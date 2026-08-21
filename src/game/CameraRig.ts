import * as THREE from 'three';

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  yaw = Math.PI; // face the course at spawn
  pitch = 0.32;
  dist = 6.5;
  private look = new THREE.Vector3(0, 1.3, 0);
  private lookReady = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 2800);
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
    // Right-handed: camera right = forward × world-up (A = left, D = right).
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
  }

  update(target: THREE.Vector3, dt: number): void {
    const wantX = target.x;
    const wantY = target.y + 1.3;
    const wantZ = target.z;
    if (!this.lookReady) {
      this.look.set(wantX, wantY, wantZ);
      this.lookReady = true;
    } else {
      // XZ can ease a little so strafe isn't snappy; Y is locked so jump/fall never nods.
      const kXZ = 1 - Math.exp(-26 * dt);
      this.look.x += (wantX - this.look.x) * kXZ;
      this.look.y = wantY;
      this.look.z += (wantZ - this.look.z) * kXZ;
    }

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.camera.position.set(
      this.look.x + Math.sin(this.yaw) * cp * this.dist,
      this.look.y + 0.1 + sp * this.dist,
      this.look.z + Math.cos(this.yaw) * cp * this.dist
    );
    this.camera.lookAt(this.look);
  }

  snap(target: THREE.Vector3): void {
    this.look.set(target.x, target.y + 1.3, target.z);
    this.lookReady = true;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.camera.position.set(
      this.look.x + Math.sin(this.yaw) * cp * this.dist,
      this.look.y + 0.1 + sp * this.dist,
      this.look.z + Math.cos(this.yaw) * cp * this.dist
    );
    this.camera.lookAt(this.look);
  }
}
