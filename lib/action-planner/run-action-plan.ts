/**
 * Action Planner runtime ? run Plan steps via Tool Router + Registry + Graph Engine.
 * Soft graph IR (pins + compare) flushes as one Diff bundle.
 * Stops at wait_commit. Never Reality Commit.
 */

import {
  buildActionPlan,
  formatActionPlanPreviewKo,
  isCompoundActionUtterance,
} from "@/lib/action-planner/build-compare-reserve-plan";
import { formatMultiIntentPreviewKo } from "@/lib/action-planner/compose-action-plan-from-atoms";
import {
  parseNlIntentChain,
  shouldRunMultiIntentPlanner,
} from "@/lib/action-planner/parse-nl-intent-chain";
import { resolvePlanEntityLabel } from "@/lib/action-planner/resolve-plan-entity";
import type {
  ActionPlannerRunResult,
  ActionPlanStepV1,
  ActionPlanV1,
} from "@/lib/action-planner/types";
import {
  applyGraphCommands,
  applyGraphCommandsAsync,
} from "@/lib/graph-command/apply-graph-commands";
import {
  ensureSessionGraph,
  readSessionGraph,
  writeSessionGraph,
} from "@/lib/graph-command/session-graph-store";
import type { GraphCommand, SessionGraphNode } from "@/lib/graph-command/types";
import { parseOrdinalIndex } from "@/lib/graph-command/resolve-selection-ref";
import { tryRunSoftSurfaceCommand } from "@/lib/rule-engine/try-run-soft-surface-command";
import { makeNodeFromLiveCandidate } from "@/lib/action-planner/inject-live-search-candidate";
import { triggerCompareBloomFromSessionGraph } from "@/lib/action-planner/trigger-compare-bloom";
import { bumpSessionGraphProjection } from "@/lib/graph-command/bump-session-graph-projection";
import {
  stampSearchToolResultsToDiff,
  TOOL_SEARCH_BATCH_ID_PREFIX,
  type SearchToolCandidate,
} from "@/lib/graph-command/stamp-search-tool-results-to-diff";
import { emitToolSearchHubAction } from "@/lib/graph-command/emit-tool-search-hub-action";
import { invokeRimvioTool, invokeRimvioToolAsync } from "@/lib/tool-registry";
import type { ToolInvokeInput, RimvioToolId, ToolInvokeResult } from "@/lib/tool-registry";
import { resolveLookupToolId } from "@/lib/rule-engine/resolve-tool-id";
import { writeActionPlanUi } from "@/lib/action-planner/action-plan-ui-store";
import { agentController } from "@/lib/agent/agent-controller-facade";
import { createObservation } from "@/lib/agent/observation";
import type { AgentHistoryTurn, AgentObservation } from "@/lib/agent/types";
import {
  AGENT_MAX_STEPS,
  bumpLoopIteration,
  bumpReplan,
  bumpRefine,
  bumpStepExecuted,
  canAgentRefine,
  canAgentReplan,
  createAgentSafetyBudget,
  enforceHumanCommitGate,
  isAgentLoopExhausted,
  safetyHaltMessageKo,
} from "@/lib/agent/agent-safety-policy";

function markStep(
  plan: ActionPlanV1,
  stepId: string,
  status: ActionPlanStepV1["status"],
  patch?: Partial<ActionPlanStepV1>,
): ActionPlanV1 {
  const next: ActionPlanV1 = {
    ...plan,
    steps: plan.steps.map((step) =>
      step.id === stepId ? { ...step, ...patch, status } : step,
    ),
  };
  /** STEP6 — Diff chip refresh after every step completion. */
  writeActionPlanUi(next, {
    waitingCommit: next.steps.some(
      (step) => step.kind === "wait_commit" && step.status === "done",
    ),
  });
  return next;
}

function visiblePlaceNodes(graph: ReturnType<typeof readSessionGraph>): SessionGraphNode[] {
  if (!graph) {
    return [];
  }
  return graph.nodes.filter(
    (n) =>
      n.visible &&
      (n.kind === "lodging" || n.kind === "eatery" || n.kind === "poi"),
  );
}

function toolBaseInput(input: {
  utterance: string;
  anchorLat?: number | null;
  anchorLng?: number | null;
}): Pick<ToolInvokeInput, "utterance" | "lat" | "lng"> {
  return {
    utterance: input.utterance,
    lat: input.anchorLat,
    lng: input.anchorLng,
  };
}

