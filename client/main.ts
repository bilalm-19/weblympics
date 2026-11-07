import "./style.css";
import type { RoomInfo } from "../shared/protocol.ts";
import { startArcheryPractice } from "./games/archery/practice.ts";
import { startArchery } from "./games/archery/view.ts";
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
import { renderMenu } from "./ui/menu.ts";
import { openLeaderboard } from "./ui/leaderboard.ts";
import { openProfile } from "./ui/profile.ts";

const root = document.getElementById("app") as HTMLElement;
const conn = new Connection();

let disposeGame: (() => void) | null = null;
let currentRoom: string | null = null;
let training = false;
let error: string | null = null;
// the sport picked on the menu, so coming back keeps it
let sport = "tennis";

function showMenu(): void {
  disposeGame?.();
  disposeGame = null;
  currentRoom = null;
  training = false;
  conn.roomCode = null;
  renderMenu(
    root,
    { name: conn.name, matches: conn.matches, account: conn.account, demo: conn.demo, look: conn.look },
    error,
    {
      onTrain: (s) => (s === "archery" ? practiseArchery() : s === "track" ? practiseTrack() : s === "boxing" ? practiseBoxing() : s === "bowling" ? practiseBowling() : train()),
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
  disposeGame?.();
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
}

conn.on((msg) => {
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

const invite = location.hash.match(/^#\/room\/([A-Za-z]{4})$/);
if (invite) conn.send({ t: "join", room: invite[1].toUpperCase() });
// task 24: the watch link always spectates, even when a seat is free
const watchLink = location.hash.match(/^#\/watch\/([A-Za-z]{4})$/);
if (watchLink) conn.send({ t: "join", room: watchLink[1].toUpperCase(), watch: true });
if (location.hash === "#/train") train();
else if (location.hash === "#/archery/practice") practiseArchery();
else if (location.hash === "#/track/practice") practiseTrack();
else if (location.hash === "#/boxing/practice") practiseBoxing();
else if (location.hash === "#/bowling/practice") practiseBowling();
else showMenu();
