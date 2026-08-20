import * as THREE from 'three';

export interface BoxCollider {
  min: THREE.Vector3;
  max: THREE.Vector3;
  bouncy?: boolean;
  moverIndex?: number;
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

export const SKY_START_Y = 90;
// Low-gravity kicks in at the sky-bridge cloud (~y 88); matches retuned course pacing
export const SPACE_START_Y = 88;
/** Max vertical step without assist (matches PlayerController.JUMP_HEIGHT_SAFE). */
const JUMP_STEP = 1.5;
/** Max vertical step in low gravity (matches PlayerController.SPACE_JUMP_HEIGHT_SAFE). */
const SPACE_STEP = 6.5;

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
  grabPoints: THREE.Vector3[] = [];
  props: Prop[] = [];
  stars!: THREE.Points;
  endingPos = new THREE.Vector3();
  spawnPos = new THREE.Vector3(0, 0.1, -4);

  private clouds: THREE.Group[] = [];
  private endingRing!: THREE.Mesh;
  private time = 0;

  constructor(private scene: THREE.Scene) {
    this.build();
  }

  // ---------- helpers ----------

  private addBox(
    w: number, h: number, d: number,
    x: number, y: number, z: number,
    color: number, opts: { bouncy?: boolean; noShadow?: boolean } = {}
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    mesh.position.set(x, y, z);
    if (!opts.noShadow) { mesh.castShadow = true; mesh.receiveShadow = true; }
    this.scene.add(mesh);
    this.colliders.push({
      min: new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
      max: new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2),
      bouncy: opts.bouncy
    });
    return mesh;
  }

  private addTrampoline(x: number, y: number, z: number, r = 1.6): void {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, 0.45, 24), mat(0x777788));
    base.position.set(x, y + 0.22, z);
    base.castShadow = true; base.receiveShadow = true;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 0.9, 0.14, 24),
      new THREE.MeshStandardMaterial({ color: 0xff4f9a, roughness: 0.4, emissive: 0x550022 }));
    pad.position.set(x, y + 0.52, z);
    this.scene.add(base, pad);
    this.colliders.push({
      min: new THREE.Vector3(x - r * 0.95, y, z - r * 0.95),
      max: new THREE.Vector3(x + r * 0.95, y + 0.6, z + r * 0.95),
      bouncy: true
    });
  }

  private addMover(
    w: number, h: number, d: number,
    a: THREE.Vector3, b: THREE.Vector3,
    color: number, speed = 1, phase = 0
  ): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, 0.6));
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.position.copy(a);
    this.scene.add(mesh);
    const size = new THREE.Vector3(w, h, d);
    const collider: BoxCollider = {
      min: a.clone().sub(size.clone().multiplyScalar(0.5)),
      max: a.clone().add(size.clone().multiplyScalar(0.5)),
      moverIndex: this.movers.length
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

  private addCloud(x: number, y: number, z: number, w = 6, d = 5, moving?: { b: THREE.Vector3; speed: number }): void {
    const g = new THREE.Group();
    const cm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    const blobCount = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < blobCount; i++) {
      const r = (0.32 + Math.random() * 0.3) * Math.min(w, d);
      const blob = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), cm);
      blob.position.set((Math.random() - 0.5) * w * 0.8, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * d * 0.8);
      blob.scale.y = 0.55;
      g.add(blob);
    }
    g.position.set(x, y, z);
    this.scene.add(g);
    this.clouds.push(g);
    if (moving) {
      // Invisible mover collider — walkable cap synced with static cloud tops
      const capH = 0.2;
      const capY = y + 0.48;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w * 0.85, capH, d * 0.85),
        new THREE.MeshStandardMaterial({ visible: false }));
      mesh.position.set(x, capY, z);
      this.scene.add(mesh);
      mesh.userData.cloud = g;
      const size = new THREE.Vector3(w * 0.85, capH, d * 0.85);
      const collider: BoxCollider = {
        min: new THREE.Vector3(x, y + 0.38, z).sub(new THREE.Vector3(size.x / 2, 0, size.z / 2)),
        max: new THREE.Vector3(x, y + 0.58, z).add(new THREE.Vector3(size.x / 2, 0, size.z / 2)),
        moverIndex: this.movers.length
      };
      this.colliders.push(collider);
      this.movers.push({
        mesh, collider, a: new THREE.Vector3(x, capY, z), b: new THREE.Vector3(moving.b.x, moving.b.y + 0.48, moving.b.z),
        speed: moving.speed, phase: Math.random() * 6, size, delta: new THREE.Vector3()
      });
    } else {
      // Thin walkable cap above puff visuals (stand on top, not inside the cloud)
      this.colliders.push({
        min: new THREE.Vector3(x - w * 0.42, y + 0.38, z - d * 0.42),
        max: new THREE.Vector3(x + w * 0.42, y + 0.58, z + d * 0.42)
      });
    }
  }

  private addAsteroid(x: number, y: number, z: number, r = 2.6): void {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 1), mat(0x6d6875, 0.95));
    rock.position.set(x, y - r * 0.45, z);
    rock.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    rock.castShadow = true; rock.receiveShadow = true;
    this.scene.add(rock);
    this.colliders.push({
      min: new THREE.Vector3(x - r * 0.75, y - r, z - r * 0.75),
      max: new THREE.Vector3(x + r * 0.75, y + 0.1, z + r * 0.75)
    });
  }

  private addGrabWall(x: number, yBottom: number, yTop: number, z: number, width = 6): void {
    const h = yTop - yBottom;
    this.addBox(width, h, 1, x, yBottom + h / 2, z, 0x9575cd);
    const handleMat = new THREE.MeshStandardMaterial({ color: 0xffe14d, emissive: 0x6b5900, roughness: 0.35 });
    for (let y = yBottom + 1.2; y < yTop - 0.2; y += 1.5) {
      for (let ox = -width / 2 + 1; ox <= width / 2 - 1; ox += 1.7) {
        const jitter = (Math.random() - 0.5) * 0.5;
        const handle = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), handleMat);
        const hp = new THREE.Vector3(x + ox + jitter, y, z - 0.62);
        handle.position.copy(hp);
        this.scene.add(handle);
        this.grabPoints.push(hp);
      }
    }
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
    this.colliders.push({ min: new THREE.Vector3(-90, -2, -90), max: new THREE.Vector3(90, 0, 90) });

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
      this.addBox(2.2, 1.4, 2.2, (i % 2 === 0 ? -1.6 : 1.6), 0.1, 12.5 + i * 2.4, 0xd9a066);
    }
    this.addCheckpoint(0, 0, 24, 'Pond Survivor');

    // Obstacle 2: the angry spinning bar
    this.addBox(14, 0.8, 14, 0, 0.4, 34, 0xcfa15a);
    this.addRotor(0, 1.75, 34, 6.4, 1.9);
    this.addSign(['This bar has anger', 'issues. JUMP!'], -6, 3.2, 30, 0.75);
    this.addCheckpoint(0, 0.8, 42, 'Bar Dodger');

    // Obstacle 3: trampoline + tower hops up to the sky road (≤ JUMP_STEP per hop after bounce)
    this.addTrampoline(0, 0, 50);
    this.addBox(4, 1, 4, 0, 5, 56, 0xd9a066);           // top 5.5 — trampoline reach
    this.addBox(3.4, 1, 3.4, -4, 6.5, 59, 0xd9a066);    // top 7.0   Δ1.5
    this.addBox(3.4, 1, 3.4, 1, 8, 62, 0xd9a066);       // top 8.5   Δ1.5
    this.addBox(3.2, 1, 3.2, -3, 9.5, 65, 0xd9a066);   // top 10.0  Δ1.5
    this.addBox(3.2, 1, 3.2, 2, 11, 68, 0xd9a066);      // top 11.5  Δ1.5
    this.addBox(3.4, 1, 3.4, -1, 12.5, 70, 0xd9a066);   // top 13.0  Δ1.5
    this.addBox(6, 1, 6, 0, 14, 73, 0xb5651d);           // top 14.5  Δ1.5
    this.addSign(['Boing responsibly.'], 3.4, 2.2, 49, 0.65);
    this.addCheckpoint(0, 14.5, 73, 'Tower Climber');

    // ===== SECTION 2: THE CLIMB =====
    // Obstacle 4: sliding platforms across the gap (Δ1.5 between standable tops)
    this.addMover(3.2, 0.7, 3.2, new THREE.Vector3(-5, 15.15, 78), new THREE.Vector3(5, 15.15, 78), 0x42a5f5, 1.1); // top 15.5
    this.addMover(3.2, 0.7, 3.2, new THREE.Vector3(5, 16.65, 85), new THREE.Vector3(-5, 16.65, 85), 0x42a5f5, 1.3, 2); // top 17.0
    this.addBox(6, 1, 6, 0, 18, 92, 0xb5651d); // top 18.5
    this.addCheckpoint(0, 18.5, 92, 'Gap Glider');

    // Obstacle 5: windmill ledge + narrow beams (Δ1.5 per hop)
    this.addBox(10, 1, 10, 0, 19.5, 102, 0xcfa15a);     // top 20.0  Δ1.5
    this.addRotor(0, 21.85, 102, 4.6, -2.3, 0xf39c12);
    this.addBox(1.1, 0.5, 10, -2, 21.25, 112, 0x90a4ae); // top 21.5  Δ1.5
    this.addBox(1.1, 0.5, 10, 2, 22.75, 121, 0x90a4ae);  // top 23.0  Δ1.5
    this.addBox(7, 1, 7, 0, 24, 130, 0xb5651d);           // top 24.5  Δ1.5
    this.addSign(['Narrow beams:', 'crawl (R) if scared.', 'No judgement.'], 5, 23, 108, 0.8);
    this.addCheckpoint(0, 24.5, 130, 'Beam Walker');

    // Obstacle 6: the sky elevator (lift carries you; post-trampoline hops ≤ JUMP_STEP)
    this.addMover(3.6, 0.7, 3.6, new THREE.Vector3(0, 25, 137), new THREE.Vector3(0, 43, 137), 0xab47bc, 0.55);
    this.addBox(8, 1, 8, 0, 44, 145, 0xb5651d);          // top 44.5
    this.addTrampoline(0, 44.5, 145, 1.4);               // bounce reach ~51 m
    this.addBox(5, 1, 5, 0, 50, 152, 0x9c6b30);          // top 50.5  trampoline reach
    this.addBox(5, 1, 5, -5, 51.5, 158, 0x9c6b30);      // top 52.0  Δ1.5
    this.addBox(8, 1, 8, 0, 53, 164, 0xb5651d);           // top 53.5  Δ1.5
    this.addCheckpoint(0, 53.5, 164, 'Elevator Enjoyer');

    // ===== SECTION 3: THE SKY =====
    // Obstacle 7: cloud hopping (Δ JUMP_STEP; walkable collider cap on puff top)
    let cy = 55, cz = 172;
    for (let i = 0; i < 7; i++) {
      const cx = Math.sin(i * 1.3) * 7;
      if (i % 3 === 2) {
        this.addCloud(cx, cy, cz, 6, 5, { b: new THREE.Vector3(cx + (i % 2 ? -8 : 8), cy, cz), speed: 0.8 });
      } else {
        this.addCloud(cx, cy, cz, 6, 5);
      }
      cy += JUMP_STEP; cz += 7;
    }
    this.addCloud(0, cy, cz, 10, 9); // big rest cloud (~65.5, 221)
    this.addSign(['Clouds: 100% certified', 'bouncy-ish. Probably.'], 4, cy + 3, cz - 2, 0.9);
    this.addCheckpoint(0, cy + 0.58, cz, 'Cloud Nine');
    const restY = cy, restZ = cz;

    // Obstacle 8: mega trampoline into the grab wall (trampoline → grab is intended route)
    this.addTrampoline(0, restY + 0.3, restZ + 3.5, 2);
    const wallBottom = restY + 6, wallTop = restY + 16, wallZ = restZ + 10;
    this.addCloud(0, wallBottom - 1.5, wallZ - 3.5, 7, 5);
    this.addGrabWall(0, wallBottom, wallTop, wallZ);
    this.addBox(9, 1, 7, 0, wallTop + 0.5, wallZ + 3.5, 0xeceff1);
    this.addSign(['Hold LEFT CLICK to cling', 'like a fridge magnet.', 'SPACE to leap!'], -6, wallBottom + 6, wallZ - 4, 0.95);
    this.addCheckpoint(0, wallTop + 1, wallZ + 3.5, 'Wall Magnet');

    // Obstacle 9: rotor gauntlet on the long sky bridge
    const bridgeY = wallTop + 0.5, bridgeZ = wallZ + 14;
    this.addBox(6, 1, 26, 0, bridgeY, bridgeZ + 9, 0xeceff1);
    this.addRotor(0, bridgeY + 1.85, bridgeZ + 4, 4.2, 2.6, 0xe74c3c);
    this.addRotor(0, bridgeY + 1.85, bridgeZ + 14, 4.2, -2.9, 0xe67e22);
    this.addCloud(0, bridgeY + 4, bridgeZ + 27, 8, 7);
    this.addCheckpoint(0, bridgeY + 4.4, bridgeZ + 27, 'Gauntlet Hero');

    // ===== SECTION 4: OUTER SPACE =====
    // Obstacle 10: low-gravity asteroid leaps (first hop Δ1.5; then Δ SPACE_STEP in space)
    let ay = bridgeY + 6, az = bridgeZ + 36;
    const astX = [0, 6, -5, 3, -2, 0];
    for (let i = 0; i < 6; i++) {
      this.addAsteroid(astX[i], ay, az, 2.6 + (i % 2) * 0.7);
      ay += SPACE_STEP; az += 9.5;
    }
    this.addAsteroid(0, ay, az, 4);
    this.addSign(['Outer space:', 'no air, no lag,', 'no excuses.'], 5, ay + 4, az, 1);
    this.addCheckpoint(0, ay + 0.4, az, 'Asteroid Hopper');

    // Obstacle 11: the drifting belt
    this.addMover(3.4, 0.8, 3.4, new THREE.Vector3(-6, ay + 5, az + 8), new THREE.Vector3(6, ay + 5, az + 8), 0x7e57c2, 0.9);
    this.addMover(3.4, 0.8, 3.4, new THREE.Vector3(6, ay + 10, az + 15), new THREE.Vector3(-6, ay + 10, az + 15), 0x5c6bc0, 1.1, 3);
    this.addMover(3.4, 0.8, 3.4, new THREE.Vector3(0, ay + 12, az + 22), new THREE.Vector3(0, ay + 19, az + 22), 0x26a69a, 0.7, 1);
    this.addAsteroid(0, ay + 21, az + 29, 3.4);
    this.addCheckpoint(0, ay + 21.4, az + 29, 'Belt Rider');

    // Final ascent: golden steps to the ending ring (Δ SPACE_STEP in low gravity)
    const fy = ay + 21, fz = az + 29;
    for (let i = 1; i <= 4; i++) {
      this.addBox(3, 0.8, 3, Math.sin(i * 2.1) * 4, fy + i * SPACE_STEP, fz + i * 5,
        0xffd54f);
    }
    const topY = fy + 4 * SPACE_STEP + 4, topZ = fz + 4 * 5 + 6;
    this.addBox(10, 1, 10, 0, topY - 4, topZ, 0xfff3cd);
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
      if (cloud) cloud.position.copy(m.mesh.position);
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

    for (const cl of this.clouds) {
      cl.children.forEach((b, i) => {
        b.position.y += Math.sin(this.time * 0.8 + i * 2.4) * 0.0009;
      });
    }
  }
}
