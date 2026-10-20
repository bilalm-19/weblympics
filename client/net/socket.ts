import type { ClientMsg, ServerMsg } from "../../shared/protocol.ts";
import { fetchMe } from "./account.ts";

const MAX_QUEUE = 20;

export class Connection {
  name = "";
  matches = 0;
  /** Signed in with a passkey, or as a demo account; false for a guest. */
  account = false;
  /** Which of the two locked demo accounts, if one. */
  demo = false;
  roomCode: string | null = null;
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

  private connect(): void {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${scheme}://${location.host}/ws`);
    this.ws = ws;

    ws.onopen = () => ws.send(JSON.stringify({ t: "hello" } satisfies ClientMsg));

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
        this.open = true;
        if (this.roomCode) ws.send(JSON.stringify({ t: "join", room: this.roomCode } satisfies ClientMsg));
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
