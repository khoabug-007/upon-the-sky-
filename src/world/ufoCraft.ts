import * as THREE from 'three';

export type UfoKind = 'saucer' | 'delta';

/** Collider size of the walkable top deck (meters). Visual hull is slightly larger. */
export function ufoDeckSize(kind: UfoKind): THREE.Vector3 {
  // Thick slab so a jump cannot tunnel through; visual deck sits on max.y.
  return kind === 'saucer'
    ? new THREE.Vector3(13.8, 1.9, 13.8)
    : new THREE.Vector3(14.4, 1.9, 13.0);
}

function metal(color: number, metalness = 0.82, roughness = 0.32, emissive = 0x000000, ei = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color, metalness, roughness, emissive, emissiveIntensity: ei
  });
}

function glass(color: number, opacity = 0.42): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.15,
    roughness: 0.08,
    transparent: true,
    opacity,
    emissive: color,
    emissiveIntensity: 0.22,
    side: THREE.DoubleSide
  });
}

function makeAlien(skin: number, glow: number, scale: number): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = metal(skin, 0.12, 0.55, glow, 0.18);
  const eyeMat = metal(0x111111, 0.4, 0.25, glow, 0.55);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), bodyMat);
  head.scale.set(1.05, 1.22, 0.95);
  head.position.y = 0.72;
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), eyeMat);
  const eyeR = eyeL.clone();
  eyeL.scale.set(1.3, 1.6, 0.7);
  eyeR.scale.copy(eyeL.scale);
  eyeL.position.set(-0.12, 0.74, 0.22);
  eyeR.position.set(0.12, 0.74, 0.22);
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), bodyMat);
  torso.scale.set(1.15, 1.35, 0.8);
  torso.position.y = 0.34;
  const armGeo = new THREE.CylinderGeometry(0.045, 0.04, 0.38, 6);
  const armL = new THREE.Mesh(armGeo, bodyMat);
  const armR = new THREE.Mesh(armGeo, bodyMat);
  armL.rotation.z = 0.85;
  armR.rotation.z = -0.85;
  armL.position.set(-0.28, 0.38, 0.04);
  armR.position.set(0.28, 0.38, 0.04);
  g.add(head, eyeL, eyeR, torso, armL, armR);
  g.scale.setScalar(scale);
  return g;
}

function addRimLights(parent: THREE.Group, radius: number, color: number, count: number, y: number): void {
  const mat = metal(color, 0.35, 0.22, color, 0.85);
  const geo = new THREE.SphereGeometry(0.11, 8, 6);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const bulb = new THREE.Mesh(geo, mat);
    bulb.position.set(Math.cos(a) * radius, y, Math.sin(a) * radius);
    parent.add(bulb);
  }
}

/** Classic disc saucer: brushed nickel hull, gold rim, green glass, green alien. */
function buildSaucer(): THREE.Group {
  const g = new THREE.Group();
  const r = 6.35;
  const hull = metal(0xc5cdd6, 0.88, 0.28);
  const gold = metal(0xc9a227, 0.7, 0.35, 0x6a4a00, 0.12);
  const dark = metal(0x2a3038, 0.7, 0.4);

  const lower = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.42, r * 0.98, 1.15, 40), hull);
  lower.position.y = -0.95;
  const mid = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.02, 0.38, 40), gold);
  mid.position.y = -0.36;
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.99, r * 0.99, 0.16, 40), metal(0xd7dee6, 0.78, 0.24));
  deck.position.y = -0.08;
  const cabin = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.72, r * 0.78, 0.62, 28), glass(0x6dff9a, 0.38));
  cabin.position.y = -0.72;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.35, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), glass(0x8cffb0, 0.5));
  dome.position.y = 0.02;
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.18, 0.22, 16), dark);
  dish.position.y = 1.05;
  const spike = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 6), gold);
  spike.position.y = 1.45;

  const alien = makeAlien(0x5cdb7a, 0x2aff6a, 1.15);
  alien.position.set(0, -0.95, 0.15);
  alien.rotation.x = -0.12;

  g.add(lower, mid, deck, cabin, dome, dish, spike, alien);
  addRimLights(g, r * 0.92, 0x7cff9e, 16, -0.36);
  for (const m of g.children) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  alien.traverse((o) => {
    o.castShadow = true;
  });
  return g;
}

/** Angular black delta craft: cyan thrusters, grey alien under a canopy. */
function buildDelta(): THREE.Group {
  const g = new THREE.Group();
  const hullMat = metal(0x1b222b, 0.9, 0.22, 0x0a3040, 0.08);
  const cyan = metal(0x4de2ff, 0.45, 0.2, 0x1ac6e6, 0.7);
  const deckMat = metal(0x3a4652, 0.75, 0.28);

  const shape = new THREE.Shape();
  shape.moveTo(0, 7.1);
  shape.lineTo(-6.6, -5.8);
  shape.lineTo(6.6, -5.8);
  shape.closePath();
  const hull = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, {
      depth: 1.05,
      bevelEnabled: true,
      bevelThickness: 0.18,
      bevelSize: 0.22,
      bevelSegments: 2
    }),
    hullMat
  );
  hull.rotation.x = -Math.PI / 2;
  hull.position.y = -1.22;

  const deck = new THREE.Mesh(new THREE.CylinderGeometry(5.9, 5.9, 0.16, 8), deckMat);
  deck.position.y = -0.08;
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(1.55, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.58),
    glass(0x7fe7ff, 0.45)
  );
  canopy.scale.set(1.15, 0.72, 1.35);
  canopy.position.set(0, 0.06, 0.35);

  const alien = makeAlien(0xc5c8cc, 0x66e7ff, 1.2);
  alien.position.set(0, -0.88, 0.4);
  alien.rotation.x = -0.08;

  const thrusterGeo = new THREE.CylinderGeometry(0.42, 0.55, 0.35, 12);
  const tips: Array<[number, number, number]> = [
    [0, -1.05, 6.4],
    [-5.7, -1.05, -5.1],
    [5.7, -1.05, -5.1]
  ];
  for (const [x, y, z] of tips) {
    const t = new THREE.Mesh(thrusterGeo, cyan);
    t.position.set(x, y, z);
    g.add(t);
  }

  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 10.4), cyan);
  ridge.position.set(0, -0.02, 0.2);

  g.add(hull, deck, canopy, alien, ridge);
  addRimLights(g, 5.4, 0x4de2ff, 10, -0.28);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}

/**
 * Visual origin is the top of the walkable deck. Hull hangs below.
 * Collider should sit so max.y matches this origin.
 */
export function buildUfoCraft(kind: UfoKind): THREE.Group {
  const g = kind === 'saucer' ? buildSaucer() : buildDelta();
  g.name = kind === 'saucer' ? 'Saucer UFO' : 'Triangle UFO';
  return g;
}
