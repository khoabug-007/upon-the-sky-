import * as THREE from 'three';
import { ufoDeckSize } from './ufoCraft';

/** Copied from PlayerController jump budget so this file does not import Game physics. */
const JUMP_DIST_RUN = 7.68;
const JUMP_HEIGHT_SAFE = 1.55;
/** Unassisted pad-to-pad rise. Must stay under stand jump (1.92 m) with walk-gap airtime. */
const JUMP_STEP = 1.35;
const SPACE_JUMP_HEIGHT_SAFE = 7.0;

const SPACE_BAND_Y = 88;
const WALK_SPEED = 5.5;
/** Copied from PlayerController trampoline bounce. */
const TRAMP_BOUNCE_VEL = 17.5;
const GRAVITY_MAG = 24;
const SPACE_GRAVITY_MAG = 7.5;
const REBOUND_R = 1.45;
/** Linear ping-pong: one-way time is 1/speed seconds. */
const UFO_SPEED = 0.035;
/** Short diagonal so the ride crawls instead of covering the old 50-pad climb. */
const UFO_CLIMB = 14;
const UFO_ALONG = 12;
/** Walk hop at +JUMP_STEP: ~2.2 m air, matching the one-block edge gap. */
const WALK_HOP_GAP = 2.2;
const PAD = 3.1;
/** Along-travel pad length: 3× the previous live scale (2/3). */
const PATH_LEN = 2;
/** Course piece count: 3× the previous live scale (1/3). Jump gaps stay WALK_HOP_GAP. */
const COURSE_RUN = 1;
const runCount = (n: number) => Math.max(1, Math.round(n * COURSE_RUN));

/** Seconds in the air from a bounce until you come back down to `landRise` above the pad. */
function bounceFlightTime(py: number, landRise: number): number {
  const g = py > SPACE_BAND_Y ? SPACE_GRAVITY_MAG : GRAVITY_MAG;
  const v = TRAMP_BOUNCE_VEL;
  const disc = v * v - 2 * g * Math.max(0, landRise);
  if (disc <= 0) return (2 * v) / g;
  return (v + Math.sqrt(disc)) / g;
}

/** Walk-speed distance after a bounce that lands `landRise` higher. Pads closer than this stay catchable. */
function bounceStep(py: number, landRise = 0): number {
  return WALK_SPEED * bounceFlightTime(py, landRise);
}

/** Obstacle segments to append after the hand-authored course (same length as before). */
export const TARGET_LEVELS = 100;

/** How many obstacle pieces between flags after this many checkpoints already exist. */
function segmentsUntilNextFlag(placedCount: number): number {
  if (placedCount < 21) return 2;
  if (placedCount < 30) return 3;
  if (placedCount < 40) return 5;
  if (placedCount < 50) return 8;
  return 12;
}

export interface ThrowSwitch {
  padMin: THREE.Vector3;
  padMax: THREE.Vector3;
  parts: Array<{ mesh: THREE.Mesh; collider: { disabled?: boolean }; hideWhenOpen: boolean }>;
  open: boolean;
}

