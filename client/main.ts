import "./style.css";
import type { RoomInfo } from "../shared/protocol.ts";
import { startTraining } from "./games/tennis/training.ts";
import { startTennis } from "./games/tennis/view.ts";
import { Connection } from "./net/socket.ts";
import { renderMenu } from "./ui/menu.ts";

const root = document.getElementById("app") as HTMLElement;
const conn = new Connection();

let disposeGame: (() => void) | null = null;
let currentRoom: string | null = null;
let training = false;
let error: string | null = null;

function showMenu(): void {
  disposeGame?.();
  disposeGame = null;
  currentRoom = null;
  training = false;
  conn.roomCode = null;
  renderMenu(root, conn.name, conn.matches, conn.demo, error, {
    onTrain: () => train(),
    onPractice: () => conn.send({ t: "create", game: "tennis", practice: true }),
    onCreate: () => conn.send({ t: "create", game: "tennis", practice: false }),
    onJoin: (code) => conn.send({ t: "join", room: code }),
    onSignInDemo: (n) => conn.signInDemo(n),
    onPlayAsGuest: () => conn.playAsGuest(),
  });
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

function enterRoom(info: RoomInfo): void {
  disposeGame?.();
  currentRoom = info.room;
  training = false;
  error = null;
  history.replaceState(null, "", `#/room/${info.room}`);
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
else showMenu();
