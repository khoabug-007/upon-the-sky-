import * as THREE from 'three';
import { gltfLoader } from '../render/gltf';
import { appendClimbLevels, placeThrowGate, type ClimbApi, type ThrowSwitch } from './climbCourse';
import { isLiftName, isSteelPad, lookMaterial } from './looks';
import { buildUfoCraft, ufoDeckSize, type UfoKind } from './ufoCraft';

export interface BoxCollider {
  min: THREE.Vector3;
  max: THREE.Vector3;
  bouncy?: boolean;
  moverIndex?: number;
  name?: string;
  disabled?: boolean;
  /** When set, XZ hit tests use this rotated rectangle instead of the fat AABB. */
  yaw?: number;
  cx?: number;
  cz?: number;
  halfW?: number;
  halfD?: number;
}

export interface Mover {
  mesh: THREE.Mesh;
  collider: BoxCollider;
  a: THREE.Vector3;
  b: THREE.Vector3;
  speed: number;
  phase: number;
  size: THREE.Vector3;
  delta: THREE.Vector3;
  /** If set, ping-pong at constant speed instead of a sine surge in the middle. */
  linear?: boolean;
}

export interface Rotor {
  pivot: THREE.Group;
  center: THREE.Vector3;
  armLength: number;
  barY: number;
  speed: number;
  angle: number;
}

export interface Checkpoint {
  index: number;
  pos: THREE.Vector3;
  ring: THREE.Mesh;
  flagMat: THREE.MeshStandardMaterial;
  label: string;
}

interface FlickerPad {
  mesh: THREE.Mesh;
  collider: BoxCollider;
  goneUntil: number;
}

interface ConvoyCrate {
  mesh: THREE.Mesh;
  collider: BoxCollider;
}

interface ConvoySeg {
  mesh: THREE.Mesh;
  collider: BoxCollider;
  crates: ConvoyCrate[];
  extras: BoxCollider[];
  homeY: number;
  falling: boolean;
  fallVel: number;
}

const CRATE_W = 3.4;
const CRATE_D = 2.2;
const CRATE_H = 3.6;
const CONVOY_DROP_EVERY = 1;
const CONVOY_KEEP_END = 2;
const CONVOY_SKIP_START = 1;
const CONVOY_ARM_DIST = 8;

interface WarpWatch {
  group: THREE.Group;
  phase: number;
  base: number;
  mats: THREE.MeshStandardMaterial[];
}

interface SpaceFloater {
  group: THREE.Group;
  base: THREE.Vector3;
  phase: number;
  spin: number;
}

export interface Prop {
  id: number;
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  radius: number;
  heldBy: string | null; // network id or 'me'
  home: THREE.Vector3;
}

/** Walkable ramp. y interpolates from y0 at z0 (bottom) to y1 at z1 (top). */
export interface Slope {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y0: number;
  y1: number;
  name: string;
  pad: BoxCollider;
}

export interface HazardBall {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  radius: number;
  active: boolean;
  slope: Slope;
}

const BALL_COLORS = [0x3498db, 0xe74c3c, 0x9b59b6, 0xf1c40f, 0xe67e22, 0x1abc9c];
const MAX_SLOPE_BALLS = 18;

export const SKY_START_Y = 90;
// Low-gravity kicks in at the sky-bridge cloud (~y 88); matches retuned course pacing
export const SPACE_START_Y = 88;
/** Max vertical step without assist (matches PlayerController.JUMP_HEIGHT_SAFE). */
const JUMP_STEP = 1.5;
/** Max vertical step in low gravity (matches PlayerController.SPACE_JUMP_HEIGHT_SAFE). */
const SPACE_STEP = 6.5;
/**
 * Jump reach from PlayerController physics (JUMP_VEL 9.6, GRAVITY -25, walk 5.5 / run 9.6):
 *   height 1.84 m | hang 0.77 s | walk 4.22 m | run 7.37 m
 *   hop of +JUMP_STEP: walk edge gap stays JUMP_GAP (one block).
 * Player radius 0.38, so walkable edge-to-edge at +JUMP_STEP stays JUMP_GAP.
 */
const JUMP_GAP = 2.2;
/** Half-width of paired slider travel; keeps worst-case 3D hop inside walk reach. */
const SLIDER_X = 2.2;
/** Along-travel walkway length: 3× the previous live scale (2/3). */
const PATH_LEN = 2;
/** Extra authored pieces: 3× the previous live scale (1/3). Hop holes stay JUMP_GAP. */
const COURSE_RUN = 1;
const runCount = (n: number) => Math.max(1, Math.round(n * COURSE_RUN));
const along = (d: number) => d * PATH_LEN;
const hopCenter = (prevZ: number, prevAlong: number, nextAlong: number) =>
  prevZ + prevAlong / 2 + JUMP_GAP + nextAlong / 2;
const joinCenter = (prevZ: number, prevAlong: number, nextAlong: number) =>
  prevZ + prevAlong / 2 + nextAlong / 2;
const BG_WATCHES = 20;
const WATCHES_40_60 = 8;
const WATCHES_60_67 = BG_WATCHES - WATCHES_40_60;
/** Typical pocket-watch world size used to scale floating craft. */
const WATCH_WORLD = 6.4;
const BG_RIFTS = 32;

const mat = (color: number, rough = 0.85) => lookMaterial(color, rough);

function makeSign(text: string[], scale = 1): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 320;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(255, 250, 235, 0.94)';
  ctx.beginPath(); ctx.roundRect(10, 10, 620, 300, 36); ctx.fill();
  ctx.strokeStyle = '#b8860b'; ctx.lineWidth = 10; ctx.stroke();
  ctx.fillStyle = '#3a2e1a';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 52px "Baloo 2", sans-serif';
  const lineH = 66;
  const startY = 160 - ((text.length - 1) * lineH) / 2;
  text.forEach((line, i) => ctx.fillText(line, 320, startY + i * lineH));
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas), transparent: true
  }));
  sprite.scale.set(6 * scale, 3 * scale, 1);
  return sprite;
}

function makeErrorWorldSign(): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 320;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(18, 12, 28, 0.92)';
  ctx.beginPath(); ctx.roundRect(16, 16, 992, 288, 28); ctx.fill();
  ctx.strokeStyle = '#c4a35a'; ctx.lineWidth = 10; ctx.stroke();
  ctx.fillStyle = '#f4ead2';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '700 92px Cinzel, "Times New Roman", serif';
  ctx.fillText('The Error World', 512, 160);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas), transparent: true
  }));
  sprite.scale.set(9.4, 2.95, 1);
  return sprite;
}

function warpGold(hex: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: hex,
    metalness: 0.88,
    roughness: 0.22,
    emissive: 0x3b1860,
    emissiveIntensity: 0.28
  });
}

export class WorldMap {
  colliders: BoxCollider[] = [];
  movers: Mover[] = [];
  rotors: Rotor[] = [];
  checkpoints: Checkpoint[] = [];
  props: Prop[] = [];
  slopes: Slope[] = [];
  hazardBalls: HazardBall[] = [];
  throwSwitches: ThrowSwitch[] = [];
  vehicleSpawn: { pos: THREE.Vector3; heading: number } | null = null;
  stars!: THREE.Points;
  courseStars!: THREE.Points;
  blockStars!: THREE.Points;
  skyFollow = new THREE.Group();
  courseNebulaMat!: THREE.SpriteMaterial;
  skyBandMinY = 55;
  skyBandMaxY = 400;
  endingPos = new THREE.Vector3();
  spawnPos = new THREE.Vector3(0, 0.1, -4);

  private clouds: THREE.Group[] = [];
  private endingRing!: THREE.Mesh;
  private time = 0;
  private ballSpawnWait = 1;
  private flickerPads: FlickerPad[] = [];
  private flickerPickAt = 4;
  private convoySegs: ConvoySeg[] = [];
  private convoyArmed = false;
  private convoyDropAcc = 0;
  private convoyNext = CONVOY_SKIP_START;
  private crateGeo = new THREE.BoxGeometry(CRATE_W, CRATE_H, CRATE_D);
  private crateMat = mat(0xb5651d);
  private roadBit = new THREE.BoxGeometry(1, 1, 1);
  private curbMat = new THREE.MeshStandardMaterial({ color: 0x6a645c, roughness: 0.92 });
  private laneMat = new THREE.MeshStandardMaterial({
    color: 0xe6c84a, roughness: 0.62, emissive: 0x4a3800, emissiveIntensity: 0.07
  });
  private warpWatches: WarpWatch[] = [];
  private errorRifts: THREE.Mesh[] = [];
  private spaceFloaters: SpaceFloater[] = [];
  private errorWorldOrigin = new THREE.Vector3();
  private riftSpriteMat: THREE.ShaderMaterial | null = null;
  private riftDoorMatA: THREE.MeshStandardMaterial | null = null;
  private riftDoorMatB: THREE.MeshStandardMaterial | null = null;

  constructor(private scene: THREE.Scene) {
    this.build();
  }

  // ---------- helpers ----------

  private meteor = 0;

  private addBox(
    w: number, h: number, d: number,
    x: number, y: number, z: number,
    color: number, opts: { bouncy?: boolean; noShadow?: boolean; name?: string; flicker?: boolean } = {}
  ): THREE.Mesh {
    const name = opts.name ?? 'Block';
    if (isSteelPad(color) && !opts.bouncy && !isLiftName(name)) {
      return this.addSteelBar(w, h, d, x, y, z, name);
    }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    mesh.position.set(x, y, z);
    mesh.name = name;
    if (!opts.noShadow) { mesh.castShadow = true; mesh.receiveShadow = true; }
    this.scene.add(mesh);
    const rim = h <= 2.2 ? 0.28 : 0;
    this.colliders.push({
      min: new THREE.Vector3(x - w / 2 - rim, y - h / 2, z - d / 2 - rim),
      max: new THREE.Vector3(x + w / 2 + rim, y + h / 2, z + d / 2 + rim),
      bouncy: opts.bouncy,
      name
    });
    if (opts.flicker) {
      this.flickerPads.push({ mesh, collider: this.colliders[this.colliders.length - 1]!, goneUntil: 0 });
    }
    return mesh;
  }

