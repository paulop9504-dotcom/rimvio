/**
 * Overseas metro (HK / Shanghai) must not LLM-essay or steal Osaka map.
 * Run: npx tsx scripts/test-overseas-metro-overlay-no-essay.ts
 */
import assert from "node:assert/strict";
import { resolveRealityNeedFromUtterance } from "@/lib/reality-provider/resolve-need";
import { tryApplyMapOverlayTurn } from "@/lib/context-run/try-apply-map-overlay-turn";
import { looksLikeMapOverlayUtterance } from "@/lib/context-run/try-apply-map-overlay-turn";
import {
  clearNetworkAbsorbProjectionForTests,
  getNetworkAbsorbVisibleLineIds,
} from "@/lib/reality-provider/network-absorb-projection-store";

clearNetworkAbsorbProjectionForTests();

for (const utterance of [
  "홍콩 지하철 노선도",
  "홍콩 지하철 노선도 보여줘",
  "상하이 지하철 노선도 찾아줘",
  "Shanghai metro map",
  "MTR 노선도 보여줘",
]) {
  assert.equal(
    looksLikeMapOverlayUtterance(utterance),
    true,
    `overlay cue: ${utterance}`,
  );
  const need = resolveRealityNeedFromUtterance(utterance);
  assert.ok(need, `need: ${utterance}`);
  assert.equal(need!.needId, "metro_network");
  const turn = tryApplyMapOverlayTurn({ utterance, contextEventId: null });
  assert.ok(turn?.handled, `handled: ${utterance}`);
  assert.match(turn!.statusKo, /캐시|아직|없어요|일본 메트로/u);
  assert.ok(!/홍콩의 주요 교통수단|매우 효율적|광범위/u.test(turn!.statusKo));
}

assert.equal(
  resolveRealityNeedFromUtterance("홍콩 지하철 노선도")!.regionKo,
  "홍콩",
);
assert.equal(
  resolveRealityNeedFromUtterance("상하이 지하철 노선도 찾아줘")!.regionKo,
  "상하이",
);

assert.equal(getNetworkAbsorbVisibleLineIds("osaka_metro").length, 0);

// Osaka still works
const osaka = tryApplyMapOverlayTurn({
  utterance: "오사카 지하철 노선도 보여줘",
  contextEventId: null,
});
assert.ok(osaka?.handled);
assert.ok(!/아직 없어요/u.test(osaka!.statusKo));

console.log("OK — overseas-metro-overlay-no-essay");
