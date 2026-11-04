import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { marked } from "marked";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import { parseClientMsg } from "../shared/protocol.ts";
import type { IncomingMessage } from "node:http";
import { guestFor, lookOf, newGuestToken } from "./accounts.ts";
import type { Player } from "./accounts.ts";
import { GUEST_COOKIE, createAuth, identify } from "./auth.ts";
import { db, matchCountFor } from "./db.ts";
import { allowedOrigin, cookie } from "./guard.ts";
import { log, who } from "./log.ts";
import { PING_MS, createRoom, getRoom, leaveRoom, onPong, roomCount, roomStats, send, sendPing } from "./rooms.ts";
import type { Client } from "./rooms.ts";

const PORT = Number(process.env.PORT ?? 8080);
const CLIENT_DIR = resolve("dist/client");
const DOCS_DIR = resolve("docs");
const HEARTBEAT_MS = 25_000;
// fly.toml gives the machine 256 MB
const MEMORY_LIMIT_MB = 256;
const STARTED = Date.now();

// Task 8: anything that would otherwise crash the server silently is logged
// first (message only: a stack can carry request data).
process.on("uncaughtException", (e) => {
  log("error", { where: "uncaught", message: e.message });
  process.exit(1);
});
process.on("unhandledRejection", (e) => log("error", { where: "unhandledRejection", message: e instanceof Error ? e.message : String(e) }));

// The game page may only talk to this server and fetch the pose model and its
// runtime. That keeps the promise that video never leaves the browser, and
// blocks the usage pings MediaPipe sends to Google on its own.
const CONNECT_SRC = ["'self'", "https://cdn.jsdelivr.net", "https://storage.googleapis.com"];
const CSP = `connect-src ${CONNECT_SRC.join(" ")}`;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
};

const readmeHtml = `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>README</title>
<style>
  body { margin: 0; font: 1rem/1.6 system-ui, sans-serif; background: #0f1720; color: #e6edf3; }
  main { max-width: 42rem; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
  a { color: #7cc4ff; }
  img { max-width: 100%; height: auto; }
  pre, code { background: #1b2733; border-radius: 4px; }
  pre { padding: 0.75rem; overflow-x: auto; }
  code { padding: 0.1rem 0.3rem; }
</style>
</head>
<body>
<main>
<p><a href="/">&larr; Back to the game</a></p>
${marked.parse(readFileSync("README.md", "utf8"), { async: false })}
</main>
</body>
</html>`;

async function serveFile(res: ServerResponse, root: string, relPath: string, immutable = false): Promise<boolean> {
  const full = normalize(join(root, relPath));
  if (full !== root && !full.startsWith(root + sep)) return false;
  try {
    const body = await readFile(full);
    res.writeHead(200, {
      "content-type": MIME[extname(full)] ?? "application/octet-stream",
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      ...(extname(full) === ".html" ? { "content-security-policy": CSP } : {}),
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

// every live socket per player, so deleting an account can drop them
const sockets = new Map<string, Set<WebSocket>>();
const auth = createAuth({
  db,
  log,
  onGone: (token) => {
    for (const ws of sockets.get(token) ?? []) ws.close(4001, "account deleted");
  },
});

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end("bad request");
    return;
  }

  if (path === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: roomCount() }));
    return;
  }
  if (path === "/stats") {
    // task 8: what the app is doing, for a quick look in production; counts
    // only, nothing about who
    const mem = process.memoryUsage();
    const mb = (n: number) => Math.round((n / 1024 / 1024) * 10) / 10;
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(
      JSON.stringify({
        uptimeSeconds: Math.round((Date.now() - STARTED) / 1000),
        connections: wss.clients.size,
        playersOnline: sockets.size,
        ...roomStats(),
        memory: { rssMb: mb(mem.rss), heapUsedMb: mb(mem.heapUsed), limitMb: MEMORY_LIMIT_MB, usedPercent: Math.round((mem.rss / (MEMORY_LIMIT_MB * 1024 * 1024)) * 100) },
      }),
    );
    return;
  }
  if (path.startsWith("/api/")) {
    try {
      await auth(req, res, path);
    } catch (e) {
      log("error", { where: "api", path, message: e instanceof Error ? e.message : String(e) });
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" }).end('{"error":"Something went wrong."}');
    }
    return;
  }
  if (path === "/readme") {
    res.writeHead(301, { location: "/readme/" });
    res.end();
    return;
  }
  if (path === "/readme/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(readmeHtml);
    return;
  }
  if (path.startsWith("/readme/docs/")) {
    if (await serveFile(res, DOCS_DIR, path.slice("/readme/docs/".length))) return;
    res.writeHead(404).end("not found");
    return;
  }

  const immutable = path.startsWith("/assets/");
  if (path !== "/" && (await serveFile(res, CLIENT_DIR, path, immutable))) return;
  if (extname(path) === "" && (await serveFile(res, CLIENT_DIR, "index.html"))) return;
  if (path === "/") {
    res.writeHead(503, { "content-type": "text/plain" }).end("client is not built: run `pnpm build`");
    return;
  }
  res.writeHead(404).end("not found");
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

// who each upgrade is, decided from its cookies before the socket opens; a
// browser with no guest cookie yet gets one in the 101 response
const upgrading = new WeakMap<IncomingMessage, { player: Player; setCookie?: string }>();
wss.on("headers", (headers, req) => {
  const set = upgrading.get(req)?.setCookie;
  if (set) headers.push(`Set-Cookie: ${set}`);
});

