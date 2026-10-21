// A software passkey authenticator for tests (task 17): makes real ES256
// keys and answers registration and sign-in the way a browser would, so the
// server's @simplewebauthn checks run for real. Not a *.test.ts file, so
// vitest only runs it through the tests that import it.
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import type { KeyObject } from "node:crypto";

const b64u = (b: Uint8Array | Buffer): string => Buffer.from(b).toString("base64url");
const sha256 = (b: Uint8Array | string): Buffer => createHash("sha256").update(b).digest();

// just enough CBOR for an attestation object and a COSE key
function cbor(v: unknown): Buffer {
  const head = (major: number, n: number): Buffer => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(n, 1);
    return b;
  };
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error("cbor: unsupported value");
}

export interface SoftCredential {
  id: Buffer;
  privateKey: KeyObject;
  userHandle: string;
  counter: number;
}

export class SoftAuthenticator {
  credentials: SoftCredential[] = [];
  origin: string;
  constructor(origin: string) {
    this.origin = origin;
  }

  private clientData(type: string, challenge: string): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }));
  }

  /** Answers navigator.credentials.create() for the server's options. */
  register(options: { challenge: string; rp: { id?: string }; user: { id: string } }): Record<string, unknown> {
    const rpId = options.rp.id ?? new URL(this.origin).hostname;
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = publicKey.export({ format: "jwk" });
    const id = randomBytes(16);
    const cose = cbor(
      new Map<number, unknown>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x!, "base64url")],
        [-3, Buffer.from(jwk.y!, "base64url")],
      ]),
    );
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(id.length);
    // flags: user present, user verified, attested credential data
    const authData = Buffer.concat([sha256(rpId), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), idLen, id, cose]);
    const attestationObject = cbor(
      new Map<string, unknown>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]),
    );
    this.credentials.push({ id, privateKey, userHandle: options.user.id, counter: 0 });
    return {
      id: b64u(id),
      rawId: b64u(id),
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64u(this.clientData("webauthn.create", options.challenge)),
        attestationObject: b64u(attestationObject),
        transports: ["internal"],
      },
    };
  }

  /** Answers navigator.credentials.get(): signs with `cred` (default the first). */
  authenticate(options: { challenge: string; rpId?: string }, cred = this.credentials[0]): Record<string, unknown> {
    const rpId = options.rpId ?? new URL(this.origin).hostname;
    cred.counter++;
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(cred.counter);
    const authData = Buffer.concat([sha256(rpId), Buffer.from([0x05]), counter]);
    const clientDataJSON = this.clientData("webauthn.get", options.challenge);
    const signature = sign("sha256", Buffer.concat([authData, sha256(clientDataJSON)]), cred.privateKey);
    return {
      id: b64u(cred.id),
      rawId: b64u(cred.id),
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64u(clientDataJSON),
        authenticatorData: b64u(authData),
        signature: b64u(signature),
        userHandle: cred.userHandle,
      },
    };
  }
}
