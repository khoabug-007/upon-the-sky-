import * as THREE from 'three';
import { WorldMap, SPACE_START_Y, type Prop } from '../world/WorldMap';
import { Character } from './Character';
import { Transport } from './Vehicle';
import { PlayerController } from './PlayerController';
import { CameraRig } from './CameraRig';
import { Input } from './Input';
import { RemotePlayer } from './RemotePlayer';
import { HUD } from '../ui/HUD';
import type { Network } from '../net/Network';
import type { ActionMsg, AnimState, JoinResult, Profile } from '../types';

const PROGRESS_KEY = 'uts_progress';
const FIXED_DT = 1 / 60;
const STRUGGLE_CLICKS = 8;
const PICKUP_IMMUNE_MS = 3000;

const GROUND_SKY = new THREE.Color(0x87ceeb);
const HIGH_SKY = new THREE.Color(0x2c3a8f);
const SPACE_SKY = new THREE.Color(0x04050d);

interface Burst { points: THREE.Points; vels: Float32Array; life: number }

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private world: WorldMap;
  private input = new Input();
  private cam: CameraRig;
  private hud = new HUD();

  private character: Character;
  private vehicle: Transport;
  private controller = new PlayerController();
  private remotes = new Map<string, RemotePlayer>();

  private sun: THREE.DirectionalLight;
  private spaceSky!: THREE.Mesh;
  private spaceSkyMat!: THREE.MeshBasicMaterial;
  private currentCheckpoint = -1;
  private carryingId: string | null = null;
  private heldProp: Prop | null = null;
  private punchCooldown = 0;
  private struggleClicks = 0;
  private pickupImmuneUntil = 0;
  private sendTimer = 0;
  private accumulator = 0;
  private clock = new THREE.Clock();
  private bursts: Burst[] = [];
  private endingTriggered = false;
  private pendingFlyLand = false;
  private afterFlyRefY: number | null = null;
  private running = true;
  private renderPos = new THREE.Vector3();

  constructor(
    canvas: HTMLCanvasElement,
    private network: Network,
    private profile: Profile,
    joinInfo: JoinResult
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    window.addEventListener('resize', () => this.renderer.setSize(innerWidth, innerHeight));

    this.scene.background = GROUND_SKY.clone();
    this.scene.fog = new THREE.Fog(GROUND_SKY.clone(), 60, 320);
    this.installSpaceSky();

    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -40; this.sun.shadow.camera.right = 40;
    this.sun.shadow.camera.top = 40; this.sun.shadow.camera.bottom = -40;
    this.sun.shadow.camera.far = 220;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x7a9a5a, 1.0));

    this.world = new WorldMap(this.scene);
    this.vehicle = new Transport(this.scene, this.world.vehicleSpawn);

    this.character = new Character(profile.custom, profile.name);
    this.scene.add(this.character.group);
    this.controller.standHeight = this.character.height + 0.05;

    this.cam = new CameraRig(canvas);

    // Restore saved progress (auto-save at checkpoints)
    const saved = localStorage.getItem(PROGRESS_KEY);
    if (saved) {
      const idx = Math.min(JSON.parse(saved).checkpoint ?? -1, this.world.checkpoints.length - 1);
      this.currentCheckpoint = idx;
      if (idx >= 0) {
        this.markCheckpointsReached(idx);
        setTimeout(() => this.hud.toast(`Welcome back, ${profile.name}! Progress restored at "${this.world.checkpoints[idx].label}".`, 4500), 800);
      }
    }
    this.controller.teleport(this.respawnPoint());
    this.cam.snap(this.controller.pos);
    this.hud.setProgress(this.currentCheckpoint + 1, this.world.checkpoints.length);

    this.controller.onBounce = () => this.hud.toast('BOING!', 900);
    this.controller.onRotorHit = () => this.hud.toast('BONK! The bar strikes again.', 2000);
    this.controller.onBallHit = () => this.hud.toast('BONK! A marble!', 1400);

    this.hud.setServer(joinInfo.name ?? 'Server', joinInfo.code ?? '------');
    this.hud.onCommand = (command) => this.handleChatCommand(command);
    this.hud.onPlayAgain = () => {
      this.currentCheckpoint = -1;
      localStorage.removeItem(PROGRESS_KEY);
      this.endingTriggered = false;
      this.controller.endingMode = false;
      this.controller.flyMode = false;
      this.pendingFlyLand = false;
      this.afterFlyRefY = null;
      this.controller.teleport(this.world.spawnPos);
      this.cam.snap(this.controller.pos);
      this.hud.toast('Back to the dirt. The sky remembers you.');
    };
    this.hud.show();

    for (const p of joinInfo.players ?? []) this.addRemote(p.id, p.profile);
    this.updatePlayerCount();

    this.network.onPlayerJoined = (p) => {
      this.addRemote(p.id, p.profile);
      this.hud.toast(`${p.profile.name} joined the climb!`);
      this.updatePlayerCount();
    };
    this.network.onPlayerLeft = (id) => {
      const r = this.remotes.get(id);
      if (r) { r.dispose(this.scene); this.remotes.delete(id); }
      if (this.carryingId === id) this.carryingId = null;
      if (this.controller.carriedBy === id) this.controller.carriedBy = null;
      for (const prop of this.world.props) if (prop.heldBy === id) prop.heldBy = null;
      this.updatePlayerCount();
    };
    this.network.onPlayerState = (s) => {
      const r = this.remotes.get(s.id);
      if (!r) return;
      r.targetPos.set(s.x, s.y, s.z);
      r.targetRy = s.ry;
      r.anim = s.anim;
      r.carriedBy = s.carriedBy;
    };
    this.network.onAction = (a) => this.handleAction(a);
    this.network.onConnectionChange = (ok) => {
      if (!ok) this.hud.toast('Connection lost... the sky is quiet.', 5000);
    };

    setTimeout(() => this.hud.toast('Click the screen to look around. Reach outer space!', 5000), 300);
    // debug/test handle (TS privacy is compile-time only)
    (window as unknown as Record<string, unknown>).__uts = this;
    requestAnimationFrame(this.loop);
  }

  // ---------------- remotes & actions ----------------

  private addRemote(id: string, profile: Profile): void {
    if (this.remotes.has(id)) return;
    this.remotes.set(id, new RemotePlayer(id, profile, this.scene));
  }

  private updatePlayerCount(): void {
    this.hud.setPlayerCount(this.remotes.size + 1);
  }

  private remoteName(id: string | undefined): string {
    return (id && this.remotes.get(id)?.name) || 'Someone';
  }

  private handleAction(a: ActionMsg): void {
    switch (a.type) {
      case 'punch': {
        if (a.target === this.network.id && a.dir) {
          this.controller.applyKnockback(new THREE.Vector3(a.dir.x, 0, a.dir.z), 11);
          this.hud.toast(`${this.remoteName(a.from)} bonked you! Rude. Hilarious, but rude.`);
        }
        this.remotes.get(a.from ?? '')?.character.triggerPunch();
        break;
      }
      case 'pickup': {
        if (a.target === this.network.id && a.from) {
          if (performance.now() < this.pickupImmuneUntil) {
            this.network.sendAction({ type: 'escape' });
            break;
          }
          this.controller.carriedBy = a.from;
          this.struggleClicks = 0;
          this.hud.setStruggle(0, STRUGGLE_CLICKS);
          this.hud.toast(`${this.remoteName(a.from)} picked you up! Click 8 times to break free.`, 3200);
        }
        break;
      }
      case 'drop': {
        if (a.target === this.network.id) {
          this.controller.carriedBy = null;
          this.controller.vel.set(0, 0, 0);
          this.struggleClicks = 0;
          this.hud.hideStruggle();
        }
        break;
      }
      case 'throw': {
        if (a.target === this.network.id && a.dir) {
          this.controller.carriedBy = null;
          this.controller.vel.set(a.dir.x * 15, a.dir.y * 15 + 6, a.dir.z * 15);
          this.struggleClicks = 0;
          this.hud.hideStruggle();
          this.hud.toast(`YEET! Courtesy of ${this.remoteName(a.from)}.`);
        }
        break;
      }
      case 'escape': {
        if (a.from && a.from === this.carryingId) {
          this.carryingId = null;
          this.hud.toast(`${this.remoteName(a.from)} wriggled free!`, 2200);
        }
        break;
      }
      case 'prop_grab': {
        const prop = this.world.props[a.propId ?? -1];
        if (prop) {
          prop.heldBy = a.from ?? null;
          if (this.heldProp?.id === prop.id) this.heldProp = null; // they stole it!
        }
        break;
      }
      case 'prop_throw': {
        const prop = this.world.props[a.propId ?? -1];
        if (prop && a.pos && a.vel) {
          prop.heldBy = null;
          prop.mesh.position.set(a.pos.x, a.pos.y, a.pos.z);
          prop.vel.set(a.vel.x, a.vel.y, a.vel.z);
        }
        break;
      }
    }
  }

  // ---------------- combat / carry / props ----------------

  private nearestRemote(maxDist: number, requireFront = false): RemotePlayer | null {
    let best: RemotePlayer | null = null;
    let bestD = maxDist;
    const fwd = this.cam.forward(new THREE.Vector3());
    for (const r of this.remotes.values()) {
      const to = r.character.group.position.clone().sub(this.controller.pos);
      const d = to.length();
      if (d > bestD) continue;
      if (requireFront && d > 0.4) {
        to.normalize();
        if (to.dot(fwd) < 0.15) continue;
      }
      best = r; bestD = d;
    }
    return best;
  }

  private nearestProp(maxDist: number): Prop | null {
    let best: Prop | null = null;
    let bestD = maxDist;
    for (const p of this.world.props) {
      if (p.heldBy) continue;
      const d = p.mesh.position.distanceTo(this.controller.pos);
      if (d < bestD) { best = p; bestD = d; }
    }
    return best;
  }

  private breakFree(): void {
    this.controller.carriedBy = null;
    this.struggleClicks = 0;
    this.pickupImmuneUntil = performance.now() + PICKUP_IMMUNE_MS;
    this.hud.hideStruggle();
    this.network.sendAction({ type: 'escape' });
    this.hud.toast('You broke free! Safe for 3 seconds.', 2500);
  }

  private doEnterOrPunch(): void {
    if (this.vehicle.seatOf('me') >= 0) {
      this.vehicle.detachRider(this.character.group, this.scene);
      const out = this.vehicle.exit('me');
      if (out) this.controller.teleport(out);
      this.character.group.position.copy(this.controller.pos);
      this.character.group.rotation.y = this.controller.facing;
      this.cam.dist = 6.5;
      this.hud.toast('You stepped out. E to get back in.', 1600);
      return;
    }
    if (this.vehicle.near(this.controller.pos, 4.2)) {
      const seat = this.vehicle.enter('me');
      if (seat < 0) {
        this.hud.toast('All six seats are full.', 1600);
        return;
      }
      this.vehicle.attachRider(this.character.group, seat);
      this.cam.dist = seat === 0 ? 11 : 8.5;
      this.hud.toast(seat === 0 ? 'Sit tight. WASD steers the truck, E to hop out.' : `Seated. E to hop out.`, 2200);
      return;
    }
    this.doPunch();
  }

  private doPunch(): void {
    if (this.punchCooldown > 0) return;
    this.punchCooldown = 0.55;
    this.character.triggerPunch();
    const target = this.nearestRemote(2.6, true);
    if (target) {
      const dir = target.character.group.position.clone().sub(this.controller.pos).setY(0).normalize();
      this.network.sendAction({ type: 'punch', target: target.id, dir: { x: dir.x, y: 0, z: dir.z } });
      this.hud.toast(`You bonked ${target.name}!`, 1500);
    }
  }

  private doPickupOrDrop(): void {
    if (this.carryingId) {
      this.network.sendAction({ type: 'drop', target: this.carryingId });
      this.carryingId = null;
      return;
    }
    if (this.heldProp) {
      // gentle drop
      this.heldProp.vel.set(0, 0, 0);
      this.network.sendAction({
        type: 'prop_throw', propId: this.heldProp.id,
        pos: v3(this.heldProp.mesh.position), vel: { x: 0, y: 0, z: 0 }
      });
      this.heldProp.heldBy = null;
      this.heldProp = null;
      return;
    }
    const target = this.nearestRemote(2.3);
    if (target) {
      this.carryingId = target.id;
      this.network.sendAction({ type: 'pickup', target: target.id });
      this.hud.toast(`You picked up ${target.name}! Carry them to glory (or the pond).`, 2600);
      return;
    }
    const prop = this.nearestProp(2.2);
    if (prop) {
      prop.heldBy = 'me';
      this.heldProp = prop;
      this.network.sendAction({ type: 'prop_grab', propId: prop.id });
    }
  }

  private doThrow(): void {
    const fwd = this.cam.forward(new THREE.Vector3());
    if (this.carryingId) {
      this.network.sendAction({
        type: 'throw', target: this.carryingId,
        dir: { x: fwd.x, y: 0.45, z: fwd.z }
      });
      this.carryingId = null;
      this.hud.toast('YEET!', 1200);
      return;
    }
    if (this.heldProp) {
      const p = this.heldProp;
      p.heldBy = null;
      p.mesh.position.copy(this.controller.pos).add(new THREE.Vector3(0, this.controller.height * 0.8, 0)).addScaledVector(fwd, 0.7);
      p.vel.copy(fwd).multiplyScalar(17).add(new THREE.Vector3(0, 6, 0));
      this.network.sendAction({
        type: 'prop_throw', propId: p.id,
        pos: v3(p.mesh.position), vel: v3(p.vel)
      });
      this.heldProp = null;
    }
  }

  private updateProps(dt: number): void {
    for (const p of this.world.props) {
      if (p.heldBy === 'me') {
        const fwd = this.cam.forward(new THREE.Vector3());
        p.mesh.position.copy(this.controller.pos)
          .add(new THREE.Vector3(0, this.controller.height * 0.75, 0))
          .addScaledVector(fwd, 0.6);
        continue;
      }
      if (p.heldBy) {
        const holder = this.remotes.get(p.heldBy);
        if (holder) {
          p.mesh.position.copy(holder.character.group.position).add(new THREE.Vector3(0, 1.3, 0));
          continue;
        }
        p.heldBy = null;
      }
      // free physics
      p.vel.y -= 20 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      for (const c of this.world.colliders) {
        if (c.disabled) continue;
        const pos = p.mesh.position;
        const cxp = Math.max(c.min.x, Math.min(pos.x, c.max.x));
        const cyp = Math.max(c.min.y, Math.min(pos.y, c.max.y));
        const czp = Math.max(c.min.z, Math.min(pos.z, c.max.z));
        const dx = pos.x - cxp, dy = pos.y - cyp, dz = pos.z - czp;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < p.radius * p.radius && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const nx = dx / d, ny = dy / d, nz = dz / d;
          pos.set(cxp + nx * p.radius, cyp + ny * p.radius, czp + nz * p.radius);
          const vn = p.vel.x * nx + p.vel.y * ny + p.vel.z * nz;
          if (vn < 0) {
            p.vel.x -= (1 + 0.45) * vn * nx;
            p.vel.y -= (1 + 0.45) * vn * ny;
            p.vel.z -= (1 + 0.45) * vn * nz;
            p.vel.multiplyScalar(0.92);
          }
        }
      }
      if (p.vel.lengthSq() < 0.02) p.vel.set(0, 0, 0);
      if (p.mesh.position.y < -25) {
        p.mesh.position.copy(p.home);
        p.vel.set(0, 0, 0);
      }
      p.mesh.rotation.x += p.vel.z * dt * 0.8;
      p.mesh.rotation.z -= p.vel.x * dt * 0.8;
    }
  }

  // ---------------- checkpoints, respawn, ending ----------------

  private respawnPoint(): THREE.Vector3 {
    if (this.currentCheckpoint >= 0) {
      return this.world.checkpoints[this.currentCheckpoint].pos.clone().add(new THREE.Vector3(0, 0.6, 0));
    }
    return this.world.spawnPos.clone();
  }

  private markCheckpointsReached(upTo: number): void {
    for (let i = 0; i <= upTo; i++) {
      const cp = this.world.checkpoints[i];
      cp.flagMat.color.set(0x2ecc71);
      (cp.ring.material as THREE.MeshStandardMaterial).color.set(0x2ecc71);
    }
  }

  private checkCheckpoints(): void {
    for (const cp of this.world.checkpoints) {
      if (cp.index <= this.currentCheckpoint) continue;
      if (cp.pos.distanceTo(this.controller.pos) < 3.4) {
        this.currentCheckpoint = cp.index;
        this.afterFlyRefY = null;
        this.markCheckpointsReached(cp.index);
        localStorage.setItem(PROGRESS_KEY, JSON.stringify({ checkpoint: cp.index }));
        this.hud.checkpointToast(cp.label, cp.index, this.world.checkpoints.length);
        this.hud.setProgress(cp.index + 1, this.world.checkpoints.length);
        this.spawnConfetti(cp.pos.clone().add(new THREE.Vector3(0, 1.5, 0)));
      }
    }
  }

  private handleChatCommand(command: string): void {
    if (command.toLowerCase() !== 'admin2011') return;
    this.input.clear();
    this.controller.carriedBy = null;
    this.struggleClicks = 0;
    this.hud.hideStruggle();
    if (this.vehicle.seatOf('me') >= 0) {
      this.vehicle.detachRider(this.character.group, this.scene);
      this.vehicle.exit('me');
    }
    if (this.controller.flyMode) {
      this.controller.leaveFly(this.world);
      this.pendingFlyLand = true;
      this.afterFlyRefY = this.controller.pos.y;
      this.input.clear();
      this.cam.snap(this.controller.pos);
      this.hud.toast('Admin fly off. Stay here and climb normally.', 3200);
    } else {
      this.controller.flyMode = true;
      this.controller.vel.set(0, 0, 0);
      this.controller.stunTimer = 0;
      this.pendingFlyLand = false;
      this.hud.toast('ADMIN FLY: WASD look-steer, Space up, Ctrl/C down, Shift faster. No fall reset.', 5200);
    }
  }

  private checkHazardBalls(): void {
    const p = this.controller;
    if (p.flyMode || p.moveLock > 0) return;
    if (p.stunTimer > 0) return;
    if (this.vehicle.seatOf('me') >= 0) return;
    const py = p.pos.y + p.height * 0.4;
    for (const b of this.world.hazardBalls) {
      if (!b.active) continue;
      const dx = p.pos.x - b.pos.x;
      const dy = py - b.pos.y;
      const dz = p.pos.z - b.pos.z;
      const rad = p.radius + b.radius;
      if (dx * dx + dy * dy + dz * dz > rad * rad) continue;
      const dir = new THREE.Vector3(dx, 0, dz);
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
      dir.normalize();
      p.applyKnockback(dir, 9.5);
      p.onBallHit?.();
      b.vel.x += dir.x * 2.4;
      b.vel.z += dir.z * 2.4;
      break;
    }
  }

  private checkFall(): void {
    if (this.controller.flyMode) return;
    if (this.pendingFlyLand) {
      if (this.controller.onGround) {
        this.pendingFlyLand = false;
        this.afterFlyRefY = this.controller.pos.y;
      }
      return;
    }
    if (this.vehicle.seatOf('me') >= 0) return;
    const cpY = this.currentCheckpoint >= 0 ? this.world.checkpoints[this.currentCheckpoint].pos.y : 0;
    const refY = this.afterFlyRefY ?? cpY;
    if (this.controller.pos.y < refY - 45 || this.controller.pos.y < -22) {
      this.afterFlyRefY = null;
      this.controller.teleport(this.respawnPoint());
      this.hud.fallToast();
    }
  }

  private checkEnding(): void {
    if (this.endingTriggered) return;
    if (this.world.endingPos.distanceTo(this.controller.pos) < 4.6) {
      this.endingTriggered = true;
      this.controller.endingMode = true;
      this.controller.vel.set(0, 1.2, 0);
      this.spawnConfetti(this.world.endingPos.clone());
      this.hud.showEnding();
    }
  }

  private spawnConfetti(at: THREE.Vector3): void {
    const count = 120;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const vels = new Float32Array(count * 3);
    const palette = [0xff6b6b, 0xffe66d, 0x4ecdc4, 0xa29bfe, 0x2ecc71];
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      pos[i * 3] = at.x; pos[i * 3 + 1] = at.y; pos[i * 3 + 2] = at.z;
      vels[i * 3] = (Math.random() - 0.5) * 9;
      vels[i * 3 + 1] = Math.random() * 8 + 2;
      vels[i * 3 + 2] = (Math.random() - 0.5) * 9;
      c.set(palette[i % palette.length]);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.16, vertexColors: true, transparent: true, opacity: 1
    }));
    this.scene.add(points);
    this.bursts.push({ points, vels, life: 1.6 });
  }

  private updateBursts(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life -= dt;
      const attr = b.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let j = 0; j < arr.length / 3; j++) {
        b.vels[j * 3 + 1] -= 12 * dt;
        arr[j * 3] += b.vels[j * 3] * dt;
        arr[j * 3 + 1] += b.vels[j * 3 + 1] * dt;
        arr[j * 3 + 2] += b.vels[j * 3 + 2] * dt;
      }
      attr.needsUpdate = true;
      (b.points.material as THREE.PointsMaterial).opacity = Math.max(0, b.life / 1.6);
      if (b.life <= 0) {
        this.scene.remove(b.points);
        b.points.geometry.dispose();
        this.bursts.splice(i, 1);
      }
    }
  }

  // ---------------- atmosphere ----------------

  private installSpaceSky(): void {
    this.spaceSkyMat = new THREE.MeshBasicMaterial({
      side: THREE.BackSide,
      fog: false,
      transparent: true,
      opacity: 0,
      depthWrite: false
    });
    new THREE.TextureLoader().load('/assets/space-sky.png', (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      this.spaceSkyMat.map = tex;
      this.spaceSkyMat.needsUpdate = true;
    });
    this.spaceSky = new THREE.Mesh(new THREE.SphereGeometry(120, 48, 32), this.spaceSkyMat);
    this.spaceSky.frustumCulled = false;
    this.spaceSky.renderOrder = -10;
    this.scene.add(this.spaceSky);
  }

  private updateAtmosphere(): void {
    const y = this.controller.pos.y;
    const bg = this.scene.background as THREE.Color;
    const skyT = THREE.MathUtils.smoothstep(y, 52, 95);
    this.spaceSkyMat.opacity = skyT;
    this.spaceSky.visible = skyT > 0.02;
    if (y < 110) {
      bg.copy(GROUND_SKY).lerp(HIGH_SKY, THREE.MathUtils.smoothstep(y, 35, 110));
    } else {
      bg.copy(HIGH_SKY).lerp(SPACE_SKY, THREE.MathUtils.smoothstep(y, 115, 190));
    }
    if (skyT > 0.15) bg.lerp(SPACE_SKY, THREE.MathUtils.smoothstep(skyT, 0.15, 1));
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(bg);
    if (this.controller.flyMode) {
      fog.near = 400;
      fog.far = 24000;
    } else {
      fog.near = 70 + skyT * 50;
      fog.far = 320 + THREE.MathUtils.smoothstep(y, 70, 220) * 1400;
    }
    (this.world.stars.material as THREE.PointsMaterial).opacity =
      THREE.MathUtils.smoothstep(y, 120, 185) * (1 - skyT * 0.55);
    const spaceness = THREE.MathUtils.smoothstep(y, 90, 190);
    this.sun.intensity = 2.6 - spaceness * 1.35;
  }

  // ---------------- main loop ----------------

  private decideAnim(): AnimState {
    const c = this.controller;
    if (c.endingMode) return 'float';
    if (c.flyMode) return 'float';
    if (this.vehicle.seatOf('me') >= 0) return 'sit';
    if (c.carriedBy) return 'carried';
    if (c.crawling) return 'crawl';
    if (!c.onGround) return c.vel.y > 1 ? 'jump' : (c.pos.y > SPACE_START_Y ? 'float' : 'fall');
    const speed = Math.hypot(c.vel.x, c.vel.z);
    if (speed > 6.5) return 'run';
    if (speed > 0.6) return 'walk';
    return 'idle';
  }

  private fixedUpdate(dt: number): void {
    this.world.update(dt);
    this.punchCooldown = Math.max(0, this.punchCooldown - dt);

    if (this.controller.moveLock <= 0) {
      if (this.input.consume('KeyE')) this.doEnterOrPunch();
      if (this.input.consume('KeyQ')) this.doPickupOrDrop();
      if (this.input.consume('KeyB')) this.doThrow();
    }

    this.controller.capturePrevPos();
    const mySeat = this.controller.flyMode ? -1 : this.vehicle.seatOf('me');
    if (mySeat >= 0) {
      if (mySeat === 0) this.vehicle.updateDrive(dt, this.input, this.world);
      this.controller.pos.copy(this.vehicle.seatWorld(mySeat));
      this.controller.facing = this.vehicle.heading;
      this.controller.vel.set(0, 0, 0);
      this.controller.onGround = true;
    } else {
      this.controller.update(dt, this.input, this.cam, this.world);
    }
    this.checkHazardBalls();

    // If someone carries us, ride on their head and struggle to break free
    if (this.controller.flyMode && this.controller.carriedBy) {
      this.controller.carriedBy = null;
      this.struggleClicks = 0;
      this.hud.hideStruggle();
    }

    if (this.controller.carriedBy) {
      const carrier = this.remotes.get(this.controller.carriedBy);
      if (carrier) {
        this.controller.pos.copy(carrier.character.group.position).add(new THREE.Vector3(0, carrier.character.height + 0.1, 0));
        this.controller.vel.set(0, 0, 0);
        if (this.input.consume('MouseLeft')) {
          this.struggleClicks += 1;
          this.hud.setStruggle(this.struggleClicks, STRUGGLE_CLICKS);
          if (this.struggleClicks >= STRUGGLE_CLICKS) this.breakFree();
        }
      } else {
        this.controller.carriedBy = null;
        this.struggleClicks = 0;
        this.hud.hideStruggle();
      }
    }

    this.updateProps(dt);
    this.checkCheckpoints();
    this.checkFall();
    this.checkEnding();

    // network state @20Hz
    this.sendTimer += dt;
    if (this.sendTimer >= 0.05) {
      this.sendTimer = 0;
      const p = this.controller.pos;
      this.network.sendState({
        x: p.x, y: p.y, z: p.z,
        ry: this.controller.facing,
        anim: this.decideAnim(),
        carriedBy: this.controller.carriedBy
      });
    }
    this.input.endFrame();
  }

  private loop = (): void => {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    const rawDt = Math.min(this.clock.getDelta(), 0.05);
    this.accumulator += rawDt;
    while (this.accumulator >= FIXED_DT) {
      this.fixedUpdate(FIXED_DT);
      this.accumulator -= FIXED_DT;
    }

    // Grounded: snap to physics so moving pads don't leave the mesh behind (looks like a fling).
    // Airborne: lerp so jump/fall arcs are smooth without a second camera lag.
    const alpha = this.controller.onGround ? 1 : this.accumulator / FIXED_DT;
    this.renderPos.lerpVectors(this.controller.prevPos, this.controller.pos, alpha);
    const anim = this.decideAnim();
    this.character.setAnim(anim);
    this.character.update(rawDt);
    if (this.vehicle.seatOf('me') < 0) {
      this.character.group.position.copy(this.renderPos);
      this.character.group.rotation.y = this.controller.facing;
    }
    if (this.controller.endingMode) this.character.group.rotation.y += rawDt * 0.0;

    for (const r of this.remotes.values()) {
      // carried players sit on their carrier's head, no matter what the network says
      if (r.carriedBy === this.network.id) {
        r.targetPos.copy(this.controller.pos).add(new THREE.Vector3(0, this.controller.height + 0.1, 0));
      } else if (r.carriedBy) {
        const carrier = this.remotes.get(r.carriedBy);
        if (carrier) r.targetPos.copy(carrier.character.group.position).add(new THREE.Vector3(0, carrier.character.height + 0.1, 0));
      }
      r.update(rawDt);
    }

    this.updateBursts(rawDt);
    this.updateAtmosphere();
    this.hud.setAltitude(this.controller.pos.y);
    this.hud.setStandingOn(this.controller.standingOnName);

    // sun follows player so shadows stay crisp on a 350m tall map
    this.sun.position.set(this.renderPos.x + 30, this.renderPos.y + 55, this.renderPos.z - 25);
    this.sun.target.position.copy(this.renderPos);

    this.cam.update(this.renderPos, rawDt);
    this.spaceSky.position.copy(this.cam.camera.position);
    this.renderer.render(this.scene, this.cam.camera);
  };
}

function v3(v: THREE.Vector3): { x: number; y: number; z: number } {
  return { x: v.x, y: v.y, z: v.z };
}