/** Inject lookup nodes into session graph. Diff stamp deferred for bundle flush. */
function injectLookupCandidates(input: {
  contextEventId: string;
  candidates: readonly SearchToolCandidate[] | null | undefined;
  preferredLabelKo?: string | null;
  anchorLat?: number | null;
  anchorLng?: number | null;
  kind?: "lodging" | "eatery" | "poi";
  stampDiff?: boolean;
  batchId?: string | null;
}): SearchToolCandidate[] {
  const graph = ensureSessionGraph({
    contextEventId: input.contextEventId,
    anchorLat: input.anchorLat,
    anchorLng: input.anchorLng,
  });
  const preferred = input.preferredLabelKo?.trim().toLowerCase() ?? "";
  const ordered = [...(input.candidates ?? [])].sort((a, b) => {
    if (!preferred) {
      return 0;
    }
    const aHit = a.labelKo.toLowerCase().includes(preferred) ? 1 : 0;
    const bHit = b.labelKo.toLowerCase().includes(preferred) ? 1 : 0;
    return bHit - aHit;
  });
  const nextNodes = [...graph.nodes];
  for (const candidate of ordered.slice(0, 4)) {
    const node = makeNodeFromLiveCandidate({
      contextEventId: input.contextEventId,
      candidate,
      kind: input.kind ?? "lodging",
    });
    if (!nextNodes.some((n) => n.id === node.id || n.labelKo === node.labelKo)) {
      nextNodes.push(node);
    }
  }
  writeSessionGraph({
    ...graph,
    nodes: nextNodes,
    selectionIds: nextNodes[0] ? [nextNodes[0].id] : graph.selectionIds,
    updatedAtIso: new Date().toISOString(),
  });
  if (input.stampDiff !== false) {
    const domain =
      input.kind === "eatery" ? "eatery" : input.kind === "poi" ? "poi" : "lodging";
    stampSearchToolResultsToDiff({
      contextEventId: input.contextEventId,
      domain,
      query: preferred || domain,
      candidates: ordered,
      summaryKo: null,
      batchId: input.batchId,
    });
    const toolId = resolveLookupToolId(
      domain === "eatery" ? "eatery" : domain === "poi" ? "poi" : "lodging",
      preferred || domain,
    );
    emitToolSearchHubAction({
      contextEventId: input.contextEventId,
      toolId,
      domain,
      query: preferred || domain,
      candidateCount: ordered.length,
    });
    bumpSessionGraphProjection(input.contextEventId);
  }
  return ordered;
}

/** Stamp LiteAPI offer attrs onto the picked node so reserve_prep can enqueue offerId. */
function stampOfferOntoPickedNode(input: {
  contextEventId: string;
  pickedId: string | null | undefined;
  pickedLabelKo: string | null;
  candidates: ToolInvokeInput["candidates"];
}): void {
  const graph = readSessionGraph(input.contextEventId);
  if (!graph) {
    return;
  }
  const fromList =
    (input.pickedId
      ? input.candidates?.find((c) => c.id === input.pickedId)
      : null) ??
    (input.pickedLabelKo
      ? input.candidates?.find((c) => c.labelKo === input.pickedLabelKo)
      : null) ??
    null;
  if (!fromList?.liteapiOfferId && !fromList?.amountLabel) {
    return;
  }
  const nodes = graph.nodes.map((node) => {
    const match =
      (input.pickedId && node.id === input.pickedId) ||
      (input.pickedLabelKo && node.labelKo === input.pickedLabelKo) ||
      (fromList.id &&
        (node.attrs.searchId === fromList.id || node.id.includes(fromList.id)));
    if (!match) {
      return node;
    }
    return {
      ...node,
      attrs: {
        ...node.attrs,
        ...(fromList.liteapiOfferId
          ? { liteapiOfferId: fromList.liteapiOfferId }
          : {}),
        ...(fromList.liteapiHotelId
          ? { liteapiHotelId: fromList.liteapiHotelId }
          : {}),
        ...(fromList.amountLabel ? { amountLabel: fromList.amountLabel } : {}),
      },
    };
  });
  writeSessionGraph({
    ...graph,
    nodes,
    updatedAtIso: new Date().toISOString(),
  });
}

function resolveEntityToolArgs(
  step: ActionPlanStepV1,
  utterance: string,
  anchors: { anchorLat?: number | null; anchorLng?: number | null },
): {
  toolId: RimvioToolId;
  invoke: ToolInvokeInput;
  pinLabelKo: string;
  domain: "lodging" | "eatery" | "poi";
} {
  const raw = step.entityLabelKo?.trim() || "";
  const resolved = resolvePlanEntityLabel(raw);
  const toolId = (step.toolId ?? resolved.toolId) as RimvioToolId;
  const domain: "lodging" | "eatery" | "poi" =
    resolved.domain === "amenity" || resolved.domain === "poi"
      ? "poi"
      : resolved.domain === "eatery"
        ? "eatery"
        : "lodging";
  return {
    toolId,
    pinLabelKo: resolved.labelKo,
    domain,
    invoke: {
      ...toolBaseInput({ utterance, ...anchors }),
      labels: [resolved.queryKo],
      domain,
      query: resolved.queryKo,
    },
  };
}

