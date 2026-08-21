import * as THREE from 'three';
import { appendClimbLevels, placeThrowGate, type ClimbApi, type ThrowSwitch } from './climbCourse';

export interface BoxCollider {
  min: THREE.Vector3;
  max: THREE.Vector3;
  bouncy?: boolean;
  moverIndex?: number;
  name?: string;
  disabled?: boolean;
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

const BALL_COLORS = [0x3498db, 0xe74c3c, 0x9b59b6, 0xf1c40f];
const MAX_SLOPE_BALLS = 16;

export const SKY_START_Y = 90;
// Low-gravity kicks in at the sky-bridge cloud (~y 88); matches retuned course pacing
export const SPACE_START_Y = 88;
/** Max vertical step without assist (matches PlayerController.JUMP_HEIGHT_SAFE). */
const JUMP_STEP = 1.5;
/** Max vertical step in low gravity (matches PlayerController.SPACE_JUMP_HEIGHT_SAFE). */
const SPACE_STEP = 6.5;
/**
 * Jump reach from PlayerController physics (JUMP_VEL 9.6, GRAVITY -24, walk 5.5 / run 9.6):
 *   height 1.92 m | hang 0.80 s | walk 4.40 m | run 7.68 m
 *   hop of +JUMP_STEP: airtime 0.587 s → walk 3.23 m | run 5.63 m
 * Player radius 0.38, so walkable edge-to-edge at +JUMP_STEP is ≤ 3.23 − 0.76 = 2.47 m.
 */
const JUMP_GAP = 2.2;
/** Half-width of paired slider travel; keeps worst-case 3D hop inside walk reach. */
const SLIDER_X = 2.2;

const mat = (color: number, rough = 0.85) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough });

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

export class WorldMap {
  colliders: BoxCollider[] = [];
  movers: Mover[] = [];
  rotors: Rotor[] = [];
  checkpoints: Checkpoint[] = [];
  props: Prop[] = [];
  slopes: Slope[] = [];
  hazardBalls: HazardBall[] = [];
  throwSwitches: ThrowSwitch[] = [];
  stars!: THREE.Points;
  endingPos = new THREE.Vector3();
  spawnPos = new THREE.Vector3(0, 0.1, -4);

  private clouds: THREE.Group[] = [];
  private endingRing!: THREE.Mesh;
  private time = 0;
  private ballSpawnWait = 1;

  constructor(private scene: THREE.Scene) {
    this.build();
  }

  // ---------- helpers ----------

