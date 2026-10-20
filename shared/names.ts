// Display-name shape (task 17), shared so the profile panel can pre-check as
// you type. The server runs the same check plus the ones the client can't
// (uniqueness, profanity, reserved words) and is the only judge.

export const NAME_MIN = 3;
export const NAME_MAX = 16;
// ASCII letters and digits, single spaces and a few symbols. ASCII only, so
// look-alike letters from other scripts can't copy someone else's name.
const NAME_CHARS = /^[A-Za-z0-9 _.'-]+$/;

/** Trims spaces, and turns any run of spaces into one (tabs and the like stay, and fail the shape check). */
export function normaliseName(raw: string): string {
  return raw.replace(/^ +| +$/g, "").replace(/ {2,}/g, " ");
}

/** null if the name has an allowed shape, else what's wrong with it. */
export function nameShapeProblem(name: string): string | null {
  if (name.length < NAME_MIN || name.length > NAME_MAX) return `Use ${NAME_MIN} to ${NAME_MAX} characters.`;
  if (!NAME_CHARS.test(name)) return "Use letters, digits, spaces and _ . ' - only.";
  if (!/[A-Za-z]/.test(name)) return "Include at least one letter.";
  return null;
}
