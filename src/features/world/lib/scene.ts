import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  buildChunkMesh,
  disposeChunkMesh,
  type ChunkMesh,
} from "./meshes";
import {
  hasLoaded,
  loadedChunks,
  takeDirtyChunks,
  type LoadedChunk,
} from "./chunks";
import { createStreamer } from "./stream";
import type { Workspace, Vec3 } from "../../../shared/document";
import type { SceneHit } from "../../../shared/commands";

const VIEW_RADIUS = 3;
const CHUNKS_PER_FRAME = 2;

export function mountScene(
  host: HTMLElement,
  state: Workspace,
  onHit: (hit: SceneHit) => void,
) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#dce5df");
  scene.fog = new THREE.Fog("#dce5df", 60, 150);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
  camera.position.set(30, 27, 34);
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 2, 0);
  controls.maxPolarAngle = Math.PI / 2.1;
  controls.minDistance = 8;
  controls.maxDistance = 70;
  controls.enableDamping = true;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };
  scene.add(new THREE.HemisphereLight("#fffae8", "#779082", 2.5));
  const sun = new THREE.DirectionalLight("#fff1d5", 3);
  sun.position.set(-15, 32, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -25,
    right: 25,
    top: 25,
    bottom: -25,
  });
  sun.shadow.bias = -0.001;
  scene.add(sun);
  scene.add(sun.target);

  // The ground plane and grid follow the player so the endless world always
  // has a visible base without loading every chunk.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: "#cdd8d0", roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.08;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(400, 400, "#abb9ad", "#c3cec3");
  grid.position.y = 0.005;
  grid.material.opacity = 0.35;
  grid.material.transparent = true;
  scene.add(grid);

  const chunkMeshes = new Map<string, ChunkMesh>();
  const streamer = createStreamer(VIEW_RADIUS, CHUNKS_PER_FRAME);
  const currentDoc = () => state.doc;
  let lastDoc = state.doc;

  const cursor = new THREE.Mesh(
    new THREE.BoxGeometry(1.02, 1.02, 1.02),
    new THREE.MeshBasicMaterial({ color: "#e9b261", wireframe: true }),
  );
  cursor.visible = false;
  scene.add(cursor);
  const region = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({
      color: "#eab569",
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    }),
  );
  region.visible = false;
  scene.add(region);
  const avatar = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.95, 0.38),
    new THREE.MeshStandardMaterial({ color: "#df8d4d" }),
  );
  body.position.y = 0.7;
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.46, 0.46),
    new THREE.MeshStandardMaterial({ color: "#f1ceac" }),
  );
  head.position.y = 1.4;
  avatar.add(body, head);
  scene.add(avatar);
  const ray = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let hit: SceneHit | null = null;

  function pickables() {
    const out: THREE.InstancedMesh[] = [];
    for (const mesh of chunkMeshes.values()) out.push(...mesh.pickables);
    return out;
  }

  const move = (e: PointerEvent) => {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      (-(e.clientY - r.top) / r.height) * 2 + 1,
    );
    ray.setFromCamera(mouse, camera);
    const h = ray.intersectObjects(pickables(), false)[0];
    hit = null;
    if (h && h.instanceId !== undefined && h.face) {
      const cell = (h.object as THREE.InstancedMesh).userData.cells[
        h.instanceId
      ] as Vec3;
      const n = h.face.normal;
      hit = {
        cell: { ...cell },
        adjacent: { x: cell.x + n.x, y: cell.y + n.y, z: cell.z + n.z },
      };
      const p = state.tool === "place" ? hit.adjacent : hit.cell;
      cursor.position.set(p.x + 0.5, p.y + 0.5, p.z + 0.5);
    }
    cursor.visible = !!hit;
  };
  let down = { x: 0, y: 0 };
  const start = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY };
  };
  const click = (e: PointerEvent) => {
    if (
      e.button === 0 &&
      Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5 &&
      hit &&
      state.mode === "build"
    )
      onHit(hit);
  };
  renderer.domElement.addEventListener("pointermove", move);
  renderer.domElement.addEventListener("pointerdown", start);
  renderer.domElement.addEventListener("pointerup", click);
  const resize = new ResizeObserver(() => {
    const w = host.clientWidth,
      h = host.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  resize.observe(host);

  function refreshChunk(doc: ReturnType<typeof currentDoc>, ck: string) {
    const old = chunkMeshes.get(ck);
    if (old) {
      scene.remove(old.group);
      disposeChunkMesh(old);
      chunkMeshes.delete(ck);
    }
    const chunk: LoadedChunk | undefined = loadedChunks(doc).get(ck);
    if (!chunk) return;
    const mesh = buildChunkMesh(chunk);
    chunkMeshes.set(ck, mesh);
    scene.add(mesh.group);
  }

  function clearMeshes() {
    for (const [ck, mesh] of chunkMeshes) {
      scene.remove(mesh.group);
      disposeChunkMesh(mesh);
      chunkMeshes.delete(ck);
    }
  }

  /** Sync meshes with the resident chunks, then rebuild edited ones. */
  function reconcile(doc: ReturnType<typeof currentDoc>) {
    const dirty = new Set(takeDirtyChunks(doc));
    // Loaded-but-not-meshed chunks (fresh streaming) get a mesh immediately.
    for (const ck of loadedChunks(doc).keys())
      if (!chunkMeshes.has(ck)) dirty.add(ck);
    for (const [ck, mesh] of [...chunkMeshes]) {
      if (hasLoaded(doc, ck)) continue;
      scene.remove(mesh.group);
      disposeChunkMesh(mesh);
      chunkMeshes.delete(ck);
    }
    for (const ck of dirty) refreshChunk(doc, ck);
  }

  let frame = 0;
  let lastPlayer = { x: state.doc.player.x, z: state.doc.player.z };
  function animate() {
    frame = requestAnimationFrame(animate);
    const doc = state.doc;
    if (doc !== lastDoc) {
      lastDoc = doc;
      clearMeshes();
      streamer.reset(doc, doc.player);
      lastPlayer = { x: doc.player.x, z: doc.player.z };
    }
    streamer.update(doc, doc.player);
    reconcile(doc);
    const resident = streamer.stats(doc).loaded;
    if (resident !== state.loadedChunks) state.loadedChunks = resident;
    const p = doc.player;
    floor.position.set(Math.round(p.x), -0.08, Math.round(p.z));
    grid.position.set(Math.round(p.x), 0.005, Math.round(p.z));
    avatar.position.set(p.x, p.y, p.z);
    // In walk mode the camera travels with the player; otherwise free orbit
    // would leave the avatar far behind in a streamed world.
    if (state.mode === "walk") {
      const dx = p.x - lastPlayer.x;
      const dz = p.z - lastPlayer.z;
      if (dx || dz) {
        camera.position.x += dx;
        camera.position.z += dz;
        controls.target.x += dx;
        controls.target.z += dz;
      }
    }
    lastPlayer = { x: p.x, z: p.z };
    // Keep the sun (and its shadow frustum) centred on the player so lighting
    // stays correct arbitrarily far from the origin.
    sun.position.set(p.x - 15, 32, p.z + 18);
    sun.target.position.set(p.x, 2, p.z);
    if (state.region) {
      const { a, b } = state.region;
      region.visible = true;
      region.position.set(
        (a.x + b.x + 1) / 2,
        (a.y + b.y + 1) / 2,
        (a.z + b.z + 1) / 2,
      );
      region.scale.set(
        Math.abs(a.x - b.x) + 1,
        Math.abs(a.y - b.y) + 1,
        Math.abs(a.z - b.z) + 1,
      );
    } else region.visible = false;
    controls.update();
    renderer.render(scene, camera);
  }
  animate();
  return {
    reset() {
      camera.position.set(30, 27, 34);
      controls.target.set(0, 2, 0);
    },
    dispose() {
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      clearMeshes();
      streamer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