export interface ClimbApi {
  addBox(
    w: number, h: number, d: number,
    x: number, y: number, z: number,
    color: number, opts?: { bouncy?: boolean; noShadow?: boolean; name?: string }
  ): THREE.Mesh;
  addTrampoline(x: number, y: number, z: number, r?: number, name?: string): void;
  addMover(
    w: number, h: number, d: number,
    a: THREE.Vector3, b: THREE.Vector3,
    color: number, speed?: number, phase?: number, name?: string
  ): void;
  addRotor(
    x: number, y: number, z: number, armLength: number, speed: number,
    color?: number, startAngle?: number
  ): void;
  addCloud(
    x: number, y: number, z: number, w?: number, d?: number,
    moving?: { b: THREE.Vector3; speed: number }, name?: string, walkable?: boolean
  ): void;
  addAsteroid(x: number, y: number, z: number, r?: number, name?: string): void;
  addProp(x: number, y: number, z: number, kind: 'ball' | 'crate'): void;
  addSign(text: string[], x: number, y: number, z: number, scale?: number): void;
  addCheckpoint(x: number, y: number, z: number, label: string): void;
  lastCollider(): { min: THREE.Vector3; max: THREE.Vector3; disabled?: boolean };
  addThrowSwitch(sw: ThrowSwitch): void;
  addVehicleSpawn(x: number, y: number, z: number, heading: number): void;
  addOrientedSlab(
    w: number, h: number, d: number,
    x: number, y: number, z: number,
    rotY: number, color: number, name: string
  ): THREE.Mesh;
  addConvoyCrate(side: number): void;
  addErrorWorld(x: number, y: number, z: number, dx: number, dz: number): void;
  addErrorWorldSign(x: number, y: number, z: number): void;
  addUfo(
    kind: 'saucer' | 'delta',
    a: THREE.Vector3,
    b: THREE.Vector3,
    speed?: number,
    phase?: number,
    yaw?: number,
    name?: string
  ): void;
}

const PALETTE = [0xb5651d, 0x9c6b30, 0xcfa15a, 0x7e57c2, 0x5c6bc0, 0x26a69a, 0xeceff1, 0xffd54f];

/**
 * Appends the same number of parkour segments as before.
 * Flags stay 1-per-segment through level 20, then thin out.
 * Later stretches get tighter (still inside jump reach).
 */
export function appendClimbLevels(
  api: ClimbApi,
  startY: number,
  startZ: number,
  already: number
): { x: number; y: number; z: number } {
  let x = 0;
  let y = startY;
  let z = startZ;
  let dx = 0;
  let dz = 1;
  let placed = already;
  let wait = 0;
  const extra = Math.max(0, TARGET_LEVELS - already);

  for (let i = 0; i < extra; i++) {
    if (placed >= 67) {
      placeComingSoon(api, x, y, z, dx, dz);
      break;
    }

    const last = i === extra - 1;
    const flag = last || wait <= 0;
    const progress = extra <= 1 ? 1 : i / (extra - 1);
    const hard = progress * progress;
    const inSpace = y > SPACE_BAND_Y;
    const rise = inSpace
      ? Math.min(4.8 + hard * 1.4, SPACE_JUMP_HEIGHT_SAFE - 0.6)
      : Math.min(1.15 + hard * 0.2, JUMP_STEP);
    const color = PALETTE[i % PALETTE.length];
    if (placed === 16 && flag) {
      const hwy = buildConvoyHighway(api, y, z);
      x = hwy.x; y = hwy.y; z = hwy.z;
      dx = hwy.dx; dz = hwy.dz;
      placed = 50;
      wait = 0;
      continue;
    }

    if (placed >= 50) {
      const next = placed + 1;
      const lateColor = PALETTE[next % PALETTE.length];
      const label = `Level ${next}`;
      const lateFlag = next === 54 || next === 60 || next === 67;
      if (next <= 54) {
        ({ x, y, z } = backHop(api, x, y, z, dx, dz, lateColor, label, lateFlag));
      } else if (next <= 59) {
        ({ x, y, z } = reverseSpin(api, x, y, z, dx, dz, lateColor, label, lateFlag));
      } else {
        ({ x, y, z } = reboundRows(api, x, y, z, dx, dz, lateColor));
        placed = 67;
        continue;
      }
      placed = next;
      continue;
    }

    const label = flag ? `Level ${placed + 1}` : `Stretch ${already + i + 1}`;
    const kind = hard > 0.45 && i % 7 === 0 ? 6 : i % 10;

    if (kind === 6 || kind === 3) {
      ({ y, z } = placeThrowGate(api, y, z, color, label, i, flag));
    } else if (kind === 0) {
      ({ y, z } = hopStairs(api, y, z, color, label, rise, flag, hard));
    } else if (kind === 1) {
      ({ y, z } = rotorYard(api, y, z, color, label, flag, hard));
    } else if (kind === 2) {
      ({ y, z } = beams(api, y, z, color, label, rise, flag, hard));
    } else if (kind === 4) {
      ({ y, z } = trampHop(api, y, z, color, label, rise, flag, hard));
    } else if (kind === 5) {
      ({ y, z } = zigzag(api, y, z, color, label, rise, flag, hard));
    } else if (kind === 7) {
      ({ y, z } = moverLift(api, y, z, color, label, rise, flag, hard));
    } else if (kind === 8) {
      ({ y, z } = inSpace
        ? rocks(api, y, z, label, rise, flag, hard)
        : puffs(api, y, z, label, rise, flag, hard));
    } else if (hard > 0.35) {
      ({ y, z } = hopStairs(api, y, z, color, label, rise, flag, hard));
    } else {
      ({ y, z } = restPad(api, y, z, color, label, flag));
    }

    if (flag) {
      placed++;
      wait = segmentsUntilNextFlag(placed) - 1;
    } else {
      wait--;
    }
  }
  return { x, y, z };
}

