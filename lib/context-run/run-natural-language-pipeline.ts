/**
 * Natural Language Pipeline runner — canonical stage order, one Rule gate.
 * Cursor-for-Reality: Context → Rules → Entity/Intent → Plan/Tools → Graph → Agent → Commit gate.
 *
 * @see lib/context-run/natural-language-pipeline.ts
 */

import type { ContextNlActionResult } from "@/lib/action-planner/context-nl-types";
import {
  buildContextPack,
  readLastContextPack,
  resolveLodgingDiffForPack,
  writeLastContextPack,
  type ContextPackV1,
} from "@/lib/context-builder";
import {
  NL_PIPELINE_STAGES,
  type NlPipelineStage,
} from "@/lib/context-run/natural-language-pipeline";
import { isCompoundActionUtterance } from "@/lib/action-planner/build-compare-reserve-plan";
import { shouldDeferSearchProjectToDiscoveryScout } from "@/lib/graph-command/should-defer-search-project-to-scout";
import { parsePalantirFacetFromMessage } from "@/lib/globe/spatial-semantic/resolve-palantir-refine-intent";
import { parseMaxNightlyPriceKrw } from "@/lib/globe/context-condition-ai/filter-lodging-for-intent";
import {
  tryRunGraphCommandOs,
  tryRunGraphCommandOsAsync,
} from "@/lib/graph-command/apply-graph-commands";
import { parseGraphCommands } from "@/lib/graph-command/parse-graph-commands";
import {
  ensureSessionGraph,
  readSessionGraph,
} from "@/lib/graph-command/session-graph-store";
import { tryRunMoveContextCommand } from "@/lib/context-engine/project-context";
import { tryRunReviseCommand } from "@/lib/globe/context-hub/try-run-revise-command";
import { tryRunSoftConfirmCommand } from "@/lib/globe/soft-confirm/try-run-soft-confirm-command";
import {
  tryApplyWorkspaceLodgingTurn,
  tryApplyWorkspaceLodgingTurnSync,
} from "@/lib/context-workspace/try-apply-workspace-lodging-turn";
import {
  applySoftConfirmPending,
  cancelSoftConfirmPending,
} from "@/lib/globe/soft-confirm/apply-soft-confirm-pending";
import {
  isSoftConfirmAffirmUtterance,
  isSoftConfirmRejectUtterance,
} from "@/lib/globe/soft-confirm/soft-confirm-affirm";
import { readSoftConfirmPending } from "@/lib/globe/soft-confirm/soft-confirm-pending-store";
import { copy } from "@/lib/copy/human-ko";
import {
  buildScoutHandoffResult,
  recoverUnmatchedNlTurn,
} from "@/lib/context-run/recover-unmatched-nl-turn";
import { bumpSessionGraphProjection } from "@/lib/graph-command/bump-session-graph-projection";
import {
  applyLodgingStayRevisePending,
  cancelLodgingStayRevisePending,
} from "@/lib/globe/context-hub/apply-lodging-stay-revise";
import { readLodgingStayRevisePending } from "@/lib/globe/context-hub/lodging-stay-revise-pending-store";
import {
  isLodgingStayReviseAffirmUtterance,
  isLodgingStayReviseRejectUtterance,
} from "@/lib/globe/context-hub/lodging-stay-revise-affirm";
import { readContextConditionLastBatch } from "@/lib/globe/context-condition-ai/context-condition-last-batch-store";
import { classifyIntentFamily } from "@/lib/rule-engine/classify-intent-family";
import { readGlobeProjectionLayerPolicy } from "@/lib/globe/spatial-semantic/globe-projection-layer-policy";
import { syncRealityPipelineAfterOperationChange } from "@/lib/reality-pipeline";
import {
  evaluateUtteranceRules,
  gateRuleDecisionForExecution,
  ruleRequiresFieldCommit,
  tryRunSoftSurfaceCommand,
  writeClarifyLessPending,
  type RuleEngineDecision,
} from "@/lib/rule-engine";
import { tryRunNlContextCreateOffer } from "@/lib/context-run/try-run-nl-context-create";
import { normalizeNlNegation } from "@/lib/context-run/normalize-nl-negation";
import {
  parseNlIntentChain,
  shouldRunMultiIntentPlanner,
} from "@/lib/action-planner/parse-nl-intent-chain";
import { commitPendingContextCreate } from "@/lib/globe-ingress/commit-pending-context-create";
import {
  isPendingContextCreateApprove,
  isPendingContextCreateCancel,
} from "@/lib/globe-ingress/detect-pending-context-create-reply";
import {
  clearPendingContextCreate,
  readPendingContextCreate,
} from "@/lib/globe-ingress/pending-context-create-store";
import { tryPatchPendingContextCreate } from "@/lib/globe-ingress/try-patch-pending-context-create";
import { writeActionPlanUi } from "@/lib/action-planner/action-plan-ui-store";
import { publishShortToolPlanPreview } from "@/lib/action-planner/publish-short-tool-plan";
import {
  tryRunActionPlanner,
  tryRunActionPlannerAsync,
} from "@/lib/action-planner/run-action-plan";
import { runAgentController } from "@/lib/agent";
import type { AgentHistoryTurn } from "@/lib/agent/types";
import type { ActionPlanV1, ActionPlannerRunResult } from "@/lib/action-planner/types";
import { readActionPlanUi } from "@/lib/action-planner/action-plan-ui-store";
import { readWorkspaceChat } from "@/lib/context-workspace/workspace-chat-store";