type WorkingSetDiffBuffer = {
  pinLabels: string[];
  candidates: SearchToolCandidate[];
  domain: "lodging" | "eatery" | "poi";
  flushed: boolean;
  commandCount: number;
};

function createWorkingSetDiffBuffer(): WorkingSetDiffBuffer {
  return {
    pinLabels: [],
    candidates: [],
    domain: "lodging",
    flushed: false,
    commandCount: 0,
  };
}

function searchBatchIdForPlan(plan: ActionPlanV1): string {
  return `${TOOL_SEARCH_BATCH_ID_PREFIX}${plan.diffBundleId}`;
}

function buildWorkingSetCommands(
  buffer: WorkingSetDiffBuffer,
  compareCommand: GraphCommand | null,
): GraphCommand[] {
  const pins: GraphCommand[] = buffer.pinLabels.map((labelKo) => ({
    op: "pin_node" as const,
    targetRef: { labelKo },
  }));
  if (compareCommand?.op === "compare" || compareCommand?.op === "filter") {
    return [...pins, compareCommand];
  }
  return pins;
}

function stampWorkingSetSearchDiff(input: {
  plan: ActionPlanV1;
  buffer: WorkingSetDiffBuffer;
}): void {
  const domain = input.buffer.domain;
  const toolId = resolveLookupToolId(
    domain === "eatery" ? "eatery" : domain === "poi" ? "poi" : "lodging",
    input.plan.utterance,
  );
  if (input.buffer.candidates.length === 0) {
    emitToolSearchHubAction({
      contextEventId: input.plan.contextEventId,
      toolId,
      domain,
      query: input.plan.utterance,
      candidateCount: 0,
    });
    return;
  }
  stampSearchToolResultsToDiff({
    contextEventId: input.plan.contextEventId,
    domain: input.buffer.domain,
    query: input.plan.utterance,
    candidates: input.buffer.candidates,
    summaryKo: `${input.buffer.pinLabels.join(" · ")} Diff`,
    batchId: searchBatchIdForPlan(input.plan),
  });
  emitToolSearchHubAction({
    contextEventId: input.plan.contextEventId,
    toolId,
    domain,
    query: input.plan.utterance,
    candidateCount: input.buffer.candidates.length,
  });
}

/**
 * Flush soft Diff once: Search lastBatch + pin?N + compare in one applyGraphCommands.
 */
function flushWorkingSetDiffSync(input: {
  plan: ActionPlanV1;
  buffer: WorkingSetDiffBuffer;
  compareCommand: GraphCommand | null;
  anchorLat?: number | null;
  anchorLng?: number | null;
  contextLabelKo?: string | null;
}): boolean {
  if (input.buffer.flushed) {
    return input.buffer.commandCount > 0;
  }
  const commands = buildWorkingSetCommands(input.buffer, input.compareCommand);
  stampWorkingSetSearchDiff({ plan: input.plan, buffer: input.buffer });
  if (commands.length === 0) {
    input.buffer.flushed = true;
    return false;
  }
  const applied = applyGraphCommands({
    contextEventId: input.plan.contextEventId,
    commands,
    anchorLat: input.anchorLat,
    anchorLng: input.anchorLng,
    contextLabelKo: input.contextLabelKo,
  });
  input.buffer.flushed = true;
  input.buffer.commandCount = applied.ok ? commands.length : 0;
  if (applied.ok && commands.some((c) => c.op === "compare")) {
    triggerCompareBloomFromSessionGraph(input.plan.contextEventId);
  }
  bumpSessionGraphProjection(input.plan.contextEventId);
  return applied.ok;
}

async function flushWorkingSetDiffAsync(input: {
  plan: ActionPlanV1;
  buffer: WorkingSetDiffBuffer;
  compareCommand: GraphCommand | null;
  anchorLat?: number | null;
  anchorLng?: number | null;
  contextLabelKo?: string | null;
}): Promise<boolean> {
  if (input.buffer.flushed) {
    return input.buffer.commandCount > 0;
  }
  const commands = buildWorkingSetCommands(input.buffer, input.compareCommand);
  stampWorkingSetSearchDiff({ plan: input.plan, buffer: input.buffer });
  if (commands.length === 0) {
    input.buffer.flushed = true;
    return false;
  }
  const applied = await applyGraphCommandsAsync({
    contextEventId: input.plan.contextEventId,
    commands,
    anchorLat: input.anchorLat,
    anchorLng: input.anchorLng,
    contextLabelKo: input.contextLabelKo,
  });
  input.buffer.flushed = true;
  input.buffer.commandCount = applied.ok ? commands.length : 0;
  if (applied.ok && commands.some((c) => c.op === "compare")) {
    triggerCompareBloomFromSessionGraph(input.plan.contextEventId);
  }
  bumpSessionGraphProjection(input.plan.contextEventId);
  return applied.ok;
}

