import * as THREE from 'three';

/** Copied from PlayerController jump budget so this file does not import Game physics. */
const JUMP_DIST_RUN = 7.68;
const JUMP_HEIGHT_SAFE = 1.55;
const SPACE_JUMP_HEIGHT_SAFE = 7.0;

const SPACE_BAND_Y = 88;
/** Walk hop at +1.5 m: 3.23 m air, minus radii → keep edge gaps at 2.2 m. */
const WALK_HOP_GAP = 2.2;
const PAD = 3.1;

export const TARGET_LEVELS = 100;

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
 * Appends parkour segments until TARGET_LEVELS checkpoints exist.
 * Gaps stay inside measured walk-hop / jump-height / space-jump budgets.
 */
export function appendClimbLevels(
  api: ClimbApi,
  startY: number,
  startZ: number,
  already: number
): { y: number; z: number } {
  let y = startY;
  let z = startZ;
  let n = already;
  while (n < TARGET_LEVELS) {
    const kind = n % 10;
    const inSpace = y > SPACE_BAND_Y;
    const rise = inSpace ? Math.min(4.8, SPACE_JUMP_HEIGHT_SAFE - 1.8) : Math.min(1.5, JUMP_HEIGHT_SAFE);
    const color = PALETTE[n % PALETTE.length];
    const label = `Level ${n + 1}`;

    if (kind === 6 || kind === 3) {
      ({ y, z } = placeThrowGate(api, y, z, color, label, n, true));
    } else if (kind === 0) {
      ({ y, z } = hopStairs(api, y, z, color, label, rise));
    } else if (kind === 1) {
      ({ y, z } = rotorYard(api, y, z, color, label));
    } else if (kind === 2) {
      ({ y, z } = beams(api, y, z, color, label, rise));
    } else if (kind === 4) {
      ({ y, z } = trampHop(api, y, z, color, label, rise));
    } else if (kind === 5) {
      ({ y, z } = zigzag(api, y, z, color, label, rise));
    } else if (kind === 7) {
      ({ y, z } = moverLift(api, y, z, color, label, rise));
    } else if (kind === 8) {
      ({ y, z } = inSpace ? rocks(api, y, z, label, rise) : puffs(api, y, z, label, rise));
    } else {
      ({ y, z } = restPad(api, y, z, color, label));
    }
    n++;
  }
  return { y, z };
}

function restPad(api: ClimbApi, y: number, z: number, color: number, label: string) {
  api.addBox(PAD + 2, 1, PAD + 2, 0, y, z, color, { name: label });
  api.addCheckpoint(0, y + 0.5, z, label);
  return { y, z: z + 9 };
}

function hopStairs(api: ClimbApi, y: number, z: number, color: number, label: string, rise: number) {
  for (let i = 0; i < 3; i++) {
    const yy = y + i * rise;
    const zz = z + i * (PAD * 0.55 + WALK_HOP_GAP);
    api.addBox(PAD, 0.7, PAD, (i % 2 ? -1.1 : 1.1), yy, zz, color, { name: `${label} Hop ${i + 1}` });
  }
  const endY = y + 2 * rise;
  const endZ = z + 2 * (PAD * 0.55 + WALK_HOP_GAP) + 4;
  api.addBox(PAD + 1.5, 1, PAD + 1.5, 0, endY, endZ, color, { name: label });
  api.addCheckpoint(0, endY + 0.5, endZ, label);
  return { y: endY, z: endZ + 8 };
}

function rotorYard(api: ClimbApi, y: number, z: number, color: number, label: string) {
  api.addBox(11, 0.8, 11, 0, y, z + 5, color, { name: `${label} Arena` });
  api.addRotor(0, y + 1.35, z + 5, 5.2, 1.05);
  api.addBox(PAD + 1, 1, PAD + 1, 0, y, z + 13, color, { name: label });
  api.addCheckpoint(0, y + 0.5, z + 13, label);
  return { y, z: z + 20 };
}

function beams(api: ClimbApi, y: number, z: number, color: number, label: string, rise: number) {
  api.addBox(1.15, 0.45, 9, -1.2, y + 0.2, z + 5, 0x90a4ae, { name: `${label} Beam A` });
  api.addBox(1.15, 0.45, 9, 1.2, y + 0.2 + rise, z + 14, 0x90a4ae, { name: `${label} Beam B` });
  const endY = y + rise;
  api.addBox(PAD + 1, 1, PAD + 1, 0, endY, z + 22, color, { name: label });
  api.addCheckpoint(0, endY + 0.5, z + 22, label);
  return { y: endY, z: z + 30 };
}

function trampHop(api: ClimbApi, y: number, z: number, color: number, label: string, rise: number) {
  api.addBox(PAD, 0.8, PAD, 0, y, z, color, { name: `${label} Approach` });
  api.addTrampoline(0, y + 0.4, z + 4, 1.35, `${label} Pad`);
  const landY = y + Math.min(rise + 1.2, 5.5);
  api.addBox(PAD + 0.4, 1, PAD + 0.4, 0, landY, z + 10, color, { name: label });
  api.addCheckpoint(0, landY + 0.5, z + 10, label);
  return { y: landY, z: z + 18 };
}

function zigzag(api: ClimbApi, y: number, z: number, color: number, label: string, rise: number) {
  const xs = [-2.4, 2.4, -2.2, 0];
  for (let i = 0; i < 4; i++) {
    api.addBox(PAD - 0.4, 0.7, PAD - 0.4, xs[i], y + i * (rise * 0.45), z + i * (WALK_HOP_GAP + PAD * 0.5), color, {
      name: `${label} Pillar ${i + 1}`
    });
  }
  const endY = y + 3 * (rise * 0.45);
  const endZ = z + 3 * (WALK_HOP_GAP + PAD * 0.5) + 4;
  api.addBox(PAD + 1, 1, PAD + 1, 0, endY, endZ, color, { name: label });
  api.addCheckpoint(0, endY + 0.5, endZ, label);
  return { y: endY, z: endZ + 8 };
}

function moverLift(api: ClimbApi, y: number, z: number, color: number, label: string, rise: number) {
  api.addBox(PAD, 0.8, PAD, 0, y, z, color, { name: `${label} Dock` });
  const top = y + Math.max(2.2, rise);
  api.addMover(3.2, 0.65, 3.2, new THREE.Vector3(0, y + 0.4, z + 5), new THREE.Vector3(0, top, z + 5), 0xab47bc, 0.7, 0, `${label} Lift`);
  api.addBox(PAD + 1, 1, PAD + 1, 0, top, z + 11, color, { name: label });
  api.addCheckpoint(0, top + 0.5, z + 11, label);
  return { y: top, z: z + 19 };
}

function puffs(api: ClimbApi, y: number, z: number, label: string, rise: number) {
  api.addCloud(0, y, z, 6.2, 6.2, undefined, `${label} Cloud A`);
  api.addCloud(2.4, y + rise, z + 7, 6.2, 6.2, undefined, `${label} Cloud B`);
  api.addCheckpoint(0, y + rise + 0.58, z + 7, label);
  return { y: y + rise, z: z + 16 };
}

function rocks(api: ClimbApi, y: number, z: number, label: string, rise: number) {
  api.addAsteroid(-2, y, z, 2.5, `${label} Rock A`);
  api.addAsteroid(2.4, y + rise, z + 9, 2.8, `${label} Rock B`);
  api.addCheckpoint(0, y + rise + 0.1, z + 9, label);
  return { y: y + rise, z: z + 18 };
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