export type NlPipelineInput = {
  readonly utterance: string;
  readonly contextEventId: string;
  readonly anchorLat?: number | null;
  readonly anchorLng?: number | null;
  readonly contextLabelKo?: string | null;
  /** Conversation Context — optional; Workspace chat used when omitted. */
  readonly history?: readonly AgentHistoryTurn[] | null;
};

export type NlPipelineTrace = {
  readonly stagesVisited: readonly NlPipelineStage[];
  readonly ruleDecision: RuleEngineDecision;
  readonly contextPack: ContextPackV1;
  readonly deferredToScout?: boolean;
};

export type NlPipelineRun = {
  readonly result: ContextNlActionResult | null;
  readonly trace: NlPipelineTrace;
};

function resolveAgentHistory(
  input: NlPipelineInput,
): readonly AgentHistoryTurn[] | null {
  if (input.history != null) {
    return input.history;
  }
  const turns = readWorkspaceChat(input.contextEventId);
  if (turns.length === 0) {
    return null;
  }
  return turns.slice(-12).map((t) => ({
    role: t.role,
    content: t.text,
  }));
}

function resolveCurrentPlanForAgent(
  contextEventId: string,
): ActionPlanV1 | null {
  const plan = readActionPlanUi();
  if (!plan) {
    return null;
  }
  return plan.contextEventId === contextEventId.trim() ? plan : null;
}

function resolveDiscoveryPlaceIds(contextEventId: string): string[] {
  const ids = new Set<string>();
  const batch = readContextConditionLastBatch(contextEventId);
  for (const row of batch?.recommendations ?? []) {
    const placeId = row.placeId?.trim();
    if (placeId) {
      ids.add(placeId);
    }
  }
  const policy = readGlobeProjectionLayerPolicy();
  if (policy.activeContextEventId === contextEventId.trim()) {
    for (const placeId of policy.visiblePlaceIds) {
      const id = placeId.trim();
      if (id) {
        ids.add(id);
      }
    }
  }
  return [...ids];
}

/** Soft 「더 싸게」 against open lodging Diff → pin-bar facet refine (same project). */
function shouldDeferSoftPriceRefineToOpenDiff(
  utterance: string,
  contextEventId: string,
  pack: ContextPackV1,
): boolean {
  if (parsePalantirFacetFromMessage(utterance) !== "price") {
    return false;
  }
  if (parseMaxNightlyPriceKrw(utterance) != null) {
    return false;
  }
  const batch = readContextConditionLastBatch(contextEventId);
  const hasLodgingBatch = Boolean(
    pack.lodgingDiff?.lastBatchId ||
      batch?.recommendations?.some((row) => row.kind === "lodging"),
  );
  return hasLodgingBatch;
}

function buildTurnPack(input: NlPipelineInput): ContextPackV1 {
  const contextEventId = input.contextEventId.trim();
  const graph = readSessionGraph(contextEventId);
  const previous = readLastContextPack(contextEventId)?.lodgingDiff ?? null;
  const lodgingDiff = resolveLodgingDiffForPack({
    contextEventId,
    graph,
    previous,
  });
  const pack = buildContextPack({
    utterance: input.utterance,
    graph,
    discoveryPlaceIds: resolveDiscoveryPlaceIds(contextEventId),
    lodgingDiff,
  });
  writeLastContextPack(pack);
  return pack;
}

function rebuildPackAfterGraph(input: {
  utterance: string;
  contextEventId: string;
  graph: ReturnType<typeof readSessionGraph>;
}): ContextPackV1 {
  const contextEventId = input.contextEventId.trim();
  const graph =
    input.graph ??
    ensureSessionGraph({ contextEventId });
  const previous = readLastContextPack(contextEventId)?.lodgingDiff ?? null;
  const lodgingDiff = resolveLodgingDiffForPack({
    contextEventId,
    graph,
    previous,
  });
  const nextPack = buildContextPack({
    utterance: input.utterance,
    graph,
    discoveryPlaceIds: resolveDiscoveryPlaceIds(contextEventId),
    lodgingDiff,
  });
  writeLastContextPack(nextPack);
  return nextPack;
}

function actionPlanNeedsFieldCommit(planned: ActionPlannerRunResult): boolean {
  if (planned.plan.requiresFieldCommit === false) {
    return false;
  }
  if (planned.waitingCommit) {
    return true;
  }
  if (planned.reservedOpIds.length > 0) {
    return true;
  }
  return planned.plan.steps.some(
    (step) =>
      step.kind === "wait_commit" ||
      step.toolId === "booking.prepare" ||
      step.graphCommand?.op === "reserve_prep",
  );
}

function afterActionPlanSuccess(input: {
  utterance: string;
  contextEventId: string;
  contextLabelKo?: string | null;
  planned: ActionPlannerRunResult;
  waitingCommit: boolean;
}): void {
  writeActionPlanUi(input.planned.plan, {
    waitingCommit: input.waitingCommit,
    requestFieldOpen: input.waitingCommit,
  });
  // Tool → Graph Diff markers (no chat dump).
  bumpSessionGraphProjection(input.contextEventId);
  syncRealityPipelineAfterOperationChange({
    contextEventId: input.contextEventId,
    utterance: input.utterance,
    contextLabelKo: input.contextLabelKo ?? null,
    destinationLabelKo: input.contextLabelKo ?? null,
  });
}

