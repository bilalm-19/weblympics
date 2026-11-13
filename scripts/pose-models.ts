// Local mode (docs/local.md): the camera's two model files, saved in models/
// (never committed) the first time `pnpm local` or `pnpm lan` runs with
// internet, so later runs need none. The runtime that runs them comes with
// `pnpm install` (node_modules/@mediapipe/tasks-vision/wasm).
import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { POSE_MODELS } from "../shared/pose-files.ts";

export const MODELS_DIR = resolve(process.env.POSE_MODELS_DIR ?? "models");

// a real model is megabytes; anything this small is a failed download
const MIN_BYTES = 100_000;
const have = (path: string) => existsSync(path) && statSync(path).size >= MIN_BYTES;

/** Download any model that isn't in models/ yet. True when both are there. */
export async function ensurePoseModels(dir = MODELS_DIR): Promise<boolean> {
  mkdirSync(dir, { recursive: true });
  let ok = true;
  for (const m of Object.values(POSE_MODELS)) {
    const path = join(dir, m.file);
    if (have(path)) continue;
    console.log(`Downloading the camera's model ${m.file} (once; later runs work offline)...`);
    try {
      const res = await fetch(m.url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length < MIN_BYTES) throw new Error("the file is too small");
      writeFileSync(`${path}.part`, body);
      renameSync(`${path}.part`, path);
    } catch (e) {
      ok = false;
      console.warn(`! Couldn't download ${m.file} (${e instanceof Error ? e.message : String(e)}).`);
    }
  }
  if (!ok) console.warn("! The camera won't work until this runs once with internet. Keys and buttons work now.");
  return ok;
}
