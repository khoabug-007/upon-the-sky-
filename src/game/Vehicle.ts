import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Input } from './Input';
import type { WorldMap } from '../world/WorldMap';

export type RiderId = 'me' | string;

/** Seats in the cab / bay. After the mesh yaw, the windshield is local +Z. */
const SEAT_LOCAL: THREE.Vector3[] = [
  new THREE.Vector3(-0.28, 1.06, 1.85),
  new THREE.Vector3(0.28, 1.06, 1.85),
  new THREE.Vector3(-0.28, 1.04, 0.55),
  new THREE.Vector3(0.28, 1.04, 0.55),
  new THREE.Vector3(-0.28, 1.04, -0.65),
  new THREE.Vector3(0.28, 1.04, -0.65)
];
const WHEEL_R = 0.42;

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
  heading = 0;
  speed = 0;
  readonly occupants: Array<RiderId | null> = [null, null, null, null, null, null];
  readonly half = new THREE.Vector3(1.15, 1.1, 3.05);
  private steer = 0;
  private readonly seats: THREE.Group[] = [];
  private readonly wheels: THREE.Object3D[] = [];
  private pitch = 0;
  private lastFloorY = 0;
  private readonly home = { pos: new THREE.Vector3(0, -80, 0), heading: 0 };
  private readonly _fwd = new THREE.Vector3();
  private readonly _seat = new THREE.Vector3();
  private readonly _side = new THREE.Vector3();

  constructor(scene: THREE.Scene, spawn: { pos: THREE.Vector3; heading: number } | null) {
    if (spawn) {
      this.home.pos.copy(spawn.pos);
      this.home.heading = spawn.heading;
      this.group.position.copy(spawn.pos);
      this.heading = spawn.heading;
      this.lastFloorY = spawn.pos.y;
    } else {
      this.group.position.copy(this.home.pos);
    }
    this.group.rotation.order = 'YXZ';
    this.group.rotation.y = this.heading;
    this.buildStandIn();
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
    rider.position.set(0, 0.02, 0.08);
    rider.rotation.set(0, 0, 0);
  }

  detachRider(rider: THREE.Object3D, scene: THREE.Scene): void {
    scene.attach(rider);
  }

  exit(id: RiderId): THREE.Vector3 | null {
    const i = this.seatOf(id);
    if (i < 0) return null;
    this.occupants[i] = null;
    if (!this.occupants[0]) this.speed *= 0.25;
    const side = i % 2 === 0 ? -2.6 : 2.6;
    this._side.set(side, 0.15, 0).applyEuler(this.group.rotation);
    return this.group.position.clone().add(this._side);
  }

  seatWorld(index: number, out = this._seat): THREE.Vector3 {
    const local = SEAT_LOCAL[index] ?? SEAT_LOCAL[0];
    out.copy(local).applyEuler(this.group.rotation).add(this.group.position);
    return out;
  }

  updateDrive(dt: number, input: Input, world: WorldMap): void {
    const want = (input.down('KeyA') ? MAX_STEER : 0) + (input.down('KeyD') ? -MAX_STEER : 0);
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

    this._fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading));
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
      w.rotation.z += spin;
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
    if (top !== null) {
      this.lastFloorY = top;
      this.group.position.y = top;
    } else {
      this.group.position.y -= 22 * dt;
    }
  }

  /** True once the truck has dropped off the road far enough to scrap. */
  fellOff(): boolean {
    return this.group.position.y < this.lastFloorY - 4
      || this.group.position.y < this.home.pos.y - 10
      || this.group.position.y < -20;
  }

  /** Vanish the fallen truck and put a fresh one on the motor-pool pad. */
  respawn(): void {
    this.occupants.fill(null);
    this.speed = 0;
    this.steer = 0;
    this.pitch = 0;
    this.heading = this.home.heading;
    this.lastFloorY = this.home.pos.y;
    this.group.position.copy(this.home.pos);
    this.group.rotation.set(0, this.heading, 0);
    for (const w of this.wheels) {
      w.rotation.y = 0;
    }
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

  private buildChairs(): void {
    const cushion = new THREE.MeshStandardMaterial({ color: 0x3a3d32, roughness: 0.88 });
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      g.position.copy(SEAT_LOCAL[i]);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.08, 0.36), cushion);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.42, 0.07), cushion);
      back.position.set(0, 0.22, -0.18);
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
      this.splitModelWheels(root);
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const longest = Math.max(size.x, size.z, 0.01);
      root.scale.setScalar(6.4 / longest);
      // Mesh is modeled along +X (cab at +X). Yaw cab to local +Z so W drives toward the windshield.
      if (size.x >= size.z) root.rotation.y = -Math.PI / 2;
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

  /** Tag the four factory tires, cut them into spinning pivots, leave the hull in place. */
  private splitModelWheels(root: THREE.Object3D): void {
    const found: THREE.Mesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (found.length === 0 && m.isMesh) found.push(m);
    });
    const hull = found[0];
    if (!hull) return;
    const src = hull.geometry.index ? hull.geometry.toNonIndexed() : hull.geometry.clone();
    const pos = src.getAttribute('position');
    if (!pos) return;
    const tag = new Int8Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      tag[i] = wheelSlot(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    const body = gatherTris(src, tag, 0);
    if (body) hull.geometry = body;
    const parent = hull.parent ?? root;
    for (let slot = 1; slot <= 4; slot++) {
      const geo = gatherTris(src, tag, slot);
      if (!geo) continue;
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      const center = bb.getCenter(new THREE.Vector3());
      geo.translate(-center.x, -center.y, -center.z);
      const mesh = new THREE.Mesh(geo, hull.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const pivot = new THREE.Group();
      pivot.rotation.order = 'YZX';
      pivot.position.copy(center);
      pivot.userData.front = slot <= 2;
      pivot.add(mesh);
      parent.add(pivot);
      this.wheels.push(pivot);
    }
  }
}

function wheelSlot(x: number, y: number, z: number): number {
  if (y > 0.95 || Math.abs(z) < 0.72) return 0;
  if (x > 1.25) return z > 0 ? 1 : 2;
  if (x < -1.25) return z > 0 ? 3 : 4;
  return 0;
}

function gatherTris(src: THREE.BufferGeometry, tag: Int8Array, slot: number): THREE.BufferGeometry | null {
  const pos = src.getAttribute('position');
  const nrm = src.getAttribute('normal');
  const uv = src.getAttribute('uv');
  const posOut: number[] = [];
  const nrmOut: number[] = [];
  const uvOut: number[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    const votes = (tag[i] === slot ? 1 : 0) + (tag[i + 1] === slot ? 1 : 0) + (tag[i + 2] === slot ? 1 : 0);
    const keep = slot === 0 ? votes === 3 : votes >= 2;
    if (!keep) continue;
    for (let k = 0; k < 3; k++) {
      const v = i + k;
      posOut.push(pos.getX(v), pos.getY(v), pos.getZ(v));
      if (nrm) nrmOut.push(nrm.getX(v), nrm.getY(v), nrm.getZ(v));
      if (uv) uvOut.push(uv.getX(v), uv.getY(v));
    }
  }
  if (posOut.length < 9) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(posOut, 3));
  if (nrmOut.length) geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrmOut, 3));
  else geo.computeVertexNormals();
  if (uvOut.length) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvOut, 2));
  return geo;
}
