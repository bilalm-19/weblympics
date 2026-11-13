#!/usr/bin/env node
// Task 39: `pnpm lan` runs Weblympics for everyone on the same wifi.
//
// A webcam only works on a secure page (https, or localhost), and the other
// devices reach this one by its IP address, so the server has to serve https
// itself. This script makes a certificate for this computer's addresses the
// first time (and again when an address changes), then starts the server with
// it and with LAN mode's local accounts on. Everything else is the normal app:
// the database is ./data/app.db (DATA_DIR overrides), live games are in memory.
//
// The certificate is self-signed and anonymous (scripts/lan-cert.ts): every
// device, this one included, shows a browser warning once. It needs no
// mkcert or openssl, so the same command works on Windows and macOS.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ipv4Addresses } from "../server/lan-urls.ts";
import { CERT_MAKER, makeLanCert } from "./lan-cert.ts";
import { ensurePoseModels } from "./pose-models.ts";

const CERT_DIR = resolve("certs");
const CERT = join(CERT_DIR, "lan.pem");
const KEY = join(CERT_DIR, "lan-key.pem");
const MADE = join(CERT_DIR, "lan-names.json");

if (!existsSync(resolve("dist/client/index.html"))) {
  console.error("The client isn't built. Run `pnpm lan` (it builds first), or `pnpm build` then this script.");
  process.exit(1);
}

const addresses = ipv4Addresses();
if (addresses.length === 0) console.warn("! No network address found: only this computer can play. Is the wifi on?");
const names = ["localhost", "127.0.0.1", "::1", ...addresses];

/** The certificate there covers every name and was made the current way (not by mkcert, as before). */
const current = (): boolean => {
  if (!existsSync(CERT) || !existsSync(KEY) || !existsSync(MADE)) return false;
  try {
    const made = JSON.parse(readFileSync(MADE, "utf8")) as { maker?: string; names?: string[] };
    return made.maker === CERT_MAKER && names.every((n) => made.names?.includes(n));
  } catch {
    return false;
  }
};

if (!current()) {
  mkdirSync(CERT_DIR, { recursive: true });
  console.log("Making a certificate for:", names.join(", "));
  console.log("Each device shows a browser warning the first time: choose Advanced (or Show Details), then continue.");
  const { cert, key } = await makeLanCert(names);
  writeFileSync(CERT, cert);
  writeFileSync(KEY, key, { mode: 0o600 });
  writeFileSync(MADE, JSON.stringify({ maker: CERT_MAKER, names }));
}

// the camera's model files are served from here too, so a wifi with no
// internet works after the first run (docs/local.md)
await ensurePoseModels();
process.env.POSE_FILES = "local";
process.env.TLS_CERT = CERT;
process.env.TLS_KEY = KEY;
process.env.LAN_ACCOUNTS = "1";
process.env.PORT ??= "8443";
await import("../server/index.ts");
