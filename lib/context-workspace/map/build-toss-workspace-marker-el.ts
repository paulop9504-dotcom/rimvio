/**
 * Toss-style Workspace markers — pill + on-map action icons (no bottom pin cart).
 * Built for mobile: no CSS transitions; in-place sync without MapLibre Marker teardown.
 */

import { GLOBE_TOSS_THEME } from "@/lib/globe/globe-toss-theme";
import type { WorkspaceMapPin } from "@/lib/context-workspace/map/workspace-map-provider";

function shortTitle(title: string, max = 10): string {
  const t = title.trim().replace(/\s+/gu, " ");
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

function iconBtn(input: {
  innerHtml: string;
  title: string;
  bg: string;
  onClick: () => void;
}): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.title = input.title;
  btn.setAttribute("aria-label", input.title);
  btn.innerHTML = input.innerHtml;
  btn.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "justify-content:center",
    "width:28px",
    "height:28px",
    "border:0",
    "border-radius:999px",
    "padding:0",
    "cursor:pointer",
    `background:${input.bg}`,
    "color:#fff",
    "line-height:0",
    "box-shadow:0 1px 3px rgba(25,31,40,0.12)",
    "touch-action:manipulation",
    "-webkit-tap-highlight-color:transparent",
  ].join(";");
  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    input.onClick();
  });
  return btn;
}

const PIN_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';

const CHECK_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

const X_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

export type WorkspaceMarkerActions = {
  onSelect: (id: string) => void;
  onPinToggle?: (id: string) => void;
  onRemove?: (id: string) => void;
};

export type TossWorkspaceMarkerInput = {
  pin: WorkspaceMapPin;
  index: number;
  selected: boolean;
  compact?: boolean;
  actions: WorkspaceMarkerActions;
};

/** Stable chrome signature — skip DOM work when unchanged. */
export function tossWorkspaceMarkerChromeKey(
  input: Omit<TossWorkspaceMarkerInput, "actions">,
): string {
  const { pin, index, selected, compact } = input;
  return [
    pin.id,
    index,
    selected ? 1 : 0,
    pin.bookmarked ? 1 : 0,
    pin.photoSpot ? 1 : 0,
    compact ? 1 : 0,
    pin.title,
    pin.rating ?? "",
    pin.amountLabel ?? "",
  ].join("|");
}

function fillTossWorkspaceMarkerEl(
  root: HTMLDivElement,
  input: TossWorkspaceMarkerInput,
): void {
  while (root.firstChild) {
    root.removeChild(root.firstChild);
  }

  const { pin, index, selected, compact, actions } = input;
  root.dataset.pinId = pin.id;
  root.dataset.chromeKey = tossWorkspaceMarkerChromeKey({
    pin,
    index,
    selected,
    compact,
  });

  const pinned = Boolean(pin.bookmarked);
  const photoSpot = Boolean(pin.photoSpot);
  const showActions = !compact && (selected || pinned);

  if (showActions) {
    const bar = document.createElement("div");
    bar.dataset.markerActions = "1";
    bar.style.cssText = [
      "display:flex",
      "align-items:center",
      "gap:4px",
      "padding:2px",
      "border-radius:999px",
      "background:rgba(255,255,255,0.94)",
      "box-shadow:0 1px 4px rgba(25,31,40,0.1)",
    ].join(";");

    if (actions.onPinToggle) {
      bar.appendChild(
        iconBtn({
          innerHtml: pinned ? CHECK_SVG : PIN_SVG,
          title: pinned ? "고정 해제" : "고정",
          bg: pinned ? "#191f28" : GLOBE_TOSS_THEME.blue,
          onClick: () => actions.onPinToggle?.(pin.id),
        }),
      );
    }
    if (actions.onRemove) {
      const remove = iconBtn({
        innerHtml: X_SVG,
        title: "빼기",
        bg: "#fff",
        onClick: () => actions.onRemove?.(pin.id),
      });
      remove.style.color = "#f04452";
      bar.appendChild(remove);
    }
    root.appendChild(bar);
  }

  const chip = document.createElement("button");
  chip.type = "button";
  chip.title = pin.title;
  chip.setAttribute("aria-label", pin.title);
  const rating =
    pin.rating != null && Number.isFinite(pin.rating)
      ? pin.rating.toFixed(1)
      : null;
  const label = compact
    ? photoSpot
      ? "포토"
      : pin.amountLabel?.trim() || `★${rating ?? "—"}`
    : selected
      ? shortTitle(pin.title, 11)
      : pinned
        ? shortTitle(pin.title, 9)
        : photoSpot
          ? "포토스팟"
          : `★${rating ?? String(index + 1)}`;

  chip.textContent = label;
  chip.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "justify-content:center",
    "gap:3px",
    "min-width:28px",
    "height:26px",
    compact
      ? "padding:0 8px"
      : selected || pinned
        ? "padding:0 10px"
        : "padding:0 8px",
    "border:0",
    "border-radius:999px",
    "cursor:pointer",
    "font-size:11px",
    "font-weight:700",
    "letter-spacing:-0.03em",
    "line-height:1",
    "touch-action:manipulation",
    "-webkit-tap-highlight-color:transparent",
    "will-change:auto",
    "box-shadow:0 1px 2px rgba(25,31,40,0.08), 0 0 0 1px rgba(25,31,40,0.04)",
    selected
      ? `background:${GLOBE_TOSS_THEME.blue};color:#fff`
      : pinned
        ? "background:#191f28;color:#fff"
        : photoSpot
          ? `background:${GLOBE_TOSS_THEME.blue};color:#fff`
          : "background:#fff;color:#191f28",
  ].join(";");

  chip.addEventListener("click", (event) => {
    event.stopPropagation();
    actions.onSelect(pin.id);
  });
  root.appendChild(chip);
}

export function buildTossWorkspaceMarkerEl(
  input: TossWorkspaceMarkerInput,
): HTMLDivElement {
  const root = document.createElement("div");
  root.style.cssText = [
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "gap:4px",
    "border:0",
    "background:transparent",
    "padding:0",
    "font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Pretendard',sans-serif",
    "contain:layout style",
  ].join(";");
  fillTossWorkspaceMarkerEl(root, input);
  return root;
}

/** Update marker DOM in place — avoids MapLibre Marker remove/add. */
export function syncTossWorkspaceMarkerEl(
  root: HTMLDivElement,
  input: TossWorkspaceMarkerInput,
): boolean {
  const nextKey = tossWorkspaceMarkerChromeKey({
    pin: input.pin,
    index: input.index,
    selected: input.selected,
    compact: input.compact,
  });
  if (root.dataset.chromeKey === nextKey) {
    return false;
  }
  fillTossWorkspaceMarkerEl(root, input);
  return true;
}