function flagAt(api: ClimbApi, x: number, y: number, z: number, label: string, flag: boolean) {
  if (flag) api.addCheckpoint(x, y, z, label);
}

/** Motor pool at Level 17, then an expanding spiral the troop truck can drive to Level 50. */
function buildConvoyHighway(api: ClimbApi, y: number, z: number) {
  const parkW = 24;
  const parkD = 24;
  const roadW = 16;
  const slabH = 1;
  const r0 = 36;
  const dTheta = 0.18;
  const dR = 0.74;
  const steps = Math.max(28, runCount(58));
  const rise = 28 / steps;
  const drdth = dR / dTheta;

  api.addBox(parkW, slabH, parkD, 0, y, z, 0x3a3a36, { name: 'Motor Pool' });
  const signZ = z - parkD / 2 + 1.4;
  api.addBox(0.38, 4.4, 0.38, -4.6, y + 2.2, signZ, 0x3a2e1a, { name: 'Error World Sign Post' });
  api.addBox(0.38, 4.4, 0.38, 4.6, y + 2.2, signZ, 0x3a2e1a, { name: 'Error World Sign Post' });
  api.addErrorWorldSign(0, y + 5.35, signZ);
  api.addSign(
    ['MOTOR POOL', 'E to drive. Weave past the wood crates.', 'The road falls behind you — one slab a second.'],
    -8.2, y + 3.4, z - 1.5, 0.9
  );
  api.addCheckpoint(0, y + 0.5, z, 'Level 17');
  api.addVehicleSpawn(0, y + 0.5, z + 1.2, 0);

  const cx = r0;
  const cz = z + parkD / 2;
  const pt = (i: number) => {
    const th = -Math.PI / 2 + i * dTheta;
    const r = r0 + i * dR;
    return {
      x: cx + r * Math.sin(th),
      y: y + i * rise,
      z: cz + r * Math.cos(th),
      tx: r * Math.cos(th) + drdth * Math.sin(th),
      tz: -r * Math.sin(th) + drdth * Math.cos(th)
    };
  };

  let crateSide = 1;
  const place = (
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
    crate: boolean
  ) => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.5) return;
    api.addOrientedSlab(
      roadW, slabH, len + 0.5,
      (a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5,
      Math.atan2(dx, dz), 0x3a3a36, 'Convoy Road'
    );
    if (crate) api.addConvoyCrate(crateSide);
  };

  const p0 = pt(0);
  place({ x: 0, y, z: z + 1.5 }, p0, false);
  let prev = p0;
  for (let i = 1; i <= steps; i++) {
    const p = pt(i);
    const crate = i % 2 === 0;
    place(prev, p, crate);
    if (crate) crateSide *= -1;
    prev = p;
  }

  const tan = Math.hypot(prev.tx, prev.tz) || 1;
  const ux = prev.tx / tan;
  const uz = prev.tz / tan;
  const exitLen = 16;
  place(prev, { x: prev.x + ux * exitLen, y: prev.y, z: prev.z + uz * exitLen }, false);
  const endX = prev.x + ux * 24;
  const endZ = prev.z + uz * 24;
  api.addErrorWorld(endX, prev.y, endZ, -ux, -uz);
  api.addCheckpoint(endX, prev.y + 0.5, endZ, 'Level 50');
  return { x: endX, y: prev.y, z: endZ, dx: -ux, dz: -uz };
}

