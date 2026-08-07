/**
 * Entity Projection — Reality Jump → Workspace node · select · expand.
 * Text Chip → ObjectID → Camera(via selected pin) → Callout(shell).
 * Never Reality Commit.
 */

import { ensureWorkspaceAnchorNode } from "@/lib/context-workspace/reality-anchor/ensure-workspace-anchor-node";
import { resolveWorkspaceFocusNode } from "@/lib/context-workspace/resolve-workspace-focus-node";
import { dispatchContextWorkspaceExpand } from "@/lib/context-workspace/workspace-expand-bridge";
import {
  readContextWorkspace,
  writeContextWorkspaceExpanded,
} from "@/lib/context-workspace/workspace-store";
import type { GlobeResourceReelKind } from "@/lib/globe/resource-reel/types";
import type { SpatialAnchorEntity } from "@/lib/spatial-retrieval/types";

export type ProjectRealityJumpResult = {
  readonly nodeId: string;
  readonly created: boolean;
  readonly expanded: true;
};

function anchorKindForJump(input: {
  readonly placeId: string;
  readonly labelKo: string;
  readonly reelKind: GlobeResourceReelKind;
}): SpatialAnchorEntity {
  if (input.reelKind === "lodging") return "hotel";
  // ensureWorkspaceAnchorNode accepts restaurant → eatery (wider than typed union)
  if (input.reelKind === "eatery") {
    return "restaurant" as SpatialAnchorEntity;
  }
  const blob = `${input.placeId} ${input.labelKo}`;
  if (/station|역|駅/iu.test(blob)) return "station";
  return "attraction";
}

/**
 * Upsert Reality Object into live Workspace and soft-expand.
 * Returns null when Workspace is closed / missing (no silent invent).
 */
export function projectRealityJumpToWorkspace(input: {
  readonly contextEventId: string;
  readonly placeId: string;
  readonly labelKo: string;
  readonly lat: number;
  readonly lng: number;
  readonly reelKind: GlobeResourceReelKind;
}): ProjectRealityJumpResult | null {
  const contextEventId = input.contextEventId.trim();
  const placeId = input.placeId.trim();
  if (!contextEventId || !placeId) return null;
  if (
    !Number.isFinite(input.lat) ||
    !Number.isFinite(input.lng)
  ) {
    return null;
  }

  const live = readContextWorkspace(contextEventId);
  if (
    !live ||
    (live.status !== "editing" && live.status !== "committing")
  ) {
    return null;
  }

  const before = resolveWorkspaceFocusNode(
    live.nodes,
    placeId,
    input.labelKo,
  );

  const label = input.labelKo.trim() || placeId;
  const nodeId = ensureWorkspaceAnchorNode({
    contextEventId,
    geoId: placeId,
    summaryKo: `${label} · 답변에서 선택`,
    anchor: {
      entityId: placeId,
      titleKo: label,
      labelKo: label,
      kind: anchorKindForJump({
        placeId,
        labelKo: label,
        reelKind: input.reelKind,
      }),
      lat: input.lat,
      lng: input.lng,
    },
  });

  if (!nodeId) return null;

  writeContextWorkspaceExpanded(contextEventId, true);
  dispatchContextWorkspaceExpand({
    contextEventId,
    source: "nl_open",
  });

  return {
    nodeId,
    created: before == null,
    expanded: true,
  };
}
