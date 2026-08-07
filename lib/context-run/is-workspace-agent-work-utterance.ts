/**
 * Personal Globe Prompt that should route to Reality Workspace Agent
 * (Patch / Scout / Spatial) — not portal converse or ask-essay.
 *
 * Globe AI opens Workspace itself — travel dest announces & soft follow-ups
 * count as work when Continuum / active draft can absorb them.
 */

import { parseWorkspacePatch } from "@/lib/context-workspace/workspace-patch";
import { parseWorkspaceRealityPatch } from "@/lib/context-workspace/workspace-reality-patch";
import { parseLodgingStayTypeFromText } from "@/lib/globe/lodging/lodging-stay-types";
import { isSpatialDiscoveryUtterance } from "@/lib/spatial-retrieval/apply-spatial-discovery-to-workspace";
import { isCompoundActionUtterance } from "@/lib/action-planner";
import { isNewTripGlobeIngressUtterance } from "@/lib/context-run/is-new-trip-globe-ingress-utterance";
import { isAgentExecuteVerbUtterance } from "@/lib/context-run/is-agent-execute-verb";
import { hasActiveWorkspaceForGlobePrompt } from "@/lib/context-run/resolve-active-workspace-context";
import { classifyWorkspaceKind } from "@/lib/workspace-kind/classify-workspace-kind";

const LODGING_FIND_RE =
  /(?:호텔|숙소|캡슐|료칸|게스트|모텔).*(?:찾아|보여|검색|바꿔|다시|추천)|(?:찾아|보여|검색|추천).*(?:호텔|숙소)|더\s*싸|가성비|저렴|역\s*근처|온천/iu;

const EATERY_FIND_RE =
  /(?:맛집|식당|카페|먹을\s*곳).*(?:찾아|보여|검색|추천)|(?:찾아|보여|검색|추천).*(?:맛집|식당|카페)/iu;

const ACTIVITY_FIND_RE =
  /(?:놀거리|관광|명소|가봐야|꼭\s*가\s*봐|가볼만).*(?:찾아|보여|검색|추천)|(?:찾아|보여|검색|추천).*(?:놀거리|관광|명소)|꼭\s*가\s*봐야\s*할\s*곳|가봐야\s*할\s*곳|must.?visit/iu;

/** Soft follow-ups — only when a provisional Workspace already exists. */
const ACTIVE_FOLLOW_RE =
  /^(?:맛집|호텔|숙소|카페|놀거리|관광|명소|티켓)(?:도|만|은|은요)?[!?.]*$|USJ\s*근처|유니버설\s*근처|(?:후쿠오카|도쿄|오사카|제주|교토|상하이|상해).{0,8}(?:로|으로)\s*(?:바꿔|변경|가)|(?:3|2|4|5)\s*개만|가성비|더\s*싸|꼭\s*가\s*봐야|가봐야/iu;

/**
 * True when utterance is Workspace Agent work — clear/soft Patch or discovery.
 * New-trip Globe Ingress create stays on `globe_ingress` (not Agent mint).
 */
export function isWorkspaceAgentWorkUtterance(utterance: string): boolean {
  const text = utterance.trim();
  if (!text) return false;
  // Knowledge / explain Q — conversational lane (never Continuum / Agent mint).
  if (
    /(?:가|은|는)?\s*뭐야|[?？]\s*$|(?:을|를)?\s*설명해(?:\s*줘)?|tell\s+me\s+about|what\s+is\b|what'?s\b/iu.test(
      text,
    ) &&
    !/(?:찾|예약|준비|더\s*싸|필터|골라|넣어|빼)/iu.test(text)
  ) {
    return false;
  }
  // 「4박5일 오사카」도 Continuum 준비 대상 — Day skeleton은 globe_ingress와 병행 가능.
  if (isNewTripGlobeIngressUtterance(text)) {
    return true;
  }
  // 「세워줘」·「짜줘」— Cursor Agent Run (Activity Trail), not free-talk.
  if (isAgentExecuteVerbUtterance(text)) {
    return true;
  }
  // 「지하철 노선도 보여줘」「깔아줘」— map overlay work, not free-talk.
  if (
    /(?:노선도|노선망|지하철|메트로|전철|신칸센|JR|地铁|港鐵|mtr|mrt).{0,12}(?:보여|깔|켜|표시|띄워|올려|찾아)|(?:보여|깔|켜|표시|띄워|올려|찾아).{0,12}(?:노선도|노선|지하철|메트로|地铁)/iu.test(
      text,
    )
  ) {
    return true;
  }
  if (parseWorkspacePatch(text)) return true;
  if (parseWorkspaceRealityPatch(text)) return true;
  if (parseLodgingStayTypeFromText(text)) return true;
  if (isSpatialDiscoveryUtterance(text)) return true;
  if (isCompoundActionUtterance(text)) return true;
  if (LODGING_FIND_RE.test(text) || EATERY_FIND_RE.test(text) || ACTIVITY_FIND_RE.test(text)) return true;
  if (
    /동선\s*(?:짜|만들|최적화|보여)|일정\s*(?:짜|세워|만들)|여행\s*준비|prep\s*(?:the\s*)?trip|plan\s*(?:a\s*)?(?:route|days|itinerary)|find\s+(?:hotels?|food)/iu.test(
      text,
    )
  ) {
    return true;
  }
  // 「오사카 간다」「오사카 호텔」→ Travel Continuum (AI opens Workspace).
  if (classifyWorkspaceKind(text) === "travel") return true;
  if (classifyWorkspaceKind(text) === "driver") return true;
  if (classifyWorkspaceKind(text) === "used_goods") return true;
  // Active Workspace: short follow-ups inherit Destination without re-stating it.
  if (hasActiveWorkspaceForGlobePrompt() && ACTIVE_FOLLOW_RE.test(text)) {
    return true;
  }
  return false;
}
