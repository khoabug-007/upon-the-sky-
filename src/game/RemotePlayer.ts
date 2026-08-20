import * as THREE from 'three';
import { Character } from './Character';
import type { AnimState, Profile } from '../types';

export class RemotePlayer {
  readonly character: Character;
  readonly targetPos = new THREE.Vector3();
  targetRy = 0;
  anim: AnimState = 'idle';
  carriedBy: string | null = null;
  name: string;

  constructor(public id: string, profile: Profile, scene: THREE.Scene) {
    this.name = profile.name || 'Player';
    this.character = new Character(profile.custom, this.name + id);
    this.character.setNameTag(this.name);
    scene.add(this.character.group);
  }

  update(dt: number): void {
    const g = this.character.group;
    const k = Math.min(1, 12 * dt);
    g.position.lerp(this.targetPos, k);
    let diff = this.targetRy - g.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    g.rotation.y += diff * k;
    this.character.setAnim(this.anim);
    this.character.update(dt);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.character.group);
  }
}
