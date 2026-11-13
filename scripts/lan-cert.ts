// Task 39: the certificate `pnpm lan` serves https with. Browsers only give a
// page the webcam over https (or on localhost), and other devices reach the
// host by its IP address, so the host needs a certificate for its addresses.
//
// It is self-signed and anonymous: its only name is "Weblympics LAN", plus the
// addresses it covers (which players have already typed). mkcert, used before
// (2026-11-13), wrote the host's Windows username, computer name and full name
// into every certificate, where any player could read them via "view
// certificate". Browsers warn once about a self-signed certificate whatever it
// says, so a name in it proved nothing anyway (spec/lan-cert.test.ts).
import { generate } from "selfsigned";

/** Changes when the way certificates are made changes, so old ones are remade. */
export const CERT_MAKER = "weblympics-anonymous-1";
export const CERT_NAME = "Weblympics LAN";

const isIp = (n: string) => /^[\d.]+$/.test(n) || n.includes(":");

/** A self-signed certificate and its private key (PEM) for these host names and IP addresses. */
export async function makeLanCert(names: string[]): Promise<{ cert: string; key: string }> {
  const now = new Date();
  const notAfter = new Date(now);
  notAfter.setDate(notAfter.getDate() + 825);
  const pems = await generate([{ name: "commonName", value: CERT_NAME }], {
    keyType: "ec",
    curve: "P-256",
    algorithm: "sha256",
    notBeforeDate: now,
    notAfterDate: notAfter,
    extensions: [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, critical: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames: names.map((n) => (isIp(n) ? { type: 7 as const, ip: n } : { type: 2 as const, value: n })) },
    ],
  });
  return { cert: pems.cert, key: pems.private };
}