function sideOf(dx: number, dz: number, s: number): { x: number; z: number } {
  return { x: -dz * s, z: dx * s };
}

/** Width stays `across`; depth along travel axis scales with `along`. */
function padDimsAlongTravel(
  dx: number, dz: number, across: number, along: number
): { w: number; d: number } {
  return Math.abs(dx) >= Math.abs(dz)
    ? { w: along, d: across }
    : { w: across, d: along };
}

/** After Level 50: hop back the way you came, still climbing. */
function backHop(
  api: ClimbApi, ox: number, y: number, z: number,
  dx: number, dz: number, color: number, label: string, flag: boolean
): { x: number; y: number; z: number } {
  const hops = runCount(4);
  const rise = JUMP_STEP;
  const padAcross = 2.7;
  const padAlong = padAcross * PATH_LEN;
  const hopSpan = padAlong + WALK_HOP_GAP;
  let py = y;
  let along = 0;
  for (let i = 0; i < hops; i++) {
    const side = sideOf(dx, dz, i % 2 ? -0.45 : 0.45);
    along = i * hopSpan;
    py = y + i * rise;
    const { w, d } = padDimsAlongTravel(dx, dz, padAcross, padAlong);
    api.addBox(w, 0.7, d, ox + dx * along + side.x, py, z + dz * along + side.z, color, {
      name: `${label} Hop ${i + 1}`
    });
  }
  along += hopSpan;
  const ex = ox + dx * along;
  const ez = z + dz * along;
  const exitAcross = padAcross + 1.1;
  const exitAlong = padAlong + 1.1;
  const { w: ew, d: ed } = padDimsAlongTravel(dx, dz, exitAcross, exitAlong);
  api.addBox(ew, 1, ed, ex, py, ez, color, { name: label });
  flagAt(api, ex, py + 0.5, ez, label, flag);
  return { x: ex, y: py, z: ez };
}

/** Levels 55–59: spinning bars turn the other way. */
function reverseSpin(
  api: ClimbApi, ox: number, y: number, z: number,
  dx: number, dz: number, color: number, label: string, flag: boolean
): { x: number; y: number; z: number } {
  const mid = 6 * COURSE_RUN;
  const mx = ox + dx * mid;
  const mz = z + dz * mid;
  const arenaAcross = 10;
  const arenaAlong = arenaAcross * PATH_LEN;
  const { w: aw, d: ad } = padDimsAlongTravel(dx, dz, arenaAcross, arenaAlong);
  api.addBox(aw, 0.8, ad, mx, y, mz, color, { name: `${label} Arena` });
  api.addRotor(mx, y + 1.35, mz, 5.0, -1.45, 0xe74c3c);
  api.addRotor(mx, y + 1.35, mz, 3.2, -2.05, 0xf39c12);
  const landAcross = 3.3;
  const landAlong = landAcross * PATH_LEN;
  const along = mid + arenaAlong / 2 + WALK_HOP_GAP + landAlong / 2;
  const ex = ox + dx * along;
  const ez = z + dz * along;
  const { w: lw, d: ld } = padDimsAlongTravel(dx, dz, landAcross, landAlong);
  api.addBox(lw, 1, ld, ex, y, ez, color, { name: label });
  flagAt(api, ex, y + 0.5, ez, label, flag);
  return { x: ex, y, z: ez };
}