/** Phase D / M1 — short plan card for non-compound Search turns. */
function publishShortPlanIfNeeded(input: {
  utterance: string;
  contextEventId: string;
  visited: NlPipelineStage[];
}): ActionPlanV1 | null {
  const plan = publishShortToolPlanPreview({
    utterance: input.utterance,
    contextEventId: input.contextEventId,
  });
  if (plan) {
    pushStage(input.visited, "action_planner");
  }
  return plan;
}

function pushStage(
  visited: NlPipelineStage[],
  stage: NlPipelineStage,
): void {
  if (!visited.includes(stage)) {
    visited.push(stage);
  }
}

function ruleStopResult(input: {
  contextEventId: string;
  pack: ContextPackV1;
  ruleDecision: RuleEngineDecision;
  visited: NlPipelineStage[];
  gate: Extract<
    ReturnType<typeof gateRuleDecisionForExecution>,
    { allow: false }
  >;
  utterance: string;
}): NlPipelineRun {
  pushStage(input.visited, "intent_parser");
  const via = input.gate.kind === "blocked" ? "rule_blocked" : "clarify";
  const clarify = input.ruleDecision.clarify;
  let clarifyChips:
    | readonly {
        readonly id: string;
        readonly labelKo: string;
        readonly gapId: string;
        readonly value: string;
      }[]
    | undefined;
  if (
    via === "clarify" &&
    clarify?.kind === "clarify" &&
    clarify.chips.length > 0
  ) {
    clarifyChips = clarify.chips;
    writeClarifyLessPending(input.contextEventId, {
      originalUtterance: input.utterance,
      intentLabelKo: input.ruleDecision.intent,
      candidateIds: clarify.candidates.map((c) => c.id),
      atIso: new Date().toISOString(),
    });
  }
  return {
    result: {
      ok: true,
      via,
      contextEventId: input.contextEventId,
      assistantReplyKo: input.gate.assistantReplyKo,
      reservedOpIds: [],
      waitingCommit: false,
      ruleDecision: input.ruleDecision,
      contextPack: input.pack,
      ...(via === "clarify" ? { clarifyChips } : {}),
    },
    trace: {
      stagesVisited: input.visited,
      ruleDecision: input.ruleDecision,
      contextPack: input.pack,
    },
  };
}

/**
 * Sync NL pipeline — one Rule Constitution evaluation, then Action / Graph path.
 * Stops before Reality Commit (human Field approval).
 */
