import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let loader: GLTFLoader | null = null;

/** Shared GLTF loader with Draco so compressed assets decode once. */
export function gltfLoader(): GLTFLoader {
  if (loader) return loader;
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
  loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  return loader;
}
