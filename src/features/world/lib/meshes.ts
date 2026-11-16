import * as THREE from "three";
import type { MaterialId, Vec3 } from "../../../shared/document";
import { materialSpec } from "../../../shared/materials";
import { chunkByMaterial, type LoadedChunk } from "./chunks";

export interface ChunkMesh {
  group: THREE.Group;
  materials: THREE.Material[];
  geometry: THREE.BoxGeometry;
  /** Flat cell list parallel to each instanced mesh, for picking. */
  pickables: THREE.InstancedMesh[];
}

/**
 * One group of instanced meshes per chunk. Material lookups are private to the
 * chunk, so unloading a chunk frees all of its GPU memory at once.
 */
export function buildChunkMesh(chunk: LoadedChunk): ChunkMesh {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const mats: THREE.Material[] = [];
  const pickables: THREE.InstancedMesh[] = [];
  const matrix = new THREE.Matrix4();
  const shade = new THREE.Color();
  for (const [id, cells] of chunkByMaterial(chunk) as Iterable<
    [MaterialId, Vec3[]]
  >) {
    if (!cells.length) continue;
    const spec = materialSpec(id);
    const material = new THREE.MeshStandardMaterial({
      color: spec.color,
      roughness: 0.9,
      transparent: spec.opacity < 1,
      opacity: spec.opacity,
    });
    mats.push(material);
    const mesh = new THREE.InstancedMesh(geometry, material, cells.length);
    cells.forEach((b, i) => {
      matrix.makeTranslation(b.x + 0.5, b.y + 0.5, b.z + 0.5);
      mesh.setMatrixAt(i, matrix);
      const tone = 0.92 + ((b.x * 13 + b.z * 7 + b.y * 3) % 7) * 0.012;
      mesh.setColorAt(i, shade.setScalar(tone));
    });
    mesh.userData.cells = cells;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    pickables.push(mesh);
  }
  group.userData.chunk = `${chunk.cx},${chunk.cz}`;
  return { group, materials: mats, geometry, pickables };
}

export function disposeChunkMesh(mesh: ChunkMesh) {
  mesh.group.removeFromParent();
  mesh.geometry.dispose();
  mesh.materials.forEach((m) => m.dispose());
  mesh.group.clear();
}
