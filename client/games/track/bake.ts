import { BufferGeometry, Color, Float32BufferAttribute, InstancedMesh, Matrix3, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, Vector3 } from "three";
import type { Object3D } from "three";

// The stadium never moves and neither does the sun, so its light is baked
// into vertex colours once and it draws unlit (task 31): the same flat-shaded
// look as a Lambert material under the same hemisphere and sun, at a fraction
// of the per-pixel cost on a software renderer. Only the runners stay lit.

export interface BakeLights {
  sky: number;
  ground: number;
  hemi: number;
  sun: number;
  sunIntensity: number;
  sunDir: Vector3;
}

const a = new Vector3();
const b = new Vector3();
const c = new Vector3();
const n = new Vector3();

/**
 * Swaps every Lambert mesh under `root` for an unlit one with the light baked
 * in per face. An instanced mesh is baked as its first instance faces (the
 * crowd in one stand all face one way, give or take a little).
 */
export function bakeLighting(root: Object3D, lights: BakeLights): void {
  const sky = new Color(lights.sky);
  const ground = new Color(lights.ground);
  const sun = new Color(lights.sun);
  const dir = lights.sunDir.clone().normalize();
  const light = new Color();
  const direct = new Color();
  // three's Lambert: (hemisphere irradiance + sun irradiance) x albedo / PI
  const shade = (normal: Vector3): Color => {
    light.copy(ground).lerp(sky, 0.5 * normal.y + 0.5).multiplyScalar(lights.hemi);
    light.add(direct.copy(sun).multiplyScalar(lights.sunIntensity * Math.max(0, normal.dot(dir))));
    return light.multiplyScalar(1 / Math.PI);
  };

  root.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh && o.material instanceof MeshLambertMaterial && !o.material.emissiveMap && o.material.emissive.getHex() === 0) meshes.push(o);
  });
  const inst = new Matrix4();
  const normalMatrix = new Matrix3();
  for (const mesh of meshes) {
    const mat = mesh.material as MeshLambertMaterial;
    const world = mesh.matrixWorld.clone();
    if (mesh instanceof InstancedMesh) {
      mesh.getMatrixAt(0, inst);
      world.multiply(inst);
    }
    normalMatrix.getNormalMatrix(world);
    const g: BufferGeometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const pos = g.getAttribute("position");
    const old = g.getAttribute("color");
    const out = new Float32Array(pos.count * 3);
    for (let i = 0; i + 2 < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      n.subVectors(c, b).cross(a.sub(b)).applyMatrix3(normalMatrix).normalize();
      const l = shade(n);
      const lr = l.r;
      const lg = l.g;
      const lb = l.b;
      for (let k = i; k < i + 3; k++) {
        out[k * 3] = (old ? old.getX(k) : 1) * lr;
        out[k * 3 + 1] = (old ? old.getY(k) : 1) * lg;
        out[k * 3 + 2] = (old ? old.getZ(k) : 1) * lb;
      }
    }
    g.setAttribute("color", new Float32BufferAttribute(out, 3));
    g.deleteAttribute("normal");
    mesh.geometry = g;
    mesh.material = new MeshBasicMaterial({ color: mat.color, map: mat.map, vertexColors: true, transparent: mat.transparent, opacity: mat.opacity });
    mat.dispose();
  }
}
