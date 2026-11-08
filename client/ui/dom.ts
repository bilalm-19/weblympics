// A tiny element builder for the friends and party panels (task 34): names
// go in as text, never as HTML, so a name can't inject markup.
type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string | boolean | number | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue;
    if (k === "class") e.className = String(v);
    else if (k === "text") e.textContent = String(v);
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

/** An SVG string we drew ourselves (look-preview), as a node. */
export function svg(markup: string): Node {
  const t = document.createElement("template");
  t.innerHTML = markup.trim();
  return t.content.firstChild ?? document.createTextNode("");
}

/**
 * The popover-on-desktop, bottom-sheet-on-phone dialog both panels use: a
 * native modal <dialog> (focus moves in, Escape closes, Tab stays inside),
 * a click on the backdrop closes it, and focus goes back to `opener`.
 */
export function sheet(className: string, label: string, opener: HTMLElement | null, host: Element = document.body): { dialog: HTMLDialogElement; close: () => void } {
  const dialog = document.createElement("dialog");
  dialog.className = `sheet ${className}`;
  dialog.setAttribute("aria-label", label);
  const close = () => dialog.open && dialog.close();
  dialog.addEventListener("close", () => {
    opener?.setAttribute("aria-expanded", "false");
    dialog.remove();
    if (opener?.isConnected) opener.focus();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const stops = [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input, select, a[href]")].filter((x) => x.offsetParent !== null);
    if (stops.length === 0) return;
    const [first, last] = [stops[0], stops[stops.length - 1]];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  host.append(dialog);
  opener?.setAttribute("aria-expanded", "true");
  return { dialog, close };
}
