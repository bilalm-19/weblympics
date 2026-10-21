import "./style.css";
import type { RoomInfo } from "../shared/protocol.ts";
import { startArcheryPractice } from "./games/archery/practice.ts";
import { startArchery } from "./games/archery/view.ts";
import { startTraining } from "./games/tennis/training.ts";
import { startTennis } from "./games/tennis/view.ts";
import { Connection } from "./net/socket.ts";
import { signInDemo, signOut } from "./net/account.ts";
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
    { name: conn.name, matches: conn.matches, account: conn.account, demo: conn.demo },
    error,
    {
      onTrain: (s) => (s === "archery" ? practiseArchery() : train()),
      onPractice: (s) => conn.send({ t: "create", game: s, practice: true }),
      onCreate: (s) => conn.send({ t: "create", game: s, practice: false }),
      onJoin: (code) => conn.send({ t: "join", room: code }),
      onProfile: () => openProfile({ onIdentityChange: () => conn.reconnect() }),
      onLeaderboard: openLeaderboard,
      onSignInDemo: (n) => void signInDemo(n).then(() => conn.reconnect(), showError),
      onSignOutDemo: () => void signOut().then(() => conn.reconnect(), showError),
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

function enterRoom(info: RoomInfo): void {
  disposeGame?.();
  currentRoom = info.room;
  training = false;
  error = null;
  history.replaceState(null, "", `#/room/${info.room}`);
  sport = info.game;
  if (info.game === "archery") {
    disposeGame = startArchery(root, conn, info, leave);
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
    if (currentRoom === null && !training) showMenu();
  }
});

const invite = location.hash.match(/^#\/room\/([A-Za-z]{4})$/);
if (invite) conn.send({ t: "join", room: invite[1].toUpperCase() });
if (location.hash === "#/train") train();
else if (location.hash === "#/archery/practice") practiseArchery();
else showMenu();