/**
 * Run compare?rank?reserve_prep plan. Returns null if utterance is not compound.
 * Sync ? seed/catalog tools.
 */
export function tryRunActionPlanner(input: {
  utterance: string;
  contextEventId: string;
  anchorLat?: number | null;
  anchorLng?: number | null;
  contextLabelKo?: string | null;
}): ActionPlannerRunResult | null {
  if (!isCompoundActionUtterance(input.utterance)) {
    return null;
  }

  const contextEventId = input.contextEventId.trim();
  if (!contextEventId) {
    return null;
  }

  ensureSessionGraph({
    contextEventId,
    anchorLat: input.anchorLat,
    anchorLng: input.anchorLng,
  });

  let plan = buildActionPlan({
    utterance: input.utterance,
    contextEventId,
    graph: readSessionGraph(contextEventId),
  });
  if (!plan) {
    return null;
  }

  const reservedOpIds: string[] = [];
  let pickedLabelKo: string | null = null;
  const chain = parseNlIntentChain(input.utterance);
  const preview = shouldRunMultiIntentPlanner(chain)
    ? formatMultiIntentPreviewKo(chain.atoms, plan)
    : formatActionPlanPreviewKo(plan);
  const anchors = {
    anchorLat: input.anchorLat,
    anchorLng: input.anchorLng,
  };
  const buffer = createWorkingSetDiffBuffer();

  for (const step of plan.steps) {
    if (step.kind === "resolve_entity" && step.entityLabelKo) {
      const args = resolveEntityToolArgs(step, input.utterance, anchors);
      const toolResult = invokeRimvioTool(args.toolId, args.invoke);
      if (toolResult.candidates?.length) {
        const ordered = injectLookupCandidates({
          contextEventId,
          candidates: toolResult.candidates,
          preferredLabelKo: args.pinLabelKo,
          ...anchors,
          kind: args.domain === "poi" ? "poi" : args.domain,
          stampDiff: false,
        });
        buffer.domain = args.domain === "poi" ? "poi" : args.domain;
        buffer.candidates.push(...ordered.slice(0, 4));
      }
      if (!buffer.pinLabels.includes(args.pinLabelKo)) {
        buffer.pinLabels.push(args.pinLabelKo);
      }
      plan = markStep(plan, step.id, "done", {
        noteKo: toolResult.summaryKo,
        toolId: args.toolId,
        entityLabelKo: args.pinLabelKo,
      });
      continue;
    }

    if (step.kind === "graph_command" && step.graphCommand) {
      if (step.graphCommand.op === "reserve_prep" || step.graphCommand.op === "payment_prep") {
        if (!buffer.flushed) {
          flushWorkingSetDiffSync({
            plan,
            buffer,
            compareCommand: null,
            ...anchors,
            contextLabelKo: input.contextLabelKo,
          });
        }
        const rawTarget =
          pickedLabelKo ?? step.graphCommand.targetRef.labelKo;
        const ordinalFirst = parseOrdinalIndex(rawTarget) != null;
        const firstVisible = ordinalFirst
          ? visiblePlaceNodes(readSessionGraph(contextEventId))[0]
          : null;
        const targetLabel =
          firstVisible?.labelKo ?? (ordinalFirst ? null : rawTarget);
        if (!targetLabel) {
          plan = markStep(plan, step.id, "blocked", {
            noteKo: "reserve prep failed",
          });
          continue;
        }
        const applied = applyGraphCommands({
          contextEventId,
          commands: [
            {
              op: step.graphCommand.op,
              targetRef: firstVisible
                ? { labelKo: firstVisible.labelKo, nodeId: firstVisible.id }
                : { labelKo: targetLabel },
            },
          ],
          anchorLat: input.anchorLat,
          anchorLng: input.anchorLng,
          contextLabelKo: input.contextLabelKo,
        });
        if (applied.ok) {
          reservedOpIds.push(...applied.reservedOpIds);
        }
        plan = markStep(plan, step.id, "done", {
          graphCommand: {
            op: step.graphCommand.op,
            targetRef: { labelKo: targetLabel },
          },
          noteKo: applied.ok ? "field ready" : "reserve prep failed",
        });
        continue;
      }

      const ok = flushWorkingSetDiffSync({
        plan,
        buffer,
        compareCommand: step.graphCommand,
        ...anchors,
        contextLabelKo: input.contextLabelKo,
      });
      plan = markStep(plan, step.id, ok ? "done" : "blocked", {
        noteKo: ok
          ? `Diff ?? ${buffer.commandCount}?`
          : "Diff ?? ??",
      });
      continue;
    }

    if (step.kind === "tool" && step.toolId === "ranking.pick") {
      if (!buffer.flushed) {
        flushWorkingSetDiffSync({
          plan,
          buffer,
          compareCommand: null,
          ...anchors,
          contextLabelKo: input.contextLabelKo,
        });
      }
      const graph = readSessionGraph(contextEventId);
      const nodes = visiblePlaceNodes(graph);
      const selectionIds = new Set(graph?.selectionIds ?? []);
      const compareTargets = nodes.filter(
        (n) => selectionIds.has(n.id) || n.pinned,
      );
      const pool = compareTargets.length >= 2 ? compareTargets : nodes.slice(0, 2);
      const toolResult = invokeRimvioTool("ranking.pick", {
        ...toolBaseInput({ utterance: input.utterance, ...anchors }),
        candidates: pool.map((n) => ({
          id: n.id,
          labelKo: n.labelKo,
          rating: n.rating,
          walkMinutes: n.walkMinutes,
          priceBand: n.priceBand,
          reservable: n.reservable,
          localFavorite: n.localFavorite,
          liteapiOfferId:
            typeof n.attrs.liteapiOfferId === "string"
              ? n.attrs.liteapiOfferId
              : null,
          liteapiHotelId:
            typeof n.attrs.liteapiHotelId === "string"
              ? n.attrs.liteapiHotelId
              : null,
          amountLabel:
            typeof n.attrs.amountLabel === "string" ? n.attrs.amountLabel : null,
        })),
      });
      pickedLabelKo = toolResult.pickedLabelKo ?? pool[0]?.labelKo ?? null;
      stampOfferOntoPickedNode({
        contextEventId,
        pickedId: toolResult.pickedId,
        pickedLabelKo,
        candidates: toolResult.candidates,
      });
      if (pickedLabelKo) {
        applyGraphCommands({
          contextEventId,
          commands: [
            {
              op: "pin_node",
              targetRef: { labelKo: pickedLabelKo },
            },
          ],
          anchorLat: input.anchorLat,
          anchorLng: input.anchorLng,
          contextLabelKo: input.contextLabelKo,
        });
      }
      plan = markStep(plan, step.id, "done", {
        noteKo: toolResult.summaryKo,
      });
      continue;
    }

    if (step.kind === "soft_navigate") {
      if (!buffer.flushed) {
        flushWorkingSetDiffSync({
          plan,
          buffer,
          compareCommand: null,
          ...anchors,
          contextLabelKo: input.contextLabelKo,
        });
      }
      const soft = tryRunSoftSurfaceCommand({
        utterance: step.noteKo?.trim() || "? ??",
        graph: readSessionGraph(contextEventId),
        contextEventId,
        contextLabelKo: input.contextLabelKo,
      });
      plan = markStep(plan, step.id, soft ? "done" : "blocked", {
        noteKo: soft?.assistantReplyKo ?? "navigate miss",
      });
      if (soft?.mapsUrl) {
        // surface maps via assistant line
      }
      continue;
    }

    if (step.kind === "wait_commit") {
      plan = markStep(plan, step.id, "done", {
        noteKo: "????? ???? ????",
      });
      break;
    }

    plan = markStep(plan, step.id, "skipped");
  }

  const pickLine = pickedLabelKo
    ? `${pickedLabelKo} reserve prep queued`
    : plan.requiresFieldCommit
      ? "reserve prep queued"
      : "same condition retuned";
  const waitingCommit =
    plan.requiresFieldCommit &&
    (reservedOpIds.length > 0 ||
      plan.steps.some((step) => step.kind === "wait_commit"));

  return {
    ok: true,
    plan,
    assistantReplyKo: `${preview}\n\n${pickLine}`,
    reservedOpIds,
    pickedLabelKo,
    waitingCommit,
    diffBundleApplied: buffer.flushed && buffer.commandCount > 0,
    diffCommandCount: buffer.commandCount,
  };
}

