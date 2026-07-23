/**
 * Context Workspace — live editable surface until Commit.
 * Any map-needed work (hotel · eatery · poi · amenity) edits here first.
 * @see docs/adr/022-context-workspace-first.md
 */

export const CONTEXT_WORKSPACE_VERSION = 1 as const;

export type ContextSurfaceKind =
  | "rich_card"
  | "interactive_card"
  | "embedded_preview"
  | "deep_link_card"
  | "rich_result"
  | "smart_result";

/** Map place node kinds — all edit in Workspace before Globe. */
export type ContextWorkspaceNodeKind =
  | "lodging"
  | "eatery"
  | "poi"
  | "amenity";

export type ContextWorkspaceDomain = ContextWorkspaceNodeKind;

export type ContextWorkspaceNode = {
  readonly id: string;
  readonly kind: ContextWorkspaceNodeKind;
  readonly placeId: string;
  readonly title: string;
  readonly summaryKo: string;
  readonly lat: number;
  readonly lng: number;
  readonly rating: number | null;
  readonly priceBand: number | null;
  readonly amountLabel: string | null;
  readonly thumbnailUrl: string | null;
  readonly tags: readonly string[];
  readonly visible: boolean;
  readonly selected: boolean;
  readonly bookmarked: boolean;
  readonly source: string;
};

export type ContextWorkspaceStatus =
  | "editing"
  | "committing"
  | "committed"
  | "closed";

export type ContextWorkspaceTransitionOp =
  | "replace_candidates"
  | "add_nodes"
  | "filter"
  | "sort"
  | "remove"
  | "select"
  | "deselect"
  | "bookmark"
  | "find_similar"
  | "compare"
  | "simulate"
  | "optimize_route"
  | "undo"
  | "redo"
  | "commit"
  | "close";

/** WHY Layer — Action · Reason · Impact (on-demand balloons). */
export type WorkspaceWhyEntry = {
  readonly actionKo: string;
  readonly reasonsKo: readonly string[];
  readonly impactsKo: readonly string[];
  readonly nodeIds: readonly string[];
  readonly atIso: string;
};

export type ContextWorkspaceFilter = {
  readonly minRating?: number | null;
  readonly maxPriceBand?: number | null;
  readonly tagIncludes?: readonly string[] | null;
  readonly queryIncludes?: string | null;
};

export type ContextWorkspaceRelationshipEdge = {
  readonly id: string;
  readonly kind: "nearby" | "compare" | "route";
  readonly fromId: string;
  readonly toId: string;
  readonly labelKo: string;
  readonly meters: number | null;
};

/** Capsule Snapshot IR — same object Resume / pack / rank consume (ADR-023). */
export type ContextWorkspaceCompilerIr = import("@/lib/context-compiler/types").ContextCompilerIrV1;

export type ContextWorkspaceState = {
  readonly version: typeof CONTEXT_WORKSPACE_VERSION;
  readonly workspaceId: string;
  readonly contextEventId: string;
  readonly domain: ContextWorkspaceDomain;
  readonly status: ContextWorkspaceStatus;
  readonly query: string;
  readonly summaryKo: string;
  readonly nodes: readonly ContextWorkspaceNode[];
  /** Relationship edges — 검색 → 관계 (ADR-023). */
  readonly relationshipEdges: readonly ContextWorkspaceRelationshipEdge[];
  /**
   * Context Compiler IR snapshot for Capsule Resume.
   * Preference · Reality State · graph — not re-parsed from chat dump.
   */
  readonly compilerIr: ContextWorkspaceCompilerIr | null;
  readonly filter: ContextWorkspaceFilter;
  readonly selectedIds: readonly string[];
  readonly compareIds: readonly string[];
  readonly surfacePrimary: ContextSurfaceKind;
  readonly openedAtIso: string;
  readonly updatedAtIso: string;
  readonly committedAtIso: string | null;
  /** Short change note for the chat strip — Workspace is the answer. */
  readonly lastChangeKo: string | null;
  /** Last WHY — shown as node/edge balloon on demand. */
  readonly lastWhy: WorkspaceWhyEntry | null;
  readonly history: readonly ContextWorkspaceStateSnapshot[];
  readonly future: readonly ContextWorkspaceStateSnapshot[];
};

export type ContextWorkspaceStateSnapshot = {
  readonly nodes: readonly ContextWorkspaceNode[];
  readonly filter: ContextWorkspaceFilter;
  readonly selectedIds: readonly string[];
  readonly compareIds: readonly string[];
  readonly summaryKo: string;
};

export type ContextWorkspaceOpenSource =
  | "map_search"
  | "hotel_search"
  | "transition"
  | "restore"
  | "scout_patch"
  | "trip_prep";

export type ContextWorkspaceOpenDetail = {
  readonly contextEventId: string;
  readonly workspaceId: string;
  readonly source: ContextWorkspaceOpenSource;
};

export function domainLabelKo(domain: ContextWorkspaceDomain): string {
  if (domain === "lodging") {
    return "숙소";
  }
  if (domain === "eatery") {
    return "맛집";
  }
  if (domain === "amenity") {
    return "편의";
  }
  return "장소";
}
