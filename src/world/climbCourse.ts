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
  addRotor(x: number, y: number, z: number, armLength: number, speed: number, color?: number): void;
  addCloud(
    x: number, y: number, z: number, w?: number, d?: number,
    moving?: { b: THREE.Vector3; speed: number }, name?: string
  ): void;
  addAsteroid(x: number, y: number, z: number, r?: number, name?: string): void;
  addProp(x: number, y: number, z: number, kind: 'ball' | 'crate'): void;
  addSign(text: string[], x: number, y: number, z: number, scale?: number): void;
  addCheckpoint(x: number, y: number, z: number, label: string): void;
  lastCollider(): { min: THREE.Vector3; max: THREE.Vector3; disabled?: boolean };
  addThrowSwitch(sw: ThrowSwitch): void;
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
): { y: number; z: number } {
  let y = startY;
  let z = startZ;
  let placed = already;
  let wait = 0;
  const extra = Math.max(0, TARGET_LEVELS - already);

  for (let i = 0; i < extra; i++) {
    const last = i === extra - 1;
    const flag = last || wait <= 0;
    const progress = extra <= 1 ? 1 : i / (extra - 1);
    const hard = progress * progress;
    const inSpace = y > SPACE_BAND_Y;
    const rise = inSpace
      ? Math.min(4.8 + hard * 1.4, SPACE_JUMP_HEIGHT_SAFE - 0.6)
      : Math.min(1.35 + hard * 0.2, JUMP_HEIGHT_SAFE);
    const color = PALETTE[i % PALETTE.length];
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
  return { y, z };
}

function flagAt(api: ClimbApi, x: number, y: number, z: number, label: string, flag: boolean) {
  if (flag) api.addCheckpoint(x, y, z, label);
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
  api.addCloud(2.4 + hard * 1.2, y + rise, z + 7 + hard, w, w, undefined, `${label} Cloud B`);
  flagAt(api, 0, y + rise + 0.58, z + 7 + hard, label, flag);
  return { y: y + rise, z: z + 16 + hard };
}

function rocks(
  api: ClimbApi, y: number, z: number, label: string,
  rise: number, flag: boolean, hard: number
) {
  api.addAsteroid(-2 - hard, y, z, 2.5 - hard * 0.35, `${label} Rock A`);
  api.addAsteroid(2.4 + hard, y + rise, z + 9 + hard * 0.8, 2.8 - hard * 0.3, `${label} Rock B`);
  flagAt(api, 0, y + rise + 0.1, z + 9 + hard * 0.8, label, flag);
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
