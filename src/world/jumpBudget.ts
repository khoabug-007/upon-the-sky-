/** Shared jump reach so course gaps stay one-obstacle hops. */

export const EARTH_G = 24;
export const MOON_G = 7.5;
export const WALK_SPEED = 5.5;
export const RUN_SPEED = 9.6;
export const EARTH_JUMP_VEL = 9.6;
export const MOON_JUMP_VEL = 11.5;
export const PLAYER_RADIUS = 0.38;

/** Feet above this Y use moon gravity. Set when the 5/21 flag is placed. */
export let SPACE_START_Y = 88;

export function setSpaceStartY(y: number): void {
  SPACE_START_Y = y;
}

export function hopFlightTime(vel: number, g: number, rise: number): number {
  const disc = vel * vel - 2 * g * Math.max(0, rise);
  if (disc <= 0) return (2 * vel) / g;
  return (vel + Math.sqrt(disc)) / g;
}

/**
 * Edge-to-edge hole that a walk jump can clear, but the next pad after that
 * stays past a sprint jump (one obstacle per hop).
 */
export function oneObstacleGap(rise: number, padAlong: number, space: boolean): number {
  const vel = space ? MOON_JUMP_VEL : EARTH_JUMP_VEL;
  const g = space ? MOON_G : EARTH_G;
  const t = hopFlightTime(vel, g, Math.max(0, rise));
  const walkEdge = WALK_SPEED * t - PLAYER_RADIUS * 2 - 0.4;
  const runEdge = RUN_SPEED * t;
  const noSkip = (runEdge - Math.max(0.8, padAlong)) / 2 + 0.45;
  return Math.max(2.4, Math.min(walkEdge, Math.max(2.4, noSkip)));
}
