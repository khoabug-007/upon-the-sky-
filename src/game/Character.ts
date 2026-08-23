import * as THREE from 'three';
import type { AnimState, Customization } from '../types';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Slider value 1..100 -> 0..1 */
const norm = (v: number) => clamp01((v - 1) / 99);

function hashHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return (h % 360) / 360;
}

/**
 * Parametric white stick-figure character (Stumble-Guys-like blob).
 * Origin is at the feet. Three sliders (1-100) reshape head, body and legs.
 */
export class Character {
  readonly group = new THREE.Group();
  height = 1.7;

  private root = new THREE.Group();
  private legL!: THREE.Group;
  private legR!: THREE.Group;
  private armL!: THREE.Group;
  private armR!: THREE.Group;
  private headG!: THREE.Group;
  private torso!: THREE.Mesh;

  private dims = { legLen: 0.5, legR: 0.1, torsoH: 0.6, bodyR: 0.25, headR: 0.24, armLen: 0.42 };

  private bodyMat: THREE.MeshStandardMaterial;
  private darkMat: THREE.MeshStandardMaterial;
  private accentMat: THREE.MeshStandardMaterial;

  private anim: AnimState = 'idle';
  private phase = Math.random() * 10;
  private punchT = -1;
  private nameSprite: THREE.Sprite | null = null;