http.on("upgrade", (req, socket, head) => {
  if (new URL(req.url ?? "/", "http://localhost").pathname !== "/ws") {
    socket.destroy();
    return;
  }
  // a browser always sends its page's Origin: another site's page may not
  // open a socket that would carry this site's cookies
  if (req.headers.origin !== undefined && !allowedOrigin(req.headers.origin, req.headers.host)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  let player = identify(db, req);
  let setCookie: string | undefined;
  if (!player) {
    player = guestFor(db, newGuestToken())!;
    setCookie = cookie(GUEST_COOKIE, player.token, 400 * 24 * 60 * 60, req.headers.host);
  }
  upgrading.set(req, { player, setCookie });
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

const alive = new WeakSet<WebSocket>();

/** A short word for a WebSocket close code, for the disconnect log. */
function closeReason(code: number): string {
  if (code === 1000) return "closed";
  if (code === 1001) return "page left";
  if (code === 1005) return "no status";
  if (code === 1006) return "connection lost";
  return `code ${code}`;
}

wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
  alive.add(ws);
  ws.on("pong", () => alive.add(ws));

  const player = upgrading.get(req)!.player;
  const opened = Date.now();
  const id = who(player.token);
  // a second socket for someone already connected is them coming back (a reload, a dropped network)
  log("connect", { who: id, account: player.account, again: sockets.has(player.token) });
  const mine = sockets.get(player.token) ?? new Set<WebSocket>();
  mine.add(ws);
  sockets.set(player.token, mine);
  const client: Client = {
    ws,
    token: player.token,
    name: player.name,
    account: player.account,
    look: lookOf(db, player.token),
    room: null,
    seat: null,
    rtt: null,
    pings: 0,
    outstanding: null,
  };
  let hello = false;
  const pinger = setInterval(() => sendPing(client), PING_MS);

  ws.on("message", (data) => {
    const msg = parseClientMsg(data.toString());
    if (!msg) {
      log("bad_message", { who: id, bytes: data.toString().length });
      send(client, { t: "error", message: "bad message" });
      return;
    }
    if (msg.t === "hello") {
      // who this is was settled from the cookies when the socket opened; the
      // client never says who it is (task 17)
      hello = true;
      send(client, { t: "welcome", name: player.name, account: player.account, demo: player.demo, matches: matchCountFor(player.token) });
      log("hello", { who: id, account: player.account });
      sendPing(client);
      return;
    }
    if (msg.t === "pong") {
      onPong(client, msg.id);
      return;
    }
    if (!hello) {
      send(client, { t: "error", message: "say hello first" });
      return;
    }
    switch (msg.t) {
      case "create": {
        leaveRoom(client);
        const room = createRoom(msg.game, msg.practice, msg.format);
        if (!room) send(client, { t: "error", message: "unknown game" });
        else room.join(client);
        break;
      }
      case "join": {
        const room = getRoom(msg.room);
        if (!room) {
          send(client, { t: "error", message: "room not found" });
          break;
        }
        if (client.room !== room) {
          // task 24: the 11th watcher is turned away before leaving anything
          const refused = room.refusal(client, msg.watch === true);
          if (refused) {
            log("join_refused", { who: id, room: room.id, reason: "watchers full" });
            send(client, { t: "error", message: refused });
            break;
          }
          leaveRoom(client);
          room.join(client, msg.watch === true);
        }
        break;
      }
      case "ready":
        client.room?.ready(client, msg.ready);
        break;
      case "format": {
        // null means accepted; only a missing room is "not in a room" (null ?? x would turn success into an error)
        const refused = client.room ? client.room.format(client, msg.format) : "not in a room";
        if (refused) send(client, { t: "error", message: refused });
        break;
      }
      case "rated": {
        const refused = client.room ? client.room.setRated(client, msg.rated) : "not in a room";
        if (refused) send(client, { t: "error", message: refused });
        break;
      }
      case "swing":
        client.room?.swing(client, msg);
        break;
      case "move":
        client.room?.move(client, msg.x);
        break;
      case "aim":
      case "release":
        client.room?.aim(client, msg);
        break;
      case "step":
        client.room?.step(client, msg);
        break;
      case "mode":
        client.room?.mode(client, msg.mode);
        break;
      case "pause":
        client.room?.pause(client, msg.paused);
        break;
      case "leave":
        leaveRoom(client);
        break;
    }
  });

  ws.on("close", (code, reason) => {
    clearInterval(pinger);
    log("disconnect", { who: id, code, reason: reason.toString().slice(0, 60) || closeReason(code), seconds: Math.round((Date.now() - opened) / 1000), room: client.room?.id ?? null });
    mine.delete(ws);
    if (mine.size === 0) sockets.delete(player.token);
    // a dropped connection mid-match holds the seat for 30 s (task 4)
    leaveRoom(client, true);
  });
  ws.on("error", (e) => {
    log("error", { where: "ws", who: id, message: e.message });
    ws.terminate();
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.has(ws)) {
      log("heartbeat_timeout", {});
      ws.terminate();
      continue;
    }
    alive.delete(ws);
    ws.ping();
  }
}, HEARTBEAT_MS).unref();

http.listen(PORT, "0.0.0.0", () => log("listening", { port: PORT }));
