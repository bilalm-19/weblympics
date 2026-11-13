// Task 39 (2026-11-13): the LAN certificate names nobody. mkcert put the host's
// Windows username, computer name and full name in its subject and issuer
// ("OU=LAPTOP-…\bilal@LAPTOP-… (Full Name)"), readable by every player via
// "view certificate". scripts/lan-cert.ts makes it with "Weblympics LAN" alone.
import { X509Certificate, createPrivateKey } from "node:crypto";
import { hostname, userInfo } from "node:os";
import { beforeAll, describe, expect, it } from "vitest";
import { CERT_NAME, makeLanCert } from "../scripts/lan-cert.ts";

const names = ["localhost", "127.0.0.1", "::1", "192.168.1.110", "10.0.0.7"];
let x509: X509Certificate;
let key: string;

beforeAll(async () => {
  const made = await makeLanCert(names);
  x509 = new X509Certificate(made.cert);
  key = made.key;
});

describe("the LAN certificate (pnpm lan)", () => {
  it("is self-signed and its only name is Weblympics LAN: no organisation, unit or person", () => {
    expect(x509.subject).toBe(`CN=${CERT_NAME}`);
    expect(x509.issuer).toBe(`CN=${CERT_NAME}`);
  });

  it("carries nothing about this computer or its user beyond the addresses it covers", () => {
    const text = [x509.subject, x509.issuer, x509.subjectAltName ?? "", x509.infoAccess ?? ""].join("\n").toLowerCase();
    for (const s of [userInfo().username, hostname(), "mkcert"]) expect(text).not.toContain(s.toLowerCase());
  });

  it("covers localhost and every address, and nothing else", () => {
    expect(x509.checkHost("localhost")).toBe("localhost");
    for (const ip of ["127.0.0.1", "192.168.1.110", "10.0.0.7"]) expect(x509.checkIP(ip)).toBe(ip);
    expect(x509.checkIP("192.168.1.111")).toBeUndefined();
    expect(x509.checkHost("example.com")).toBeUndefined();
  });

  it("is for a server, not a certificate authority, and the key is its own", () => {
    expect(x509.ca).toBe(false);
    expect(x509.checkPrivateKey(createPrivateKey(key))).toBe(true);
    expect(new Date(x509.validTo).getTime()).toBeGreaterThan(Date.now() + 365 * 24 * 3600 * 1000);
  });
});