/** Levels 60–67: two slow UFO ferries from the Level 60 pad to the flag. */
function reboundRows(
  api: ClimbApi, ox: number, y: number, z: number,
  dx: number, dz: number, color: number
): { x: number; y: number; z: number } {
  const startAlong = 6;
  const startHalf = 2.6;
  const { w: sw, d: sd } = padDimsAlongTravel(dx, dz, 5.2, 5.2);
  const sx = ox + dx * startAlong;
  const sz = z + dz * startAlong;
  api.addBox(sw, 1, sd, sx, y, sz, color, { name: 'Level 60' });
  api.addSign(
    ['Hop onto a UFO.', 'Ride it to the flag.'],
    sx - dz * 5.5, y + 3.2, sz + dx * 5.5, 0.75
  );
  flagAt(api, sx, y + 0.5, sz, 'Level 60', true);

  const yaw = Math.atan2(dx, dz);
  const left = sideOf(dx, dz, -1);
  const right = sideOf(dx, dz, 1);
  const saucer = ufoDeckSize('saucer');
  const delta = ufoDeckSize('delta');
  const padHalf = 3.1;
  const startTop = y + 0.5;
  const lowAlong = startAlong + startHalf + WALK_HOP_GAP + saucer.x / 2;
  const endAlong = lowAlong + UFO_ALONG;
  const endY = y + UFO_CLIMB;
  const end = {
    x: ox + dx * endAlong,
    y: endY,
    z: z + dz * endAlong
  };
  const lowSide = 5.6;
  const deckLift = (h: number) => startTop - h / 2;
  const highLift = (h: number) => end.y + 0.5 - h / 2;
  const highGap = (half: number) => padHalf + WALK_HOP_GAP + half;

  api.addUfo(
    'saucer',
    new THREE.Vector3(
      ox + dx * lowAlong + left.x * lowSide,
      deckLift(saucer.y),
      z + dz * lowAlong + left.z * lowSide
    ),
    new THREE.Vector3(
      end.x + left.x * highGap(saucer.x / 2),
      highLift(saucer.y),
      end.z + left.z * highGap(saucer.x / 2)
    ),
    UFO_SPEED, 0, yaw, 'Saucer UFO'
  );
  api.addUfo(
    'delta',
    new THREE.Vector3(
      ox + dx * lowAlong + right.x * lowSide,
      deckLift(delta.y),
      z + dz * lowAlong + right.z * lowSide
    ),
    new THREE.Vector3(
      end.x + right.x * highGap(delta.x / 2),
      highLift(delta.y),
      end.z + right.z * highGap(delta.x / 2)
    ),
    UFO_SPEED, 1, yaw, 'Triangle UFO'
  );

  const { w: ew, d: ed } = padDimsAlongTravel(dx, dz, 6.2, 6.2);
  api.addBox(ew, 1, ed, end.x, end.y, end.z, color, { name: 'Level 67' });
  flagAt(api, end.x, end.y + 0.5, end.z, 'Level 67', true);
  return { x: end.x, y: end.y, z: end.z };
}