export function runNaturalLanguagePipeline(
  raw: NlPipelineInput,
): NlPipelineRun {
  const chain = parseNlIntentChain(raw.utterance);
  const multiIntent = shouldRunMultiIntentPlanner(chain);
  const input: NlPipelineInput = {
    ...raw,
    utterance: multiIntent
      ? raw.utterance.trim().replace(/\s+/gu, " ")
      : normalizeNlNegation(raw.utterance),
  };
  const visited: NlPipelineStage[] = [];
  const contextEventId = input.contextEventId.trim();

  pushStage(visited, "context_builder");
  const pack = buildTurnPack(input);

  pushStage(visited, "rule_constitution");
  const ruleDecision = evaluateUtteranceRules({
    utterance: input.utterance,
    graph: readSessionGraph(contextEventId),
  });

  const gate = gateRuleDecisionForExecution({
    decision: ruleDecision,
    utterance: input.utterance,
  });
  if (!gate.allow) {
    return ruleStopResult({
      contextEventId,
      pack,
      ruleDecision,
      visited,
      gate,
      utterance: input.utterance,
    });
  }

  if (!multiIntent) {
    const soft = tryRunSoftSurfaceCommand({
      utterance: input.utterance,
      graph: readSessionGraph(contextEventId),
      contextEventId,
      contextLabelKo: input.contextLabelKo,
    });
    if (soft) {
      pushStage(visited, "intent_parser");
      pushStage(visited, "tool_router");
      if (soft.waitingCommit) {
        pushStage(visited, "agent_runtime");
      }
      return {
        result: {
          ok: true,
          via: "soft_command",
          contextEventId,
          assistantReplyKo: soft.assistantReplyKo,
          reservedOpIds: soft.reservedOpIds ?? [],
          waitingCommit: soft.waitingCommit ?? false,
          mapsUrl: soft.mapsUrl,
          softKind: soft.kind,
          ruleDecision,
          contextPack: pack,
        },
        trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
      };
    }
  }

  {
    const pendingCreate = readPendingContextCreate(contextEventId);
    if (pendingCreate) {
      if (isPendingContextCreateCancel(input.utterance)) {
        clearPendingContextCreate(contextEventId);
        pushStage(visited, "intent_parser");
        return {
          result: {
            ok: true,
            via: "soft_command",
            contextEventId,
            assistantReplyKo: "나중에 만들게요",
            reservedOpIds: [],
            waitingCommit: false,
            mapsUrl: null,
            softKind: "navigate",
            ruleDecision,
            contextPack: pack,
          },
          trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
        };
      }
      if (isPendingContextCreateApprove(input.utterance)) {
        const committed = commitPendingContextCreate({
          graphId: contextEventId,
          handlers: {
            openPortal: () => {},
            openFieldDiscovery: () => {},
            tryQuickListMarket: async () => false,
            navigateUrl: () => {},
          },
        });
        pushStage(visited, "intent_parser");
        pushStage(visited, "graph_engine");
        return {
          result: {
            ok: true,
            via: "soft_command",
            contextEventId,
            assistantReplyKo: committed
              ? "맥락을 만들었어요"
              : "맥락을 만들지 못했어요",
            reservedOpIds: [],
            waitingCommit: false,
            mapsUrl: null,
            softKind: "navigate",
            ruleDecision,
            contextPack: pack,
          },
          trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
        };
      }
      const patchedCreate = tryPatchPendingContextCreate({
        utterance: input.utterance,
        contextEventId,
        ruleDecision,
        pack,
      });
      if (patchedCreate) {
        pushStage(visited, "intent_parser");
        return {
          result: patchedCreate,
          trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
        };
      }
    }
  }

  {
    const createOffer = tryRunNlContextCreateOffer({
      utterance: input.utterance,
      contextEventId,
      ruleDecision,
      pack,
    });
    if (createOffer) {
      pushStage(visited, "intent_parser");
      return {
        result: createOffer,
        trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
      };
    }
  }

  const compound = isCompoundActionUtterance(input.utterance);

  // Lodging stay revise soft affirm — slots write + Diff re-scout hint (NL one line).
  {
    const pendingStay = readLodgingStayRevisePending(contextEventId);
    if (pendingStay) {
      if (isLodgingStayReviseRejectUtterance(input.utterance)) {
        const summaryKo = cancelLodgingStayRevisePending(contextEventId);
        pushStage(visited, "intent_parser");
        return {
          result: {
            ok: true,
            via: "soft_command",
            contextEventId,
            assistantReplyKo: summaryKo,
            reservedOpIds: [],
            waitingCommit: false,
            mapsUrl: null,
            softKind: "navigate",
            ruleDecision,
            contextPack: pack,
          },
          trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
        };
      }
      if (isLodgingStayReviseAffirmUtterance(input.utterance)) {
        const applied = applyLodgingStayRevisePending({ contextEventId });
        pushStage(visited, "intent_parser");
        pushStage(visited, "graph_command_ir");
        pushStage(visited, "graph_engine");
        pushStage(visited, "reality_graph");
        if (!applied.ok) {
          return {
            result: {
              ok: true,
              via: "soft_command",
              contextEventId,
              assistantReplyKo: applied.messageKo,
              reservedOpIds: [],
              waitingCommit: false,
              mapsUrl: null,
              softKind: "navigate",
              ruleDecision,
              contextPack: pack,
            },
            trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
          };
        }
        bumpSessionGraphProjection(contextEventId);
        return {
          result: {
            ok: true,
            via: "revise_applied",
            contextEventId,
            assistantReplyKo: copy.globe.lodgingStayReviseApplied(
              applied.summaryKo,
            ),
            reservedOpIds: [],
            waitingCommit: false,
            requestDiffRescout: true,
            skipFeedGate: true,
            ruleDecision,
            contextPack: pack,
          },
          trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
        };
      }
    }
  }

  // Revise Intent — confirm chips before slot write (same pipeline, not scout).
  {
    const revised = tryRunReviseCommand({
      utterance: input.utterance,
      contextEventId,
    });
    if (revised) {
      pushStage(visited, "intent_parser");
      pushStage(visited, "graph_command_ir");
      if (revised.via === "revise_confirm") {
        pushStage(visited, "graph_engine");
      }
      return {
        result: {
          ...revised,
          ruleDecision,
          contextPack: pack,
        },
        trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
      };
    }
  }

  // Soft affirm / reject for pending Filter · Pin · Delete.
  {
    const pendingSoft = readSoftConfirmPending(contextEventId);
    if (pendingSoft) {
      if (isSoftConfirmRejectUtterance(input.utterance)) {
        const summaryKo = cancelSoftConfirmPending(contextEventId);
        pushStage(visited, "intent_parser");
        return {
          result: {
            ok: true,
            via: "soft_command",
            contextEventId,
            assistantReplyKo: summaryKo,
            reservedOpIds: [],
            waitingCommit: false,
            mapsUrl: null,
            softKind: "navigate",
            ruleDecision,
            contextPack: pack,
          },
          trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
        };
      }
      if (isSoftConfirmAffirmUtterance(input.utterance)) {
        const applied = applySoftConfirmPending({
          contextEventId,
          anchorLat: input.anchorLat,
          anchorLng: input.anchorLng,
          contextLabelKo: input.contextLabelKo,
        });
        pushStage(visited, "intent_parser");
        pushStage(visited, "graph_command_ir");
        pushStage(visited, "graph_engine");
        pushStage(visited, "reality_graph");
        return {
          result: {
            ok: true,
            via: "soft_command",
            contextEventId,
            assistantReplyKo: applied.ok
              ? copy.globe.softConfirmApplied(applied.summaryKo)
              : applied.messageKo,
            reservedOpIds: [],
            waitingCommit: false,
            mapsUrl: null,
            softKind: "navigate",
            ruleDecision,
            contextPack: pack,
          },
          trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
        };
      }
    }
  }

  // Scout Field discovery — NL returns null so pin-bar scout owns the turn.
  // Never defer Revise (project edit stays on NL → Diff).
  // Soft 「더 싸게」 with open lodging Diff → same project facet refine.
  if (
    !compound &&
    classifyIntentFamily(input.utterance) !== "Revise" &&
    (shouldDeferSearchProjectToDiscoveryScout(input.utterance, contextEventId) ||
      shouldDeferSoftPriceRefineToOpenDiff(
        input.utterance,
        contextEventId,
        pack,
      ))
  ) {
    pushStage(visited, "intent_parser");
    const shortPlan = publishShortPlanIfNeeded({
      utterance: input.utterance,
      contextEventId,
      visited,
    });
    const handoff = buildScoutHandoffResult({
      contextEventId,
      ruleDecision,
      pack,
      utterance: input.utterance,
      ...(shortPlan ? { actionPlan: shortPlan } : {}),
    });
    return {
      result: handoff,
      trace: {
        stagesVisited: visited,
        ruleDecision,
        contextPack: pack,
        deferredToScout: true,
      },
    };
  }

  if (compound) {
    pushStage(visited, "entity_resolver");
    pushStage(visited, "intent_parser");
    pushStage(visited, "action_planner");
    const planned = tryRunActionPlanner(input);
    if (planned) {
      pushStage(visited, "tool_router");
      pushStage(visited, "graph_command_ir");
      pushStage(visited, "graph_engine");
      pushStage(visited, "agent_runtime");
      const waitingCommit =
        actionPlanNeedsFieldCommit(planned) ||
        ruleRequiresFieldCommit(ruleDecision, planned.reservedOpIds);
      if (waitingCommit) {
        pushStage(visited, "reality_commit");
      }
      pushStage(visited, "reality_graph");
      afterActionPlanSuccess({
        utterance: input.utterance,
        contextEventId,
        contextLabelKo: input.contextLabelKo,
        planned,
        waitingCommit,
      });
      const nextPack = rebuildPackAfterGraph({
        utterance: input.utterance,
        contextEventId,
        graph: readSessionGraph(contextEventId),
      });
      return {
        result: {
          ok: true,
          via: "action_plan",
          contextEventId,
          assistantReplyKo: planned.assistantReplyKo,
          reservedOpIds: planned.reservedOpIds,
          actionPlan: planned.plan,
          waitingCommit,
          ruleDecision,
          contextPack: nextPack,
        },
        trace: { stagesVisited: visited, ruleDecision, contextPack: nextPack },
      };
    }
  }

  // Single Graph Command — Context Engine move · Pin / Filter / Delete / Reserve …
  pushStage(visited, "entity_resolver");
  pushStage(visited, "intent_parser");
  let shortPlan: ActionPlanV1 | null = null;
  // Search → short plan + Tool Registry before Graph IR (canonical order).
  {
    const peek = parseGraphCommands(
      input.utterance,
      readSessionGraph(contextEventId),
    );
    if (peek[0]?.op === "search_project") {
      shortPlan = !compound
        ? publishShortPlanIfNeeded({
            utterance: input.utterance,
            contextEventId,
            visited,
          })
        : null;
      pushStage(visited, "tool_router");
    }
  }
  pushStage(visited, "graph_command_ir");

  const moved = tryRunMoveContextCommand({
    utterance: input.utterance,
    contextEventId,
    anchorLat: input.anchorLat,
    anchorLng: input.anchorLng,
  });
  if (moved) {
    pushStage(visited, "graph_engine");
    pushStage(visited, "reality_graph");
    const nextPack = rebuildPackAfterGraph({
      utterance: input.utterance,
      contextEventId,
      graph: moved.graph,
    });
    return {
      result: {
        ...moved,
        via: "graph_command",
        waitingCommit: false,
        ruleDecision,
        contextPack: nextPack,
      },
      trace: {
        stagesVisited: visited,
        ruleDecision,
        contextPack: nextPack,
      },
    };
  }

  // Provisional lodging Workspace — NL mutates Workspace before Globe soft/graph.
  {
    const workspaceTurn = tryApplyWorkspaceLodgingTurnSync({
      utterance: input.utterance,
      contextEventId,
    });
    if (workspaceTurn.handled) {
      pushStage(visited, "graph_engine");
      return {
        result: {
          ok: true,
          via: "workspace",
          contextEventId,
          assistantReplyKo: workspaceTurn.replyKo ?? "워크스페이스를 바꿨어요",
          reservedOpIds: [],
          waitingCommit: false,
          workspaceCommitted: workspaceTurn.committed,
          ruleDecision,
          contextPack: pack,
        },
        trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
      };
    }
  }

  // Filter / Pin / Delete — soft confirm chips (not Field).
  {
    const softConfirm = tryRunSoftConfirmCommand({
      utterance: input.utterance,
      contextEventId,
      anchorLat: input.anchorLat,
      anchorLng: input.anchorLng,
    });
    if (softConfirm) {
      return {
        result: {
          ...softConfirm,
          ruleDecision,
          contextPack: pack,
        },
        trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
      };
    }
  }

  const single = tryRunGraphCommandOs(input);
  if (!single) {
    pushStage(visited, "intent_parser");
    const recovery = recoverUnmatchedNlTurn({
      utterance: input.utterance,
      contextEventId,
      ruleDecision,
      pack,
      graph: readSessionGraph(contextEventId),
    });
    return {
      result: {
        ok: true,
        via: recovery.via,
        contextEventId,
        assistantReplyKo: recovery.assistantReplyKo,
        reservedOpIds: [],
        waitingCommit: false,
        ruleDecision,
        contextPack: pack,
        clarifyChips: recovery.clarifyChips,
      },
      trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
    };
  }
  pushStage(visited, "graph_engine");
  const waitingCommit = ruleRequiresFieldCommit(
    ruleDecision,
    single.reservedOpIds,
  );
  if (single.reservedOpIds.length > 0) {
    pushStage(visited, "agent_runtime");
  }
  if (waitingCommit) {
    pushStage(visited, "reality_commit");
    if (single.reservedOpIds.length > 0) {
      syncRealityPipelineAfterOperationChange({
        contextEventId,
        utterance: input.utterance,
        contextLabelKo: input.contextLabelKo ?? null,
        destinationLabelKo: input.contextLabelKo ?? null,
      });
    }
  }
  pushStage(visited, "reality_graph");
  const nextPack = rebuildPackAfterGraph({
    utterance: input.utterance,
    contextEventId,
    graph: single.graph,
  });
  bumpSessionGraphProjection(contextEventId);
  return {
    result: {
      ...single,
      via: "graph_command",
      waitingCommit,
      ruleDecision,
      contextPack: nextPack,
      ...(shortPlan ? { actionPlan: shortPlan } : {}),
    },
    trace: {
      stagesVisited: visited,
      ruleDecision,
      contextPack: nextPack,
    },
  };
}

