export interface Customization {
  head: number; // 1-100
  body: number; // 1-100
  legs: number; // 1-100
}

export interface Profile {
  name: string;
  custom: Customization;
}

export interface ServerInfo {
  code: string;
  name: string;
  host: string;
  players: number;
}

export interface RemotePlayerInfo {
  id: string;
  profile: Profile;
}

export interface JoinResult {
  ok: boolean;
  error?: string;
  code?: string;
  name?: string;
  players?: RemotePlayerInfo[];
}

export type AnimState =
  | 'idle' | 'walk' | 'run' | 'crawl' | 'jump' | 'fall'
  | 'carried' | 'float' | 'grab';

export interface StateMsg {
  x: number; y: number; z: number;
  ry: number;
  anim: AnimState;
  carriedBy: string | null;
}

export interface Vec3Msg { x: number; y: number; z: number }

export interface ActionMsg {
  from?: string;
  type: 'punch' | 'pickup' | 'drop' | 'throw' | 'prop_grab' | 'prop_throw';
  target?: string;
  dir?: Vec3Msg;
  propId?: number;
  pos?: Vec3Msg;
  vel?: Vec3Msg;
}

export const DEFAULT_CUSTOM: Customization = { head: 50, body: 50, legs: 50 };
