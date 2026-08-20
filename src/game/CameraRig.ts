import * as THREE from 'three';

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  yaw = Math.PI; // face the course at spawn
  pitch = 0.32;
  dist = 6.5;
  private smoothed = new THREE.Vector3(0, 2, 8);

  constructor(private canvas: HTMLCanvasElement) {
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 1600);
    canvas.addEventListener('click', () => {
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
    });
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.canvas) return;
      this.yaw -= e.movementX * 0.0024;
      this.pitch = Math.min(1.35, Math.max(-0.9, this.pitch + e.movementY * 0.0022));
    });
    window.addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  /** Flat XZ forward direction the player moves along. */
  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
  }

  right(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw)).normalize();
  }

  update(target: THREE.Vector3, dt: number): void {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const desired = new THREE.Vector3(
      target.x + Math.sin(this.yaw) * cp * this.dist,
      target.y + 1.4 + sp * this.dist,
      target.z + Math.cos(this.yaw) * cp * this.dist
    );
    const k = 1 - Math.exp(-14 * dt);
    this.smoothed.lerp(desired, k);
    this.camera.position.copy(this.smoothed);
    this.camera.lookAt(target.x, target.y + 1.3, target.z);
  }

  snap(target: THREE.Vector3): void {
    this.smoothed.set(
      target.x + Math.sin(this.yaw) * this.dist,
      target.y + 3,
      target.z + Math.cos(this.yaw) * this.dist
    );
  }
}
