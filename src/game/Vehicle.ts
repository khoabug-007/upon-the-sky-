import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Input } from './Input';
import type { WorldMap } from '../world/WorldMap';

export type RiderId = 'me' | string;

/** Seats inside the cab / troop bay, not hanging off the sides. Nose is local -Z. */
const SEAT_LOCAL: THREE.Vector3[] = [
  new THREE.Vector3(0.28, 1.06, 1.46),
  new THREE.Vector3(-0.28, 1.06, 1.46),
  new THREE.Vector3(0.28, 1.04, 0.28),
  new THREE.Vector3(-0.28, 1.04, 0.28),
  new THREE.Vector3(0.28, 1.04, -0.62),
  new THREE.Vector3(-0.28, 1.04, -0.62)
];
const WHEEL_R = 0.48;

const FLOOR_NAMES = new Set([
  'Motor Pool', 'Convoy Road', 'Level 50 Plaza', 'Level 17', 'Level 50'
]);

const WHEELBASE = 3.2;
const MAX_STEER = 0.40;
const ENGINE = 7.2;
const BRAKE = 14;
const DRAG = 1.35;
const MAX_FWD = 15;
const MAX_REV = 5.5;

/** 6-seat troop truck with visible chairs and car-like steering. */
export class Transport {
  readonly group = new THREE.Group();
  heading = Math.PI;
  speed = 0;
  readonly occupants: Array<RiderId | null> = [null, null, null, null, null, null];
  readonly half = new THREE.Vector3(1.15, 1.1, 3.05);
  private steer = 0;
  private readonly seats: THREE.Group[] = [];
  private readonly wheels: THREE.Mesh[] = [];
  private pitch = 0;
  private readonly _fwd = new THREE.Vector3();
  private readonly _seat = new THREE.Vector3();
  private readonly _side = new THREE.Vector3();

  constructor(scene: THREE.Scene, spawn: { pos: THREE.Vector3; heading: number } | null) {
    if (spawn) {
      this.group.position.copy(spawn.pos);
      this.heading = spawn.heading;
    } else {
      this.group.position.set(0, -80, 0);
    }
    this.group.rotation.order = 'YXZ';
    this.group.rotation.y = this.heading;
    this.buildStandIn();
    this.buildWheels();
    this.buildChairs();
    this.loadMesh();
    scene.add(this.group);
  }

  seatOf(id: RiderId): number {
    return this.occupants.indexOf(id);
  }

  near(pos: THREE.Vector3, radius = 3.8): boolean {
    const dx = pos.x - this.group.position.x;
    const dz = pos.z - this.group.position.z;
    return dx * dx + dz * dz < radius * radius
      && Math.abs(pos.y - this.group.position.y) < 3.2;
  }

  enter(id: RiderId): number {
    if (this.seatOf(id) >= 0) return this.seatOf(id);
    for (let i = 0; i < 6; i++) {
      if (!this.occupants[i]) {
        this.occupants[i] = id;
        return i;
      }
    }
    return -1;
  }

  /** Bolt a character into a chair so they ride with the truck. */
  attachRider(rider: THREE.Object3D, seatIndex: number): void {
    const seat = this.seats[seatIndex] ?? this.seats[0];
    seat.attach(rider);
    rider.position.set(0, 0.02, 0.04);
    rider.rotation.set(0, Math.PI, 0);
  }

  detachRider(rider: THREE.Object3D, scene: THREE.Scene): void {
    scene.attach(rider);
  }

  exit(id: RiderId): THREE.Vector3 | null {
    const i = this.seatOf(id);
    if (i < 0) return null;
    this.occupants[i] = null;
    if (!this.occupants[0]) this.speed *= 0.25;
    const side = i % 2 === 0 ? 2.6 : -2.6;
    this._side.set(side, 0.15, 0).applyEuler(this.group.rotation);
    return this.group.position.clone().add(this._side);
  }

  seatWorld(index: number, out = this._seat): THREE.Vector3 {
    const local = SEAT_LOCAL[index] ?? SEAT_LOCAL[0];
    out.copy(local).applyEuler(this.group.rotation).add(this.group.position);
    return out;
  }

  updateDrive(dt: number, input: Input, world: WorldMap): void {
    const want = (input.down('KeyA') ? -MAX_STEER : 0) + (input.down('KeyD') ? MAX_STEER : 0);
    this.steer += (want - this.steer) * Math.min(1, 10 * dt);

    const throttle = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    const top = (input.down('ShiftLeft') || input.down('ShiftRight')) ? 20 : MAX_FWD;
    if (throttle > 0) this.speed += ENGINE * dt;
    else if (throttle < 0) this.speed -= (this.speed > 0.45 ? BRAKE : ENGINE * 0.5) * dt;
    this.speed -= Math.sign(this.speed) * DRAG * dt;
    if (Math.abs(this.speed) < 0.04) this.speed = 0;
    this.speed = THREE.MathUtils.clamp(this.speed, -MAX_REV, top);

    if (Math.abs(this.speed) > 0.45) {
      this.heading += (this.speed / WHEELBASE) * Math.tan(this.steer) * dt;
    }

    this._fwd.set(-Math.sin(this.heading), 0, -Math.cos(this.heading));
    const nx = this.group.position.x + this._fwd.x * this.speed * dt;
    const nz = this.group.position.z + this._fwd.z * this.speed * dt;
    if (this.blocked(nx, nz, world)) {
      this.speed *= 0.35;
    } else {
      this.group.position.x = nx;
      this.group.position.z = nz;
    }
    this.snapFloor(dt, world);
    this.alignToRoad(world);
    this.group.rotation.y = this.heading;
    this.group.rotation.x = this.pitch;
    const spin = (this.speed / WHEEL_R) * dt;
    for (const w of this.wheels) {
      w.rotation.x += spin;
      w.rotation.y = w.userData.front ? this.steer : 0;
    }
  }