function placeComingSoon(
  api: ClimbApi, x: number, y: number, z: number, dx: number, dz: number
): void {
  const plaza = 4 * PATH_LEN;
  const px = x + dx * plaza;
  const pz = z + dz * plaza;
  const plazaW = 12;
  const plazaD = 12 * PATH_LEN;
  const { w: pw, d: pd } = padDimsAlongTravel(dx, dz, plazaW, plazaD);
  api.addBox(pw, 1, pd, px, y, pz, 0xcfa15a, { name: 'Coming Soon Plaza' });
  api.addSign(
    ['LEVELS 68–100', 'COMING SOON'],
    px - dz * 2.4, y + 7.2, pz + dx * 2.4, 2.5
  );

  const wallAlong = 16 * COURSE_RUN;
  const wx = px + dx * wallAlong;
  const wz = pz + dz * wallAlong;
  const rotY = Math.atan2(dx, dz);
  api.addOrientedSlab(180, 72, 14 * PATH_LEN, wx, y + 28, wz, rotY, 0xf5f7fa, 'Coming Soon Wall');
  api.addOrientedSlab(180, 18, 80 * PATH_LEN, wx + dx * 28, y + 68, wz + dz * 28, rotY, 0xf5f7fa, 'Coming Soon Roof');

  for (let i = 0; i < 18; i++) {
    const s = (i - 8.5) * 9;
    const side = sideOf(dx, dz, s);
    const along = (10 + (i % 4) * 5) * COURSE_RUN;
    api.addCloud(
      px + dx * along + side.x,
      y + 4 + (i % 5) * 7,
      pz + dz * along + side.z,
      16 + (i % 3) * 6,
      (12 + (i % 2) * 5) * PATH_LEN,
      undefined,
      `Fog Cloud ${i + 1}`,
      false
    );
  }
}

function restPad(api: ClimbApi, y: number, z: number, color: number, label: string, flag: boolean) {
  const across = PAD + 2;
  const along = across * PATH_LEN;
  api.addBox(across, 1, along, 0, y, z, color, { name: label });
  flagAt(api, 0, y + 0.5, z, label, flag);
  return { y, z: z + 9 * COURSE_RUN };
}

function hopStairs(
  api: ClimbApi, y: number, z: number, color: number, label: string,
  rise: number, flag: boolean, hard: number
) {
  const hops = runCount(3 + (hard > 0.55 ? 2 : hard > 0.25 ? 1 : 0));
  const gap = WALK_HOP_GAP + hard * 0.24;
  const padAcross = PAD - hard * 0.7;
  const padAlong = padAcross * PATH_LEN;
  const hopSpan = padAlong + gap;
  let endY = y;
  let endZ = z;
  for (let i = 0; i < hops; i++) {
    endY = y + i * rise;
    endZ = z + i * hopSpan;
    api.addBox(padAcross, 0.7, padAlong, (i % 2 ? -1.2 - hard : 1.2 + hard), endY, endZ, color, {
      name: `${label} Hop ${i + 1}`
    });
  }
  const landAcross = padAcross + 1.2;
  const landAlong = padAcross * PATH_LEN + 1.2;
  endZ = endZ + hopSpan;
  api.addBox(landAcross, 1, landAlong, 0, endY, endZ, color, { name: label });
  flagAt(api, 0, endY + 0.5, endZ, label, flag);
  return { y: endY, z: endZ + 12 * COURSE_RUN };
}

function rotorYard(
  api: ClimbApi, y: number, z: number, color: number, label: string,
  flag: boolean, hard: number
) {
  const arenaAcross = 11;
  const arenaAlong = arenaAcross * PATH_LEN;
  const arenaZ = z + arenaAlong / 2;
  api.addBox(arenaAcross, 0.8, arenaAlong, 0, y, arenaZ, color, { name: `${label} Arena` });
  api.addRotor(0, y + 1.35, arenaZ, 5.2, 1.05 + hard * 0.95);
  if (hard > 0.5) api.addRotor(0, y + 1.35, arenaZ, 3.4, -(1.2 + hard * 0.7), 0xf39c12);
  const landAcross = PAD + 1 - hard * 0.4;
  const landAlong = landAcross * PATH_LEN;
  const landZ = arenaZ + arenaAlong / 2 + WALK_HOP_GAP + landAlong / 2;
  api.addBox(landAcross, 1, landAlong, 0, y, landZ, color, { name: label });
  flagAt(api, 0, y + 0.5, landZ, label, flag);
  return { y, z: landZ + landAlong / 2 + 8 * COURSE_RUN };
}

