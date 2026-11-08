import "./style.css";
import type { RoomInfo } from "../shared/protocol.ts";
import { startArcheryPractice } from "./games/archery/practice.ts";
import { startArchery } from "./games/archery/view.ts";
import { startBasketballPractice } from "./games/basketball/practice.ts";
import { startBasketball } from "./games/basketball/view.ts";
import { startTraining } from "./games/tennis/training.ts";
import { startTennis } from "./games/tennis/view.ts";
import { startBowlingPractice } from "./games/bowling/practice.ts";
import { startBowling } from "./games/bowling/view.ts";
import { startBoxingPractice } from "./games/boxing/practice.ts";
import { startBoxing } from "./games/boxing/view.ts";
import { startTrackPractice } from "./games/track/practice.ts";
import { startTrack } from "./games/track/view.ts";
import { Connection } from "./net/socket.ts";
import { addPasskey, signIn, signInDemo, signOut } from "./net/account.ts";
import { SPORTS, renderMenu } from "./ui/menu.ts";
import { friendsButton, openFriends } from "./ui/friends.ts";
import { addPartyStrip, openParty, partyButton, showInvite } from "./ui/party.ts";
import { SocialState } from "./ui/social-state.ts";
import { useFriendLink } from "./net/account.ts";
import { openLeaderboard } from "./ui/leaderboard.ts";
import { openProfile } from "./ui/profile.ts";

const root = document.getElementById("app") as HTMLElement;
const conn = new Connection();
// task 34: friends and the party, pushed on the same socket
const social = new SocialState(conn);
let disposeStrip: (() => void) | null = null;
// whether the current room's match is under way (the party strip's "Next match")
let roomInMatch = false;
const partyActions = {
  games: SPORTS.filter((s) => s.playable).map((s) => ({ id: s.id, name: s.name })),
  onWatch: (room: string) => conn.send({ t: "join", room, watch: true }),
};
let currentPractice = false;
const friendActions = {
  onWatch: partyActions.onWatch,
  onParty: () => openParty(root.querySelector(".pt-button"), social, partyActions),
  inRoom: () => currentRoom !== null && !currentPractice,
};

let disposeGame: (() => void) | null = null;
let currentRoom: string | null = null;
let training = false;
let error: string | null = null;
// the sport picked on the menu, so coming back keeps it
let sport = "tennis";

function showMenu(): void {
  disposeGame?.();
  disposeGame = null;
  disposeStrip?.();
  disposeStrip = null;
  currentRoom = null;
  training = false;
  conn.roomCode = null;
  renderMenu(
    root,
    { name: conn.name, matches: conn.matches, account: conn.account, demo: conn.demo, look: conn.look },
    error,
    {
      onTrain: (s) =>
        s === "archery"
          ? practiseArchery()
          : s === "track"
            ? practiseTrack()
            : s === "boxing"
              ? practiseBoxing()
              : s === "basketball"
                ? practiseBasketball()
                : s === "bowling"
                  ? practiseBowling()
                  : train(),
      onPractice: (s) => conn.send({ t: "create", game: s, practice: true }),
      onCreate: (s) => conn.send({ t: "create", game: s, practice: false }),
      onJoin: (code) => conn.send({ t: "join", room: code }),
      // who you are changed: a new socket, whose welcome draws the menu (and its avatar) again
      onProfile: () => openProfile({ onIdentityChange: () => conn.reconnect() }),
      onLeaderboard: openLeaderboard,
      onPasskey: async (kind) => {
        await (kind === "create" ? addPasskey() : signIn());
        conn.reconnect();
      },
      onSignInDemo: async (n) => {
        await signInDemo(n);
        conn.reconnect();
      },
      onSignOut: async () => {
        await signOut();
        conn.reconnect();
      },
      onSelect: (s) => (sport = s),
    },
    sport,
  );
  // task 34: Friends (and the party, once in one) beside the profile button
  const corner = root.querySelector(".menu-corner");
  const who = { name: conn.name, tag: conn.tag, account: conn.account };
  const friends = friendsButton(who, social, friendActions);
  if (corner && friends) corner.prepend(friends, partyButton(social, partyActions));
}

function showError(e: unknown): void {
  error = e instanceof Error ? e.message : "Something went wrong.";
  if (currentRoom === null && !training) showMenu();
}

function leave(): void {
  conn.send({ t: "leave" });
  error = null;
  history.replaceState(null, "", location.pathname);
  showMenu();
}

// Training runs in the page against a ball machine: it sends nothing to the
// server, so leaving it needs no "leave" either. `resumeCamera`: coming from
// the camera setup's "Train first", so the camera starts again at once.
function train(resumeCamera = false): void {
  disposeGame?.();
  training = true;
  error = null;
  history.replaceState(null, "", "#/train");
  disposeGame = startTraining(root, () => {
    history.replaceState(null, "", location.pathname);
    showMenu();
  }, resumeCamera);
}

// Archery practice (task 22): in the page too, nothing sent to the server.
function practiseArchery(): void {
  disposeGame?.();
  training = true;
  sport = "archery";
  error = null;
  history.replaceState(null, "", "#/archery/practice");
  disposeGame = startArcheryPractice(root, () => {
    history.replaceState(null, "", location.pathname);
    showMenu();
  });
}

// Track practice (task 26): in the page too, nothing sent to the server.
function practiseTrack(): void {
  disposeGame?.();
  training = true;
  sport = "track";
  error = null;
  history.replaceState(null, "", "#/track/practice");
  disposeGame = startTrackPractice(root, () => {
    history.replaceState(null, "", location.pathname);
    showMenu();
  });
}

