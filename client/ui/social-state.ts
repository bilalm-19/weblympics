// Task 34: the page's copy of what the server pushes about friends and the
// party, on the one socket the page already has (no polling). Only renders
// the server's word: the friends panel, the party panel and the in-game
// strip all subscribe here. Nothing in it names an account's id.
import type { ClientMsg, FriendView, PartyView, RequestView, ServerMsg, ShownStatus } from "../../shared/protocol.ts";
import { rememberStatus, shownStatus } from "../net/socket.ts";

export interface SocialLink {
  on(handler: (msg: ServerMsg) => void): () => void;
  send(msg: ClientMsg): void;
}

export type Invite = Extract<ServerMsg, { t: "invited" }>;

export interface SocialSnapshot {
  /** The server has sent the list at least once. */
  loaded: boolean;
  friends: FriendView[];
  requests: RequestView[];
  /** Your own "show me as". */
  status: ShownStatus;
  party: PartyView | null;
}

export class SocialState {
  state: SocialSnapshot = { loaded: false, friends: [], requests: [], status: shownStatus(), party: null };
  private listeners = new Set<() => void>();
  private inviteListeners = new Set<(i: Invite) => void>();
  private noticeListeners = new Set<(m: string) => void>();
  readonly link: SocialLink;

  constructor(link: SocialLink) {
    this.link = link;
    link.on((msg) => {
      if (msg.t === "friends") {
        this.state = { ...this.state, loaded: true, friends: msg.friends, requests: msg.requests, status: msg.status };
        this.emit();
      } else if (msg.t === "party") {
        this.state = { ...this.state, party: msg.party };
        this.emit();
      } else if (msg.t === "invited") {
        for (const fn of this.inviteListeners) fn(msg);
      } else if (msg.t === "notice") {
        for (const fn of this.noticeListeners) fn(msg.message);
      }
    });
  }

  /** Calls `fn` on every change; returns unsubscribe. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onInvite(fn: (i: Invite) => void): () => void {
    this.inviteListeners.add(fn);
    return () => this.inviteListeners.delete(fn);
  }

  onNotice(fn: (m: string) => void): () => void {
    this.noticeListeners.add(fn);
    return () => this.noticeListeners.delete(fn);
  }

  /** Shows a note in the same place as the server's notices. */
  notice(message: string): void {
    for (const fn of this.noticeListeners) fn(message);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  setStatus(status: ShownStatus): void {
    rememberStatus(status);
    this.state = { ...this.state, status };
    this.link.send({ t: "status", status });
    this.emit();
  }

  /** Friends showing online (the button's count). */
  onlineCount(): number {
    return this.state.friends.filter((f) => f.status === "online").length;
  }
}

/** "Sam#4821" */
export const tagged = (p: { name: string; tag: string }): string => `${p.name}#${p.tag}`;
