#!/usr/bin/env node
// `pnpm local` (docs/local.md): Weblympics on this computer alone, with no
// internet needed after the first run. Play against the bots, with the camera
// or keys. It listens on 127.0.0.1 only, so no other device can connect and
// there is no firewall prompt, and http://localhost is a secure page, so the
// camera works with no certificate. This server serves the pose runtime and
// models itself, and the page may talk to nothing else.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ensurePoseModels } from "./pose-models.ts";

if (!existsSync(resolve("dist/client/index.html"))) {
  console.error("The client isn't built. Run `pnpm local` (it builds first), or `pnpm build` then this script.");
  process.exit(1);
}

await ensurePoseModels();

process.env.POSE_FILES = "local";
process.env.HOST ??= "127.0.0.1";
process.env.PORT ??= "8080";
await import("../server/index.ts");
