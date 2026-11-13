// Local mode (`pnpm local`, `pnpm lan`; docs/local.md, user 2026-11-13): this
// server serves the pose runtime and models itself, so the camera works with
// no internet, and the page may then talk to this server alone. The normal
// app (Fly) is unchanged: models from their public hosts, as spec/privacy.test.ts
// checks against the running app. Private servers here, one each way.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ipv4Addresses } from "../server/lan-urls.ts";
import { ensurePoseModels } from "../scripts/pose-models.ts";
import { LOCAL_POSE_META, LOCAL_POSE_PATH, POSE_MODELS, poseSources } from "../shared/pose-files.ts";

const dirs: string[] = [];
const tmp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), `weblympics-${p}-`));
  dirs.push(d);
  return d;
};

interface Server {
  child: ChildProcess;
  base: string;
  out: string;
}
const servers: Server[] = [];

async function start(env: Record<string, string>, port: number): Promise<Server> {
  const s: Server = { child: null as unknown as ChildProcess, base: `http://localhost:${port}`, out: "" };
  // none of the modes' settings leak in from the shell that runs the spec
  const base: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), DATA_DIR: tmp("local-data") };
  for (const k of ["POSE_FILES", "POSE_MODELS_DIR", "HOST", "TLS_CERT", "TLS_KEY", "LAN_ACCOUNTS"]) delete base[k];
  // its own tiny client, so this needs no `pnpm build` (CI builds only inside
  // the Docker image, and the first push failed here on "client is not built")
  base.CLIENT_DIR = client;
  s.child = spawn(process.execPath, ["server/index.ts"], { env: { ...base, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  s.child.stdout!.on("data", (d) => (s.out += d.toString()));
  s.child.stderr!.on("data", (d) => (s.out += d.toString()));
  servers.push(s);
  const deadline = Date.now() + 60_000;
  while (!s.out.includes('"listening"')) {
    if (Date.now() > deadline || s.child.exitCode !== null) throw new Error(`server didn't start:\n${s.out}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return s;
}

let client = "";
let local: Server;
let normal: Server;
const fakeModel = "a fake pose model, served as it is";

beforeAll(async () => {
  client = tmp("client");
  writeFileSync(join(client, "index.html"), "<!doctype html><html><head><title>Weblympics</title></head><body></body></html>");
  const models = tmp("models");
  writeFileSync(join(models, POSE_MODELS.pose.file), fakeModel);
  const port = 20000 + Math.floor(Math.random() * 20000);
  local = await start({ POSE_FILES: "local", POSE_MODELS_DIR: models, HOST: "127.0.0.1" }, port);
  normal = await start({}, port + 1);
}, 120_000);

afterAll(async () => {
  for (const s of servers) {
    if (s.child.exitCode === null) await new Promise((r) => { s.child.once("exit", r); s.child.kill(); });
  }
  for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const connectSrc = (res: Response) => res.headers.get("content-security-policy")?.match(/connect-src ([^;]+)/)?.[1].trim().split(/\s+/);

describe("local mode (pnpm local)", () => {
  it("tells the page to load the pose files from here, and lets it connect to nothing else", async () => {
    const res = await fetch(local.base + "/");
    const html = await res.text();
    expect(html).toContain(`<meta name="${LOCAL_POSE_META}" content="${LOCAL_POSE_PATH}">`);
    expect(connectSrc(res)).toEqual(["'self'"]);
  });

  it("serves the runtime from node_modules, as wasm, and the models from models/", async () => {
    const wasm = await fetch(`${local.base}${LOCAL_POSE_PATH}/wasm/vision_wasm_internal.wasm`);
    expect(wasm.status).toBe(200);
    expect(wasm.headers.get("content-type")).toBe("application/wasm");
    expect(wasm.headers.get("cache-control")).toContain("immutable");
    const js = await fetch(`${local.base}${LOCAL_POSE_PATH}/wasm/vision_wasm_internal.js`);
    expect(js.status).toBe(200);
    const model = await fetch(`${local.base}${LOCAL_POSE_PATH}/models/${POSE_MODELS.pose.file}`);
    expect(model.status).toBe(200);
    expect(await model.text()).toBe(fakeModel);
  });

  it("serves nothing else under the pose path, and nothing outside its folders", async () => {
    for (const p of [`/models/${POSE_MODELS.hand.file}`, "/models/", "/other/x", "/wasm/%2e%2e%2f%2e%2e%2fpackage.json", "/models/%2e%2e%2f%2e%2e%2f%2e%2e%2fpackage.json"]) {
      expect((await fetch(local.base + LOCAL_POSE_PATH + p)).status, p).toBe(404);
    }
  });

  it("listens on this computer only", async () => {
    const lan = ipv4Addresses()[0];
    if (!lan) return; // no network here: nothing to try from
    const port = new URL(local.base).port;
    await expect(fetch(`http://${lan}:${port}/`, { signal: AbortSignal.timeout(3000) })).rejects.toThrow();
  });
});

describe("the normal app is unchanged", () => {
  it("has no local pose files and keeps the public hosts", async () => {
    const res = await fetch(normal.base + "/");
    expect(await res.text()).not.toContain(LOCAL_POSE_META);
    expect(connectSrc(res)).toEqual(["'self'", "https://cdn.jsdelivr.net", "https://storage.googleapis.com"]);
    expect((await fetch(`${normal.base}${LOCAL_POSE_PATH}/wasm/vision_wasm_internal.wasm`)).status).toBe(404);
  });
});

describe("where the client loads the pose files from", () => {
  it("this server in local mode, the public hosts otherwise", () => {
    expect(poseSources({ origin: "http://localhost:8080", path: LOCAL_POSE_PATH })).toEqual({
      wasm: "http://localhost:8080/pose/wasm",
      pose: `http://localhost:8080/pose/models/${POSE_MODELS.pose.file}`,
      hand: `http://localhost:8080/pose/models/${POSE_MODELS.hand.file}`,
    });
    const pub = poseSources(null);
    expect(new URL(pub.wasm).host).toBe("cdn.jsdelivr.net");
    expect(new URL(pub.pose).host).toBe("storage.googleapis.com");
    expect(new URL(pub.hand).host).toBe("storage.googleapis.com");
  });

  it("the runtime version is the installed one", () => {
    const installed = JSON.parse(readFileSync("node_modules/@mediapipe/tasks-vision/package.json", "utf8")) as { version: string };
    expect(poseSources(null).wasm).toContain(`@${installed.version}/`);
  });
});

describe("downloading the models once (scripts/pose-models.ts)", () => {
  afterAll(() => vi.unstubAllGlobals());

  it("saves each missing model, skips one already there, and keeps nothing from a failed download", async () => {
    const dir = tmp("models-dl");
    writeFileSync(join(dir, POSE_MODELS.pose.file), Buffer.alloc(200_000, 1));
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      return new Response(Buffer.alloc(300_000, 2));
    });
    expect(await ensurePoseModels(dir)).toBe(true);
    expect(asked).toEqual([POSE_MODELS.hand.url]);
    expect(readFileSync(join(dir, POSE_MODELS.hand.file)).length).toBe(300_000);

    const empty = tmp("models-fail");
    vi.stubGlobal("fetch", async () => new Response("<html>an error page</html>"));
    expect(await ensurePoseModels(empty)).toBe(false);
    expect(existsSync(join(empty, POSE_MODELS.pose.file))).toBe(false);
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    expect(await ensurePoseModels(empty)).toBe(false);
    expect(existsSync(join(empty, POSE_MODELS.hand.file))).toBe(false);
  });
});