function beams(
  api: ClimbApi, y: number, z: number, color: number, label: string,
  rise: number, flag: boolean, hard: number
) {
  const w = 1.15 - hard * 0.32;
  const beamLen = 9 * PATH_LEN;
  const beamAZ = z + beamLen / 2;
  const beamBZ = beamAZ + beamLen / 2 + WALK_HOP_GAP + beamLen / 2;
  api.addBox(w, 0.45, beamLen, -1.2 - hard * 0.4, y + 0.2, beamAZ, 0x90a4ae, { name: `${label} Beam A` });
  api.addBox(w, 0.45, beamLen, 1.2 + hard * 0.4, y + 0.2 + rise, beamBZ, 0x90a4ae, { name: `${label} Beam B` });
  const endY = y + rise;
  const landAcross = PAD + 1 - hard * 0.5;
  const landAlong = landAcross * PATH_LEN;
  const landZ = beamBZ + beamLen / 2 + WALK_HOP_GAP + landAlong / 2;
  api.addBox(landAcross, 1, landAlong, 0, endY, landZ, color, { name: label });
  flagAt(api, 0, endY + 0.5, landZ, label, flag);
  return { y: endY, z: landZ + landAlong / 2 + 8 * COURSE_RUN };
}

function trampHop(
  api: ClimbApi, y: number, z: number, color: number, label: string,
  rise: number, flag: boolean, hard: number
) {
  const approachAcross = PAD - hard * 0.4;
  const approachAlong = approachAcross * PATH_LEN;
  api.addBox(approachAcross, 0.8, approachAlong, 0, y, z, color, { name: `${label} Approach` });
  const trampZ = z + approachAlong / 2 + 0.45;
  api.addTrampoline(0, y + 0.4, trampZ, 1.35 - hard * 0.15, `${label} Pad`);
  const landY = y + Math.min(rise + 1.2 + hard * 0.8, 5.8);
  const landAcross = PAD + 0.4 - hard * 0.5;
  const landAlong = landAcross * PATH_LEN;
  const landZ = trampZ + 6 + hard * 2.2 + landAlong / 2;
  api.addBox(landAcross, 1, landAlong, 0, landY, landZ, color, { name: label });
  flagAt(api, 0, landY + 0.5, landZ, label, flag);
  return { y: landY, z: landZ + 8 * COURSE_RUN };
}

function zigzag(
  api: ClimbApi, y: number, z: number, color: number, label: string,
  rise: number, flag: boolean, hard: number
) {
  const xs = [-2.4 - hard, 2.4 + hard, -2.2 - hard * 0.6, 0];
  const padAcross = PAD - 0.4 - hard * 0.45;
  const padAlong = padAcross * PATH_LEN;
  const step = padAlong + WALK_HOP_GAP + hard * 0.15;
  const pillars = runCount(4);
  for (let i = 0; i < pillars; i++) {
    api.addBox(padAcross, 0.7, padAlong, xs[i % xs.length], y + i * (rise * 0.45), z + i * step, color, {
      name: `${label} Pillar ${i + 1}`
    });
  }
  const endY = y + (pillars - 1) * (rise * 0.45);
  const endZ = z + (pillars - 1) * step + step;
  const landAcross = PAD + 1 - hard * 0.4;
  const landAlong = landAcross * PATH_LEN;
  api.addBox(landAcross, 1, landAlong, 0, endY, endZ, color, { name: label });
  flagAt(api, 0, endY + 0.5, endZ, label, flag);
  return { y: endY, z: endZ + 8 * COURSE_RUN };
}

function moverLift(
  api: ClimbApi, y: number, z: number, color: number, label: string,
  rise: number, flag: boolean, hard: number
) {
  const dockAcross = PAD - hard * 0.3;
  const dockAlong = dockAcross * PATH_LEN;
  api.addBox(dockAcross, 0.8, dockAlong, 0, y, z, color, { name: `${label} Dock` });
  const top = y + Math.max(2.2, rise);
  const liftZ = z + dockAlong / 2 + 3.2;
  api.addMover(
    3.2 - hard * 0.5, 0.65, 3.2 - hard * 0.5,
    new THREE.Vector3(0, y + 0.4, liftZ),
    new THREE.Vector3(0, top, liftZ),
    0xab47bc, 0.7 + hard * 0.55, 0, `${label} Lift`
  );
  const landAcross = PAD + 1 - hard * 0.4;
  const landAlong = landAcross * PATH_LEN;
  const landZ = liftZ + 6 + landAlong / 2;
  api.addBox(landAcross, 1, landAlong, 0, top, landZ, color, { name: label });
  flagAt(api, 0, top + 0.5, landZ, label, flag);
  return { y: top, z: landZ + landAlong / 2 + 8 * COURSE_RUN };
}

