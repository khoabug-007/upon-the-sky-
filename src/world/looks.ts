import * as THREE from 'three';

const BROWN = new Set([0xb5651d, 0x9c6b30, 0xd9a066, 0x7a5230, 0xcfa15a, 0xb07d48, 0xb08968, 0x8d6e63]);
const YELLOW = new Set([0xffd54f, 0xfff3cd, 0xf39c12, 0xffeb3b, 0xd9a400]);
const METAL = new Set([0x90a4ae, 0x6d6875, 0xeceff1, 0x8899aa, 0x777788, 0x6d6a5c, 0xcfd8dc]);
const SPACE = new Set([0x7e57c2, 0x5c6bc0, 0xab47bc]);
const BLUE = new Set([0x42a5f5, 0x3498db, 0x26a69a]);
const ASPHALT = 0x3a3a36;

export type LookKind = 'wood' | 'yellowWood' | 'metal' | 'space' | 'asphalt' | 'plain';

function kindFor(color: number): LookKind {
  if (color === ASPHALT) return 'asphalt';
  if (YELLOW.has(color)) return 'yellowWood';
  if (BROWN.has(color)) return 'wood';
  if (METAL.has(color)) return 'metal';
  if (SPACE.has(color)) return 'space';
  return 'plain';
}

export function isSpacePanel(color: number, h: number, w: number, d: number): boolean {
  return kindFor(color) === 'space' && h <= 1.25 && Math.min(w, d) >= 2.6;
}

export function isSteelPad(color: number): boolean {
  return kindFor(color) === 'space' || BLUE.has(color);
}

export function isLiftName(name?: string): boolean {
  return !!name && /lift/i.test(name);
}

function canvasPlanks(base: string, grain: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  const h = 32;
  for (let y = 0; y < 256; y += h) {
    ctx.fillStyle = grain;
    ctx.globalAlpha = 0.18 + ((y / h) % 3) * 0.05;
    ctx.fillRect(0, y, 256, h - 3);
    ctx.globalAlpha = 0.35;
    ctx.fillRect(0, y + h - 3, 256, 3);
  }
  ctx.globalAlpha = 0.12;
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(Math.random() * 256, Math.random() * 256);
    ctx.lineTo(Math.random() * 256, Math.random() * 256);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function canvasMetal(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#8b98a4';
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 2) {
    ctx.fillStyle = y % 8 === 0 ? '#7a8792' : '#96a2ad';
    ctx.globalAlpha = 0.35;
    ctx.fillRect(0, y, 256, 1);
  }
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#5c6570';
  for (const [x, y] of [[28, 28], [228, 28], [28, 228], [228, 228], [128, 128]]) {
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const cache = new Map<LookKind, THREE.MeshStandardMaterial>();

function loadMap(mat: THREE.MeshStandardMaterial, url: string, repeat: number): void {
  new THREE.TextureLoader().load(url, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
    tex.anisotropy = 4;
    mat.map = tex;
    mat.needsUpdate = true;
  });
}

export function lookMaterial(color: number, rough = 0.85): THREE.MeshStandardMaterial {
  const kind = kindFor(color);
  const hit = cache.get(kind);
  if (hit && kind !== 'plain') return hit;

  let mat: THREE.MeshStandardMaterial;
  if (kind === 'wood') {
    mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, map: canvasPlanks('#b5651d', '#7a3f12') });
    loadMap(mat, '/assets/tex-wood-brown.png', 2.2);
  } else if (kind === 'yellowWood') {
    mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, map: canvasPlanks('#ffd54f', '#c9a227') });
    loadMap(mat, '/assets/tex-wood-yellow.png', 2.2);
  } else if (kind === 'metal') {
    mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.38, metalness: 0.72, map: canvasMetal() });
    loadMap(mat, '/assets/tex-metal.png', 3);
  } else if (kind === 'asphalt') {
    mat = new THREE.MeshStandardMaterial({ color: 0x3a3a36, roughness: 0.95 });
    loadMap(mat, '/assets/tex-asphalt.png', 4);
  } else if (kind === 'space') {
    mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.35 });
  } else {
    return new THREE.MeshStandardMaterial({ color, roughness: rough });
  }
  cache.set(kind, mat);
  return mat;
}
