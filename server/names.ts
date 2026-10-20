// Display names (task 17): who may be called what. Guests get a server-made
// pseudonym; an account may choose a name, checked here. The client may
// pre-check the shape (shared/names.ts) but is never trusted.
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from "obscenity";
import { nameShapeProblem, normaliseName } from "../shared/names.ts";

const ADJECTIVES = ["Swift", "Lucky", "Quiet", "Brave", "Sunny", "Nimble", "Plucky", "Breezy"];
const ANIMALS = ["Otter", "Heron", "Wombat", "Koala", "Magpie", "Quokka", "Gecko", "Dingo"];
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

export function pseudonym(): string {
  return `${pick(ADJECTIVES)} ${pick(ANIMALS)} ${10 + Math.floor(Math.random() * 90)}`;
}

// A chosen name can't look like a server-made one, so a guest's pseudonym is
// never mistaken for an account someone picked (or the other way round).
const PSEUDONYM = new RegExp(`^(${ADJECTIVES.join("|")}) (${ANIMALS.join("|")}) \\d+$`, "i");

// Labels the game itself shows: the bot, the HUD's "You", a deleted player.
const RESERVED = new Set(["bot", "admin", "administrator", "moderator", "you", "deleted player", "guest", "weblympics"]);

// The word list ships inside the package; nothing is stored in this repo.
const profanity = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });

export type NameCheck = { ok: true; name: string } | { ok: false; reason: string };

/**
 * Whether `raw` may be an account's chosen name, ignoring uniqueness (the
 * database's unique index on lower(name) decides that). Returns the
 * normalised name to store.
 */
export function checkChosenName(raw: unknown): NameCheck {
  if (typeof raw !== "string" || raw.length > 64) return { ok: false, reason: "Use 3 to 16 characters." };
  const name = normaliseName(raw);
  const shape = nameShapeProblem(name);
  if (shape) return { ok: false, reason: shape };
  const lower = name.toLowerCase();
  // "<name> (2)" is how a second tab on one account is labelled
  if (RESERVED.has(lower) || /\(\s*\d+\s*\)$/.test(name) || /^(bot|admin)\b/i.test(name) || PSEUDONYM.test(name)) {
    return { ok: false, reason: "That name is reserved." };
  }
  if (profanity.hasMatch(name)) return { ok: false, reason: "Please pick another name." };
  return { ok: true, name };
}