  constructor(custom: Customization, accentName = 'player') {
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 });
    this.darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1c24, roughness: 0.4 });
    const accent = new THREE.Color().setHSL(hashHue(accentName), 0.75, 0.55);
    this.accentMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5 });
    this.group.add(this.root);
    this.applyCustomization(custom);
  }

  applyCustomization(c: Customization): void {
    const th = norm(c.head), tb = norm(c.body), tl = norm(c.legs);
    this.dims = {
      headR: lerp(0.15, 0.42, th),
      bodyR: lerp(0.13, 0.46, tb),
      torsoH: lerp(0.5, 0.68, tb),
      legLen: lerp(0.26, 0.95, tl),
      legR: lerp(0.06, 0.16, lerp(tl, tb, 0.4)),
      armLen: lerp(0.32, 0.5, tb)
    };
    this.build();
    this.height = this.dims.legLen + this.dims.torsoH + this.dims.headR * 2 + 0.04;
  }

  setNameTag(name: string): void {
    if (this.nameSprite) this.group.remove(this.nameSprite);
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 72;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 40px "Baloo 2", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    const w = Math.min(240, ctx.measureText(name).width + 30);
    ctx.beginPath(); ctx.roundRect(128 - w / 2, 8, w, 56, 16); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(name, 128, 38);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
    this.nameSprite = new THREE.Sprite(mat);
    this.nameSprite.scale.set(1.6, 0.45, 1);
    this.nameSprite.position.y = this.height + 0.45;
    this.group.add(this.nameSprite);
  }

  private disposeTree(obj: THREE.Object3D): void {
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
  }

  private capsule(r: number, totalLen: number, mat: THREE.Material): THREE.Mesh {
    const mid = Math.max(0.02, totalLen - 2 * r);
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, mid, 6, 14), mat);
    mesh.castShadow = true;
    return mesh;
  }

  private build(): void {
    this.disposeTree(this.root);
    this.root.clear();
    this.root.rotation.set(0, 0, 0);
    this.root.position.set(0, 0, 0);
    const d = this.dims;

    // Legs (pivot at hip)
    const hipY = d.legLen;
    const hipOff = Math.max(d.bodyR * 0.45, d.legR * 1.15);
    this.legL = new THREE.Group();
    this.legL.position.set(-hipOff, hipY, 0);
    const legMeshL = this.capsule(d.legR, d.legLen, this.bodyMat);
    legMeshL.position.y = -d.legLen / 2;
    this.legL.add(legMeshL);
    this.legR = this.legL.clone();
    this.legR.position.x = hipOff;

    // Torso: cute ellipsoid blob
    this.torso = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), this.bodyMat);
    this.torso.scale.set(d.bodyR, d.torsoH * 0.62, d.bodyR * 0.9);
    this.torso.position.y = hipY + d.torsoH * 0.5;
    this.torso.castShadow = true;

    // Accent scarf so friends can tell each other apart
    const scarf = new THREE.Mesh(
      new THREE.TorusGeometry(Math.max(0.08, d.bodyR * 0.72), 0.045, 8, 24), this.accentMat);
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = hipY + d.torsoH * 0.92;

    // Arms (pivot at shoulder)
    const shoulderY = hipY + d.torsoH * 0.82;
    this.armL = new THREE.Group();
    this.armL.position.set(-(d.bodyR + 0.06), shoulderY, 0);
    const armMeshL = this.capsule(0.07, d.armLen, this.bodyMat);
    armMeshL.position.y = -d.armLen / 2;
    this.armL.add(armMeshL);
    this.armR = this.armL.clone();
    this.armR.position.x = d.bodyR + 0.06;

    // Head with a happy face
    this.headG = new THREE.Group();
    this.headG.position.y = hipY + d.torsoH + d.headR * 0.82;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(d.headR, 22, 18), this.bodyMat);
    skull.castShadow = true;
    this.headG.add(skull);
    const eyeGeo = new THREE.SphereGeometry(d.headR * 0.13, 10, 8);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, this.darkMat);
      eye.position.set(sx * d.headR * 0.34, d.headR * 0.18, d.headR * 0.85);
      this.headG.add(eye);
    }
    const smileArc = Math.PI * 0.7;
    const smile = new THREE.Mesh(
      new THREE.TorusGeometry(d.headR * 0.42, d.headR * 0.07, 8, 16, smileArc), this.darkMat);
    smile.rotation.z = -Math.PI / 2 - smileArc / 2;
    smile.position.set(0, -d.headR * 0.12, d.headR * 0.82);
    this.headG.add(smile);

    this.root.add(this.legL, this.legR, this.torso, scarf, this.armL, this.armR, this.headG);
    if (this.nameSprite) this.nameSprite.position.y = this.dims.legLen + this.dims.torsoH + this.dims.headR * 2 + 0.5;
  }

  setAnim(a: AnimState): void { this.anim = a; }
  triggerPunch(): void { this.punchT = 0; }

  update(dt: number): void {
    const speed = this.anim === 'run' ? 13 : this.anim === 'walk' ? 8.5
      : this.anim === 'carried' ? 16 : this.anim === 'crawl' ? 7 : 2.2;
    this.phase += speed * dt;
    if (this.punchT >= 0) {
      this.punchT += dt / 0.28;
      if (this.punchT > 1) this.punchT = -1;
    }
    this.pose();
  }

  private pose(): void {
    const p = this.phase;
    const s = Math.sin(p);
    this.root.rotation.set(0, 0, 0);
    this.root.position.set(0, 0, 0);
    this.legL.rotation.set(0, 0, 0);
    this.legR.rotation.set(0, 0, 0);
    this.armL.rotation.set(0, 0, 0.14);
    this.armR.rotation.set(0, 0, -0.14);
    this.headG.rotation.set(0, 0, 0);

    switch (this.anim) {
      case 'idle': {
        this.armL.rotation.x = Math.sin(p) * 0.07;
        this.armR.rotation.x = -Math.sin(p) * 0.07;
        this.root.position.y = Math.sin(p * 1.6) * 0.012;
        this.headG.rotation.z = Math.sin(p * 0.5) * 0.06;
        break;
      }
      case 'walk':
      case 'run': {
        const amp = this.anim === 'run' ? 0.95 : 0.55;
        this.legL.rotation.x = s * amp;
        this.legR.rotation.x = -s * amp;
        this.armL.rotation.x = -s * amp * 0.85;
        this.armR.rotation.x = s * amp * 0.85;
        this.root.position.y = Math.abs(Math.cos(p)) * 0.05;
        this.root.rotation.x = this.anim === 'run' ? 0.16 : 0.05;
        break;
      }
      case 'jump': {
        this.legL.rotation.x = 0.55;
        this.legR.rotation.x = 0.4;
        this.armL.rotation.x = -2.7;
        this.armR.rotation.x = -2.7;
        break;
      }
      case 'fall': {
        this.legL.rotation.x = Math.sin(p * 3) * 0.4 + 0.3;
        this.legR.rotation.x = -Math.sin(p * 3) * 0.4 + 0.3;
        this.armL.rotation.x = -2.4 + Math.sin(p * 4) * 0.3;
        this.armR.rotation.x = -2.4 - Math.sin(p * 4) * 0.3;
        break;
      }
      case 'crawl': {
        this.root.rotation.x = 1.35;
        this.root.position.y = 0.34;
        this.legL.rotation.x = Math.sin(p) * 0.5 - 0.2;
        this.legR.rotation.x = -Math.sin(p) * 0.5 - 0.2;
        this.armL.rotation.x = -Math.sin(p) * 0.7 - 1.2;
        this.armR.rotation.x = Math.sin(p) * 0.7 - 1.2;
        this.headG.rotation.x = -1.0;
        break;
      }
      case 'carried': {
        this.root.rotation.z = Math.sin(p) * 0.22;
        this.legL.rotation.x = Math.sin(p * 1.7) * 0.9;
        this.legR.rotation.x = -Math.sin(p * 1.7) * 0.9;
        this.armL.rotation.x = -2.6 + Math.sin(p * 2) * 0.5;
        this.armR.rotation.x = -2.6 - Math.sin(p * 2) * 0.5;
        break;
      }
      case 'float': {
        this.armL.rotation.set(-0.4, 0, 1.15);
        this.armR.rotation.set(-0.4, 0, -1.15);
        this.legL.rotation.set(0.25, 0, 0.28);
        this.legR.rotation.set(0.25, 0, -0.28);
        this.root.rotation.z = Math.sin(p * 0.35) * 0.18;
        this.root.rotation.x = Math.sin(p * 0.27) * 0.15;
        this.headG.rotation.x = -0.25;
        break;
      }
      case 'grab': {
        this.armL.rotation.x = -2.9;
        this.armR.rotation.x = -2.9;
        this.legL.rotation.x = Math.sin(p) * 0.15 + 0.1;
        this.legR.rotation.x = -Math.sin(p) * 0.15 + 0.1;
        break;
      }
      case 'sit': {
        this.root.position.y = -this.dims.legLen * 0.78;
        this.root.rotation.x = 0.1;
        this.legL.rotation.x = 1.28;
        this.legR.rotation.x = 1.22;
        this.legL.rotation.z = 0.06;
        this.legR.rotation.z = -0.06;
        this.armL.rotation.set(-0.72, 0, 0.32);
        this.armR.rotation.set(-0.62, 0, -0.22);
        this.headG.rotation.x = -0.06;
        break;
      }
    }

    // Punch overlays any pose on the right arm
    if (this.punchT >= 0) {
      const k = Math.sin(Math.min(1, this.punchT) * Math.PI);
      this.armR.rotation.x = -k * (Math.PI / 2) * 1.15;
      this.armR.rotation.z = -0.05;
      this.root.rotation.y = -k * 0.25;
    }
  }
}
