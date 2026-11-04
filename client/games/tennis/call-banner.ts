// The umpire's call across the top of the game screen after each point (task
// 16): "15-Love", "30-all", "Deuce", "Advantage Bot", "Game", "Set", "Game, set,
// match", in bold, with who took it underneath. It replaces the small call that
// used to sit in the score bar. Placed under the HUD's measured bottom and
// clear of the court, the camera dock and the timing meter (call-banner.css,
// e2e/call-banner.e2e.ts). It is also the live region screen readers hear.
import type { PointCall } from "./point-call.ts";
import "./call-banner.css";

/** How long a call stays up, ms: a little longer for a bigger moment. */
export const callMs = (c: PointCall): number => 2000 + 400 * c.weight;

export interface CallBanner {
  show(c: PointCall): void;
  dispose(): void;
}

export function createCallBanner(view: HTMLElement): CallBanner {
  const el = document.createElement("div");
  el.className = "call-banner";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.setAttribute("aria-atomic", "true");
  el.innerHTML = `<b class="cb-call"></b><span class="cb-detail"></span>`;
  el.hidden = true;
  view.append(el);
  const callEl = el.querySelector(".cb-call") as HTMLElement;
  const detailEl = el.querySelector(".cb-detail") as HTMLElement;

  // under the HUD, which wraps to more rows on a phone
  const hud = view.querySelector(".hud") as HTMLElement | null;
  const place = () => {
    if (hud) el.style.setProperty("--hud-bottom", `${Math.ceil(hud.getBoundingClientRect().bottom - view.getBoundingClientRect().top)}px`);
  };
  const observer = new ResizeObserver(place);
  if (hud) observer.observe(hud);
  place();

  let timer = 0;
  return {
    show(c) {
      callEl.textContent = c.call;
      detailEl.textContent = c.detail;
      el.dataset.kind = c.kind;
      el.dataset.weight = String(c.weight);
      // restart the pop-in (none under reduced motion)
      el.hidden = true;
      void el.offsetWidth;
      el.hidden = false;
      place();
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        el.hidden = true;
        // empty, so a screen reader doesn't read a stale call
        callEl.textContent = "";
        detailEl.textContent = "";
      }, callMs(c));
    },
    dispose() {
      clearTimeout(timer);
      observer.disconnect();
      el.remove();
    },
  };
}
