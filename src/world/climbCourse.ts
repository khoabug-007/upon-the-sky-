import * as THREE from 'three';

/** Copied from PlayerController jump budget so this file does not import Game physics. */
const JUMP_DIST_RUN = 7.68;
const JUMP_HEIGHT_SAFE = 1.55;
const SPACE_JUMP_HEIGHT_SAFE = 7.0;

const SPACE_BAND_Y = 88;
/** Walk hop at +1.5 m: 3.23 m air, minus radii → keep edge gaps at 2.2 m. */
const WALK_HOP_GAP = 2.2;
const PAD = 3.1;

/** Obstacle segments to append after the hand-authored course (same length as before). */
export const TARGET_LEVELS = 100;

/** How many obstacle pieces between flags after this many checkpoints already exist. */
function segmentsUntilNextFlag(placedCount: number): number {
  if (placedCount < 21) return 1;
  if (placedCount < 30) return 2;
  if (placedCount < 40) return 3;
  if (placedCount < 50) return 4;
  return 5;
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
  addErrorWorld(x: number, y: number, z: number, dx: number, dz: number): void;
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
      : Math.min(1.35 + hard * 0.2, JUMP_HEIGHT_SAFE);
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
      if (next <= 54) {
        ({ x, y, z } = backHop(api, x, y, z, dx, dz, lateColor, label));
      } else if (next <= 60) {
        ({ x, y, z } = reverseSpin(api, x, y, z, dx, dz, lateColor, label));
      } else {
        ({ x, y, z } = spiralUp(api, x, y, z, dx, dz, lateColor, label, next));
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

/** Motor pool at Level 17, then a helix road the troop truck can drive to Level 50. */
function buildConvoyHighway(api: ClimbApi, y: number, z: number) {
  const parkW = 24;
  const parkD = 24;
  const roadW = 16;
  const slabD = 20;
  const slabH = 1;
  const R = 40;
  const steps = 72;
  const dTheta = 0.30;
  const rise = 0.42;
  api.addBox(parkW, slabH, parkD, 0, y, z, 0x3a3a36, { name: 'Motor Pool' });
  api.addSign(
    ['MOTOR POOL', 'Press E to sit inside the cab.', 'Drive the spiral road up to Level 50.'],
    -8.2, y + 3.4, z - 1.5, 0.9
  );
  api.addCheckpoint(0, y + 0.5, z, 'Level 17');

  const zStart = z + parkD / 2 + slabD * 0.32;
  const cx = R;
  const cz = zStart;
  api.addOrientedSlab(roadW, slabH, 16, 0, y, z + parkD / 2 + 7, 0, 0x3a3a36, 'Convoy Road');
  api.addVehicleSpawn(0, y + 0.5, z + 1.2, 0);

  let lastX = 0, lastY = y, lastZ = zStart, lastTx = 0, lastTz = 1;
  for (let i = 0; i < steps; i++) {
    const th = -Math.PI / 2 + i * dTheta;
    const px = cx + R * Math.sin(th);
    const pz = cz + R * Math.cos(th);
    const py = y + i * rise;
    const tx = R * Math.cos(th);
    const tz = -R * Math.sin(th);
    const rotY = Math.atan2(tx, tz);
    api.addOrientedSlab(roadW, slabH, slabD, px, py, pz, rotY, 0x3a3a36, 'Convoy Road');
    lastX = px; lastY = py; lastZ = pz; lastTx = tx; lastTz = tz;
  }

  const tan = Math.hypot(lastTx, lastTz) || 1;
  const ux = lastTx / tan;
  const uz = lastTz / tan;
  const exitRot = Math.atan2(lastTx, lastTz);
  api.addOrientedSlab(roadW, slabH, 16, lastX + ux * 10, lastY, lastZ + uz * 10, exitRot, 0x3a3a36, 'Convoy Road');
  const endX = lastX + ux * 22;
  const endZ = lastZ + uz * 22;
  api.addErrorWorld(endX, lastY, endZ, -ux, -uz);
  api.addCheckpoint(endX, lastY + 0.5, endZ, 'Level 50');
  return { x: endX, y: lastY, z: endZ, dx: -ux, dz: -uz };
}

function sideOf(dx: number, dz: number, s: number): { x: number; z: number } {
  return { x: -dz * s, z: dx * s };
}

/** After Level 50: hop back the way you came, still climbing. */
function backHop(
  api: ClimbApi, ox: number, y: number, z: number,
  dx: number, dz: number, color: number, label: string
): { x: number; y: number; z: number } {
  const hops = 4;
  const rise = 1.48;
  const pad = 2.7;
  let py = y;
  let along = 0;
  for (let i = 0; i < hops; i++) {
    const side = sideOf(dx, dz, i % 2 ? -0.45 : 0.45);
    along = i * (pad + WALK_HOP_GAP);
    py = y + i * rise;
    api.addBox(pad, 0.7, pad, ox + dx * along + side.x, py, z + dz * along + side.z, color, {
      name: `${label} Hop ${i + 1}`
    });
  }
  along += 4;
  const ex = ox + dx * along;
  const ez = z + dz * along;
  api.addBox(pad + 1.1, 1, pad + 1.1, ex, py, ez, color, { name: label });
  flagAt(api, ex, py + 0.5, ez, label, true);
  return { x: ex, y: py, z: ez };
}

/** Levels 55–60: spinning bars turn the other way. */
function reverseSpin(
  api: ClimbApi, ox: number, y: number, z: number,
  dx: number, dz: number, color: number, label: string
): { x: number; y: number; z: number } {
  const mid = 6;
  const mx = ox + dx * mid;
  const mz = z + dz * mid;
  api.addBox(10, 0.8, 10, mx, y, mz, color, { name: `${label} Arena` });
  api.addRotor(mx, y + 1.35, mz, 5.0, -1.45, 0xe74c3c);
  api.addRotor(mx, y + 1.35, mz, 3.2, -2.05, 0xf39c12);
  const along = mid + 8;
  const ex = ox + dx * along;
  const ez = z + dz * along;
  api.addBox(3.3, 1, 3.3, ex, y, ez, color, { name: label });
  flagAt(api, ex, y + 0.5, ez, label, true);
  return { x: ex, y, z: ez };
}

/** Levels 61–67: pads and rotors climb a rising spiral. */
function spiralUp(
  api: ClimbApi, ox: number, y: number, z: number,
  dx: number, dz: number, color: number, label: string, seed: number
): { x: number; y: number; z: number } {
  const pads = 5;
  const rise = 1.48;
  const R = 3.0;
  const step = 2.2;
  const dAng = 0.7;
  let lastX = ox, lastY = y, lastZ = z;
  for (let i = 0; i < pads; i++) {
    const ang = seed * 0.35 + i * dAng;
    const px = ox + dx * (i * step) + Math.cos(ang) * R;
    const pz = z + dz * (i * step) + Math.sin(ang) * R;
    const py = y + i * rise;
    api.addBox(2.55, 0.7, 2.55, px, py, pz, color, { name: `${label} Coil ${i + 1}` });
    api.addRotor(px, py + 1.32, pz, 2.5, 1.2 + i * 0.1, 0xe67e22, ang);
    lastX = px; lastY = py; lastZ = pz;
  }
  flagAt(api, lastX, lastY + 0.5, lastZ, label, true);
  return { x: lastX, y: lastY, z: lastZ };
}

function placeComingSoon(
  api: ClimbApi, x: number, y: number, z: number, dx: number, dz: number
): void {
  const plaza = 4;
  const px = x + dx * plaza;
  const pz = z + dz * plaza;
  api.addBox(12, 1, 12, px, y, pz, 0xcfa15a, { name: 'Coming Soon Plaza' });
  api.addSign(
    ['LEVELS 68–100', 'COMING SOON'],
    px - dz * 2.4, y + 7.2, pz + dx * 2.4, 2.5
  );

  const wallAlong = 16;
  const wx = px + dx * wallAlong;
  const wz = pz + dz * wallAlong;
  const rotY = Math.atan2(dx, dz);
  api.addOrientedSlab(180, 72, 14, wx, y + 28, wz, rotY, 0xf5f7fa, 'Coming Soon Wall');
  api.addOrientedSlab(180, 18, 80, wx + dx * 28, y + 68, wz + dz * 28, rotY, 0xf5f7fa, 'Coming Soon Roof');

  for (let i = 0; i < 18; i++) {
    const s = (i - 8.5) * 9;
    const side = sideOf(dx, dz, s);
    const along = 10 + (i % 4) * 5;
    api.addCloud(
      px + dx * along + side.x,
      y + 4 + (i % 5) * 7,
      pz + dz * along + side.z,
      16 + (i % 3) * 6,
      12 + (i % 2) * 5,
      undefined,
      `Fog Cloud ${i + 1}`,
      false
    );
  }
}

function restPad(api: ClimbApi, y: number, z: number, color: number, label: string, flag: boolean) {
  api.addBox(PAD + 2, 1, PAD + 2, 0, y, z, color, { name: label });
  flagAt(api, 0, y + 0.5, z, label, flag);
  return { y, z: z + 9 };
}

function hopStairs(
  api: ClimbApi, y: number, z: number, color: number, label: string,
  rise: number, flag: boolean, hard: number
) {
  const hops = 3 + (hard > 0.55 ? 2 : hard > 0.25 ? 1 : 0);
  const gap = WALK_HOP_GAP + hard * 0.24;
  const pad = PAD - hard * 0.7;
  let endY = y;
  let endZ = z;
  for (let i = 0; i < hops; i++) {
    endY = y + i * rise;
    endZ = z + i * (pad * 0.55 + gap);
    api.addBox(pad, 0.7, pad, (i % 2 ? -1.2 - hard : 1.2 + hard), endY, endZ, color, {
      name: `${label} Hop ${i + 1}`
    });
  }
  api.addBox(pad + 1.2, 1, pad + 1.2, 0, endY, endZ + 4, color, { name: label });
  flagAt(api, 0, endY + 0.5, endZ + 4, label, flag);
  return { y: endY, z: endZ + 12 };
}

function rotorYard(
  api: ClimbApi, y: number, z: number, color: number, label: string,
  flag: boolean, hard: number
) {
  api.addBox(11, 0.8, 11, 0, y, z + 5, color, { name: `${label} Arena` });
  api.addRotor(0, y + 1.35, z + 5, 5.2, 1.05 + hard * 0.95);
  if (hard > 0.5) api.addRotor(0, y + 1.35, z + 5, 3.4, -(1.2 + hard * 0.7), 0xf39c12);
  api.addBox(PAD + 1 - hard * 0.4, 1, PAD + 1 - hard * 0.4, 0, y, z + 13, color, { name: label });
  flagAt(api, 0, y + 0.5, z + 13, label, flag);
  return { y, z: z + 20 };
}

function beams(
  api: ClimbApi, y: number, z: number, color: number, label: string,
  rise: number, flag: boolean, hard: number
) {
  const w = 1.15 - hard * 0.32;
  api.addBox(w, 0.45, 9, -1.2 - hard * 0.4, y + 0.2, z + 5, 0x90a4ae, { name: `${label} Beam A` });
  api.addBox(w, 0.45, 9, 1.2 + hard * 0.4, y + 0.2 + rise, z + 14, 0x90a4ae, { name: `${label} Beam B` });
  const endY = y + rise;
  api.addBox(PAD + 1 - hard * 0.5, 1, PAD + 1 - hard * 0.5, 0, endY, z + 22, color, { name: label });
  flagAt(api, 0, endY + 0.5, z + 22, label, flag);
  return { y: endY, z: z + 30 };
}

function trampHop(
  api: ClimbApi, y: number, z: number, color: number, label: string,
  rise: number, flag: boolean, hard: number
) {
  api.addBox(PAD - hard * 0.4, 0.8, PAD - hard * 0.4, 0, y, z, color, { name: `${label} Approach` });
  api.addTrampoline(0, y + 0.4, z + 4, 1.35 - hard * 0.15, `${label} Pad`);
  const landY = y + Math.min(rise + 1.2 + hard * 0.8, 5.8);
  const landZ = z + 10 + hard * 2.2;
  api.addBox(PAD + 0.4 - hard * 0.5, 1, PAD + 0.4 - hard * 0.5, 0, landY, landZ, color, { name: label });
  flagAt(api, 0, landY + 0.5, landZ, label, flag);
  return { y: landY, z: landZ + 8 };
}

function zigzag(
  api: ClimbApi, y: number, z: number, color: number, label: string,
  rise: number, flag: boolean, hard: number
) {
  const xs = [-2.4 - hard, 2.4 + hard, -2.2 - hard * 0.6, 0];
  const pad = PAD - 0.4 - hard * 0.45;
  const step = WALK_HOP_GAP + PAD * 0.5 + hard * 0.15;
  for (let i = 0; i < 4; i++) {
    api.addBox(pad, 0.7, pad, xs[i], y + i * (rise * 0.45), z + i * step, color, {
      name: `${label} Pillar ${i + 1}`
    });
  }
  const endY = y + 3 * (rise * 0.45);
  const endZ = z + 3 * step + 4;
  api.addBox(PAD + 1 - hard * 0.4, 1, PAD + 1 - hard * 0.4, 0, endY, endZ, color, { name: label });
  flagAt(api, 0, endY + 0.5, endZ, label, flag);
  return { y: endY, z: endZ + 8 };
}

function moverLift(
  api: ClimbApi, y: number, z: number, color: number, label: string,
  rise: number, flag: boolean, hard: number
) {
  api.addBox(PAD - hard * 0.3, 0.8, PAD - hard * 0.3, 0, y, z, color, { name: `${label} Dock` });
  const top = y + Math.max(2.2, rise);
  api.addMover(
    3.2 - hard * 0.5, 0.65, 3.2 - hard * 0.5,
    new THREE.Vector3(0, y + 0.4, z + 5),
    new THREE.Vector3(0, top, z + 5),
    0xab47bc, 0.7 + hard * 0.55, 0, `${label} Lift`
  );
  api.addBox(PAD + 1 - hard * 0.4, 1, PAD + 1 - hard * 0.4, 0, top, z + 11, color, { name: label });
  flagAt(api, 0, top + 0.5, z + 11, label, flag);
  return { y: top, z: z + 19 };
}

function puffs(
  api: ClimbApi, y: number, z: number, label: string,
  rise: number, flag: boolean, hard: number
) {
  const w = 6.2 - hard * 1.4;
  api.addCloud(0, y, z, w, w, undefined, `${label} Cloud A`);
  const bx = 2.4 + hard * 1.2;
  const bz = z + 7 + hard;
  api.addCloud(bx, y + rise, bz, w, w, undefined, `${label} Cloud B`);
  flagAt(api, bx, y + rise + 0.58, bz, label, flag);
  return { y: y + rise, z: z + 16 + hard };
}

function rocks(
  api: ClimbApi, y: number, z: number, label: string,
  rise: number, flag: boolean, hard: number
) {
  api.addAsteroid(-2 - hard, y, z, 2.5 - hard * 0.35, `${label} Rock A`);
  const rx = 2.4 + hard;
  const rz = z + 9 + hard * 0.8;
  api.addAsteroid(rx, y + rise, rz, 2.8 - hard * 0.3, `${label} Rock B`);
  flagAt(api, rx, y + rise + 0.1, rz, label, flag);
  return { y: y + rise, z: z + 18 + hard };
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
  api.addBox(PAD + 2, 1, PAD + 1, 0, y, z, color, { name: `${label} Start` });
  api.addProp(seed % 2 ? -1.6 : 1.6, y + 0.5, z + 0.4, 'crate');
  api.addSign(
    ['THROW the crate (B)', 'onto the high green pad.', `Sprint jump ${JUMP_DIST_RUN.toFixed(1)} m still too low.`],
    -6.2, y + 3.2, z + 1.2, 0.75
  );

  const padY = y + JUMP_HEIGHT_SAFE + 1.15;
  api.addBox(2.8, 0.4, 2.8, 0, padY, z + 3.4, 0x2ecc71, { name: `${label} Catch` });
  const padCol = api.lastCollider();

  const wallH = 3.5;
  const wallZ = z + 7.2;
  const gateVisual = api.addBox(8, wallH, 1.05, 0, y + wallH / 2, wallZ, 0x5d4e60, { name: `${label} Gate` });
  const gateCollider = api.lastCollider();
  api.addThrowSwitch({
    padMin: padCol.min.clone(),
    padMax: padCol.max.clone(),
    parts: [{ mesh: gateVisual, collider: gateCollider, hideWhenOpen: true }],
    open: false
  });

  const landZ = wallZ + 5;
  api.addBox(PAD + 1.5, 1, PAD + 1.5, 0, y, landZ, color, { name: label });
  if (withCheckpoint) api.addCheckpoint(0, y + 0.5, landZ, label);
  return { y, z: landZ + 8 };
}
