import * as THREE from 'three';
import type { WorldMap, BoxCollider } from '../world/WorldMap';
import { SPACE_START_Y } from '../world/WorldMap';
import type { Input } from './Input';
import type { CameraRig } from './CameraRig';

const WALK_SPEED = 5.5;
const RUN_SPEED = 9.6;
const CRAWL_SPEED = 2.3;
const JUMP_VEL = 9.6;
const SPACE_JUMP_VEL = 11.5;
const GRAVITY = -24;
const SPACE_GRAVITY = -7.5;
const GRAVITY_MAG = -GRAVITY;
const SPACE_GRAVITY_MAG = -SPACE_GRAVITY;

/** Measured jump reach from existing physics (v²/2g, flat ground, stand jump). */
export const JUMP_HEIGHT = (JUMP_VEL * JUMP_VEL) / (2 * GRAVITY_MAG); // 1.92 m
/** Design cap for required vertical steps without trampoline/grab assist. */
export const JUMP_HEIGHT_SAFE = 1.55;
export const JUMP_HANG_TIME = (2 * JUMP_VEL) / GRAVITY_MAG; // 0.80 s
export const JUMP_DIST_WALK = WALK_SPEED * JUMP_HANG_TIME; // 4.40 m
export const JUMP_DIST_RUN = RUN_SPEED * JUMP_HANG_TIME; // 7.68 m

export const SPACE_JUMP_HEIGHT = (SPACE_JUMP_VEL * SPACE_JUMP_VEL) / (2 * SPACE_GRAVITY_MAG); // 8.82 m
/** Design cap for required vertical steps in low-gravity zones. */
export const SPACE_JUMP_HEIGHT_SAFE = 7.0;
export const TRAMPOLINE_BOUNCE_VEL = 17.5;
export const TRAMPOLINE_JUMP_HEIGHT = (TRAMPOLINE_BOUNCE_VEL * TRAMPOLINE_BOUNCE_VEL) / (2 * GRAVITY_MAG); // 6.38 m

export class PlayerController {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  facing = 0; // y rotation
  onGround = false;
  crawling = false;
  grabbing = false;
  stunTimer = 0;
  /** set by Game when another player picks us up */
  carriedBy: string | null = null;
  endingMode = false;

  radius = 0.38;
  standHeight = 1.7;
  /** Physics pose at the start of the last fixed step — used to interpolate rendering. */
  prevPos = new THREE.Vector3();

  private grabTarget: THREE.Vector3 | null = null;
  private groundCollider: BoxCollider | null = null;
  private tmpF = new THREE.Vector3();
  private tmpR = new THREE.Vector3();

  /** Feet this close to a box top count as standing on it, not inside a wall. */
  private static readonly FLOOR_SKIN = 0.28;

  onBounce: (() => void) | null = null;
  onRotorHit: (() => void) | null = null;

  get height(): number { return this.crawling ? 0.72 : this.standHeight; }

  /** Name of the surface underfoot, or null while airborne. */
  get standingOnName(): string | null {
    if (!this.onGround) return null;
    return this.groundCollider?.name ?? null;
  }

  teleport(p: THREE.Vector3): void {
    this.pos.copy(p);
    this.prevPos.copy(p);
    this.vel.set(0, 0, 0);
    this.grabbing = false;
    this.grabTarget = null;
    this.stunTimer = 0;
  }

  /** Call once per physics tick before update() so the renderer can lerp. */
  capturePrevPos(): void {
    this.prevPos.copy(this.pos);
  }

  applyKnockback(dir: THREE.Vector3, power = 10): void {
    this.vel.x += dir.x * power;
    this.vel.z += dir.z * power;
    this.vel.y = Math.max(this.vel.y, 5.5);
    this.stunTimer = 0.45;
    this.grabbing = false;
    this.grabTarget = null;
  }