// Boxing practice (task 30): in the page too, nothing sent to the server.
function practiseBoxing(): void {
  disposeGame?.();
  training = true;
  sport = "boxing";
  error = null;
  history.replaceState(null, "", "#/boxing/practice");
  disposeGame = startBoxingPractice(root, () => {
    history.replaceState(null, "", location.pathname);
    showMenu();
  });
}

// Basketball practice (task 32): in the page too, nothing sent to the server.
function practiseBasketball(): void {
  disposeGame?.();
  training = true;
  sport = "basketball";
  error = null;
  history.replaceState(null, "", "#/basketball/practice");
  disposeGame = startBasketballPractice(root, () => {
    history.replaceState(null, "", location.pathname);
    showMenu();
  });
}

// Bowling practice (task 29): in the page too, nothing sent to the server.
function practiseBowling(): void {
  disposeGame?.();
  training = true;
  sport = "bowling";
  error = null;
  history.replaceState(null, "", "#/bowling/practice");
  disposeGame = startBowlingPractice(root, () => {
    history.replaceState(null, "", location.pathname);
    showMenu();
  });
}

function enterRoom(info: RoomInfo): void {
  currentPractice = info.practice;
  // task 34: a party start moves you into its room: an open friends or party sheet goes, so nothing covers the game
  for (const d of document.querySelectorAll<HTMLDialogElement>("dialog.sheet")) d.close();
  disposeGame?.();
  disposeStrip?.();
  roomInMatch = false;
  currentRoom = info.room;
  training = false;
  error = null;
  // task 24: a watcher keeps the watch link in the address bar, so a reload watches again
  history.replaceState(null, "", info.seat === null && conn.roomWatch ? `#/watch/${info.room}` : `#/room/${info.room}`);
  sport = info.game;
  if (info.game === "archery") {
    disposeGame = startArchery(root, conn, info, leave);
  } else if (info.game === "track") {
    disposeGame = startTrack(root, conn, info, leave);
  } else if (info.game === "boxing") {
    disposeGame = startBoxing(root, conn, info, leave);
  } else if (info.game === "basketball") {
    disposeGame = startBasketball(root, conn, info, leave);
  } else if (info.game === "bowling") {
    disposeGame = startBowling(root, conn, info, leave);
  } else {
    // practice offers training once the camera is set up (a room may have
    // someone waiting, so it doesn't): leave the bot and train with the camera on
    const onTrain = info.practice
      ? () => {
          conn.send({ t: "leave" });
          currentRoom = null;
          train(true);
        }
      : undefined;
    disposeGame = startTennis(root, conn, info, leave, { onTrain });
  }
  // task 34: the party, compact, in the HUD's own row (practice has no party)
  const inviteFriends = conn.account ? () => openFriends(null, { name: conn.name, tag: conn.tag, account: true }, social, friendActions) : null;
  disposeStrip = info.practice ? null : addPartyStrip(root, social, partyActions, () => roomInMatch, inviteFriends);
}

conn.on((msg) => {
  if (msg.t === "lobby") roomInMatch = msg.match;
  if (msg.t === "welcome" && currentRoom === null && !training) showMenu();
  else if (msg.t === "room") {
    if (msg.room !== currentRoom) enterRoom(msg);
  } else if (msg.t === "closed" && msg.room === currentRoom) {
    // a dropped player didn't come back in time: say why on the home screen
    error = `Room ${msg.room} closed: ${msg.reason}.`;
    history.replaceState(null, "", location.pathname);
    showMenu();
  } else if (msg.t === "error") {
    error = msg.message;
    if (currentRoom === null && !training) {
      // a link that didn't get in (no such room, or full of watchers) leaves the address bar
      if (/^#\/(room|watch)\//.test(location.hash)) history.replaceState(null, "", location.pathname);
      showMenu();
    }
  }
});

// task 34: a friend's invite pops up wherever you are; Join takes you there
social.onInvite((invite) =>
  showInvite(invite, () => {
    if (invite.kind === "party") {
      conn.send({ t: "party", act: "join", code: invite.code });
      if (currentRoom === null && !training) openParty(null, social, partyActions);
    } else conn.send({ t: "join", room: invite.code });
  }),
);
// a party link (#/party/CODE) joins the party; a friend link (#/friend/CODE) makes you friends
const partyLink = location.hash.match(/^#\/party\/([A-Za-z0-9_-]{8,32})$/);
if (partyLink) {
  conn.send({ t: "party", act: "join", code: partyLink[1] });
  history.replaceState(null, "", location.pathname);
  queueMicrotask(() => openParty(null, social, partyActions));
}
const friendLink = location.hash.match(/^#\/friend\/([A-Za-z0-9_-]{10,64})$/);
if (friendLink) {
  history.replaceState(null, "", location.pathname);
  useFriendLink(friendLink[1]).then(
    (r) => social.notice(r.outcome === "already" ? "You're already friends." : "You're now friends."),
    (e: unknown) => {
      error = e instanceof Error ? e.message : "That friend link didn't work.";
      if (currentRoom === null && !training) showMenu();
    },
  );
}

const invite = location.hash.match(/^#\/room\/([A-Za-z]{4})$/);
if (invite) conn.send({ t: "join", room: invite[1].toUpperCase() });
// task 24: the watch link always spectates, even when a seat is free
const watchLink = location.hash.match(/^#\/watch\/([A-Za-z]{4})$/);
if (watchLink) conn.send({ t: "join", room: watchLink[1].toUpperCase(), watch: true });
if (location.hash === "#/train") train();
else if (location.hash === "#/archery/practice") practiseArchery();
else if (location.hash === "#/track/practice") practiseTrack();
else if (location.hash === "#/boxing/practice") practiseBoxing();
else if (location.hash === "#/basketball/practice") practiseBasketball();
else if (location.hash === "#/bowling/practice") practiseBowling();
else showMenu();
