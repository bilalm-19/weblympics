import type { ClientMsg, ServerMsg, ShownStatus } from "../../shared/protocol.ts";
import type { Look } from "../../shared/look.ts";
import { fetchMe } from "./account.ts";

const MAX_QUEUE = 20;
/** Task 34: a tab with no input this long (or hidden) counts as away. */
export const IDLE_MS = 5 * 60_000;
const STATUS_KEY = "wl-status";

/** The player's own "show me as" (task 34), kept in this browser only. */
export function shownStatus(): ShownStatus {
  try {
    const v = localStorage.getItem(STATUS_KEY);
    return v === "away" || v === "offline" ? v : "online";
  } catch {
    return "online";
  }
}

export function rememberStatus(status: ShownStatus): void {
  try {
    if (status === "online") localStorage.removeItem(STATUS_KEY);
    else localStorage.setItem(STATUS_KEY, status);
  } catch {
    // private mode: the choice lasts this session only
  }
}

export class Connection {
  name = "";
  matches = 0;
  /** Signed in with a passkey, or as a demo account; false for a guest. */
  account = false;
  /** Which of the two locked demo accounts, if one. */
  demo = false;
  /** The account's saved look (task 18); null for a guest or the default. */
  look: Look | null = null;
  /** Task 34: an account's four-digit tag ("0317"); null for a guest. */
  tag: string | null = null;
  roomCode: string | null = null;
  /** Task 24: the room was joined by its watch link, so a reconnect watches again rather than taking a free seat. */
  roomWatch = false;
  private ws: WebSocket | null = null;
  private open = false;
  private queue: ClientMsg[] = [];
  private handlers = new Set<(msg: ServerMsg) => void>();

  constructor() {
    // who this is lives in HttpOnly cookies (task 17); /api/me makes sure a
    // first visit has its guest cookie before the socket opens
    void fetchMe()
      .catch(() => null)
      .then(() => this.connect());
  }

  on(handler: (msg: ServerMsg) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  send(msg: ClientMsg): void {
    if (msg.t === "join") this.roomWatch = msg.watch === true;
    else if (msg.t === "create") this.roomWatch = false;
    if (this.open && this.ws) this.ws.send(JSON.stringify(msg));
    else if (this.queue.length < MAX_QUEUE) this.queue.push(msg);
  }

  /**
   * After signing in or out the cookies say someone else: open a new socket
   * so the server reads them again. It replies with a fresh `welcome`.
   */
  reconnect(): void {
    const old = this.ws;
    this.open = false;
    if (old) {
      old.onclose = null;
      old.close();
    }
    this.connect();
  }

  // ---- task 34: away after about 5 minutes with no input, or a hidden tab ----
  private idleSent: boolean | null = null;
  private lastInput = Date.now();
  private presenceStarted = false;

  private startPresence(): void {
    if (this.presenceStarted) return;
    this.presenceStarted = true;
    const active = () => {
      this.lastInput = Date.now();
      if (this.idleSent) this.reportIdle();
    };
    for (const e of ["pointerdown", "keydown", "wheel", "touchstart"]) addEventListener(e, active, { passive: true, capture: true });
    addEventListener("pointermove", () => (this.lastInput = Date.now()), { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) this.lastInput = Date.now();
      this.reportIdle();
    });
    setInterval(() => this.reportIdle(), 15_000);
  }

  /** Tells the server whether this tab is idle, only when it changes. */
  private reportIdle(): void {
    const idle = document.hidden || Date.now() - this.lastInput > IDLE_MS;
    if (idle === this.idleSent || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.idleSent = idle;
    this.ws.send(JSON.stringify({ t: "idle", idle } satisfies ClientMsg));
  }

  private connect(): void {
    this.startPresence();
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${scheme}://${location.host}/ws`);
    this.ws = ws;

    // task 34: the remembered "show me as", so appearing offline holds across a reload
    ws.onopen = () => {
      const status = shownStatus();
      ws.send(JSON.stringify((status === "online" ? { t: "hello" } : { t: "hello", status }) satisfies ClientMsg));
      this.idleSent = null;
      this.reportIdle();
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      const msg = JSON.parse(String(event.data)) as ServerMsg;
      if (msg.t === "ping") {
        ws.send(JSON.stringify({ t: "pong", id: msg.id } satisfies ClientMsg));
        return;
      }
      if (msg.t === "welcome") {
        this.name = msg.name;
        this.matches = msg.matches;
        this.account = msg.account;
        this.demo = msg.demo;
        this.look = msg.look ?? null;
        this.tag = msg.tag ?? null;
        this.open = true;
        if (this.roomCode) ws.send(JSON.stringify((this.roomWatch ? { t: "join", room: this.roomCode, watch: true } : { t: "join", room: this.roomCode }) satisfies ClientMsg));
        for (const queued of this.queue.splice(0)) ws.send(JSON.stringify(queued));
      }
      if (msg.t === "room") this.roomCode = msg.room;
      for (const handler of this.handlers) handler(msg);
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.open = false;
      setTimeout(() => this.connect(), 1000);
    };
  }
}
