// Task 36: when the home screen may load its small 3D card icons (user,
// 2026-11-08: "light on weak devices"). Only after the flat page is on
// screen, only in a window at least 760 px wide, and never under reduced
// motion; WebGL itself is checked by home-3d.ts when it loads, and it falls
// back to the flat icons if the frame rate drops. A browser driven by tests
// (navigator.webdriver) stays flat unless the page asks with `?icons3d`, so
// the e2e suite sees the flat path, and one test checks the 3D one on
// purpose. Pure, so spec/ can test it.

/** The narrowest window that gets the 3D icons (narrower is the phone layout). */
export const ICONS_3D_MIN_WIDTH = 761;

/** Frames a second below which the 3D icons give way to the flat ones. */
export const ICONS_3D_MIN_FPS = 30;

export interface IconsEnv {
  reducedMotion: boolean;
  /** The window's width in CSS pixels. */
  width: number;
  /** Driven by a test browser (navigator.webdriver). */
  automated: boolean;
  /** The page's address asks for them (`?icons3d`). */
  asked: boolean;
}

export function wants3dIcons(env: IconsEnv): boolean {
  if (env.reducedMotion || env.width < ICONS_3D_MIN_WIDTH) return false;
  return !env.automated || env.asked;
}