  private addOrientedSlab(
    w: number, h: number, d: number,
    x: number, y: number, z: number,
    rotY: number, color: number, name: string
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    const rim = h <= 2.2 ? 0.28 : 0;
    const hw = w / 2 + rim, hd = d / 2 + rim;
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const xs = [hw, hw, -hw, -hw];
    const zs = [hd, -hd, hd, -hd];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < 4; i++) {
      const wx = x + xs[i] * c + zs[i] * s;
      const wz = z - xs[i] * s + zs[i] * c;
      minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
      minZ = Math.min(minZ, wz); maxZ = Math.max(maxZ, wz);
    }
    this.colliders.push({
      min: new THREE.Vector3(minX, y - h / 2, minZ),
      max: new THREE.Vector3(maxX, y + h / 2, maxZ),
      name,
      yaw: rotY,
      cx: x,
      cz: z,
      halfW: hw,
      halfD: hd
    });
    if (name === 'Convoy Road') {
      this.convoySegs.push({
        mesh,
        collider: this.colliders[this.colliders.length - 1]!,
        crates: [],
        extras: [],
        homeY: y,
        falling: false,
        fallVel: 0
      });
      this.dressConvoyRoad(mesh, w, h, d, x, y, z, rotY);
    }
    return mesh;
  }

  /** Concrete curbs + a painted center line so the highway reads as one continuous road. */
  private dressConvoyRoad(
    mesh: THREE.Mesh, w: number, h: number, d: number,
    x: number, y: number, z: number, rotY: number
  ): void {
    const host = this.convoySegs[this.convoySegs.length - 1];
    if (!host) return;
    const curbW = 0.42;
    const curbH = 1.12;
    const edge = w / 2 - curbW * 0.45;
    const addCurb = (side: number) => {
      const curb = new THREE.Mesh(this.roadBit, this.curbMat);
      curb.scale.set(curbW, curbH, d);
      curb.position.set(side * edge, (h + curbH) * 0.5 - 0.02, 0);
      curb.castShadow = true;
      curb.receiveShadow = true;
      mesh.add(curb);
      const lx = side * edge;
      const c = Math.cos(rotY), s = Math.sin(rotY);
      const cx = x + lx * c;
      const cz = z - lx * s;
      const hw = curbW / 2, hd = d / 2;
      const xs = [hw, hw, -hw, -hw];
      const zs = [hd, -hd, hd, -hd];
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < 4; i++) {
        const wx = cx + xs[i]! * c + zs[i]! * s;
        const wz = cz - xs[i]! * s + zs[i]! * c;
        minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
        minZ = Math.min(minZ, wz); maxZ = Math.max(maxZ, wz);
      }
      const cy = y + h / 2 + curbH / 2;
      this.colliders.push({
        min: new THREE.Vector3(minX, cy - curbH / 2, minZ),
        max: new THREE.Vector3(maxX, cy + curbH / 2, maxZ),
        name: 'Road Curb',
        yaw: rotY,
        cx, cz, halfW: hw, halfD: hd
      });
      host.extras.push(this.colliders[this.colliders.length - 1]!);
    };
    addCurb(-1);
    addCurb(1);
    const dashN = Math.max(2, Math.floor(d / 4.2));
    const dashLen = Math.min(2.4, d / dashN * 0.55);
    const gap = d / dashN;
    for (let i = 0; i < dashN; i++) {
      const line = new THREE.Mesh(this.roadBit, this.laneMat);
      line.scale.set(0.16, 0.03, dashLen);
      line.position.set(0, h * 0.5 + 0.02, -d / 2 + gap * (i + 0.5));
      mesh.add(line);
    }
  }

  /** Wood block on one side of the last convoy slab, with a clear truck lane. */
  private addConvoyCrate(side: number): void {
    const host = this.convoySegs[this.convoySegs.length - 1];
    if (!host || host.collider.halfW === undefined || host.collider.yaw === undefined) return;
    const yaw = host.collider.yaw;
    const roadHalf = host.collider.halfW;
    const crateHalfW = CRATE_W / 2;
    const crateHalfD = CRATE_D / 2;
    const across = Math.sign(side || 1) * (roadHalf - crateHalfW);
    const mesh = new THREE.Mesh(this.crateGeo, this.crateMat);
    mesh.name = 'Wood Crate';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(across, (CRATE_H + (host.collider.max.y - host.collider.min.y)) / 2, 0);
    host.mesh.add(mesh);
    host.mesh.updateMatrixWorld(true);
    const wp = new THREE.Vector3();
    mesh.getWorldPosition(wp);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const xs = [crateHalfW, crateHalfW, -crateHalfW, -crateHalfW];
    const zs = [crateHalfD, -crateHalfD, crateHalfD, -crateHalfD];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < 4; i++) {
      const wx = wp.x + xs[i]! * c + zs[i]! * s;
      const wz = wp.z - xs[i]! * s + zs[i]! * c;
      minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
      minZ = Math.min(minZ, wz); maxZ = Math.max(maxZ, wz);
    }
    this.colliders.push({
      min: new THREE.Vector3(minX, wp.y - CRATE_H / 2, minZ),
      max: new THREE.Vector3(maxX, wp.y + CRATE_H / 2, maxZ),
      name: 'Wood Crate',
      yaw,
      cx: wp.x,
      cz: wp.z,
      halfW: crateHalfW,
      halfD: crateHalfD
    });
    host.crates.push({ mesh, collider: this.colliders[this.colliders.length - 1]! });
  }

  /**
   * Push a circle out of an oriented box in XZ. Returns the new center, or null if no overlap.
   */
  pushCircleFromOriented(
    c: BoxCollider, x: number, z: number, radius: number
  ): { x: number; z: number } | null {
    if (c.yaw === undefined || c.cx === undefined || c.cz === undefined
      || c.halfW === undefined || c.halfD === undefined) {
      return null;
    }
    const dx = x - c.cx;
    const dz = z - c.cz;
    const cos = Math.cos(c.yaw);
    const sin = Math.sin(c.yaw);
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;
    const hw = c.halfW;
    const hd = c.halfD;
    const closestX = THREE.MathUtils.clamp(lx, -hw, hw);
    const closestZ = THREE.MathUtils.clamp(lz, -hd, hd);
    const ox = lx - closestX;
    const oz = lz - closestZ;
    const inside = Math.abs(lx) <= hw && Math.abs(lz) <= hd;
    let nlx: number;
    let nlz: number;
    if (inside) {
      const px = hw - Math.abs(lx);
      const pz = hd - Math.abs(lz);
      if (px < pz) {
        nlx = (lx >= 0 ? 1 : -1) * (hw + radius);
        nlz = lz;
      } else {
        nlx = lx;
        nlz = (lz >= 0 ? 1 : -1) * (hd + radius);
      }
    } else {
      const d2 = ox * ox + oz * oz;
      if (d2 >= radius * radius || d2 < 1e-10) return null;
      const d = Math.sqrt(d2);
      const push = (radius - d) / d;
      nlx = lx + ox * push;
      nlz = lz + oz * push;
    }
    return {
      x: c.cx + nlx * cos + nlz * sin,
      z: c.cz - nlx * sin + nlz * cos
    };
  }

  /** Point-in-slab: oriented road pieces use their real rectangle, not the fat AABB. */
  containsXZ(c: BoxCollider, x: number, z: number): boolean {
    if (c.yaw === undefined || c.cx === undefined || c.cz === undefined
      || c.halfW === undefined || c.halfD === undefined) {
      return x >= c.min.x && x <= c.max.x && z >= c.min.z && z <= c.max.z;
    }
    const dx = x - c.cx;
    const dz = z - c.cz;
    const cos = Math.cos(c.yaw);
    const sin = Math.sin(c.yaw);
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;
    return Math.abs(lx) <= c.halfW && Math.abs(lz) <= c.halfD;
  }

  private steelSize(w: number, h: number, d: number): { bw: number; bh: number; bd: number } {
    const alongZ = d >= w;
    const length = Math.max(w, d);
    const width = THREE.MathUtils.clamp(Math.min(w, d) * 0.4, 0.95, 1.22);
    const bh = Math.min(0.34, Math.max(0.22, h * 0.45));
    return alongZ
      ? { bw: width, bh, bd: length }
      : { bw: length, bh, bd: width };
  }

  /** Narrow walkable I-beam. Collider matches the bar so you stand on steel, not air. */
  private addSteelBar(
    w: number, h: number, d: number,
    x: number, y: number, z: number, name: string
  ): THREE.Mesh {
    const { bw, bh, bd } = this.steelSize(w, h, d);
    const top = y + h / 2;
    const cy = top - bh / 2;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat(0x90a4ae));
    mesh.position.set(x, cy, z);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.colliders.push({
      min: new THREE.Vector3(x - bw / 2, cy - bh / 2, z - bd / 2),
      max: new THREE.Vector3(x + bw / 2, cy + bh / 2, z + bd / 2),
      name
    });
    this.dressMesh(mesh, '/assets/steel-beam.glb');
    return mesh;
  }

  private static craftTpl = new Map<string, THREE.Object3D>();
  private static craftWait = new Map<string, Array<(src: THREE.Object3D) => void>>();
  private static watchTpl: THREE.Object3D | null = null;
  private static watchTried = false;
  private static watchWait: Array<(src: THREE.Object3D | null) => void> = [];

  private loadCraft(url: string, place: (src: THREE.Object3D) => void): void {
    const cached = WorldMap.craftTpl.get(url);
    if (cached) {
      place(cached);
      return;
    }
    const q = WorldMap.craftWait.get(url);
    if (q) {
      q.push(place);
      return;
    }
    WorldMap.craftWait.set(url, [place]);
    gltfLoader().load(url, (gltf) => {
      WorldMap.craftTpl.set(url, gltf.scene);
      for (const fn of WorldMap.craftWait.get(url) ?? []) fn(gltf.scene);
      WorldMap.craftWait.delete(url);
    });
  }

  private dressMesh(host: THREE.Mesh, url: string): void {
    this.loadCraft(url, (src) => {
      const root = src.clone(true);
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const g = host.geometry as THREE.BoxGeometry | THREE.SphereGeometry | THREE.BufferGeometry;
      const p = (g as THREE.BoxGeometry).parameters;
      const tw = p?.width ?? 1.2;
      const th = p?.height ?? 0.8;
      const td = p?.depth ?? 1.2;
      const sx = tw / Math.max(size.x, 0.01);
      const sy = th / Math.max(size.y, 0.01);
      const sz = td / Math.max(size.z, 0.01);
      root.scale.set(sx, sy, sz);
      const c = box.getCenter(new THREE.Vector3());
      root.position.set(-c.x * sx, -c.y * sy, -c.z * sz);
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = false;
          m.receiveShadow = false;
        }
      });
      host.add(root);
    });
  }

  private addSpaceDeck(w: number, d: number, x: number, y: number, z: number, name: string): THREE.Mesh {
    const kind = name.length % 2 === 0 ? 'shuttle' : 'satellite';
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, 0.22, d * 0.92), mat(0x90a4ae));
    cap.position.set(x, y + 0.2, z);
    cap.name = name;
    cap.receiveShadow = true;
    this.scene.add(cap);
    this.colliders.push({
      min: new THREE.Vector3(x - w / 2, y - 0.15, z - d / 2),
      max: new THREE.Vector3(x + w / 2, y + 0.42, z + d / 2),
      name
    });
    const url = kind === 'shuttle' ? '/assets/space-shuttle.glb' : '/assets/space-satellite.glb';
    const place = (src: THREE.Object3D) => {
      const root = src.clone(true);
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      root.scale.multiplyScalar(Math.min(w, d) * 0.95 / Math.max(size.x, size.z, 0.01));
      box.setFromObject(root);
      root.position.set(x, y + 0.05 - box.min.y, z);
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = false;
          m.receiveShadow = false;
        }
      });
      this.scene.add(root);
    };
    const cached = WorldMap.craftTpl.get(url);
    if (cached) {
      place(cached);
      return cap;
    }
    gltfLoader().load(url, (gltf) => {
      WorldMap.craftTpl.set(url, gltf.scene);
      place(gltf.scene);
    }, undefined, () => {
      const fallback = new THREE.Mesh(
        kind === 'shuttle' ? new THREE.BoxGeometry(w * 0.8, 0.7, d * 0.55) : new THREE.OctahedronGeometry(Math.min(w, d) * 0.28, 1),
        new THREE.MeshStandardMaterial({ color: kind === 'shuttle' ? 0xeeeee8 : 0xc9b037, metalness: 0.4, roughness: 0.35 })
      );
      fallback.position.set(x, y + 0.55, z);
      this.scene.add(fallback);
    });
    return cap;
  }

  private addTrampoline(x: number, y: number, z: number, r = 1.6, name = 'Trampoline'): void {
    const charcoal = mat(0x3a3a42, 0.55);
    const ridges = [1.18, 1.10, 1.03];
    for (let i = 0; i < ridges.length; i++) {
      const rr = r * ridges[i]!;
      const h = 0.11;
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr * 1.04, h, 28), charcoal);
      ring.position.set(x, y + 0.06 + i * 0.11, z);
      ring.castShadow = true;
      ring.receiveShadow = true;
      this.scene.add(ring);
    }
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.92, r * 0.92, 0.1, 28),
      new THREE.MeshStandardMaterial({
        color: 0xff2d8a, roughness: 0.38, metalness: 0.04, emissive: 0x5a0028, emissiveIntensity: 0.18
      })
    );
    pad.position.set(x, y + 0.44, z);
    pad.name = name;
    pad.castShadow = true;
    pad.receiveShadow = true;
    this.scene.add(pad);
    const hitR = r * 1.12;
    this.colliders.push({
      min: new THREE.Vector3(x - hitR, y, z - hitR),
      max: new THREE.Vector3(x + hitR, y + 0.5, z + hitR),
      bouncy: true,
      name
    });
  }

  private addMover(
    w: number, h: number, d: number,
    a: THREE.Vector3, b: THREE.Vector3,
    color: number, speed = 1, phase = 0, name = 'Moving Block'
  ): void {
    const lift = isLiftName(name);
    let mw = w, mh = h, md = d;
    if (isSteelPad(color) && !lift) {
      const bar = this.steelSize(w, h, d);
      mw = bar.bw; mh = bar.bh; md = bar.bd;
    }
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(mw, mh, md),
      mat(isSteelPad(color) && !lift ? 0x90a4ae : color, 0.6)
    );
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.position.copy(a);
    mesh.name = name;
    this.scene.add(mesh);
    if (isSteelPad(color) && !lift) this.dressMesh(mesh, '/assets/steel-beam.glb');
    const size = new THREE.Vector3(mw, mh, md);
    const collider: BoxCollider = {
      min: a.clone().sub(size.clone().multiplyScalar(0.5)),
      max: a.clone().add(size.clone().multiplyScalar(0.5)),
      moverIndex: this.movers.length,
      name
    };
    this.colliders.push(collider);
    this.movers.push({ mesh, collider, a: a.clone(), b: b.clone(), speed, phase, size, delta: new THREE.Vector3() });
  }

  /** Large walkable UFO that ferries the player between two points. */
  private addUfo(
    kind: UfoKind,
    a: THREE.Vector3,
    b: THREE.Vector3,
    speed = 0.42,
    phase = 0,
    yaw = 0,
    name = 'UFO'
  ): void {
    const size = ufoDeckSize(kind);
    const visual = buildUfoCraft(kind);
    visual.rotation.y = yaw;
    visual.position.set(a.x, a.y + size.y / 2, a.z);
    this.scene.add(visual);

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size.x, size.y, size.z),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    mesh.position.copy(a);
    mesh.name = name;
    mesh.userData.cloud = visual;
    mesh.userData.yOffset = size.y / 2;
    this.scene.add(mesh);

    const collider: BoxCollider = {
      min: a.clone().sub(size.clone().multiplyScalar(0.5)),
      max: a.clone().add(size.clone().multiplyScalar(0.5)),
      moverIndex: this.movers.length,
      name
    };
    this.colliders.push(collider);
    this.movers.push({
      mesh, collider, a: a.clone(), b: b.clone(), speed, phase, size, delta: new THREE.Vector3(),
      linear: true
    });
  }

  private addRotor(
    x: number, y: number, z: number, armLength: number, speed: number,
    color = 0xe74c3c, startAngle?: number
  ): void {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2.4, 12), mat(0x8899aa));
    pole.position.y = -0.6;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(armLength * 2, 0.42, 0.42),
      new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
    bar.castShadow = true;
    pivot.add(pole, bar);
    this.scene.add(pivot);
    this.rotors.push({
      pivot, center: new THREE.Vector3(x, y, z), armLength, barY: y, speed,
      angle: startAngle ?? Math.random() * Math.PI * 2
    });
  }

  private standTopAt(x: number, z: number, hint: number): number {
    const tops: number[] = [];
    for (const c of this.colliders) {
      if (c.disabled) continue;
      const name = c.name ?? '';
      if (/coming soon/i.test(name)) continue;
      if (name === 'Earth Ground' && hint > 0.25) continue;
      if (c.max.y - c.min.y > 8) continue;
      if (!this.containsXZ(c, x, z)) continue;
      tops.push(c.max.y);
    }
    for (const s of this.slopes) {
      if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
      tops.push(this.slopeHeight(s, z));
    }
    if (!tops.length) return hint;
    tops.sort((a, b) => Math.abs(a - hint) - Math.abs(b - hint));
    return tops[0];
  }

  /** Closest walkable top under (x,z) to hintY, or null if none. */
  nearestStandY(x: number, z: number, hintY: number): number | null {
    const tops: number[] = [];
    for (const c of this.colliders) {
      if (c.disabled) continue;
      const name = c.name ?? '';
      if (/coming soon/i.test(name)) continue;
      if (name === 'Earth Ground' && hintY > 0.25) continue;
      if (c.max.y - c.min.y > 8) continue;
      if (!this.containsXZ(c, x, z)) continue;
      tops.push(c.max.y);
    }
    for (const s of this.slopes) {
      if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
      tops.push(this.slopeHeight(s, z));
    }
    if (!tops.length) return null;
    tops.sort((a, b) => Math.abs(a - hintY) - Math.abs(b - hintY));
    return tops[0];
  }

  private addCheckpoint(x: number, y: number, z: number, label: string): void {
    const index = this.checkpoints.length;
    const top = this.standTopAt(x, z, y);
    const pos = new THREE.Vector3(x, top, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.6, 10), mat(0xcfd8dc, 0.4));
    pole.position.set(x + 0.9, top + 1.3, z);
    const flagMat = new THREE.MeshStandardMaterial({ color: 0x9e9e9e, roughness: 0.5, side: THREE.DoubleSide });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.6), flagMat);
    flag.position.set(x + 0.9 - 0.5, top + 2.25, z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.09, 10, 40),
      new THREE.MeshStandardMaterial({ color: 0xffd54f, emissive: 0x8a6d00, roughness: 0.35 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, top + 0.12, z);
    this.scene.add(pole, flag, ring);
    this.checkpoints.push({ index, pos, ring, flagMat, label });
  }

  private addCloud(
    x: number, y: number, z: number, w = 6, d = 5,
    moving?: { b: THREE.Vector3; speed: number }, name = 'Cloud', walkable = true
  ): void {
    const g = new THREE.Group();
    const cm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    const blobCount = 5 + Math.floor(Math.random() * 3);
    const standTop = 0.58;
    for (let i = 0; i < blobCount; i++) {
      const r = (0.22 + Math.random() * 0.2) * Math.min(w, d);
      const blob = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), cm);
      blob.scale.y = 0.48;
      const halfH = r * 0.48;
      blob.position.set(
        (Math.random() - 0.5) * w * 0.72,
        standTop - 0.08 - halfH,
        (Math.random() - 0.5) * d * 0.72
      );
      g.add(blob);
    }
    g.position.set(x, y, z);
    this.scene.add(g);
    this.clouds.push(g);
    if (!walkable) return;
    const capH = 0.2;
    const capY = y + standTop - capH / 2;
    const padW = w * 0.86 + 0.56;
    const padD = d * 0.86 + 0.56;
    if (moving) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(padW, capH, padD),
        new THREE.MeshStandardMaterial({ visible: false }));
      mesh.position.set(x, capY, z);
      this.scene.add(mesh);
      mesh.userData.cloud = g;
      const size = new THREE.Vector3(padW, capH, padD);
      const collider: BoxCollider = {
        min: new THREE.Vector3(x - padW / 2, y + standTop - capH, z - padD / 2),
        max: new THREE.Vector3(x + padW / 2, y + standTop, z + padD / 2),
        moverIndex: this.movers.length,
        name
      };
      this.colliders.push(collider);
      this.movers.push({
        mesh, collider, a: new THREE.Vector3(x, capY, z), b: new THREE.Vector3(moving.b.x, capY, moving.b.z),
        speed: moving.speed, phase: Math.random() * 6, size, delta: new THREE.Vector3()
      });
    } else {
      this.colliders.push({
        min: new THREE.Vector3(x - padW / 2, y + standTop - capH, z - padD / 2),
        max: new THREE.Vector3(x + padW / 2, y + standTop, z + padD / 2),
        name
      });
    }
  }

  private addAsteroid(x: number, y: number, z: number, r = 2.6, name = 'Asteroid'): void {
    const standTop = y + 0.1;
    const kind = this.meteor++ % 4;
    const urls = [
      '/assets/meteor-flat.glb',
      '/assets/meteor-sphere.glb',
      '/assets/meteor-cube.glb',
      '/assets/meteor-irregular.glb'
    ];
    const geos = [
      new THREE.CylinderGeometry(r, r * 0.9, r * 0.5, 12),
      new THREE.SphereGeometry(r * 0.7, 14, 12),
      new THREE.BoxGeometry(r * 1.15, r * 1.05, r * 1.15),
      new THREE.IcosahedronGeometry(r * 0.78, 0)
    ];
    const rock = new THREE.Mesh(geos[kind], mat(0x6d6875, 0.95));
    rock.position.set(x, y, z);
    rock.rotation.set(0.12, Math.random() * Math.PI * 2, 0.06);
    rock.castShadow = true; rock.receiveShadow = true;
    rock.name = name;
    this.scene.add(rock);
    this.loadCraft(urls[kind], (src) => {
      const root = src.clone(true);
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const s = (r * 1.7) / Math.max(size.x, size.y, size.z, 0.01);
      root.scale.setScalar(s);
      root.updateMatrixWorld(true);
      const after = new THREE.Box3().setFromObject(root);
      root.position.set(x, standTop - 0.02 - after.max.y, z);
      root.rotation.copy(rock.rotation);
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
      });
      rock.visible = false;
      this.scene.add(root);
    });
    rock.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(rock);
    rock.position.y += standTop - 0.04 - bbox.max.y;
    const capR = r * 0.58;
    this.colliders.push({
      min: new THREE.Vector3(x - capR, standTop - 0.22, z - capR),
      max: new THREE.Vector3(x + capR, standTop + 0.02, z + capR),
      name
    });
  }

  /** Walkable ramp. Not added to box colliders — PlayerController sticks to the sloped surface. */
  private addWalkSlope(
    x0: number, x1: number,
    z0: number, y0: number,
    z1: number, y1: number,
    name: string,
    color = 0xb08968
  ): Slope {
    const width = x1 - x0;
    const run = z1 - z0;
    const rise = y1 - y0;
    const len = Math.hypot(run, rise);
    const angle = Math.atan2(rise, run);
    const midX = (x0 + x1) / 2;
    const midY = (y0 + y1) / 2;
    const midZ = (z0 + z1) / 2;
    const thick = 0.42;

    const ramp = new THREE.Mesh(new THREE.BoxGeometry(width, thick, len), mat(color, 0.9));
    ramp.rotation.x = -angle;
    ramp.position.set(midX, midY - Math.cos(angle) * (thick / 2), midZ + Math.sin(angle) * (thick / 2));
    ramp.castShadow = true;
    ramp.receiveShadow = true;
    ramp.name = name;
    this.scene.add(ramp);

    const curbMat = mat(0x8d6e63, 0.88);
    for (const side of [x0 + 0.12, x1 - 0.12]) {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.55, len), curbMat);
      curb.rotation.x = -angle;
      curb.position.set(side, midY + 0.12, midZ);
      curb.castShadow = true;
      this.scene.add(curb);
    }

    const pad: BoxCollider = {
      min: new THREE.Vector3(x0, y0 - 0.2, z0),
      max: new THREE.Vector3(x1, y1 + 0.2, z1),
      name
    };
    const slope: Slope = { x0, x1, z0, z1, y0, y1, name, pad };
    this.slopes.push(slope);
    return slope;
  }

  private addBallSlope(
    x0: number, x1: number,
    z0: number, y0: number,
    z1: number, y1: number,
    name = 'Marble Slope'
  ): Slope {
    const slope = this.addWalkSlope(x0, x1, z0, y0, z1, y1, name, 0xb08968);
    for (let i = 0; i < MAX_SLOPE_BALLS; i++) {
      const large = i % 2 === 0;
      const radius = large ? 1.28 + (i % 5) * 0.16 : 0.42 + (i % 4) * 0.08;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius, large ? 18 : 14, large ? 14 : 10),
        new THREE.MeshStandardMaterial({ color: BALL_COLORS[i % BALL_COLORS.length], roughness: 0.35, metalness: 0.08 })
      );
      mesh.castShadow = true;
      mesh.visible = false;
      this.scene.add(mesh);
      this.hazardBalls.push({
        mesh, pos: new THREE.Vector3(), vel: new THREE.Vector3(), radius, active: false, slope
      });
    }
    return slope;
  }

  slopeHeight(s: Slope, z: number): number {
    const t = (z - s.z0) / Math.max(1e-4, s.z1 - s.z0);
    return s.y0 + (s.y1 - s.y0) * Math.min(1, Math.max(0, t));
  }

  private addProp(x: number, y: number, z: number, kind: 'ball' | 'crate'): void {
    const id = this.props.length;
    let mesh: THREE.Mesh;
    let radius: number;
    if (kind === 'ball') {
      radius = 0.42;
      const colors = [0xff6b6b, 0x4ecdc4, 0xffe66d, 0x95e1d3];
      mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 18, 14),
        new THREE.MeshStandardMaterial({ color: colors[id % colors.length], roughness: 0.5 }));
    } else {
      radius = 0.4;
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.75, 0.75), mat(0xb07d48, 0.9));
    }
    mesh.position.set(x, y + radius, z);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.props.push({ id, mesh, vel: new THREE.Vector3(), radius, heldBy: null, home: new THREE.Vector3(x, y + radius, z) });
  }

  private addSign(text: string[], x: number, y: number, z: number, scale = 1): void {
    const s = makeSign(text, scale);
    s.position.set(x, y, z);
    this.scene.add(s);
  }

  /** Title board at the start of the convoy highway. */
  private addErrorWorldSign(x: number, y: number, z: number): void {
    const title = makeErrorWorldSign();
    title.position.set(x, y, z);
    this.scene.add(title);
  }

  /** Level 50 plaza: title, vanishing outer tiles, rifts, oversized warped watches. */
  private addErrorWorld(x: number, y: number, z: number, dx: number, dz: number): void {
    this.errorWorldOrigin.set(x, y, z);
    const tile = 4.2 * PATH_LEN;
    const n = 5;
    const h = 1;
    for (let ix = 0; ix < n; ix++) {
      for (let iz = 0; iz < n; iz++) {
        const px = x + (ix - 2) * tile;
        const pz = z + (iz - 2) * tile;
        const inner = ix >= 1 && ix <= 3 && iz >= 1 && iz <= 3;
        if (inner) {
          this.addBox(tile, h, tile, px, y, pz, 0x242420, { name: 'Level 50 Plaza' });
        } else {
          const hue = (ix * 5 + iz) % 2 === 0 ? 0x1a1528 : 0x101820;
          this.addBox(tile, h, tile, px, y, pz, hue, { name: 'Error World', flicker: true });
        }
      }
    }

    this.addErrorRifts(x, y, z, dx, dz);
    this.addErrorWatches(x, y, z, dx, dz);
  }

  private errorRiftMaterials(): {
    rift: THREE.ShaderMaterial;
    doorA: THREE.MeshStandardMaterial;
    doorB: THREE.MeshStandardMaterial;
  } {
    if (!this.riftSpriteMat) {
      this.riftSpriteMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uA: { value: new THREE.Color(0x6b4cff) },
          uB: { value: new THREE.Color(0x19e3c2) }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform vec3 uA;
          uniform vec3 uB;
          varying vec2 vUv;
          void main() {
            vec2 p = vUv * 2.0 - 1.0;
            float r = length(p);
            float a = atan(p.y, p.x);
            float swirl = sin(a * 5.0 + uTime * 1.4 - r * 8.0);
            float ring = smoothstep(1.0, 0.12, r) * smoothstep(0.02, 0.22, r);
            vec3 col = mix(uA, uB, 0.5 + 0.5 * swirl);
            gl_FragColor = vec4(col, ring * (0.35 + 0.25 * swirl));
          }
        `
      });
      this.riftDoorMatA = new THREE.MeshStandardMaterial({
        color: 0x1a1424, metalness: 0.55, roughness: 0.4, emissive: 0x2a1850, emissiveIntensity: 0.42
      });
      this.riftDoorMatB = new THREE.MeshStandardMaterial({
        color: 0x141a1c, metalness: 0.55, roughness: 0.4, emissive: 0x0d3d38, emissiveIntensity: 0.38
      });
    }
    return { rift: this.riftSpriteMat!, doorA: this.riftDoorMatA!, doorB: this.riftDoorMatB! };
  }

  private placeErrorRift(
    px: number, py: number, pz: number,
    lookX: number, lookY: number, lookZ: number, seed: number
  ): void {
    const { rift: riftMat, doorA, doorB } = this.errorRiftMaterials();
    const doorMat = seed % 2 === 0 ? doorA : doorB;
    const g = new THREE.Group();
    g.position.set(px, py, pz);
    g.lookAt(lookX, lookY, lookZ);
    const postL = new THREE.Mesh(new THREE.BoxGeometry(0.45, 7.2, 0.45), doorMat);
    const postR = postL.clone();
    postL.position.set(-2.2, 0, 0);
    postR.position.set(2.2, 0, 0);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.5, 0.5), doorMat);
    lintel.position.y = 3.5;
    const rift = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 6.4, 1, 1), riftMat);
    rift.position.z = -0.05;
    this.errorRifts.push(rift);
    g.add(postL, postR, lintel, rift);
    this.scene.add(g);
  }

  private addErrorRifts(x: number, y: number, z: number, dx: number, dz: number): void {
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2;
      const rad = 28 + (i % 4) * 7;
      const px = x + Math.cos(ang) * rad + dx * ((i % 3) - 1) * 4;
      const pz = z + Math.sin(ang) * rad + dz * ((i % 3) - 1) * 4;
      const py = y + 6 + (i % 5) * 3.2;
      this.placeErrorRift(px, py, pz, x, y + 4, z, i);
    }
  }

  private addErrorWatches(x: number, y: number, z: number, dx: number, dz: number): void {
    const faces: Array<[number, number]> = [
      [3, 0], [10, 10], [8, 20]
    ];
    for (let i = 0; i < faces.length; i++) {
      const [hour, minute] = faces[i]!;
      const ang = (i / faces.length) * Math.PI * 2 + 0.4;
      const rad = 22 + (i % 3) * 6;
      const px = x - dx * 6 + Math.cos(ang) * rad;
      const pz = z - dz * 6 + Math.sin(ang) * rad;
      const py = y + 11 + (i % 4) * 4.5;
      const scale = 7.4 + (i % 3) * 2.8;
      this.placeMysteryWatch(px, py, pz, scale, x, y + 3, z, hour, minute, i * 1.17);
    }
  }

  /** Blender GLB if present; otherwise the built-in watch. All of them spin. */
  private placeMysteryWatch(
    x: number, y: number, z: number, scale: number,
    lookX: number, lookY: number, lookZ: number,
    hour: number, minute: number, phase: number
  ): void {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.lookAt(lookX, lookY, lookZ);
    this.scene.add(group);
    const mats: THREE.MeshStandardMaterial[] = [];
    this.warpWatches.push({ group, phase, base: scale, mats });
    this.dressWatchModel(group, hour, minute, mats);
  }

  private dressWatchModel(
    into: THREE.Group, hour: number, minute: number, mats: THREE.MeshStandardMaterial[]
  ): void {
    const tintMystery = (root: THREE.Object3D) => {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = false;
        m.receiveShadow = false;
        const src = m.material as THREE.MeshStandardMaterial;
        if (!src || !('emissive' in src)) return;
        const mat = src.clone();
        mat.emissive = new THREE.Color(0x4a1a78);
        mat.emissiveIntensity = Math.max(mat.emissiveIntensity ?? 0, 0.2);
        m.material = mat;
        mats.push(mat);
      });
    };
    const mount = (src: THREE.Object3D | null) => {
      if (src) {
        const root = src.clone(true);
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const longest = Math.max(size.x, size.y, size.z, 0.01);
        root.scale.multiplyScalar(1.35 / longest);
        box.setFromObject(root);
        root.position.sub(box.getCenter(new THREE.Vector3()));
        tintMystery(root);
        into.add(root);
        return;
      }
      const watch = this.makePocketWatch(hour, minute);
      tintMystery(watch);
      into.add(watch);
    };
    if (WorldMap.watchTried) {
      mount(WorldMap.watchTpl);
      return;
    }
    WorldMap.watchWait.push(mount);
    if (WorldMap.watchWait.length > 1) return;
    gltfLoader().load('/assets/pocket-watch.glb', (gltf) => {
      WorldMap.watchTried = true;
      WorldMap.watchTpl = gltf.scene;
      const q = WorldMap.watchWait.splice(0);
      for (const fn of q) fn(gltf.scene);
    }, undefined, () => {
      WorldMap.watchTried = true;
      WorldMap.watchTpl = null;
      const q = WorldMap.watchWait.splice(0);
      for (const fn of q) fn(null);
    });
  }

  private makePocketWatch(hour: number, minute: number): THREE.Group {
    const gold = warpGold(0xc4a35a);
    const dark = warpGold(0x3a2a18);
    const face = new THREE.MeshStandardMaterial({
      color: 0xf3e6c8, roughness: 0.5, metalness: 0.12,
      emissive: 0x2a1048, emissiveIntensity: 0.18
    });
    const g = new THREE.Group();
    const caseR = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.1, 12, 36), gold);
    caseR.rotation.x = Math.PI / 2;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 36), face);
    const back = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.08, 28), dark);
    back.position.y = -0.06;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.22, 10), gold);
    crown.position.set(0, 0, 0.72);
    crown.rotation.x = Math.PI / 2;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 8, 18), gold);
    ring.position.set(0, 0, 0.9);
    const hourA = ((hour % 12) + minute / 60) * (Math.PI * 2 / 12);
    const minA = (minute / 60) * Math.PI * 2;
    const hourHand = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.03), dark);
    hourHand.position.set(Math.sin(hourA) * 0.12, 0.05, Math.cos(hourA) * 0.12);
    hourHand.rotation.y = hourA;
    const minHand = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.025), dark);
    minHand.position.set(Math.sin(minA) * 0.18, 0.055, Math.cos(minA) * 0.18);
    minHand.rotation.y = minA;
    g.add(caseR, disc, back, crown, ring, hourHand, minHand);
    g.rotation.x = -0.35;
    return g;
  }

  private collectErrorBandSpine(): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    const seen = new Set<string>();
    const push = (x: number, y: number, z: number) => {
      const k = `${Math.round(x * 2)}_${Math.round(y * 2)}_${Math.round(z * 2)}`;
      if (seen.has(k)) return;
      seen.add(k);
      pts.push(new THREE.Vector3(x, y, z));
    };

    if (this.errorWorldOrigin.lengthSq() > 0) {
      push(this.errorWorldOrigin.x, this.errorWorldOrigin.y, this.errorWorldOrigin.z);
    }

    for (const cp of this.checkpoints) {
      if (/^Level (5[0-9]|6[0-8])$/.test(cp.label)
        || /coming soon/i.test(cp.label)
        || /error world/i.test(cp.label)) {
        push(cp.pos.x, cp.pos.y, cp.pos.z);
      }
    }
    for (const c of this.colliders) {
      const name = c.name ?? '';
      if (!/Coming Soon|Error World|Level 50 Plaza|^Level 5|^Level 6/.test(name)) continue;
      push((c.min.x + c.max.x) * 0.5, c.max.y, (c.min.z + c.max.z) * 0.5);
    }
    if (!pts.length) {
      if (this.errorWorldOrigin.lengthSq() > 0) {
        push(this.errorWorldOrigin.x, this.errorWorldOrigin.y, this.errorWorldOrigin.z);
      } else {
        const last = this.checkpoints[this.checkpoints.length - 1];
        if (last) push(last.pos.x, last.pos.y, last.pos.z);
      }
    }
    return pts;
  }

  private spineSample(pts: THREE.Vector3[], t: number): { p: THREE.Vector3; dir: THREE.Vector3 } {
    if (pts.length === 1) {
      return { p: pts[0]!.clone(), dir: new THREE.Vector3(0, 0, 1) };
    }
    const f = t * (pts.length - 1);
    const i = Math.min(pts.length - 2, Math.max(0, Math.floor(f)));
    const u = f - i;
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const p = a.clone().lerp(b, u);
    const dir = b.clone().sub(a);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    else dir.normalize();
    return { p, dir };
  }

  /** Level 60 pad, rebounders, UFOs, Level 67 pad — the zigzag climb. */
  private collectZigzagWatchSpine(): THREE.Vector3[] {
    const center = (c: BoxCollider) => new THREE.Vector3(
      (c.min.x + c.max.x) * 0.5, c.max.y, (c.min.z + c.max.z) * 0.5
    );
    const named = (label: string) => {
      const box = this.colliders.find((c) => c.name === label);
      if (box) return center(box);
      const cp = this.checkpoints.find((c) => c.label === label);
      return cp ? cp.pos.clone() : null;
    };
    const start = named('Level 60');
    const end = named('Level 67');
    const pads = this.colliders
      .map((c) => {
        const m = /^(?:Rebounder|Trampoline) (\d+)$/.exec(c.name ?? '');
        return m ? { i: Number(m[1]), p: center(c) } : null;
      })
      .filter((x): x is { i: number; p: THREE.Vector3 } => !!x)
      .sort((a, b) => a.i - b.i)
      .map((x) => x.p);
    const pts: THREE.Vector3[] = [];
    if (start) pts.push(start);
    pts.push(...pads);
    for (const c of this.colliders) {
      if (/UFO$/i.test(c.name ?? '')) pts.push(center(c));
    }
    if (end) pts.push(end);
    return pts;
  }

  /** Convoy road from ~Level 40 through Error World pads to Level 60. */
  private collectWatchSpine40to60(): THREE.Vector3[] {
    const center = (c: BoxCollider) => new THREE.Vector3(
      (c.min.x + c.max.x) * 0.5, c.max.y, (c.min.z + c.max.z) * 0.5
    );
    const pts: THREE.Vector3[] = [];
    const roads = this.colliders.filter((c) => c.name === 'Convoy Road');
    if (roads.length) {
      const start = Math.floor(roads.length * (40 - 17) / (50 - 17));
      for (let i = Math.max(0, start); i < roads.length; i++) {
        pts.push(center(roads[i]!));
      }
    } else {
      const cloud = this.checkpoints.find((c) => c.label === 'Cloud Nine');
      if (cloud) pts.push(cloud.pos.clone());
    }
    for (let lv = 50; lv <= 60; lv++) {
      const name = `Level ${lv}`;
      const box = this.colliders.find((c) => c.name === name);
      if (box) {
        pts.push(center(box));
        continue;
      }
      const cp = this.checkpoints.find((c) => c.label === name);
      if (cp) pts.push(cp.pos.clone());
    }
    return pts;
  }

  private addErrorBandDecor(): void {
    const spine = this.collectErrorBandSpine();
    if (!spine.length) return;
    this.addErrorBandRifts(spine);
    const early = this.collectWatchSpine40to60();
    const zig = this.collectZigzagWatchSpine();
    if (early.length) this.addErrorBandWatches(early, WATCHES_40_60);
    const late = zig.length ? zig : spine;
    this.addErrorBandWatches(late, WATCHES_60_67);
    this.addSpaceFleet(late);
  }

  private addErrorBandRifts(spine: THREE.Vector3[]): void {
    for (let i = 0; i < BG_RIFTS; i++) {
      const t = ((i * 0.61803398875) % 1);
      const { p, dir } = this.spineSample(spine, t);
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      else side.normalize();
      const sign = i % 2 === 0 ? 1 : -1;
      const rad = 22 + (i * 31 % 49);
      const px = p.x + side.x * rad * sign + dir.x * ((i % 5) - 2) * 3;
      const pz = p.z + side.z * rad * sign + dir.z * ((i % 5) - 2) * 3;
      const py = p.y + 5 + (i % 7) * 3.1;
      this.placeErrorRift(px, py, pz, p.x, p.y + 3, p.z, i + 14);
    }
  }

  private addSpaceFleet(spine: THREE.Vector3[]): void {
    const craft: Array<{ url: string; size: number }> = [
      { url: '/assets/space-ship-shuttle.glb', size: WATCH_WORLD * 2 },
      { url: '/assets/space-ship-dragon.glb', size: WATCH_WORLD * 2 },
      { url: '/assets/space-ship-soyuz.glb', size: WATCH_WORLD * 2 },
      { url: '/assets/space-sat-comm.glb', size: WATCH_WORLD },
      { url: '/assets/space-sat-gps.glb', size: WATCH_WORLD },
      { url: '/assets/space-sat-telescope.glb', size: WATCH_WORLD },
      { url: '/assets/space-sat-weather.glb', size: WATCH_WORLD },
      { url: '/assets/space-sat-cubesat.glb', size: WATCH_WORLD }
    ];
    const ring = [
      { s: 1, u: 0.15 },
      { s: -1, u: 0.35 },
      { s: 0.2, u: 1 },
      { s: -0.15, u: -1 },
      { s: 0.85, u: 0.55 },
      { s: -0.85, u: -0.4 },
      { s: 0.45, u: 0.9 },
      { s: -0.55, u: 0.75 }
    ];
    const n = craft.length;
    for (let i = 0; i < n; i++) {
      const spec = craft[i]!;
      const t = n <= 1 ? 0.5 : (i + 0.5) / n;
      const { p, dir } = this.spineSample(spine, t);
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      else side.normalize();
      const slot = ring[i]!;
      const rad = 22 + (i % 3) * 5;
      const px = p.x + side.x * rad * slot.s + dir.x * ((i % 3) - 1) * 3;
      const pz = p.z + side.z * rad * slot.s + dir.z * ((i % 3) - 1) * 3;
      const py = p.y + rad * slot.u * 0.85;
      const holder = new THREE.Group();
      holder.position.set(px, py, pz);
      this.scene.add(holder);
      this.spaceFloaters.push({
        group: holder,
        base: holder.position.clone(),
        phase: i * 1.31,
        spin: 0.08 + (i % 4) * 0.03
      });
      this.loadCraft(spec.url, (src) => {
        const root = src.clone(true);
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const longest = Math.max(size.x, size.y, size.z, 0.01);
        root.scale.multiplyScalar(spec.size / longest);
        box.setFromObject(root);
        const c = box.getCenter(new THREE.Vector3());
        root.position.sub(c);
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = false;
            m.receiveShadow = false;
            m.frustumCulled = true;
          }
        });
        holder.add(root);
      });
    }
  }

  private addErrorBandWatches(spine: THREE.Vector3[], n: number): void {
    if (n < 1 || !spine.length) return;
    const ring = [
      { s: 1, u: 0.12 },
      { s: -1, u: 0.18 }
    ];
    for (let i = 0; i < n; i++) {
      const t = n <= 1 ? 0 : i / (n - 1);
      const { p, dir } = this.spineSample(spine, t);
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      else side.normalize();
      const slot = ring[i % ring.length]!;
      const rad = 20 + (i % 4) * 3.5;
      const alongJitter = ((i % 5) - 2) * 1.4;
      const px = p.x + side.x * rad * slot.s + dir.x * alongJitter;
      const pz = p.z + side.z * rad * slot.s + dir.z * alongJitter;
      const py = p.y + rad * slot.u * 0.9;
      const scale = 3.2 + (i % 5) * 0.28;
      this.placeMysteryWatch(
        px, py, pz, scale, p.x, p.y + 2, p.z, i % 12, (Math.floor(i / 12) * 7) % 60, i * 1.17
      );
    }
  }

  private updateFlickerPads(): void {
    const now = this.time;
    let gone = 0;
    for (const p of this.flickerPads) {
      if (now < p.goneUntil) {
        gone++;
        continue;
      }
      if (!p.mesh.visible) {
        p.mesh.visible = true;
        p.collider.disabled = false;
      }
    }
    if (now < this.flickerPickAt || gone >= 4) return;
    const ready = this.flickerPads.filter((p) => now >= p.goneUntil);
    if (!ready.length) return;
    const pick = ready[Math.floor(Math.random() * ready.length)]!;
    pick.mesh.visible = false;
    pick.collider.disabled = true;
    pick.goneUntil = now + 5;
    this.flickerPickAt = now + 0.7 + Math.random() * 1.1;
  }

  private dropConvoySeg(index: number): void {
    const s = this.convoySegs[index];
    if (!s || s.falling) return;
    s.falling = true;
    s.collider.disabled = true;
    for (const crate of s.crates) crate.collider.disabled = true;
    for (const extra of s.extras) extra.disabled = true;
  }

  private stepConvoyFall(dt: number): void {
    for (const s of this.convoySegs) {
      if (!s.falling) continue;
      s.fallVel += 28 * dt;
      s.mesh.position.y -= s.fallVel * dt;
      if (s.mesh.position.y < s.homeY - 90) s.mesh.visible = false;
    }
  }

  /**
   * After the truck leaves the motor pool, drop one convoy slab per second from the start.
   * Returns true on the frame the collapse first arms.
   */
  updateConvoyCollapse(dt: number, truck: THREE.Vector3, occupied: boolean): boolean {
    this.stepConvoyFall(dt);
    let justArmed = false;
    if (!this.convoyArmed && occupied && this.vehicleSpawn) {
      const dx = truck.x - this.vehicleSpawn.pos.x;
      const dz = truck.z - this.vehicleSpawn.pos.z;
      if (dx * dx + dz * dz > CONVOY_ARM_DIST * CONVOY_ARM_DIST) {
        this.convoyArmed = true;
        justArmed = true;
      }
    }
    if (!this.convoyArmed) return false;
    this.convoyDropAcc += dt;
    const last = Math.max(0, this.convoySegs.length - CONVOY_KEEP_END);
    while (this.convoyDropAcc >= CONVOY_DROP_EVERY && this.convoyNext < last) {
      this.convoyDropAcc -= CONVOY_DROP_EVERY;
      this.dropConvoySeg(this.convoyNext++);
    }
    return justArmed;
  }

  resetConvoyRoad(): void {
    this.convoyArmed = false;
    this.convoyDropAcc = 0;
    this.convoyNext = CONVOY_SKIP_START;
    for (const s of this.convoySegs) {
      s.falling = false;
      s.fallVel = 0;
      s.mesh.position.y = s.homeY;
      s.mesh.visible = true;
      s.collider.disabled = false;
      for (const crate of s.crates) crate.collider.disabled = false;
      for (const extra of s.extras) extra.disabled = false;
    }
  }

  private updateErrorDecor(dt: number): void {
    for (const rift of this.errorRifts) {
      const mat = rift.material as THREE.ShaderMaterial;
      if (mat.uniforms?.uTime) mat.uniforms.uTime.value = this.time;
    }
    if (this.riftSpriteMat?.uniforms?.uTime) this.riftSpriteMat.uniforms.uTime.value = this.time;
    for (const w of this.warpWatches) {
      const t = this.time + w.phase;
      w.group.rotation.y += (0.62 + (w.phase % 0.35)) * dt;
      w.group.rotation.x = -0.18 + Math.sin(t * 0.48) * 0.42 + Math.sin(t * 0.91) * 0.12;
      w.group.rotation.z = Math.sin(t * 0.33 + 0.8) * 0.38;
      const pulse = 1 + Math.sin(t * 0.7) * 0.06;
      w.group.scale.setScalar(w.base * pulse);
      for (const m of w.mats) {
        m.emissiveIntensity = 0.16 + 0.18 * (0.5 + 0.5 * Math.sin(t * 1.4));
      }
    }
    for (const f of this.spaceFloaters) {
      const t = this.time + f.phase;
      f.group.position.y = f.base.y + Math.sin(t * 0.35) * 1.4;
      f.group.rotation.y += f.spin * dt;
      f.group.rotation.z = Math.sin(t * 0.22) * 0.12;
    }
  }

  private climbApi(): ClimbApi {
    return {
      addBox: this.addBox.bind(this),
      addTrampoline: this.addTrampoline.bind(this),
      addMover: this.addMover.bind(this),
      addRotor: this.addRotor.bind(this),
      addCloud: this.addCloud.bind(this),
      addAsteroid: this.addAsteroid.bind(this),
      addProp: this.addProp.bind(this),
      addSign: this.addSign.bind(this),
      addCheckpoint: this.addCheckpoint.bind(this),
      lastCollider: () => this.colliders[this.colliders.length - 1]!,
      addThrowSwitch: (sw) => { this.throwSwitches.push(sw); },
      addVehicleSpawn: (x, y, z, heading) => {
        this.vehicleSpawn = { pos: new THREE.Vector3(x, y, z), heading };
      },
      addOrientedSlab: this.addOrientedSlab.bind(this),
      addConvoyCrate: this.addConvoyCrate.bind(this),
      addErrorWorld: this.addErrorWorld.bind(this),
      addErrorWorldSign: this.addErrorWorldSign.bind(this),
      addUfo: this.addUfo.bind(this)
    };
  }

  private updateThrowSwitches(): void {
    for (const sw of this.throwSwitches) {
      if (sw.open) continue;
      let hit = false;
      for (const p of this.props) {
        if (p.heldBy) continue;
        const pos = p.mesh.position;
        if (pos.x + p.radius < sw.padMin.x || pos.x - p.radius > sw.padMax.x) continue;
        if (pos.z + p.radius < sw.padMin.z || pos.z - p.radius > sw.padMax.z) continue;
        if (pos.y + p.radius < sw.padMin.y - 0.2 || pos.y - p.radius > sw.padMax.y + 1.4) continue;
        hit = true;
        break;
      }
      if (!hit) continue;
      sw.open = true;
      for (const part of sw.parts) {
        if (part.hideWhenOpen) {
          part.mesh.visible = false;
          part.collider.disabled = true;
        } else {
          part.mesh.visible = true;
          part.collider.disabled = false;
        }
      }
    }
  }

  private addTree(x: number, z: number): void {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 2.2, 8), mat(0x7a5230));
    trunk.position.set(x, 1.1, z);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 1), mat(0x3c9d4e));
    crown.position.set(x, 3, z);
    crown.scale.y = 1.2;
    trunk.castShadow = crown.castShadow = true;
    this.scene.add(trunk, crown);
  }

  // ---------- the course ----------

  private build(): void {
    // ===== SECTION 1: EARTH GROUND =====
    const ground = new THREE.Mesh(new THREE.CylinderGeometry(90, 90, 2, 48), mat(0x63a34c, 1));
    ground.position.y = -1;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.colliders.push({ min: new THREE.Vector3(-90, -2, -90), max: new THREE.Vector3(90, 0, 90), name: 'Earth Ground' });

    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      const r = 30 + Math.random() * 45;
      const tx = Math.cos(a) * r, tz = Math.sin(a) * r;
      if (Math.abs(tx) > 12 || tz < 0) this.addTree(tx, tz);
    }

    this.addSign(['WELCOME UPON THE SKY!', 'Ground floor: dirt,', 'dreams and destiny.'], -8, 3.6, 6);
    this.addSign(['Rule 1: teamwork.', 'Rule 2: trolling', '(gently).'], 7, 2.6, 5, 0.8);

    // Props to pick up and yeet at friends
    this.addProp(-3, 0, 2, 'ball');
    this.addProp(3.5, 0, 3, 'ball');
    this.addProp(-5, 0, 6, 'crate');
    this.addProp(5, 0, 8, 'ball');

    // Obstacle 1: stepping stones over the pond of shame
    // (visual-only water: fall in and you wade through it in shame)
    const stoneD = along(2.2);
    const stoneN = runCount(4);
    const stoneTouch = 0.2;
    let stoneZ = 11.4 + stoneD / 2;
    const firstStoneZ = stoneZ;
    for (let i = 0; i < stoneN; i++) {
      this.addBox(2.2, 1.4, stoneD, (i % 2 === 0 ? -1.6 : 1.6), 0.1, stoneZ, 0xd9a066,
        { name: `Stepping Stone ${i + 1}` });
      if (i < stoneN - 1) stoneZ += stoneD + stoneTouch;
    }
    const lastStoneZ = stoneZ;
    const pondStart = firstStoneZ - stoneD / 2;
    const pondEnd = lastStoneZ + stoneD / 2;
    const pond = new THREE.Mesh(new THREE.BoxGeometry(24, 0.14, pondEnd - pondStart + 1.2),
      new THREE.MeshStandardMaterial({ color: 0x2f8fd5, roughness: 0.2, transparent: true, opacity: 0.85 }));
    pond.position.set(0, 0.07, (pondStart + pondEnd) / 2);
    this.scene.add(pond);
    this.addCheckpoint(1.6, 0.8, lastStoneZ, 'Pond Survivor');

    // Obstacle 2: the angry spinning bar (no Bar Dodger flag)
    const arenaD = along(14);
    const arenaZ = lastStoneZ + stoneD / 2 + 6.2 + arenaD / 2;
    this.addBox(14, 0.8, arenaD, 0, 0.4, arenaZ, 0xcfa15a, { name: 'Rotor Arena' });
    this.addRotor(0, 1.75, arenaZ - arenaD * 0.22, 6.4, 1.9);
    this.addRotor(0, 1.75, arenaZ + arenaD * 0.22, 6.4, -1.7, 0xe67e22);
    this.addSign(['This bar has anger', 'issues. JUMP!'], -6, 3.2, arenaZ - arenaD / 2 + 4, 0.75);

    // Obstacle 3: trampoline + tower hops up to the sky road (≤ JUMP_STEP per hop after bounce)
    const trampZ = arenaZ + arenaD / 2 + 2 + 1.6;
    this.addTrampoline(0, 0, trampZ, 1.6, 'Pink Trampoline');
    const towerW = [4, 3.4, 3.4, 3.2, 3.2, 3.4];
    const towerX = [0, -1.8, 1.6, -1.7, 1.8, -0.9];
    const towerN = runCount(6);
    let towerY = 5;
    let prevZ = trampZ;
    let prevAlong = 1.6 * 2;
    for (let i = 0; i < towerN; i++) {
      const w = towerW[i % towerW.length]!;
      const d = along(w);
      const z = hopCenter(prevZ, prevAlong, d);
      this.addBox(w, 1, d, towerX[i % towerX.length]!, towerY, z, 0xd9a066, { name: `Tower Block ${i + 1}` });
      prevZ = z;
      prevAlong = d;
      towerY += JUMP_STEP;
    }
    const restD = along(6);
    const restZ = hopCenter(prevZ, prevAlong, restD);
    const restY = towerY;
    this.addBox(6, 1, restD, 0, restY, restZ, 0xb5651d, { name: 'Tower Rest' });
    this.addSign(['Boing responsibly.'], 3.4, 2.2, trampZ - 1, 0.65);
    this.addCheckpoint(0, restY + 0.5, restZ, 'Tower Climber');

    // ===== SECTION 2: THE CLIMB =====
    // Obstacle 4: sliders across the gap (Δ JUMP_STEP between standable tops).
    // Rebuild from tower-rest edge; hop holes stay JUMP_GAP (never × PATH_LEN).
    const sliderD = along(3.2);
    const sliderN = runCount(2);
    let sliderEdge = restZ + restD / 2;
    let sliderTop = restY + 0.5 + 1.0;
    let lastSliderZ = sliderEdge;
    for (let i = 0; i < sliderN; i++) {
      const sliderZ = sliderEdge + JUMP_GAP + sliderD / 2;
      const cy = sliderTop - 0.35;
      this.addMover(3.2, 0.7, sliderD,
        new THREE.Vector3(-SLIDER_X, cy, sliderZ), new THREE.Vector3(SLIDER_X, cy, sliderZ),
        0x42a5f5, 1.05, i * 1.2, i % 2 === 0 ? 'Sliding Block A' : 'Sliding Block B');
      sliderEdge = sliderZ + sliderD / 2;
      lastSliderZ = sliderZ;
      sliderTop += JUMP_STEP;
    }
    const gapLandD = along(6);
    const gapLandZ = hopCenter(lastSliderZ, sliderD, gapLandD);
    const gapLandY = sliderTop - 0.5;
    this.addBox(6, 1, gapLandD, 0, gapLandY, gapLandZ, 0xb5651d, { name: 'Gap Landing' });

    // Obstacle 5: windmill ledge + narrow beams (connected walkways; Δ JUMP_STEP on tops)
    const windD = along(10);
    const windZ = hopCenter(gapLandZ, gapLandD, windD);
    const windY = gapLandY + JUMP_STEP;
    this.addBox(10, 1, windD, 0, windY, windZ, 0xcfa15a, { name: 'Windmill Ledge' });
    this.addRotor(0, windY + 2.35, windZ, 4.6, -2.3, 0xf39c12);
    const beamLen = along(10);
    const beamN = runCount(2);
    let beamPrevZ = windZ;
    let beamPrevD = windD;
    let beamTop = windY + 0.5 + JUMP_STEP;
    this.addSign(['Narrow beams:', 'crawl (R) if scared.', 'No judgement.'], 5, beamTop + 1.5, windZ + windD / 2 + 4, 0.8);
    for (let i = 0; i < beamN; i++) {
      const z = joinCenter(beamPrevZ, beamPrevD, beamLen);
      const x = i % 2 === 0 ? -1.35 : 1.35;
      this.addBox(1.1, 0.5, beamLen, x, beamTop - 0.25, z, 0x90a4ae, { name: `Narrow Beam ${i + 1}` });
      beamPrevZ = z;
      beamPrevD = beamLen;
      beamTop += JUMP_STEP;
    }
    const beamLandD = along(7);
    const beamLandZ = joinCenter(beamPrevZ, beamPrevD, beamLandD);
    const beamLandY = beamTop - 0.5;
    this.addBox(7, 1, beamLandD, 0, beamLandY, beamLandZ, 0xb5651d, { name: 'Beam Landing' });

    // Obstacle 6: the sky elevator (lift carries you; post-trampoline hops ≤ JUMP_STEP)
    const elevD = 3.6;
    const elevZ = hopCenter(beamLandZ, beamLandD, elevD);
    const elevY0 = beamLandY + 1;
    const elevY1 = elevY0 + 18;
    this.addMover(elevD, 0.7, elevD, new THREE.Vector3(0, elevY0, elevZ), new THREE.Vector3(0, elevY1, elevZ), 0xab47bc, 0.55, 0, 'Sky Elevator');
    const deckD = along(8);
    const deckZ = hopCenter(elevZ, elevD, deckD);
    const deckY = elevY1 + 1;
    this.addBox(8, 1, deckD, 0, deckY, deckZ, 0xb5651d, { name: 'Elevator Deck' });
    this.addTrampoline(0, deckY + 0.5, deckZ, 1.4, 'Sky Trampoline');
    const stepD = along(5);
    const stepN = runCount(2);
    const stepX = [0, -2.2, 2.0, -1.8];
    let stepPrevZ = deckZ;
    let stepPrevD = deckD;
    let stepY = deckY + 6;
    for (let i = 0; i < stepN; i++) {
      const z = hopCenter(stepPrevZ, stepPrevD, stepD);
      this.addBox(5, 1, stepD, stepX[i % stepX.length]!, stepY, z, 0x9c6b30, { name: `High Step ${i + 1}` });
      stepPrevZ = z;
      stepPrevD = stepD;
      stepY += JUMP_STEP;
    }
    const elevRestD = along(8);
    const elevRestZ = hopCenter(stepPrevZ, stepPrevD, elevRestD);
    this.addBox(8, 1, elevRestD, 0, stepY, elevRestZ, 0xb5651d, { name: 'Elevator Rest' });
    this.addCheckpoint(0, stepY + 0.5, elevRestZ, 'Elevator Enjoyer');

    // ===== SECTION 3: THE SKY =====
    // Obstacle 7: cloud hopping (Δ JUMP_STEP; walkable collider cap on puff top).
    // Weave ±3.2 and drift ±2.5 so a +JUMP_STEP hop stays inside run (5.63 m), usually walk.
    const cloudPad = (d: number) => d * 0.86;
    const cloudD = along(6.2);
    const cloudN = runCount(7);
    let cy = stepY + 2;
    let cz = hopCenter(elevRestZ, elevRestD, cloudPad(cloudD));
    for (let i = 0; i < cloudN; i++) {
      const cx = Math.sin(i * 1.3) * 3.2;
      const drifting = i % 3 === 2;
      const cloudName = drifting ? `Drifting Cloud ${i + 1}` : `Cloud ${i + 1}`;
      if (drifting) {
        this.addCloud(cx, cy, cz, 6, cloudD, { b: new THREE.Vector3(cx + (i % 2 ? -2.5 : 2.5), cy, cz), speed: 0.8 }, cloudName);
      } else {
        this.addCloud(cx, cy, cz, 6, cloudD, undefined, cloudName);
      }
      if (i < cloudN - 1) {
        cz = hopCenter(cz, cloudPad(cloudD), cloudPad(cloudD));
        cy += JUMP_STEP;
      }
    }
    const restCloudD = along(9);
    cz = hopCenter(cz, cloudPad(cloudD), cloudPad(restCloudD));
    cy += JUMP_STEP;
    this.addCloud(0, cy, cz, 10, restCloudD, undefined, 'Rest Cloud');
    this.addSign(['Clouds: 100% certified', 'bouncy-ish. Probably.'], 4, cy + 3, cz - 2, 0.9);
    this.addCheckpoint(0, cy + 0.58, cz, 'Cloud Nine');
    const cloudRestY = cy, cloudRestZ = cz;

    const throwZ = cloudRestZ + cloudPad(restCloudD) / 2 + 6;
    const throwLesson = placeThrowGate(this.climbApi(), cloudRestY, throwZ, 0xb5651d, 'Throw Lesson', 1, false);

    // Obstacle 8: one long straight ramp. No Wall Magnet flag.
    const slopeZ0 = throwLesson.z + 2.4;
    const slopeY0 = throwLesson.y + 0.5;
    const slopeY1 = cloudRestY + 17;
    const slopeZ1 = slopeZ0 + 32 * PATH_LEN;
    this.addBallSlope(-3.4, 3.4, slopeZ0, slopeY0, slopeZ1, slopeY1, 'Checkpoint Slope');
    this.addSign(['One long ramp.', 'Walk it to the flag.', 'SHIFT is slower on slopes.'], -7, slopeY0 + 6, slopeZ0 + 8, 0.95);

    // Obstacle 9: rotor gauntlet on the long sky bridge (joined to the slope)
    const bridgeY = slopeY1 - 0.5;
    const bridgeD = along(26);
    const bridgeCenter = joinCenter(slopeZ1, 0, bridgeD);
    this.addBox(6, 1, bridgeD, 0, bridgeY, bridgeCenter, 0xeceff1, { name: 'Sky Bridge' });
    const rotorN = runCount(2);
    for (let i = 0; i < rotorN; i++) {
      const rz = slopeZ1 + bridgeD * ((i + 1) / (rotorN + 1));
      this.addRotor(0, bridgeY + 1.85, rz, 4.2, i % 2 === 0 ? 1.15 : -1.25, i % 2 === 0 ? 0xe74c3c : 0xe67e22);
    }
    this.addTrampoline(0, bridgeY + 0.32, slopeZ1 + bridgeD * 0.93, 1.7, 'Bridge Trampoline');
    const gauntD = along(7);
    const gauntZ = hopCenter(bridgeCenter, bridgeD, cloudPad(gauntD));
    const gauntY = bridgeY + 4;
    this.addCloud(0, gauntY, gauntZ, 8, gauntD, undefined, 'Gauntlet Cloud');
    this.addCheckpoint(0, gauntY + 0.58, gauntZ, 'Gauntlet Hero');

    // ===== SECTION 4: OUTER SPACE =====
    // Obstacle 10: low-gravity asteroid leaps (first hop Δ JUMP_STEP; then Δ SPACE_STEP)
    const astAlong = (r: number) => r * 0.58 * 2;
    const astN = runCount(6);
    const astX = [0, 6, -5, 3, -2, 4, -3, 5, -4, 2, -1, 0];
    let ay = gauntY + JUMP_STEP;
    let az = hopCenter(gauntZ, cloudPad(gauntD), astAlong(2.6));
    let prevAstZ = az;
    let prevAstAlong = astAlong(2.6);
    for (let i = 0; i < astN; i++) {
      const r = 2.6 + (i % 2) * 0.7;
      if (i > 0) {
        az = hopCenter(prevAstZ, prevAstAlong, astAlong(r));
        ay += SPACE_STEP;
      }
      this.addAsteroid(astX[i]!, ay, az, r, `Asteroid ${i + 1}`);
      prevAstZ = az;
      prevAstAlong = astAlong(r);
    }
    ay += SPACE_STEP;
    az = hopCenter(prevAstZ, prevAstAlong, astAlong(4));
    this.addAsteroid(0, ay, az, 4, 'Asteroid Rest');
    this.addSign(['Outer space:', 'no air, no lag,', 'no excuses.'], 5, ay + 4, az, 1);
    this.addCheckpoint(0, ay + 0.1, az, 'Asteroid Hopper');

    // Obstacle 11: the drifting belt
    const driftD = along(3.4);
    const driftN = runCount(2);
    let driftEdge = az + astAlong(4) / 2;
    let lastDriftZ = az;
    const driftColors = [0x7e57c2, 0x5c6bc0, 0x7e57c2, 0x5c6bc0];
    for (let i = 0; i < driftN; i++) {
      const dz = driftEdge + JUMP_GAP + driftD / 2;
      const y = ay + (i < 2 ? 5 : 10);
      const xa = i % 2 === 0 ? -6 : 6;
      this.addMover(3.4, 0.8, driftD,
        new THREE.Vector3(xa, y, dz), new THREE.Vector3(-xa, y, dz),
        driftColors[i]!, i % 2 === 0 ? 0.9 : 1.1, i * 1.5, `Drift Pad ${i + 1}`);
      driftEdge = dz + driftD / 2;
      lastDriftZ = dz;
    }
    const liftD = along(3.4);
    const liftZ = hopCenter(lastDriftZ, driftD, liftD);
    this.addMover(3.4, 0.8, liftD,
      new THREE.Vector3(0, ay + 12, liftZ), new THREE.Vector3(0, ay + 19, liftZ),
      0x26a69a, 0.7, 1, 'Space Lift');
    const beltR = 3.4;
    const beltAz = hopCenter(liftZ, liftD, astAlong(beltR));
    const beltAy = ay + 21;
    this.addAsteroid(0, beltAy, beltAz, beltR, 'Belt Asteroid');
    this.addCheckpoint(0, beltAy + 0.1, beltAz, 'Belt Rider');

    const fy = beltAy, fz = beltAz;
    const more = appendClimbLevels(this.climbApi(), fy + 0.15, fz + 10, this.checkpoints.length);
    this.addErrorBandDecor();
    this.addSkyBandStars(new THREE.Vector3(0, cloudRestY, cloudRestZ), more);
    this.endingPos.set(more.x, -80, more.z);
    this.endingRing = new THREE.Mesh(new THREE.TorusGeometry(3, 0.3, 14, 48),
      new THREE.MeshStandardMaterial({ color: 0xffeb3b, emissive: 0xd9a400, emissiveIntensity: 1.4, roughness: 0.25 }));
    this.endingRing.position.copy(this.endingPos);
    this.endingRing.visible = false;
    this.scene.add(this.endingRing);

    // Stars everywhere above the sky line
    const starGeo = new THREE.BufferGeometry();
    const starCount = 160;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 380 + Math.random() * 250;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = 240 + Math.abs(r * Math.cos(phi)) * 0.9;
      positions[i * 3 + 2] = 150 + r * Math.sin(phi) * Math.sin(theta);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0xe8edf4, size: 1.05, sizeAttenuation: false, transparent: true, opacity: 0, fog: false
    }));
    this.scene.add(this.stars);
  }

  /** Camera-following star dome + per-block stars so every pad from ~Level 40–67 sees the field. */
  private addSkyBandStars(start: THREE.Vector3, end: { x: number; y: number; z: number }): void {
    const numbered = this.checkpoints.filter((c) => /^Level (\d+)$/.exec(c.label));
    const lv = (n: number) => numbered.find((c) => c.label === `Level ${n}`);
    const from = lv(40) ?? lv(50) ?? this.checkpoints.find((c) => c.label === 'Cloud Nine');
    const to = lv(67) ?? lv(60) ?? this.checkpoints[this.checkpoints.length - 1];
    this.skyBandMinY = Math.min(start.y, from?.pos.y ?? start.y) - 4;
    this.skyBandMaxY = Math.max(end.y, to?.pos.y ?? end.y) + 30;

    this.skyFollow.clear();
    this.scene.add(this.skyFollow);

    const fibonacci = (count: number, radius: number, out: number[], offset = 0) => {
      const golden = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < count; i++) {
        const y = 1 - (i / Math.max(1, count - 1)) * 2;
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        const t = golden * i + offset;
        out.push(Math.cos(t) * r * radius, y * radius, Math.sin(t) * r * radius);
      }
    };
    const dome: number[] = [];
    fibonacci(90, 320, dome, 0.2);
    const domePos = new Float32Array(dome);
    const domeGeo = new THREE.BufferGeometry();
    domeGeo.setAttribute('position', new THREE.BufferAttribute(domePos, 3));
    this.courseStars = new THREE.Points(domeGeo, new THREE.PointsMaterial({
      color: 0xe8edf4,
      size: 1.05,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false
    }));
    this.courseStars.frustumCulled = false;
    this.skyFollow.add(this.courseStars);

    const blob = document.createElement('canvas');
    blob.width = 128;
    blob.height = 128;
    const ctx = blob.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 48, 6, 64, 64, 60);
    grad.addColorStop(0, 'rgba(220, 226, 236, 0.5)');
    grad.addColorStop(0.35, 'rgba(170, 180, 198, 0.22)');
    grad.addColorStop(1, 'rgba(140, 150, 168, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    this.courseNebulaMat = new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(blob),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false
    });
    const blockGeo = new THREE.BufferGeometry();
    blockGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    this.blockStars = new THREE.Points(blockGeo, new THREE.PointsMaterial({
      color: 0xf4f6fb,
      size: 1,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false
    }));
    this.blockStars.visible = false;
    this.blockStars.frustumCulled = false;
    this.scene.add(this.blockStars);
  }

  update(dt: number): void {
    this.time += dt;

    for (const m of this.movers) {
      let t: number;
      if (m.linear) {
        const u = (this.time * m.speed + m.phase) % 2;
        t = u < 1 ? u : 2 - u;
      } else {
        t = 0.5 + 0.5 * Math.sin(this.time * m.speed + m.phase);
      }
      const nx = m.a.x + (m.b.x - m.a.x) * t;
      const ny = m.a.y + (m.b.y - m.a.y) * t;
      const nz = m.a.z + (m.b.z - m.a.z) * t;
      m.delta.set(nx - m.mesh.position.x, ny - m.mesh.position.y, nz - m.mesh.position.z);
      m.mesh.position.set(nx, ny, nz);
      const cloud = m.mesh.userData.cloud as THREE.Group | undefined;
      if (cloud) {
        cloud.position.x = nx;
        cloud.position.z = nz;
        const yOff = m.mesh.userData.yOffset as number | undefined;
        if (yOff !== undefined) cloud.position.y = ny + yOff;
      }
      m.collider.min.set(nx - m.size.x / 2, ny - m.size.y / 2, nz - m.size.z / 2);
      m.collider.max.set(nx + m.size.x / 2, ny + m.size.y / 2, nz + m.size.z / 2);
    }

    for (const r of this.rotors) {
      r.angle += r.speed * dt;
      r.pivot.rotation.y = r.angle;
    }

    for (const c of this.checkpoints) {
      c.ring.rotation.z = this.time * 0.8 + c.index;
    }

    this.endingRing.rotation.y = this.time * 0.6;
    this.endingRing.position.y = this.endingPos.y + Math.sin(this.time * 1.2) * 0.4;

    this.updateHazardBalls(dt);
    this.updateThrowSwitches();
    this.updateFlickerPads();
    this.updateErrorDecor(dt);

    for (const cl of this.clouds) {
      cl.children.forEach((b, i) => {
        b.position.y += Math.sin(this.time * 0.8 + i * 2.4) * 0.0009;
      });
    }
  }

  private spawnHazardBall(): void {
    const idle = this.hazardBalls.filter((b) => !b.active);
    if (idle.length === 0) return;
    const ball = idle[Math.floor(Math.random() * idle.length)]!;
    const s = ball.slope;
    const margin = ball.radius + 0.25;
    ball.pos.set(
      s.x0 + margin + Math.random() * Math.max(0.2, s.x1 - s.x0 - margin * 2),
      s.y1 + 0.85 + Math.random() * 0.35,
      s.z1 - 0.35 - Math.random() * 0.25
    );
    ball.vel.set((Math.random() - 0.5) * 3.6, -6, -(7.2 + Math.random() * 3.2));
    const mat = ball.mesh.material as THREE.MeshStandardMaterial;
    mat.color.setHex(BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)]);
    ball.mesh.visible = true;
    ball.mesh.position.copy(ball.pos);
    ball.active = true;
  }

  private updateHazardBalls(dt: number): void {
    this.ballSpawnWait -= dt;
    if (this.ballSpawnWait <= 0) {
      this.spawnHazardBall();
      this.ballSpawnWait += 1;
    }

    for (const b of this.hazardBalls) {
      if (!b.active) continue;
      const s = b.slope;
      const run = s.z1 - s.z0;
      const rise = s.y1 - s.y0;
      const len = Math.hypot(run, rise);
      const downZ = (s.z0 - s.z1) / len;
      const downY = (s.y0 - s.y1) / len;
      const surf = this.slopeHeight(s, b.pos.z) + b.radius;

      if (b.pos.y > surf + 0.08) {
        b.vel.y -= 18 * dt;
      } else {
        b.pos.y = surf;
        const along = b.vel.y * downY + b.vel.z * downZ;
        const speed = Math.min(26, Math.max(16, along + 34 * dt));
        b.vel.y = downY * speed;
        b.vel.z = downZ * speed;
        b.vel.x += (Math.random() - 0.5) * 2.2 * dt;
        b.vel.x *= 0.985;
      }

      b.pos.addScaledVector(b.vel, dt);
      const edge = b.radius + 0.16;
      b.pos.x = Math.min(s.x1 - edge, Math.max(s.x0 + edge, b.pos.x));

      if (b.pos.z < s.z0 - 0.6 || b.pos.y < s.y0 - 1.5) {
        b.active = false;
        b.mesh.visible = false;
        continue;
      }

      b.mesh.position.copy(b.pos);
      b.mesh.rotation.x += b.vel.z * dt * 4.4;
      b.mesh.rotation.z -= b.vel.x * dt * 2.4;
    }
  }
}