function puffs(
  api: ClimbApi, y: number, z: number, label: string,
  rise: number, flag: boolean, hard: number
) {
  const w = 6.2 - hard * 1.4;
  const d = w * PATH_LEN;
  api.addCloud(0, y, z, w, d, undefined, `${label} Cloud A`);
  const bx = 2.4 + hard * 1.2;
  const bz = z + d / 2 + WALK_HOP_GAP + d / 2;
  api.addCloud(bx, y + rise, bz, w, d, undefined, `${label} Cloud B`);
  flagAt(api, bx, y + rise + 0.58, bz, label, flag);
  return { y: y + rise, z: bz + d / 2 + 8 * COURSE_RUN };
}

function rocks(
  api: ClimbApi, y: number, z: number, label: string,
  rise: number, flag: boolean, hard: number
) {
  const rA = 2.5 - hard * 0.35;
  const rB = 2.8 - hard * 0.3;
  api.addAsteroid(-2 - hard, y, z, rA, `${label} Rock A`);
  const rx = 2.4 + hard;
  const rz = z + rA + WALK_HOP_GAP + rB;
  api.addAsteroid(rx, y + rise, rz, rB, `${label} Rock B`);
  flagAt(api, rx, y + rise + 0.1, rz, label, flag);
  return { y: y + rise, z: rz + rB + 8 * COURSE_RUN };
}

/** Catch pad sits above stand-jump height, so the crate must be thrown (Q, then B). */
export function placeThrowGate(
  api: ClimbApi,
  y: number,
  z: number,
  color: number,
  label: string,
  seed: number,
  withCheckpoint = true
) {
  const startAlong = (PAD + 1) * PATH_LEN;
  api.addBox(PAD + 2, 1, startAlong, 0, y, z, color, { name: `${label} Start` });
  api.addProp(seed % 2 ? -1.6 : 1.6, y + 0.5, z + 0.4, 'crate');
  api.addSign(
    ['THROW the crate (B)', 'onto the high green pad.', `Sprint jump ${JUMP_DIST_RUN.toFixed(1)} m still too low.`],
    -6.2, y + 3.2, z + 1.2, 0.75
  );

  const padY = y + JUMP_HEIGHT_SAFE + 1.15;
  api.addBox(2.8, 0.4, 2.8, 0, padY, z + 3.4, 0x2ecc71, { name: `${label} Catch` });
  const padCol = api.lastCollider();

  const wallH = 3.5;
  const wallZ = z + startAlong / 2 + 0.6;
  const gateVisual = api.addBox(8, wallH, 1.05, 0, y + wallH / 2, wallZ, 0x5d4e60, { name: `${label} Gate` });
  const gateCollider = api.lastCollider();
  api.addThrowSwitch({
    padMin: padCol.min.clone(),
    padMax: padCol.max.clone(),
    parts: [{ mesh: gateVisual, collider: gateCollider, hideWhenOpen: true }],
    open: false
  });

  const landZ = wallZ + 5;
  const landAcross = PAD + 1.5;
  const landAlong = landAcross * PATH_LEN;
  api.addBox(landAcross, 1, landAlong, 0, y, landZ, color, { name: label });
  if (withCheckpoint) api.addCheckpoint(0, y + 0.5, landZ, label);
  return { y, z: landZ + 8 * COURSE_RUN };
}