export type ExecuteActionPlanInput = {
  utterance: string;
  contextEventId: string;
  anchorLat?: number | null;
  anchorLng?: number | null;
  contextLabelKo?: string | null;
  /** Per-step AgentController.observe (default true). */
  enableStepObserve?: boolean;
  /** Forwarded to agentController.observe — LLM stays outside Executor. */
  observeUseLlm?: boolean;
  history?: readonly AgentHistoryTurn[] | null;
  /** Conversation context — passed into replan Planner. */
  previousObservations?: readonly AgentObservation[] | null;
};

/**
 * Execute an existing ActionPlanV1 (Agent refine/replan re-entry).
 * Skips steps already done/skipped. Never Reality Commit.
 */
export async function executeActionPlanAsync(
  planInput: ActionPlanV1,
  input: ExecuteActionPlanInput,
): Promise<ActionPlannerRunResult> {
  const contextEventId = input.contextEventId.trim();
  ensureSessionGraph({
    contextEventId,
    anchorLat: input.anchorLat,
    anchorLng: input.anchorLng,
  });

  let plan = planInput;
  const reservedOpIds: string[] = [];
  let pickedLabelKo: string | null = null;
  const chain = parseNlIntentChain(input.utterance);
  const preview = shouldRunMultiIntentPlanner(chain)
    ? formatMultiIntentPreviewKo(chain.atoms, plan)
    : formatActionPlanPreviewKo(plan);
  const anchors = {
    anchorLat: input.anchorLat,
    anchorLng: input.anchorLng,
  };
  const buffer = createWorkingSetDiffBuffer();
  const enableStepObserve = input.enableStepObserve !== false;
  let stepIndex = 0;
  let lastTool: ToolInvokeResult | null = null;
  let agentHalt: "ask_user" | "stop" | null = null;
  let haltMessageKo: string | null = null;
  let safety = createAgentSafetyBudget();
  const observationTrail: AgentObservation[] = [
    ...(input.previousObservations ?? []),
  ];

  const finish = (): ActionPlannerRunResult => {
    const pickLine = pickedLabelKo
      ? `${pickedLabelKo} reserve prep queued`
      : plan.requiresFieldCommit
        ? "reserve prep queued"
        : "same condition retuned";
    // Human Field Commit gate — Agent never Reality-commits.
    const waitingCommit =
      plan.requiresFieldCommit &&
      (reservedOpIds.length > 0 ||
        plan.steps.some((step) => step.kind === "wait_commit"));
    return {
      ok: true,
      plan,
      assistantReplyKo: haltMessageKo
        ? haltMessageKo
        : `${preview}\n\n${pickLine}`,
      reservedOpIds,
      pickedLabelKo,
      waitingCommit,
      diffBundleApplied: buffer.flushed && buffer.commandCount > 0,
      diffCommandCount: buffer.commandCount,
      agentHalt,
    };
  };

  while (stepIndex < plan.steps.length) {
    safety = bumpLoopIteration(safety);
    const exhausted = isAgentLoopExhausted(safety);
    if (exhausted) {
      agentHalt = "ask_user";
      haltMessageKo = safetyHaltMessageKo(exhausted);
      return finish();
    }

    const step = plan.steps[stepIndex]!;
    if (step.status === "done" || step.status === "skipped") {
      stepIndex += 1;
      continue;
    }
    lastTool = null;
    safety = bumpStepExecuted(safety);
    if (safety.stepsExecuted > AGENT_MAX_STEPS) {
      agentHalt = "ask_user";
      haltMessageKo = safetyHaltMessageKo("max_steps");
      return finish();
    }

    if (step.kind === "resolve_entity" && step.entityLabelKo) {
      const args = resolveEntityToolArgs(step, input.utterance, anchors);
      const toolResult = await invokeRimvioToolAsync(args.toolId, args.invoke);
      lastTool = toolResult;
      const hasHits = Boolean(toolResult.candidates?.length);
      if (hasHits) {
        const ordered = injectLookupCandidates({
          contextEventId,
          candidates: toolResult.candidates,
          preferredLabelKo: args.pinLabelKo,
          ...anchors,
          kind: args.domain === "poi" ? "poi" : args.domain,
          stampDiff: false,
        });
        buffer.domain = args.domain === "poi" ? "poi" : args.domain;
        buffer.candidates.push(...ordered.slice(0, 4));
        if (!buffer.pinLabels.includes(args.pinLabelKo)) {
          buffer.pinLabels.push(args.pinLabelKo);
        }
        plan = markStep(plan, step.id, "done", {
          noteKo: toolResult.summaryKo,
          toolId: args.toolId,
          entityLabelKo: args.pinLabelKo,
        });
      } else {
        // Empty hotel.search — blocked so Agent → refinePlanStep (not silent done).
        plan = markStep(plan, step.id, "blocked", {
          noteKo: toolResult.summaryKo || "후보 0곳",
          toolId: args.toolId,
          entityLabelKo: args.pinLabelKo,
        });
      }
    } else if (step.kind === "graph_command" && step.graphCommand) {
      if (step.graphCommand.op === "reserve_prep" || step.graphCommand.op === "payment_prep") {
        if (!buffer.flushed) {
          await flushWorkingSetDiffAsync({
            plan,
            buffer,
            compareCommand: null,
            ...anchors,
            contextLabelKo: input.contextLabelKo,
          });
        }
        const rawTarget =
          pickedLabelKo ?? step.graphCommand.targetRef.labelKo;
        const ordinalFirst = parseOrdinalIndex(rawTarget) != null;
        const firstVisible = ordinalFirst
          ? visiblePlaceNodes(readSessionGraph(contextEventId))[0]
          : null;
        const targetLabel =
          firstVisible?.labelKo ?? (ordinalFirst ? null : rawTarget);
        if (!targetLabel) {
          plan = markStep(plan, step.id, "blocked", {
            noteKo: "reserve prep failed",
          });
        } else {
          const applied = await applyGraphCommandsAsync({
            contextEventId,
            commands: [
              {
                op: step.graphCommand.op,
                targetRef: firstVisible
                  ? { labelKo: firstVisible.labelKo, nodeId: firstVisible.id }
                  : { labelKo: targetLabel },
              },
            ],
            anchorLat: input.anchorLat,
            anchorLng: input.anchorLng,
            contextLabelKo: input.contextLabelKo,
          });
          if (applied.ok) {
            reservedOpIds.push(...applied.reservedOpIds);
          }
          plan = markStep(plan, step.id, "done", {
            graphCommand: {
              op: step.graphCommand.op,
              targetRef: { labelKo: targetLabel },
            },
            noteKo: applied.ok ? "field ready" : "reserve prep failed",
          });
        }
      } else {
        const ok = await flushWorkingSetDiffAsync({
          plan,
          buffer,
          compareCommand: step.graphCommand,
          ...anchors,
          contextLabelKo: input.contextLabelKo,
        });
        plan = markStep(plan, step.id, ok ? "done" : "blocked", {
          noteKo: ok
            ? `Diff ?? ${buffer.commandCount}?`
            : "Diff ?? ??",
        });
      }
    } else if (step.kind === "tool" && step.toolId === "ranking.pick") {
      if (!buffer.flushed) {
        await flushWorkingSetDiffAsync({
          plan,
          buffer,
          compareCommand: null,
          ...anchors,
          contextLabelKo: input.contextLabelKo,
        });
      }
      const graph = readSessionGraph(contextEventId);
      const nodes = visiblePlaceNodes(graph);
      const selectionIds = new Set(graph?.selectionIds ?? []);
      const compareTargets = nodes.filter(
        (n) => selectionIds.has(n.id) || n.pinned,
      );
      const pool = compareTargets.length >= 2 ? compareTargets : nodes.slice(0, 2);
      const toolResult = await invokeRimvioToolAsync("ranking.pick", {
        ...toolBaseInput({ utterance: input.utterance, ...anchors }),
        candidates: pool.map((n) => ({
          id: n.id,
          labelKo: n.labelKo,
          rating: n.rating,
          walkMinutes: n.walkMinutes,
          priceBand: n.priceBand,
          reservable: n.reservable,
          localFavorite: n.localFavorite,
          liteapiOfferId:
            typeof n.attrs.liteapiOfferId === "string"
              ? n.attrs.liteapiOfferId
              : null,
          liteapiHotelId:
            typeof n.attrs.liteapiHotelId === "string"
              ? n.attrs.liteapiHotelId
              : null,
          amountLabel:
            typeof n.attrs.amountLabel === "string" ? n.attrs.amountLabel : null,
        })),
      });
      lastTool = toolResult;
      pickedLabelKo = toolResult.pickedLabelKo ?? pool[0]?.labelKo ?? null;
      stampOfferOntoPickedNode({
        contextEventId,
        pickedId: toolResult.pickedId,
        pickedLabelKo,
        candidates: toolResult.candidates,
      });
      if (pickedLabelKo) {
        await applyGraphCommandsAsync({
          contextEventId,
          commands: [
            {
              op: "pin_node",
              targetRef: { labelKo: pickedLabelKo },
            },
          ],
          anchorLat: input.anchorLat,
          anchorLng: input.anchorLng,
          contextLabelKo: input.contextLabelKo,
        });
      }
      plan = markStep(plan, step.id, "done", {
        noteKo: toolResult.summaryKo,
      });
    } else if (step.kind === "soft_navigate") {
      if (!buffer.flushed) {
        await flushWorkingSetDiffAsync({
          plan,
          buffer,
          compareCommand: null,
          ...anchors,
          contextLabelKo: input.contextLabelKo,
        });
      }
      const soft = tryRunSoftSurfaceCommand({
        utterance: step.noteKo?.trim() || "? ??",
        graph: readSessionGraph(contextEventId),
        contextEventId,
        contextLabelKo: input.contextLabelKo,
      });
      plan = markStep(plan, step.id, soft ? "done" : "blocked", {
        noteKo: soft?.assistantReplyKo ?? "navigate miss",
      });
    } else if (step.kind === "wait_commit") {
      plan = markStep(plan, step.id, "done", {
        noteKo: "승인 대기 · Field에서 확정",
      });
    } else {
      plan = markStep(plan, step.id, "skipped");
    }

    const finishedStep =
      plan.steps.find((s) => s.id === step.id) ?? plan.steps[stepIndex]!;

    if (enableStepObserve) {
      const observation = createObservation({
        plan,
        step: finishedStep,
        tool: lastTool,
        reservedOpIds,
        pickedLabelKo,
        diffBundleApplied: buffer.flushed && buffer.commandCount > 0,
        diffCommandCount: buffer.commandCount,
      });
      observationTrail.push(observation);
      // LLM judgment stays in AgentController — Executor only calls observe.
      let decision = await agentController.observe(observation, {
        utterance: input.utterance,
        history: input.history,
        useLlm: input.observeUseLlm === true,
        plan,
        previousObservations: observationTrail,
        refineAttempt: safety.refineCount,
      });
      decision = enforceHumanCommitGate(decision, finishedStep);

      switch (decision.type) {
        case "continue":
          // wait_commit → stop for human Field approval (never auto-commit).
          if (finishedStep.kind === "wait_commit") {
            agentHalt = "stop";
            haltMessageKo = safetyHaltMessageKo("wait_commit_human_gate");
            return finish();
          }
          stepIndex += 1;
          break;
        case "replan": {
          if (!canAgentReplan(safety)) {
            agentHalt = "ask_user";
            haltMessageKo = safetyHaltMessageKo("max_replans");
            return finish();
          }
          const nextPlan = await agentController.replan({
            utterance: input.utterance,
            contextEventId,
            reason: decision.reason,
            history: input.history,
            useLlm: input.observeUseLlm === true,
            currentPlan: plan,
            previousObservations: observationTrail,
          });
          if (nextPlan) {
            safety = bumpReplan(safety);
            plan = nextPlan;
            stepIndex = 0;
            buffer.flushed = false;
            buffer.candidates = [];
            buffer.pinLabels = [];
            buffer.commandCount = 0;
          } else {
            stepIndex += 1;
          }
          break;
        }
        case "refine": {
          if (!canAgentRefine(safety)) {
            if (canAgentReplan(safety)) {
              const nextPlan = await agentController.replan({
                utterance: input.utterance,
                contextEventId,
                reason:
                  decision.changes?.reasonKo ||
                  "refine exhausted — rebuild plan",
                history: input.history,
                useLlm: input.observeUseLlm === true,
                currentPlan: plan,
                previousObservations: observationTrail,
              });
              if (nextPlan) {
                safety = bumpReplan(safety);
                plan = nextPlan;
                stepIndex = 0;
                buffer.flushed = false;
                buffer.candidates = [];
                buffer.pinLabels = [];
                buffer.commandCount = 0;
                break;
              }
            }
            agentHalt = "ask_user";
            haltMessageKo = safetyHaltMessageKo("max_refines");
            return finish();
          }
          // Agent judgment → search condition change → refinePlanStep.
          const refined = agentController.refine(plan, decision);
          if (refined) {
            safety = bumpRefine(safety);
            plan = refined;
            const nextPending = plan.steps.findIndex(
              (s) => s.status === "pending",
            );
            stepIndex = nextPending >= 0 ? nextPending : stepIndex + 1;
          } else {
            stepIndex += 1;
          }
          break;
        }
        case "ask_user":
          agentHalt = "ask_user";
          haltMessageKo = decision.message;
          return finish();
        case "stop":
          agentHalt = "stop";
          if (finishedStep.kind === "wait_commit" || plan.requiresFieldCommit) {
            haltMessageKo =
              haltMessageKo ?? safetyHaltMessageKo("wait_commit_human_gate");
          }
          return finish();
        default:
          stepIndex += 1;
          break;
      }
    } else if (finishedStep.kind === "wait_commit") {
      break;
    } else {
      stepIndex += 1;
    }
  }

  return finish();
}

/**
 * Live Action Planner — buildActionPlan then executeActionPlanAsync.
 */
export async function tryRunActionPlannerAsync(input: {
  utterance: string;
  contextEventId: string;
  anchorLat?: number | null;
  anchorLng?: number | null;
  contextLabelKo?: string | null;
}): Promise<ActionPlannerRunResult | null> {
  if (!isCompoundActionUtterance(input.utterance)) {
    return null;
  }

  const contextEventId = input.contextEventId.trim();
  if (!contextEventId) {
    return null;
  }

  ensureSessionGraph({
    contextEventId,
    anchorLat: input.anchorLat,
    anchorLng: input.anchorLng,
  });

  const plan = buildActionPlan({
    utterance: input.utterance,
    contextEventId,
    graph: readSessionGraph(contextEventId),
  });
  if (!plan) {
    return null;
  }

  return executeActionPlanAsync(plan, {
    utterance: input.utterance,
    contextEventId,
    anchorLat: input.anchorLat,
    anchorLng: input.anchorLng,
    contextLabelKo: input.contextLabelKo,
    enableStepObserve: true,
    observeUseLlm: false,
  });
}