  private blocked(x: number, z: number, world: WorldMap): boolean {
    const minX = x - this.half.x, maxX = x + this.half.x;
    const minY = this.group.position.y + 0.4, maxY = this.group.position.y + 2.1;
    const minZ = z - this.half.z, maxZ = z + this.half.z;
    for (const c of world.colliders) {
      if (c.disabled) continue;
      if (c.name && FLOOR_NAMES.has(c.name)) continue;
      const boxH = c.max.y - c.min.y;
      if (boxH < 1.05) continue;
      if (maxX <= c.min.x || minX >= c.max.x) continue;
      if (maxY <= c.min.y || minY >= c.max.y) continue;
      if (maxZ <= c.min.z || minZ >= c.max.z) continue;
      return true;
    }
    return false;
  }

  private snapFloor(dt: number, world: WorldMap): void {
    const hint = this.group.position.y;
    const x = this.group.position.x;
    const z = this.group.position.z;
    const top = this.floorY(x, z, world, hint)
      ?? this.floorY(x + this._fwd.x * 1.6, z + this._fwd.z * 1.6, world, hint)
      ?? this.floorY(x - this._fwd.x * 1.6, z - this._fwd.z * 1.6, world, hint);
    if (top !== null) this.group.position.y = top;
    else this.group.position.y -= 22 * dt;
  }

  private floorY(x: number, z: number, world: WorldMap, hint = this.group.position.y): number | null {
    let top: number | null = null;
    let best = Infinity;
    for (const c of world.colliders) {
      if (c.disabled || !c.name || !FLOOR_NAMES.has(c.name)) continue;
      if (!world.containsXZ(c, x, z)) continue;
      const d = Math.abs(c.max.y - hint);
      if (d < best) {
        best = d;
        top = c.max.y;
      }
    }
    return top;
  }

  private alignToRoad(world: WorldMap): void {
    const fx = this.group.position.x + this._fwd.x * 1.5;
    const fz = this.group.position.z + this._fwd.z * 1.5;
    const bx = this.group.position.x - this._fwd.x * 1.5;
    const bz = this.group.position.z - this._fwd.z * 1.5;
    const fy = this.floorY(fx, fz, world);
    const by = this.floorY(bx, bz, world);
    if (fy === null || by === null) {
      this.pitch += (0 - this.pitch) * 0.15;
      return;
    }
    const want = Math.atan2(fy - by, 3);
    this.pitch += (THREE.MathUtils.clamp(want, -0.35, 0.35) - this.pitch) * 0.2;
  }

  private buildWheels(): void {
    const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 });
    for (const sx of [-0.92, 0.92]) {
      for (const sz of [-1.85, 1.55]) {
        const tire = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.36, 14), rubber);
        tire.rotation.z = Math.PI / 2;
        tire.position.set(sx, WHEEL_R, sz);
        tire.userData.front = sz > 0;
        tire.castShadow = true;
        this.group.add(tire);
        this.wheels.push(tire);
      }
    }
  }

  private buildChairs(): void {
    const cushion = new THREE.MeshStandardMaterial({ color: 0x3a3d32, roughness: 0.88 });
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      g.position.copy(SEAT_LOCAL[i]);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.08, 0.36), cushion);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.42, 0.07), cushion);
      back.position.set(0, 0.22, -0.16);
      g.add(pad, back);
      this.group.add(g);
      this.seats.push(g);
    }
  }

  private buildStandIn(): void {
    const hull = new THREE.Group();
    hull.name = 'stand-in';
    const mat = (hex: number, rough = 0.82) =>
      new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: 0.22 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.05, 1.05, 5.2), mat(0x4b5335));
    body.position.y = 1.22;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.95, 1.55), mat(0x3f462c));
    cab.position.set(0, 2.05, 1.55);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 0.06), mat(0x8aa0b8, 0.2));
    glass.position.set(0, 2.12, 2.32);
    hull.add(body, cab, glass);
    this.group.add(hull);
  }

  private loadMesh(): void {
    new GLTFLoader().load('/assets/military-transport.glb', (gltf) => {
      const root = gltf.scene;
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const longest = Math.max(size.x, size.z, 0.01);
      root.scale.setScalar(6.4 / longest);
      // Nose along local -Z so heading 0 drives the way the truck faces.
      root.rotation.y = Math.PI;
      root.updateMatrixWorld(true);
      box.setFromObject(root);
      root.position.y -= box.min.y;
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      const standIn = this.group.getObjectByName('stand-in');
      if (standIn) standIn.visible = false;
      this.group.add(root);
    });
  }
}
