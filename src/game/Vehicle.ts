import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Input } from './Input';
import type { WorldMap } from '../world/WorldMap';

export type RiderId = 'me' | string;

const SEAT_LOCAL: THREE.Vector3[] = [
  new THREE.Vector3(0.48, 1.12, 1.35),
  new THREE.Vector3(-0.48, 1.12, 1.35),
  new THREE.Vector3(0.52, 1.08, -0.15),
  new THREE.Vector3(-0.52, 1.08, -0.15),
  new THREE.Vector3(0.52, 1.08, -1.25),
  new THREE.Vector3(-0.52, 1.08, -1.25)
];

const FLOOR_NAMES = new Set([
  'Motor Pool', 'Convoy Road', 'Level 50 Plaza', 'Level 17', 'Level 50'
]);

/** 6-seat troop truck. Loads Meshy GLB when present; otherwise a stand-in hull. */
export class Transport {
  readonly group = new THREE.Group();
  heading = Math.PI;
  speed = 0;
  readonly occupants: Array<RiderId | null> = [null, null, null, null, null, null];
  readonly half = new THREE.Vector3(1.2, 1.15, 3.15);
  private model: THREE.Object3D | null = null;
  private readonly _fwd = new THREE.Vector3();
  private readonly _seat = new THREE.Vector3();

  constructor(scene: THREE.Scene, spawn: { pos: THREE.Vector3; heading: number } | null) {
    if (spawn) {
      this.group.position.copy(spawn.pos);
      this.heading = spawn.heading;
    } else {
      this.group.position.set(0, -80, 0);
    }
    this.group.rotation.y = this.heading;
    this.buildStandIn();
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
    const start = this.occupants[0] ? 1 : 0;
    for (let i = start; i < 6; i++) {
      if (!this.occupants[i]) {
        this.occupants[i] = id;
        return i;
      }
    }
    if (!this.occupants[0]) {
      this.occupants[0] = id;
      return 0;
    }
    return -1;
  }

  exit(id: RiderId): THREE.Vector3 | null {
    const i = this.seatOf(id);
    if (i < 0) return null;
    this.occupants[i] = null;
    if (id === 'me' && !this.occupants[0]) this.speed *= 0.2;
    const side = i % 2 === 0 ? 2.4 : -2.4;
    return this.group.position.clone().add(new THREE.Vector3(side, 0.2, 0));
  }

  seatWorld(index: number, out = this._seat): THREE.Vector3 {
    const local = SEAT_LOCAL[index] ?? SEAT_LOCAL[0];
    out.copy(local).applyEuler(this.group.rotation).add(this.group.position);
    return out;
  }

  updateDrive(dt: number, input: Input, world: WorldMap): void {
    const throttle = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    const steer = (input.down('KeyA') ? 1 : 0) - (input.down('KeyD') ? 1 : 0);
    const max = (input.down('ShiftLeft') || input.down('ShiftRight')) ? 22 : 14;
    this.speed += throttle * 16 * dt;
    if (throttle === 0) this.speed *= Math.max(0, 1 - 2.4 * dt);
    this.speed = THREE.MathUtils.clamp(this.speed, -7, max);
    if (Math.abs(this.speed) > 0.25) {
      this.heading += steer * 1.2 * dt * Math.sign(this.speed);
    }
    this._fwd.set(-Math.sin(this.heading), 0, -Math.cos(this.heading));
    const nx = this.group.position.x + this._fwd.x * this.speed * dt;
    const nz = this.group.position.z + this._fwd.z * this.speed * dt;
    if (!this.blocked(nx, this.group.position.z, world)) this.group.position.x = nx;
    else this.speed *= 0.4;
    if (!this.blocked(this.group.position.x, nz, world)) this.group.position.z = nz;
    else this.speed *= 0.4;
    this.snapFloor(world);
    this.group.rotation.y = this.heading;
  }

  private blocked(x: number, z: number, world: WorldMap): boolean {
    const minX = x - this.half.x, maxX = x + this.half.x;
    const minY = this.group.position.y + 0.35, maxY = this.group.position.y + this.half.y * 2;
    const minZ = z - this.half.z, maxZ = z + this.half.z;
    for (const c of world.colliders) {
      if (c.disabled) continue;
      if (c.name && FLOOR_NAMES.has(c.name)) continue;
      const boxH = c.max.y - c.min.y;
      if (boxH < 1.2) continue;
      if (maxX <= c.min.x || minX >= c.max.x) continue;
      if (maxY <= c.min.y || minY >= c.max.y) continue;
      if (maxZ <= c.min.z || minZ >= c.max.z) continue;
      return true;
    }
    return false;
  }

  private snapFloor(world: WorldMap): void {
    let top = this.group.position.y;
    let found = false;
    const x = this.group.position.x;
    const z = this.group.position.z;
    for (const c of world.colliders) {
      if (c.disabled) continue;
      if (x < c.min.x || x > c.max.x || z < c.min.z || z > c.max.z) continue;
      const h = c.max.y - c.min.y;
      if (h > 2.4) continue;
      if (c.max.y > top + 4) continue;
      if (!found || c.max.y > top) {
        top = c.max.y;
        found = true;
      }
    }
    if (found) this.group.position.y = top;
  }

  private buildStandIn(): void {
    const hull = new THREE.Group();
    hull.name = 'stand-in';
    const mat = (hex: number, rough = 0.82) =>
      new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: 0.22 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.15, 5.6), mat(0x4b5335));
    body.position.y = 1.15;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.15, 1.05, 1.7), mat(0x3f462c));
    cab.position.set(0, 2.05, 1.7);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 0.08), mat(0x8aa0b8, 0.2));
    glass.position.set(0, 2.15, 2.54);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.12, 3.2), mat(0x5a6140));
    bed.position.set(0, 1.78, -0.85);
    hull.add(body, cab, glass, bed);
    for (const sx of [-0.85, 0.85]) {
      for (const sz of [-2.1, -0.3, 1.6]) {
        const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.38, 12), mat(0x1a1a1a, 0.95));
        tire.rotation.z = Math.PI / 2;
        tire.position.set(sx, 0.48, sz);
        hull.add(tire);
      }
    }
    this.group.add(hull);
  }

  private loadMesh(): void {
    new GLTFLoader().load('/assets/military-transport.glb', (gltf) => {
      const root = gltf.scene;
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const longest = Math.max(size.x, size.z, 0.01);
      const scale = 6.4 / longest;
      root.scale.setScalar(scale);
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
      this.model = root;
      this.group.add(root);
    });
  }
}