/**
 * Live NL pipeline — same stage order, async tools / LiteAPI offer resolve.
 */
export async function runNaturalLanguagePipelineAsync(
  raw: NlPipelineInput,
): Promise<NlPipelineRun> {
  const chain = parseNlIntentChain(raw.utterance);
  const multiIntent = shouldRunMultiIntentPlanner(chain);
  const input: NlPipelineInput = {
    ...raw,
    utterance: multiIntent
      ? raw.utterance.trim().replace(/\s+/gu, " ")
      : normalizeNlNegation(raw.utterance),
  };
  const visited: NlPipelineStage[] = [];
  const contextEventId = input.contextEventId.trim();

  pushStage(visited, "context_builder");
  const pack = buildTurnPack(input);

  pushStage(visited, "rule_constitution");
  const ruleDecision = evaluateUtteranceRules({
    utterance: input.utterance,
    graph: readSessionGraph(contextEventId),
  });

  const gate = gateRuleDecisionForExecution({
    decision: ruleDecision,
    utterance: input.utterance,
  });
  if (!gate.allow) {
    return ruleStopResult({
      contextEventId,
      pack,
      ruleDecision,
      visited,
      gate,
      utterance: input.utterance,
    });
  }

  if (!multiIntent) {
    const soft = tryRunSoftSurfaceCommand({
      utterance: input.utterance,
      graph: readSessionGraph(contextEventId),
      contextEventId,
      contextLabelKo: input.contextLabelKo,
    });
    if (soft) {
      pushStage(visited, "intent_parser");
      pushStage(visited, "tool_router");
      if (soft.waitingCommit) {
        pushStage(visited, "agent_runtime");
      }
      return {
        result: {
          ok: true,
          via: "soft_command",
          contextEventId,
          assistantReplyKo: soft.assistantReplyKo,
          reservedOpIds: soft.reservedOpIds ?? [],
          waitingCommit: soft.waitingCommit ?? false,
          mapsUrl: soft.mapsUrl,
          softKind: soft.kind,
          ruleDecision,
          contextPack: pack,
        },
        trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
      };
    }
  }

  {
    const pendingCreate = readPendingContextCreate(contextEventId);
    if (pendingCreate) {
      if (isPendingContextCreateCancel(input.utterance)) {
        clearPendingContextCreate(contextEventId);
        pushStage(visited, "intent_parser");
        return {
          result: {
            ok: true,
            via: "soft_command",
            contextEventId,
            assistantReplyKo: "나중에 만들게요",
            reservedOpIds: [],
            waitingCommit: false,
            mapsUrl: null,
            softKind: "navigate",
            ruleDecision,
            contextPack: pack,
          },
          trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
        };
      }
      if (isPendingContextCreateApprove(input.utterance)) {
        const committed = commitPendingContextCreate({
          graphId: contextEventId,
          handlers: {
            openPortal: () => {},
            openFieldDiscovery: () => {},
            tryQuickListMarket: async () => false,
            navigateUrl: () => {},
          },
        });
        pushStage(visited, "intent_parser");
        pushStage(visited, "graph_engine");
        return {
          result: {
            ok: true,
            via: "soft_command",
            contextEventId,
            assistantReplyKo: committed
              ? "맥락을 만들었어요"
              : "맥락을 만들지 못했어요",
            reservedOpIds: [],
            waitingCommit: false,
            mapsUrl: null,
            softKind: "navigate",
            ruleDecision,
            contextPack: pack,
          },
          trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
        };
      }
      const patchedCreate = tryPatchPendingContextCreate({
        utterance: input.utterance,
        contextEventId,
        ruleDecision,
        pack,
      });
      if (patchedCreate) {
        pushStage(visited, "intent_parser");
        return {
          result: patchedCreate,
          trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
        };
      }
    }
  }

  {
    const createOffer = tryRunNlContextCreateOffer({
      utterance: input.utterance,
      contextEventId,
      ruleDecision,
      pack,
    });
    if (createOffer) {
      pushStage(visited, "intent_parser");
      return {
        result: createOffer,
        trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
      };
    }
  }

  const compound = isCompoundActionUtterance(input.utterance);

  // Lodging stay revise soft affirm — slots write + Diff re-scout hint (NL one line).
  {
    const pendingStay = readLodgingStayRevisePending(contextEventId);
    if (pendingStay) {
      if (isLodgingStayReviseRejectUtterance(input.utterance)) {
        const summaryKo = cancelLodgingStayRevisePending(contextEventId);
        pushStage(visited, "intent_parser");
        return {
          result: {
            ok: true,
            via: "soft_command",
            contextEventId,
            assistantReplyKo: summaryKo,
            reservedOpIds: [],
            waitingCommit: false,
            mapsUrl: null,
            softKind: "navigate",
            ruleDecision,
            contextPack: pack,
          },
          trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
        };
      }
      if (isLodgingStayReviseAffirmUtterance(input.utterance)) {
        const applied = applyLodgingStayRevisePending({ contextEventId });
        pushStage(visited, "intent_parser");
        pushStage(visited, "graph_command_ir");
        pushStage(visited, "graph_engine");
        pushStage(visited, "reality_graph");
        if (!applied.ok) {
          return {
            result: {
              ok: true,
              via: "soft_command",
              contextEventId,
              assistantReplyKo: applied.messageKo,
              reservedOpIds: [],
              waitingCommit: false,
              mapsUrl: null,
              softKind: "navigate",
              ruleDecision,
              contextPack: pack,
            },
            trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
          };
        }
        bumpSessionGraphProjection(contextEventId);
        return {
          result: {
            ok: true,
            via: "revise_applied",
            contextEventId,
            assistantReplyKo: copy.globe.lodgingStayReviseApplied(
              applied.summaryKo,
            ),
            reservedOpIds: [],
            waitingCommit: false,
            requestDiffRescout: true,
            skipFeedGate: true,
            ruleDecision,
            contextPack: pack,
          },
          trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
        };
      }
    }
  }

  // Revise Intent — confirm chips before slot write (same pipeline, not scout).
  {
    const revised = tryRunReviseCommand({
      utterance: input.utterance,
      contextEventId,
    });
    if (revised) {
      pushStage(visited, "intent_parser");
      pushStage(visited, "graph_command_ir");
      if (revised.via === "revise_confirm") {
        pushStage(visited, "graph_engine");
      }
      return {
        result: {
          ...revised,
          ruleDecision,
          contextPack: pack,
        },
        trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
      };
    }
  }

  // Soft affirm / reject for pending Filter · Pin · Delete.
  {
    const pendingSoft = readSoftConfirmPending(contextEventId);
    if (pendingSoft) {
      if (isSoftConfirmRejectUtterance(input.utterance)) {
        const summaryKo = cancelSoftConfirmPending(contextEventId);
        pushStage(visited, "intent_parser");
        return {
          result: {
            ok: true,
            via: "soft_command",
            contextEventId,
            assistantReplyKo: summaryKo,
            reservedOpIds: [],
            waitingCommit: false,
            mapsUrl: null,
            softKind: "navigate",
            ruleDecision,
            contextPack: pack,
          },
          trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
        };
      }
      if (isSoftConfirmAffirmUtterance(input.utterance)) {
        const applied = applySoftConfirmPending({
          contextEventId,
          anchorLat: input.anchorLat,
          anchorLng: input.anchorLng,
          contextLabelKo: input.contextLabelKo,
        });
        pushStage(visited, "intent_parser");
        pushStage(visited, "graph_command_ir");
        pushStage(visited, "graph_engine");
        pushStage(visited, "reality_graph");
        return {
          result: {
            ok: true,
            via: "soft_command",
            contextEventId,
            assistantReplyKo: applied.ok
              ? copy.globe.softConfirmApplied(applied.summaryKo)
              : applied.messageKo,
            reservedOpIds: [],
            waitingCommit: false,
            mapsUrl: null,
            softKind: "navigate",
            ruleDecision,
            contextPack: pack,
          },
          trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
        };
      }
    }
  }

  if (
    !compound &&
    classifyIntentFamily(input.utterance) !== "Revise" &&
    (shouldDeferSearchProjectToDiscoveryScout(input.utterance, contextEventId) ||
      shouldDeferSoftPriceRefineToOpenDiff(
        input.utterance,
        contextEventId,
        pack,
      ))
  ) {
    pushStage(visited, "intent_parser");
    const shortPlan = publishShortPlanIfNeeded({
      utterance: input.utterance,
      contextEventId,
      visited,
    });
    const handoff = buildScoutHandoffResult({
      contextEventId,
      ruleDecision,
      pack,
      utterance: input.utterance,
      ...(shortPlan ? { actionPlan: shortPlan } : {}),
    });
    return {
      result: handoff,
      trace: {
        stagesVisited: visited,
        ruleDecision,
        contextPack: pack,
        deferredToScout: true,
      },
    };
  }

  if (compound) {
    pushStage(visited, "entity_resolver");
    pushStage(visited, "intent_parser");
    pushStage(visited, "action_planner");
    const agent = await runAgentController({
      utterance: input.utterance,
      contextEventId,
      anchorLat: input.anchorLat,
      anchorLng: input.anchorLng,
      contextLabelKo: input.contextLabelKo,
      history: resolveAgentHistory(input),
      currentPlan: resolveCurrentPlanForAgent(contextEventId),
      useLlm: true,
      maxIterations: 3,
    });
    const planned =
      agent.ok
        ? agent.run
        : await tryRunActionPlannerAsync(input);
    if (planned) {
      pushStage(visited, "tool_router");
      pushStage(visited, "graph_command_ir");
      pushStage(visited, "graph_engine");
      pushStage(visited, "agent_runtime");
      const waitingCommit =
        actionPlanNeedsFieldCommit(planned) ||
        ruleRequiresFieldCommit(ruleDecision, planned.reservedOpIds);
      if (waitingCommit) {
        pushStage(visited, "reality_commit");
      }
      pushStage(visited, "reality_graph");
      afterActionPlanSuccess({
        utterance: input.utterance,
        contextEventId,
        contextLabelKo: input.contextLabelKo,
        planned,
        waitingCommit,
      });
      const nextPack = rebuildPackAfterGraph({
        utterance: input.utterance,
        contextEventId,
        graph: readSessionGraph(contextEventId),
      });
      const assistantReplyKo =
        agent.ok && agent.decision.type === "ask_user"
          ? agent.assistantReplyKo
          : planned.assistantReplyKo;
      return {
        result: {
          ok: true,
          via: "action_plan",
          contextEventId,
          assistantReplyKo,
          reservedOpIds: planned.reservedOpIds,
          actionPlan: planned.plan,
          waitingCommit,
          ruleDecision,
          contextPack: nextPack,
        },
        trace: { stagesVisited: visited, ruleDecision, contextPack: nextPack },
      };
    }
  }

  pushStage(visited, "entity_resolver");
  pushStage(visited, "intent_parser");
  let shortPlan: ActionPlanV1 | null = null;
  // Search → short plan + Tool Registry before Graph IR (canonical order).
  {
    const peek = parseGraphCommands(
      input.utterance,
      readSessionGraph(contextEventId),
    );
    if (peek[0]?.op === "search_project") {
      shortPlan = !compound
        ? publishShortPlanIfNeeded({
            utterance: input.utterance,
            contextEventId,
            visited,
          })
        : null;
      pushStage(visited, "tool_router");
    }
  }
  pushStage(visited, "graph_command_ir");

  const moved = tryRunMoveContextCommand({
    utterance: input.utterance,
    contextEventId,
    anchorLat: input.anchorLat,
    anchorLng: input.anchorLng,
  });
  if (moved) {
    pushStage(visited, "graph_engine");
    pushStage(visited, "reality_graph");
    const nextPack = rebuildPackAfterGraph({
      utterance: input.utterance,
      contextEventId,
      graph: moved.graph,
    });
    return {
      result: {
        ...moved,
        via: "graph_command",
        waitingCommit: false,
        ruleDecision,
        contextPack: nextPack,
      },
      trace: {
        stagesVisited: visited,
        ruleDecision,
        contextPack: nextPack,
      },
    };
  }

  // Provisional lodging Workspace — NL mutates Workspace before Globe soft/graph.
  {
    const workspaceTurn = await tryApplyWorkspaceLodgingTurn({
      utterance: input.utterance,
      contextEventId,
    });
    if (workspaceTurn.handled) {
      pushStage(visited, "graph_engine");
      return {
        result: {
          ok: true,
          via: "workspace",
          contextEventId,
          assistantReplyKo: workspaceTurn.replyKo ?? "워크스페이스를 바꿨어요",
          reservedOpIds: [],
          waitingCommit: false,
          workspaceCommitted: workspaceTurn.committed,
          ruleDecision,
          contextPack: pack,
        },
        trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
      };
    }
  }

  // Filter / Pin / Delete — soft confirm chips (not Field).
  {
    const softConfirm = tryRunSoftConfirmCommand({
      utterance: input.utterance,
      contextEventId,
      anchorLat: input.anchorLat,
      anchorLng: input.anchorLng,
    });
    if (softConfirm) {
      return {
        result: {
          ...softConfirm,
          ruleDecision,
          contextPack: pack,
        },
        trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
      };
    }
  }

  const single = await tryRunGraphCommandOsAsync(input);
  if (!single) {
    pushStage(visited, "intent_parser");
    const recovery = recoverUnmatchedNlTurn({
      utterance: input.utterance,
      contextEventId,
      ruleDecision,
      pack,
      graph: readSessionGraph(contextEventId),
    });
    return {
      result: {
        ok: true,
        via: recovery.via,
        contextEventId,
        assistantReplyKo: recovery.assistantReplyKo,
        reservedOpIds: [],
        waitingCommit: false,
        ruleDecision,
        contextPack: pack,
        clarifyChips: recovery.clarifyChips,
      },
      trace: { stagesVisited: visited, ruleDecision, contextPack: pack },
    };
  }
  pushStage(visited, "graph_engine");
  const waitingCommit = ruleRequiresFieldCommit(
    ruleDecision,
    single.reservedOpIds,
  );
  if (single.reservedOpIds.length > 0) {
    pushStage(visited, "agent_runtime");
  }
  if (waitingCommit) {
    pushStage(visited, "reality_commit");
    if (single.reservedOpIds.length > 0) {
      syncRealityPipelineAfterOperationChange({
        contextEventId,
        utterance: input.utterance,
        contextLabelKo: input.contextLabelKo ?? null,
        destinationLabelKo: input.contextLabelKo ?? null,
      });
    }
  }
  pushStage(visited, "reality_graph");
  const nextPack = rebuildPackAfterGraph({
    utterance: input.utterance,
    contextEventId,
    graph: single.graph,
  });
  bumpSessionGraphProjection(contextEventId);
  return {
    result: {
      ...single,
      via: "graph_command",
      waitingCommit,
      ruleDecision,
      contextPack: nextPack,
      ...(shortPlan ? { actionPlan: shortPlan } : {}),
    },
    trace: {
      stagesVisited: visited,
      ruleDecision,
      contextPack: nextPack,
    },
  };
}

/** Assert visited stages stay within the canonical ordered prefix (no skip-back). */
export function assertNlPipelineStageOrder(
  stagesVisited: readonly NlPipelineStage[],
): boolean {
  let lastIndex = -1;
  for (const stage of stagesVisited) {
    const index = NL_PIPELINE_STAGES.indexOf(stage);
    if (index < 0) {
      return false;
    }
    if (index < lastIndex) {
      return false;
    }
    lastIndex = index;
  }
  return true;
}
