// Task 39: which address to tell other devices to open. A computer often has
// more IPv4 addresses than its wifi one (VirtualBox, WSL / Hyper-V, Docker,
// VPNs), and on Windows a VM adapter can be called "Ethernet 3", so names don't
// tell them apart. The address the OS would route the internet through is the
// wifi (or wired) one; a UDP connect picks it without sending a packet.
import { createSocket } from "node:dgram";
import { networkInterfaces } from "node:os";

/** This computer's non-internal IPv4 addresses. */
export function ipv4Addresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => a!.address);
}

/** The local address on the default route, or null with no route (offline). */
export function primaryAddress(): Promise<string | null> {
  return new Promise((done) => {
    const s = createSocket("udp4");
    const finish = (addr: string | null) => {
      s.close();
      done(addr);
    };
    s.on("error", () => finish(null));
    // any routable address works: connect only looks up the route
    s.connect(53, "192.0.2.1", () => {
      try {
        const a = s.address().address;
        finish(a === "0.0.0.0" ? null : a);
      } catch {
        finish(null);
      }
    });
  });
}

/** The address to share first, then the rest; all of them when the primary is unknown. */
export function splitAddresses(all: string[], primary: string | null): { share: string[]; others: string[] } {
  if (!primary || !all.includes(primary)) return { share: all, others: [] };
  return { share: [primary], others: all.filter((a) => a !== primary) };
}