  update(dt: number, input: Input, cam: CameraRig, world: WorldMap): void {
    if (this.carriedBy) { this.onGround = false; return; }

    if (this.endingMode) {
      // Zero-g farewell float
      this.vel.y = Math.min(this.vel.y + 2.4 * dt, 1.6);
      this.vel.x *= 0.995; this.vel.z *= 0.995;
      this.pos.addScaledVector(this.vel, dt);
      return;
    }

    if (this.stunTimer > 0) this.stunTimer -= dt;
    const stunned = this.stunTimer > 0;

    if (input.consume('KeyR')) this.crawling = !this.crawling;

    // ----- grasping (hold left mouse near a yellow handle) -----
    if (input.mouseLeft && !this.grabbing) {
      const reach = new THREE.Vector3(this.pos.x, this.pos.y + this.height * 0.72, this.pos.z);
      let best: THREE.Vector3 | null = null;
      let bestD = 1.45;
      for (const gp of world.grabPoints) {
        const d = gp.distanceTo(reach);
        if (d < bestD) { bestD = d; best = gp; }
      }
      if (best) {
        this.grabbing = true;
        this.grabTarget = best;
        this.crawling = false;
      }
    }
    if (this.grabbing) {
      if (!input.mouseLeft || !this.grabTarget) {
        this.grabbing = false;
        this.grabTarget = null;
      } else {
        this.pos.set(this.grabTarget.x, this.grabTarget.y - this.height * 0.72, this.grabTarget.z + 0.15);
        this.vel.set(0, 0, 0);
        this.onGround = false;
        if (input.consume('Space')) {
          // Leap off the wall in the camera direction
          this.grabbing = false;
          this.grabTarget = null;
          cam.forward(this.tmpF);
          this.vel.set(this.tmpF.x * 3.5, JUMP_VEL * 1.05, this.tmpF.z * 3.5);
        }
        return;
      }
    }

    // ----- movement input -----
    const inSpace = this.pos.y > SPACE_START_Y;
    const move = new THREE.Vector3();
    if (!stunned) {
      cam.forward(this.tmpF); cam.right(this.tmpR);
      if (input.down('KeyW')) move.add(this.tmpF);
      if (input.down('KeyS')) move.sub(this.tmpF);
      if (input.down('KeyD')) move.add(this.tmpR);
      if (input.down('KeyA')) move.sub(this.tmpR);
    }
    const hasInput = move.lengthSq() > 0;
    if (hasInput) move.normalize();

    const targetSpeed = this.crawling ? CRAWL_SPEED : (input.down('ShiftLeft') || input.down('ShiftRight')) ? RUN_SPEED : WALK_SPEED;
    const accel = this.onGround ? 42 : (inSpace ? 8 : 14);
    const desiredX = move.x * targetSpeed;
    const desiredZ = move.z * targetSpeed;
    const k = Math.min(1, accel * dt / Math.max(0.001, targetSpeed));
    this.vel.x += (desiredX - this.vel.x) * (this.onGround ? Math.min(1, 42 * dt / 8) : k);
    this.vel.z += (desiredZ - this.vel.z) * (this.onGround ? Math.min(1, 42 * dt / 8) : k);

    if (hasInput) {
      const targetFacing = Math.atan2(move.x, move.z);
      let diff = targetFacing - this.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.facing += diff * Math.min(1, 14 * dt);
    }

    // ----- jump, ride pads, gravity -----
    const ride = (this.onGround && this.groundCollider?.moverIndex !== undefined)
      ? world.movers[this.groundCollider.moverIndex]
      : null;
    const rideVy = ride ? ride.delta.y / Math.max(dt, 1e-6) : 0;

    if (!stunned && this.onGround && input.consume('Space')) {
      const jumpVel = this.crawling ? JUMP_VEL * 0.55 : (inSpace ? SPACE_JUMP_VEL : JUMP_VEL);
      this.vel.y = jumpVel + Math.max(0, rideVy);
      this.onGround = false;
    }

    if (ride) {
      // Glue XZ every ride frame (including the jump takeoff frame).
      this.pos.x += ride.delta.x;
      this.pos.z += ride.delta.z;
      if (this.onGround) this.pos.y = ride.collider.max.y;
    }

    this.vel.y += (inSpace ? SPACE_GRAVITY : GRAVITY) * dt;
    this.vel.y = Math.max(this.vel.y, -40);

    // ----- integrate with axis-separated collision -----
    this.moveAxis(world, 'x', this.vel.x * dt);
    this.moveAxis(world, 'z', this.vel.z * dt);
    const wasFalling = this.vel.y < -2;
    this.groundCollider = null;
    this.onGround = false;
    this.moveAxis(world, 'y', this.vel.y * dt, wasFalling);

    // ----- rotor bars knock you flying -----
    for (const r of world.rotors) {
      const dy = (this.pos.y + this.height * 0.4) - r.barY;
      if (Math.abs(dy) > 1.1) continue;
      const rel = new THREE.Vector3(this.pos.x - r.center.x, 0, this.pos.z - r.center.z);
      const dist = rel.length();
      if (dist > r.armLength + this.radius || dist < 0.05) continue;
      const playerAngle = Math.atan2(-rel.z, rel.x);
      // bar spans angle and angle+PI (pivot rotates around Y)
      for (const barA of [r.angle, r.angle + Math.PI]) {
        let diff = playerAngle - barA;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const angularHalfWidth = Math.atan2(0.45 + this.radius, dist);
        if (Math.abs(diff) < angularHalfWidth) {
          // knock tangentially in the spin direction
          const tangent = new THREE.Vector3(-Math.sin(barA), 0, -Math.cos(barA));
          if (r.speed < 0) tangent.negate();
          this.vel.x = tangent.x * 13;
          this.vel.z = tangent.z * 13;
          this.vel.y = 7;
          this.stunTimer = 0.5;
          this.onRotorHit?.();
          break;
        }
      }
    }
  }

