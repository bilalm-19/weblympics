import { BufferGeometry, Float32BufferAttribute, Matrix4, Mesh, MeshLambertMaterial, Vector3 } from "three";
import type { InstancedMesh, Material } from "three";

// Track's crowd (task 31). Tennis's fanMeshes places and colours the fans
// as instanced meshes; on the e2e's software renderer each instance costs
// far more than its triangles (the same 2,400 fans drew in about 80 ms
// instanced and 7 ms merged), so here each stand's fans are baked into one
// ordinary mesh. The cheer is a bounce in the vertex shader: each vertex
// carries its fan's keenness and beat, and two shared uniforms say how loud
// it is and what time it is, so cheering costs no uploads at all.

// Task 19: each fan also carries its side (seat 1's fans in the left half of
// each block, seat 2's in the right, as the end stand's blue and red halves
// show), and after the finish the winner's side jumps while the other side
// slumps and shakes its head, through three more uniforms. Under
// prefers-reduced-motion (`uStill` 1) the crowd changes pose but doesn't loop.

export interface CheerUniforms {
  uTime: { value: number };
  uLoud: { value: number };
  /** Which side cheers (0 or 1), -1 none. */
  uCheer: { value: number };
  /** Which side is down (0 or 1), -1 none. */
  uAww: { value: number };
  /** How far into the reaction, 0..1. */
  uReact: { value: number };
  /** 1: hold the pose, no jumping loop. */
  uStill: { value: number };
}

export const cheerUniforms = (): CheerUniforms => ({
  uTime: { value: 0 },
  uLoud: { value: 0 },
  uCheer: { value: -1 },
  uAww: { value: -1 },
  uReact: { value: 0 },
  uStill: { value: 0 },
});

/**
 * One mesh holding every instance of `bodies` and `heads`, in their own
 * colours (a vertex colour each), lit by a flat Lambert material until
 * bakeLighting swaps it. Per vertex, `fan` is (keen, beat, lift): lift is how
 * far it rises with the fan, a little more for a head.
 */
export function mergeFans(bodies: InstancedMesh, heads: InstancedMesh, keen: number[], beat: number[], side: number[] = []): Mesh {
  const parts: { mesh: InstancedMesh; lift: number }[] = [
    { mesh: bodies, lift: 1 },
    { mesh: heads, lift: 1.1 },
  ];
  let total = 0;
  for (const { mesh } of parts) total += (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.getAttribute("position").count) * mesh.count;
  const position = new Float32Array(total * 3);
  const colour = new Float32Array(total * 3);
  const fan = new Float32Array(total * 3);
  const fanSide = new Float32Array(total);
  const m = new Matrix4();
  const v = new Vector3();
  let o = 0;
  for (const { mesh, lift } of parts) {
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const pos = g.getAttribute("position");
    const ic = mesh.instanceColor?.array;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      for (let k = 0; k < pos.count; k++, o++) {
        v.fromBufferAttribute(pos, k).applyMatrix4(m);
        position.set([v.x, v.y, v.z], o * 3);
        colour.set(ic ? [ic[i * 3], ic[i * 3 + 1], ic[i * 3 + 2]] : [1, 1, 1], o * 3);
        fan.set([keen[i], beat[i], lift], o * 3);
        fanSide[o] = side[i] ?? 0;
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colour, 3));
  geometry.setAttribute("fan", new Float32BufferAttribute(fan, 3));
  geometry.setAttribute("fanSide", new Float32BufferAttribute(fanSide, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const mesh = new Mesh(geometry, new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.name = "crowd";
  return mesh;
}

/**
 * Makes `material` bounce its fans: the keen ones (keen below the loudness)
 * jump, the louder the higher and quicker; the rest only stir.
 */
export function cheer(material: Material, uniforms: CheerUniforms): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uLoud = uniforms.uLoud;
    shader.uniforms.uCheer = uniforms.uCheer;
    shader.uniforms.uAww = uniforms.uAww;
    shader.uniforms.uReact = uniforms.uReact;
    shader.uniforms.uStill = uniforms.uStill;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec3 fan;\nattribute float fanSide;\nuniform float uTime;\nuniform float uLoud;\nuniform float uCheer;\nuniform float uAww;\nuniform float uReact;\nuniform float uStill;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        bool down = uReact > 0.0 && abs(fanSide - uAww) < 0.5;
        bool mine = uReact > 0.0 && abs(fanSide - uCheer) < 0.5;
        float loud = down ? 0.0 : (mine ? max(uLoud, uReact) : uLoud);
        float up = fan.x < loud ? 0.12 + 0.28 * loud : 0.025 * loud;
        float beat = uStill > 0.5 ? 0.6 : max(0.0, sin(uTime * (7.0 + 3.0 * loud) + fan.y));
        transformed.y += fan.z * up * beat;
        // the side that lost slumps, the head (lift 1.1) a little further
        if (down) transformed.y -= uReact * (0.06 + (fan.z - 1.0) * 0.8);`,
      );
  };
  material.customProgramCacheKey = () => "track-cheer-sides";
  material.needsUpdate = true;
}
