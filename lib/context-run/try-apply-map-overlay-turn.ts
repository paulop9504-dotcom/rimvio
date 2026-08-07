/**
 * Map overlay / network absorb utterances — never free-talk / LLM essay.
 * Verbs: 보여줘 · 깔아줘 · 켜줘 · 띄워줘 · 올려줘 · 표시해 · 해바 …
 */

import { tryApplyRealityAbsorbFromUtterance } from "@/lib/reality-provider/run-reality-absorb";
import { tryApplyOsakaMetroOverlayFromUtterance } from "@/lib/geo/osaka-metro/resolve-metro-overlay-command";
import { tryApplyJapanMetroOverlayFromUtterance } from "@/lib/geo/japan-metro/resolve-metro-overlay-command";
import { tryApplyJapanShinkansenOverlayFromUtterance } from "@/lib/geo/japan-shinkansen/resolve-shinkansen-overlay-command";
import { tryApplyKoreaRailOverlayFromUtterance } from "@/lib/geo/korea-rail/resolve-rail-overlay-command";
import { resolveRealityNeedFromUtterance } from "@/lib/reality-provider/resolve-need";

const MAP_SHOW_VERB_RE =
  /표시|보여|켜|그려|띄워|올려|깔아|깔어|깔아줘|깔아놔|깔아라|켜줘|보여줘|표시해|보여바|켜바|그려바|띄워바|해바|해봐|해죠|해줘|show|display|put\s*on/iu;

const MAP_HIDE_VERB_RE =
  /숨겨|꺼|지워|끄|숨김|없애|가려|꺼줘|숨겨바|꺼바|지워바|hide|remove\s*from\s*map/iu;

const MAP_LAYER_HINT_RE =
  /노선도|노선망|노선|지하철|메트로|전철|신칸센|新幹線|JR|ＪＲ|철도|KTX|SRT|metro|subway|地铁|メトロ|港鐵|\bmtr\b|\bmrt\b|rail\s*map|transit\s*map/iu;

/**
 * True when NL is a Workspace map layer command (show/hide overlay).
 */
export function looksLikeMapOverlayUtterance(utterance: string): boolean {
  const text = utterance.trim();
  if (!text || text.length > 120) return false;
  if (!MAP_LAYER_HINT_RE.test(text)) return false;
  if (MAP_SHOW_VERB_RE.test(text) || MAP_HIDE_VERB_RE.test(text)) return true;
  // 「지하철 노선 전부」「메트로 전체」etc.
  if (/전부|전체|다\s*표시|다\s*보여/iu.test(text)) return true;
  // Need resolver already classifies network absorb
  return resolveRealityNeedFromUtterance(text) != null;
}

export type MapOverlayTurnResult = {
  readonly handled: true;
  readonly statusKo: string;
  readonly viaLegacyDomainStore: boolean;
};

/**
 * Prefer ADR-051 Reality absorb; fall back to domain overlay stores
 * so older map hooks still paint.
 */
export function tryApplyMapOverlayTurn(input: {
  readonly utterance: string;
  readonly contextEventId?: string | null;
}): MapOverlayTurnResult | null {
  const utterance = input.utterance.trim();
  if (!utterance || !looksLikeMapOverlayUtterance(utterance)) {
    return null;
  }

  const absorb = tryApplyRealityAbsorbFromUtterance({
    utterance,
    contextEventId: input.contextEventId,
  });
  if (absorb?.handled && absorb.mapProjected) {
    return {
      handled: true,
      statusKo: absorb.statusKo,
      viaLegacyDomainStore: false,
    };
  }
  if (absorb?.handled && absorb.statusKo) {
    // Soft fail still surfaces (e.g. city cache missing) — don't LLM essay.
    return {
      handled: true,
      statusKo: absorb.statusKo,
      viaLegacyDomainStore: false,
    };
  }

  const legacy =
    tryApplyOsakaMetroOverlayFromUtterance(utterance) ??
    tryApplyJapanMetroOverlayFromUtterance(utterance) ??
    tryApplyJapanShinkansenOverlayFromUtterance(utterance) ??
    tryApplyKoreaRailOverlayFromUtterance(utterance);

  if (legacy) {
    return {
      handled: true,
      statusKo: legacy,
      viaLegacyDomainStore: true,
    };
  }

  return null;
}