  private moveAxis(world: WorldMap, axis: 'x' | 'y' | 'z', amount: number, landingCheck = false): void {
    if (amount === 0 && axis !== 'y') return;
    this.pos[axis] += amount;

    for (const c of world.colliders) {
      const minX = this.pos.x - this.radius, maxX = this.pos.x + this.radius;
      const minY = this.pos.y, maxY = this.pos.y + this.height;
      const minZ = this.pos.z - this.radius, maxZ = this.pos.z + this.radius;
      if (maxX <= c.min.x || minX >= c.max.x) continue;
      if (maxY <= c.min.y || minY >= c.max.y) continue;
      if (maxZ <= c.min.z || minZ >= c.max.z) continue;

      const boxH = c.max.y - c.min.y;
      const solidWall = boxH > 2.2;

      if (axis === 'x' || axis === 'z') {
        // Floor top: do not treat as a wall.
        if (this.pos.y >= c.max.y - PlayerController.FLOOR_SKIN) continue;
        // Higher pad that only the head/torso reaches (clouds/blocks stacked 1.5m, player ~1.7m).
        // Side-ejecting here is what flung players off obstacle 7.
        if (this.pos.y < c.min.y) continue;
        if (axis === 'x') {
          this.pos.x = amount > 0 ? c.min.x - this.radius : c.max.x + this.radius;
          this.vel.x = 0;
        } else {
          this.pos.z = amount > 0 ? c.min.z - this.radius : c.max.z + this.radius;
          this.vel.z = 0;
        }
      } else {
        const prevY = this.pos.y - amount;
        const crossedTop = amount <= 0 && prevY >= c.max.y - 0.08 && this.pos.y <= c.max.y;
        const inTopSkin = amount <= 0 && this.pos.y >= c.max.y - PlayerController.FLOOR_SKIN;
        if (crossedTop || inTopSkin) {
          this.pos.y = c.max.y;
          if (c.bouncy && landingCheck) {
            this.vel.y = TRAMPOLINE_BOUNCE_VEL;
            this.onBounce?.();
          } else {
            this.vel.y = 0;
            this.onGround = true;
            this.groundCollider = c;
          }
        } else if (amount > 0 && solidWall) {
          this.pos.y = c.min.y - this.height;
          this.vel.y = 0;
        }
        // else: one-way pad — pass through from below / ignore glancing hits
      }
    }
  }
}