  private addBox(
    w: number, h: number, d: number,
    x: number, y: number, z: number,
    color: number, opts: { bouncy?: boolean; noShadow?: boolean; name?: string } = {}
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    mesh.position.set(x, y, z);
    mesh.name = opts.name ?? 'Block';
    if (!opts.noShadow) { mesh.castShadow = true; mesh.receiveShadow = true; }
    this.scene.add(mesh);
    this.colliders.push({
      min: new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
      max: new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2),
      bouncy: opts.bouncy,
      name: opts.name ?? 'Block'
    });
    return mesh;
  }

  private addTrampoline(x: number, y: number, z: number, r = 1.6, name = 'Trampoline'): void {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, 0.45, 24), mat(0x777788));
    base.position.set(x, y + 0.22, z);
    base.castShadow = true; base.receiveShadow = true;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 0.9, 0.14, 24),
      new THREE.MeshStandardMaterial({ color: 0xff4f9a, roughness: 0.4, emissive: 0x550022 }));
    pad.position.set(x, y + 0.52, z);
    pad.name = name;
    this.scene.add(base, pad);
    this.colliders.push({
      min: new THREE.Vector3(x - r * 0.95, y, z - r * 0.95),
      max: new THREE.Vector3(x + r * 0.95, y + 0.6, z + r * 0.95),
      bouncy: true,
      name
    });
  }

  private addMover(
    w: number, h: number, d: number,
    a: THREE.Vector3, b: THREE.Vector3,
    color: number, speed = 1, phase = 0, name = 'Moving Block'
  ): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, 0.6));
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.position.copy(a);
    mesh.name = name;
    this.scene.add(mesh);
    const size = new THREE.Vector3(w, h, d);
    const collider: BoxCollider = {
      min: a.clone().sub(size.clone().multiplyScalar(0.5)),
      max: a.clone().add(size.clone().multiplyScalar(0.5)),
      moverIndex: this.movers.length,
      name
    };
    this.colliders.push(collider);
    this.movers.push({ mesh, collider, a: a.clone(), b: b.clone(), speed, phase, size, delta: new THREE.Vector3() });
  }

  private addRotor(x: number, y: number, z: number, armLength: number, speed: number, color = 0xe74c3c): void {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2.4, 12), mat(0x8899aa));
    pole.position.y = -0.6;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(armLength * 2, 0.42, 0.42),
      new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
    bar.castShadow = true;
    pivot.add(pole, bar);
    this.scene.add(pivot);
    this.rotors.push({ pivot, center: new THREE.Vector3(x, y, z), armLength, barY: y, speed, angle: Math.random() * Math.PI * 2 });
  }

  private addCheckpoint(x: number, y: number, z: number, label: string): void {
    const index = this.checkpoints.length;
    const pos = new THREE.Vector3(x, y, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.6, 10), mat(0xcfd8dc, 0.4));
    pole.position.set(x + 0.9, y + 1.3, z);
    const flagMat = new THREE.MeshStandardMaterial({ color: 0x9e9e9e, roughness: 0.5, side: THREE.DoubleSide });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.6), flagMat);
    flag.position.set(x + 0.9 - 0.5, y + 2.25, z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.09, 10, 40),
      new THREE.MeshStandardMaterial({ color: 0xffd54f, emissive: 0x8a6d00, roughness: 0.35 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, y + 0.12, z);
    this.scene.add(pole, flag, ring);
    this.checkpoints.push({ index, pos, ring, flagMat, label });
  }

  private addCloud(x: number, y: number, z: number, w = 6, d = 5, moving?: { b: THREE.Vector3; speed: number }, name = 'Cloud'): void {
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
    const capH = 0.2;
    const capY = y + standTop - capH / 2;
    const padW = w * 0.86;
    const padD = d * 0.86;
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
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 1), mat(0x6d6875, 0.95));
    rock.position.set(x, y, z);
    rock.rotation.set(0.15, Math.random() * Math.PI * 2, 0.08);
    rock.castShadow = true; rock.receiveShadow = true;
    rock.name = name;
    this.scene.add(rock);
    rock.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(rock);
    rock.position.y += standTop - 0.04 - bbox.max.y;
    const capR = r * 0.52;
    this.colliders.push({
      min: new THREE.Vector3(x - capR, standTop - 0.22, z - capR),
      max: new THREE.Vector3(x + capR, standTop, z + capR),
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
    const radius = 0.72;
    for (let i = 0; i < MAX_SLOPE_BALLS; i++) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 16, 12),
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
      addThrowSwitch: (sw) => { this.throwSwitches.push(sw); }
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
    const pond = new THREE.Mesh(new THREE.BoxGeometry(24, 0.14, 10),
      new THREE.MeshStandardMaterial({ color: 0x2f8fd5, roughness: 0.2, transparent: true, opacity: 0.85 }));
    pond.position.set(0, 0.07, 16);
    this.scene.add(pond);
    for (let i = 0; i < 4; i++) {
      this.addBox(2.2, 1.4, 2.2, (i % 2 === 0 ? -1.6 : 1.6), 0.1, 12.5 + i * 2.4, 0xd9a066,
        { name: `Stepping Stone ${i + 1}` });
    }
    this.addCheckpoint(0, 0, 24, 'Pond Survivor');

    // Obstacle 2: the angry spinning bar
    this.addBox(14, 0.8, 14, 0, 0.4, 34, 0xcfa15a, { name: 'Rotor Arena' });
    this.addRotor(0, 1.75, 34, 6.4, 1.9);
    this.addSign(['This bar has anger', 'issues. JUMP!'], -6, 3.2, 30, 0.75);
    this.addCheckpoint(0, 0.8, 42, 'Bar Dodger');

    // Obstacle 3: trampoline + tower hops up to the sky road (≤ JUMP_STEP per hop after bounce)
    this.addTrampoline(0, 0, 50, 1.6, 'Pink Trampoline');
    this.addBox(4, 1, 4, 0, 5, 56, 0xd9a066, { name: 'Tower Block 1' });
    this.addBox(3.4, 1, 3.4, -4, 6.5, 59, 0xd9a066, { name: 'Tower Block 2' });
    this.addBox(3.4, 1, 3.4, 1, 8, 62, 0xd9a066, { name: 'Tower Block 3' });
    this.addBox(3.2, 1, 3.2, -3, 9.5, 65, 0xd9a066, { name: 'Tower Block 4' });
    this.addBox(3.2, 1, 3.2, 2, 11, 68, 0xd9a066, { name: 'Tower Block 5' });
    this.addBox(3.4, 1, 3.4, -1, 12.5, 70, 0xd9a066, { name: 'Tower Block 6' });
    this.addBox(6, 1, 6, 0, 14, 73, 0xb5651d, { name: 'Tower Rest' });
    this.addSign(['Boing responsibly.'], 3.4, 2.2, 49, 0.65);
    this.addCheckpoint(0, 14.5, 73, 'Tower Climber');

    // ===== SECTION 2: THE CLIMB =====
    // Obstacle 4: two sliding squares across the gap (Δ JUMP_STEP between standable tops).
    // Tower pad (z=73, d=6) ends at z=76; landing (z=92, d=6) starts at z=89.
    // Split that 13 m with two 3.2-deep sliders and three JUMP_GAP holes.
    const sliderD = 3.2;
    const sliderHalf = sliderD / 2;
    const firstSliderZ = 76 + JUMP_GAP + sliderHalf;   // 79.8
    const secondSliderZ = firstSliderZ + sliderHalf + JUMP_GAP + sliderHalf; // 85.2
    this.addMover(sliderD, 0.7, sliderD,
      new THREE.Vector3(-SLIDER_X, 15.15, firstSliderZ), new THREE.Vector3(SLIDER_X, 15.15, firstSliderZ),
      0x42a5f5, 1.05, 0, 'Sliding Block A');
    this.addMover(sliderD, 0.7, sliderD,
      new THREE.Vector3(-SLIDER_X, 16.65, secondSliderZ), new THREE.Vector3(SLIDER_X, 16.65, secondSliderZ),
      0x42a5f5, 1.05, 1.2, 'Sliding Block B');
    this.addBox(6, 1, 6, 0, 18, 92, 0xb5651d, { name: 'Gap Landing' });
    this.addCheckpoint(0, 18.5, 92, 'Gap Glider');

    // Obstacle 5: windmill ledge + narrow beams (Δ1.5 per hop)
    this.addBox(10, 1, 10, 0, 19.5, 102, 0xcfa15a, { name: 'Windmill Ledge' });
    this.addRotor(0, 21.85, 102, 4.6, -2.3, 0xf39c12);
    this.addBox(1.1, 0.5, 10, -1.35, 21.25, 112, 0x90a4ae, { name: 'Narrow Beam 1' });
    this.addBox(1.1, 0.5, 10, 1.35, 22.75, 121, 0x90a4ae, { name: 'Narrow Beam 2' });
    this.addBox(7, 1, 7, 0, 24, 130, 0xb5651d, { name: 'Beam Landing' });
    this.addSign(['Narrow beams:', 'crawl (R) if scared.', 'No judgement.'], 5, 23, 108, 0.8);
    this.addCheckpoint(0, 24.5, 130, 'Beam Walker');

    // Obstacle 6: the sky elevator (lift carries you; post-trampoline hops ≤ JUMP_STEP)
    this.addMover(3.6, 0.7, 3.6, new THREE.Vector3(0, 25, 137), new THREE.Vector3(0, 43, 137), 0xab47bc, 0.55, 0, 'Sky Elevator');
    this.addBox(8, 1, 8, 0, 44, 145, 0xb5651d, { name: 'Elevator Deck' });
    this.addTrampoline(0, 44.5, 145, 1.4, 'Sky Trampoline');
    this.addBox(5, 1, 5, 0, 50, 152, 0x9c6b30, { name: 'High Step 1' });
    this.addBox(5, 1, 5, -5, 51.5, 158, 0x9c6b30, { name: 'High Step 2' });
    this.addBox(8, 1, 8, 0, 53, 164, 0xb5651d, { name: 'Elevator Rest' });
    this.addCheckpoint(0, 53.5, 164, 'Elevator Enjoyer');

    // ===== SECTION 3: THE SKY =====
    // Obstacle 7: cloud hopping (Δ JUMP_STEP; walkable collider cap on puff top).
    // Weave ±3.2 and drift ±2.5 so a +JUMP_STEP hop stays inside run (5.63 m), usually walk.
    let cy = 55, cz = 172;
    for (let i = 0; i < 7; i++) {
      const cx = Math.sin(i * 1.3) * 3.2;
      const drifting = i % 3 === 2;
      const cloudName = drifting ? `Drifting Cloud ${i + 1}` : `Cloud ${i + 1}`;
      if (drifting) {
        this.addCloud(cx, cy, cz, 6, 6.2, { b: new THREE.Vector3(cx + (i % 2 ? -2.5 : 2.5), cy, cz), speed: 0.8 }, cloudName);
      } else {
        this.addCloud(cx, cy, cz, 6, 6.2, undefined, cloudName);
      }
      cy += JUMP_STEP; cz += 7;
    }
    this.addCloud(0, cy, cz, 10, 9, undefined, 'Rest Cloud');
    this.addSign(['Clouds: 100% certified', 'bouncy-ish. Probably.'], 4, cy + 3, cz - 2, 0.9);
    this.addCheckpoint(0, cy + 0.58, cz, 'Cloud Nine');
    const restY = cy, restZ = cz;

    const throwLesson = placeThrowGate(this.climbApi(), restY, restZ + 10, 0xb5651d, 'Throw Lesson', 1, false);

    // Obstacle 8: one long straight ramp from Rest Cloud to the checkpoint. No landings, no wall.
    const slopeZ0 = throwLesson.z + 2.4;
    const slopeY0 = throwLesson.y + 0.5;
    const slopeY1 = restY + 17;
    const slopeZ1 = slopeZ0 + 32;
    this.addBallSlope(-3.4, 3.4, slopeZ0, slopeY0, slopeZ1, slopeY1, 'Checkpoint Slope');
    this.addSign(['One long ramp.', 'Walk it to the flag.', 'SHIFT is slower on slopes.'], -7, slopeY0 + 6, slopeZ0 + 8, 0.95);
    this.addCheckpoint(0, slopeY1, slopeZ1, 'Wall Magnet');

    // Obstacle 9: rotor gauntlet on the long sky bridge
    const bridgeY = slopeY1 - 0.5, bridgeZ = slopeZ1 + 4;
    this.addBox(6, 1, 26, 0, bridgeY, bridgeZ + 9, 0xeceff1, { name: 'Sky Bridge' });
    this.addRotor(0, bridgeY + 1.85, bridgeZ + 4, 4.2, 1.15, 0xe74c3c);
    this.addRotor(0, bridgeY + 1.85, bridgeZ + 14, 4.2, -1.25, 0xe67e22);
    this.addTrampoline(0, bridgeY - 0.02, bridgeZ + 21, 1.4, 'Bridge Trampoline');
    this.addCloud(0, bridgeY + 4, bridgeZ + 27, 8, 7, undefined, 'Gauntlet Cloud');
    this.addCheckpoint(0, bridgeY + 4.4, bridgeZ + 27, 'Gauntlet Hero');

    // ===== SECTION 4: OUTER SPACE =====
    // Obstacle 10: low-gravity asteroid leaps (first hop Δ1.5; then Δ SPACE_STEP in space)
    let ay = bridgeY + 6, az = bridgeZ + 36;
    const astX = [0, 6, -5, 3, -2, 0];
    for (let i = 0; i < 6; i++) {
      this.addAsteroid(astX[i], ay, az, 2.6 + (i % 2) * 0.7, `Asteroid ${i + 1}`);
      ay += SPACE_STEP; az += 9.5;
    }
    this.addAsteroid(0, ay, az, 4, 'Asteroid Rest');
    this.addSign(['Outer space:', 'no air, no lag,', 'no excuses.'], 5, ay + 4, az, 1);
    this.addCheckpoint(0, ay + 0.4, az, 'Asteroid Hopper');

    // Obstacle 11: the drifting belt
    this.addMover(3.4, 0.8, 3.4, new THREE.Vector3(-6, ay + 5, az + 8), new THREE.Vector3(6, ay + 5, az + 8), 0x7e57c2, 0.9, 0, 'Drift Pad 1');
    this.addMover(3.4, 0.8, 3.4, new THREE.Vector3(6, ay + 10, az + 15), new THREE.Vector3(-6, ay + 10, az + 15), 0x5c6bc0, 1.1, 3, 'Drift Pad 2');
    this.addMover(3.4, 0.8, 3.4, new THREE.Vector3(0, ay + 12, az + 22), new THREE.Vector3(0, ay + 19, az + 22), 0x26a69a, 0.7, 1, 'Space Lift');
    this.addAsteroid(0, ay + 21, az + 29, 3.4, 'Belt Asteroid');
    this.addCheckpoint(0, ay + 21.4, az + 29, 'Belt Rider');

    const fy = ay + 21, fz = az + 29;
    const more = appendClimbLevels(this.climbApi(), fy + 0.15, fz + 10, this.checkpoints.length);
    const topY = more.y + 5, topZ = more.z + 8;
    this.addBox(10, 1, 10, 0, topY - 4, topZ, 0xfff3cd, { name: 'The Summit' });
    this.endingPos.set(0, topY, topZ);

    this.endingRing = new THREE.Mesh(new THREE.TorusGeometry(3, 0.3, 14, 48),
      new THREE.MeshStandardMaterial({ color: 0xffeb3b, emissive: 0xd9a400, emissiveIntensity: 1.4, roughness: 0.25 }));
    this.endingRing.position.copy(this.endingPos);
    this.scene.add(this.endingRing);
    this.addSign(['THE END IS UP HERE!', 'Jump through the ring.', 'You earned the sky.'], 0, topY + 6, topZ, 1.3);

    // Stars everywhere above the sky line
    const starGeo = new THREE.BufferGeometry();
    const starCount = 1800;
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
      color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0
    }));
    this.scene.add(this.stars);
  }

  update(dt: number): void {
    this.time += dt;

    for (const m of this.movers) {
      const t = 0.5 + 0.5 * Math.sin(this.time * m.speed + m.phase);
      const nx = m.a.x + (m.b.x - m.a.x) * t;
      const ny = m.a.y + (m.b.y - m.a.y) * t;
      const nz = m.a.z + (m.b.z - m.a.z) * t;
      m.delta.set(nx - m.mesh.position.x, ny - m.mesh.position.y, nz - m.mesh.position.z);
      m.mesh.position.set(nx, ny, nz);
      const cloud = m.mesh.userData.cloud as THREE.Group | undefined;
      if (cloud) {
        cloud.position.x = nx;
        cloud.position.z = nz;
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

    for (const cl of this.clouds) {
      cl.children.forEach((b, i) => {
        b.position.y += Math.sin(this.time * 0.8 + i * 2.4) * 0.0009;
      });
    }
  }

  private spawnHazardBall(): void {
    const ball = this.hazardBalls.find((b) => !b.active);
    if (!ball) return;
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
