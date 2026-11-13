// Task 39, found hosting on Windows (2026-11-13): `pnpm lan` printed three
// "same wifi" addresses with a VirtualBox one (adapter "Ethernet 3") first and
// WSL's last, so friends were sent to an address they can't reach. Only the
// address on the default route is offered; the others are listed as a fallback.
import { describe, expect, it } from "vitest";
import { ipv4Addresses, primaryAddress, splitAddresses } from "../server/lan-urls.ts";

describe("LAN address to share", () => {
  const all = ["192.168.56.1", "192.168.1.110", "172.21.144.1"];

  it("offers only the default-route address when it's known", () => {
    expect(splitAddresses(all, "192.168.1.110")).toEqual({ share: ["192.168.1.110"], others: ["192.168.56.1", "172.21.144.1"] });
  });

  it("offers every address when the route is unknown or not one of ours", () => {
    expect(splitAddresses(all, null)).toEqual({ share: all, others: [] });
    expect(splitAddresses(all, "10.9.9.9")).toEqual({ share: all, others: [] });
  });

  it("the default-route address, when there is one, is one of this computer's", async () => {
    const p = await primaryAddress();
    if (p !== null) expect(ipv4Addresses()).toContain(p);
  });
});
