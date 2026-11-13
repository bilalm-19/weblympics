# Wifi multiplayer (`pnpm lan`, opt-in)

Task 39. An extra, and the one that takes some setup: one computer runs the
game and other devices on the same wifi open it in their browser. For one
computer on its own, [`pnpm local`](local.md) is simpler: no certificate, no
warning, no internet. Nothing changes about how the game works: the host's
server owns the ball and the score, and accounts, friends, looks and match
history are saved in `data/app.db` on it.

## Read this first

- **Every device shows a security warning once**, the host included ("Your
  connection is not private"), and the address bar says "Not secure" after.
  The connection is encrypted, but nothing proves which computer is at that
  address (see below). People who don't expect it may stop there, so tell
  them first. For a demo to someone new, `pnpm local` on one computer shows no warning.
- **Accounts are recovery codes, not passkeys** (below).
- **The host's firewall decides who can connect**, and Windows asks once.
  Allow it on Private networks only.

## Start it

On the computer that will host:

```bash
pnpm install
pnpm lan
```

It builds the client, makes a certificate the first time, and prints where to
go:

```
Weblympics is on your network. Open on this computer: https://localhost:8443
  On another device on the same wifi: https://192.168.1.20:8443
```

Everyone else opens the second address. The host computer has to stay on,
with `pnpm lan` running, for anyone to play. `PORT` and `DATA_DIR` work as
they do for `pnpm start`.

## Why https, and the certificate

A browser only lets a page use the webcam over https (or on `localhost`), and
the other devices reach the host by its IP address, so the server serves
https itself. On the hosted site the hosting service does this, which is why the normal
app never needs a certificate.

`pnpm lan` makes the certificate itself (`scripts/lan-cert.ts`, nothing to
install) in `certs/`, never committed, for `localhost` and this computer's
current addresses, and makes a new one when an address changes. Each person
who hosts gets their own; players never need one.

It is **self-signed**: no company vouches for it, so every device, the host
included, shows a "connection isn't private" warning the first time. Choose
Advanced (Safari: Show Details), then continue; the camera works after that.
The warning is honest, and the address bar keeps saying "Not secure": the
connection is encrypted, but nothing proves which computer is at that
address. Only tap through it for this game, on this wifi.

It is **anonymous**: its only name is "Weblympics LAN", plus the addresses it
covers. It used to come from mkcert, which writes the host's username,
computer name and full name into it for any player to read
(`spec/lan-cert.test.ts`). If you ran an older `pnpm lan` with mkcert
installed, the next run replaces that certificate; to stop trusting mkcert's
root on your computer too, run `mkcert -uninstall`. Don't install a root
certificate on players' devices: it would let the host vouch for any website
there.

Give the host a fixed address in your router (a DHCP reservation), or the
address, and so the certificate, changes now and then.

## Setting up the host

Run the host on Windows or macOS directly. No port forwarding is needed on
either, in the router or anywhere else: the server listens on the computer's
own wifi address, and everyone is on the same network. (Router port
forwarding is only for letting people in from the internet.)

### Windows

1. Install Node 24 and pnpm on Windows itself, not inside WSL. With mise,
   `mise install` in the repo picks the pinned versions.
2. Run `pnpm lan`. The first time, Windows asks whether to let Node through
   the firewall: tick **Private networks** and allow it.
3. Check the wifi's network profile is **Private** (Settings, Network &
   internet, Wi-Fi, your network). On a Public profile Windows blocks
   incoming connections even after Node is allowed; this is the commonest
   reason friends can't connect. (Ticking **Public** at the firewall prompt
   also lets them in, but then Node accepts connections on any public wifi,
   such as a cafe's. Change it under Windows Security, Firewall, "Allow an
   app through firewall", Node.js.)
4. `pnpm lan` prints one address to share. If the computer also has VM or
   WSL adapters, their addresses are listed in brackets after it; others
   can't reach those, so only try them if the first fails.

Windows sleeps after a while on battery; keep it plugged in, or change the
sleep setting, while hosting.

### macOS

1. Install Node 24 and pnpm (`mise install`, or Homebrew).
2. Run `caffeinate -i pnpm lan`. `caffeinate` keeps the Mac awake for as long
   as the server runs; the game drops if it sleeps.
3. If the macOS firewall is on, a pop-up asks whether "node" may accept
   incoming connections: choose **Allow**. If the firewall is off there's no
   pop-up and nothing to do.

### WSL (not recommended)

The server runs inside WSL's own virtual network, which other devices can't
see. Run `pnpm lan` from Windows instead (above). If you must use WSL,
forward the port from an admin PowerShell, `netsh interface portproxy add
v4tov4 listenport=8443 listenaddress=0.0.0.0 connectport=8443
connectaddress=<WSL IP>`, allow port 8443 in the Windows firewall, and give
friends the Windows computer's wifi address, not the one `pnpm lan` prints.

## If others can't connect

1. Open the printed `https://192.168…:8443` address on the host computer
   itself. If that fails, the server isn't running or the address changed:
   restart `pnpm lan` and use the address it prints now.
2. If it works on the host but not on another device, it's the host's
   firewall: on Windows, the Private profile and Node's firewall rule; on a
   Mac, the "Allow" for node (System Settings, Network, Firewall, Options).
3. Check both devices are on the same wifi, not one on a guest network or
   mobile data.
4. Guest or "client isolation" wifi (some hotels, cafes and campuses) stops
   devices seeing each other at all. Use a home network or a phone hotspot.

## Accounts on a LAN

Passkeys can't work here: a passkey belongs to a domain name, and the game is
reached by IP address. So LAN mode replaces them (only when `pnpm lan` runs;
the hosted app is unchanged, see [accounts.md](accounts.md#lan-mode-local-accounts)):

- **Create account** in the profile makes the guest an account in one click.
  Names, looks and friends then work exactly as with a passkey, and friends
  see each other online, away or offline.
- The account gets a **recovery code** such as `K7QM-4XTR-9PDW-H2NC`, shown
  once. Save it. It signs you in on another browser or device ("Sign in with
  its recovery code" in the profile), and it is the only way back if this
  browser's cookies are cleared or you sign out. "Make a new recovery code"
  replaces it; the old one stops working.
- Deleting the account asks for the code.

## Moving or backing up

Everything that lasts is `data/app.db` (with its `-wal` and `-shm` files while
the server runs). Stop the server and copy the `data/` folder to keep a
backup or to host from another computer.

## Without internet

Like `pnpm local`, `pnpm lan` serves the camera's runtime and models
itself (see [local.md](local.md)): the host needs internet once, to download
the models into `models/`, and after that a wifi with no internet works.
