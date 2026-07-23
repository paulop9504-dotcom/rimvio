"use client";

/**
 * Context Workspace shell — GPT chat over map.
 * Full-bleed map · collapsible chat · bottom prompt. No place card.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { List, X } from "lucide-react";
import { toast } from "sonner";
import {
  applyWorkspaceTransition,
  clearContextWorkspace,
  commitContextWorkspaceToGlobe,
  domainLabelKo,
  estimateWorkspaceProgressPercent,
  readContextWorkspace,
  readContextWorkspaceExpanded,
  subscribeContextWorkspaceOpen,
  subscribeContextWorkspaceUpdated,
  writeContextWorkspaceExpanded,
  type ContextWorkspaceNode,
  type ContextWorkspaceState,
} from "@/lib/context-workspace";
import { buildWorkspaceCommitPreview } from "@/lib/context-workspace/build-commit-preview";
import {
  appendWorkspaceChatTurn,
  clearWorkspaceChat,
} from "@/lib/context-workspace/workspace-chat-store";
import { subscribeContextWorkspaceExpand } from "@/lib/context-workspace/workspace-expand-bridge";
import { WorkspaceCommitPreviewSheet } from "@/components/context-workspace/workspace-commit-preview-sheet";
import { WorkspaceChatPanel } from "@/components/context-workspace/workspace-chat-panel";
import { WorkspaceMapView } from "@/components/context-workspace/workspace-map-view";
import { WorkspaceNodePeek } from "@/components/context-workspace/workspace-node-peek";
import { WorkspacePromptBar } from "@/components/context-workspace/workspace-prompt-bar";
import { copy } from "@/lib/copy/human-ko";
import { cn } from "@/lib/utils";

export type ContextWorkspaceShellProps = {
  contextEventId: string | null | undefined;
  projectTitleKo?: string | null;
  className?: string;
};

function formatRating(rating: number | null): string {
  if (rating == null || !Number.isFinite(rating)) {
    return "—";
  }
  return rating.toFixed(1);
}

function formatPrice(node: ContextWorkspaceNode): string {
  if (node.amountLabel?.trim()) {
    return node.amountLabel.trim();
  }
  if (node.priceBand != null) {
    return `가격대 ${node.priceBand}`;
  }
  return "가격 미정";
}

export function ContextWorkspaceShell({
  contextEventId,
  projectTitleKo = null,
  className,
}: ContextWorkspaceShellProps) {
  const [state, setState] = useState<ContextWorkspaceState | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [commitPreviewOpen, setCommitPreviewOpen] = useState(false);
  const [commitBusy, setCommitBusy] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [peekDismissedId, setPeekDismissedId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const id = contextEventId?.trim();
    if (!id) {
      setState(null);
      return;
    }
    const next = readContextWorkspace(id);
    setState(next);
    if (!next || next.status === "closed" || next.status === "committed") {
      setExpanded(false);
      writeContextWorkspaceExpanded(id, false);
    }
  }, [contextEventId]);

  useEffect(() => {
    refresh();
    const id = contextEventId?.trim();
    if (id) {
      const draft = readContextWorkspace(id);
      if (
        draft &&
        (draft.status === "editing" || draft.status === "committing") &&
        readContextWorkspaceExpanded(id)
      ) {
        setExpanded(true);
      }
    }
    const unsubUpdate = subscribeContextWorkspaceUpdated((eventId) => {
      if (eventId === contextEventId?.trim()) {
        refresh();
      }
    });
    const unsubOpen = subscribeContextWorkspaceOpen((detail) => {
      if (detail.contextEventId === contextEventId?.trim()) {
        refresh();
      }
    });
    const unsubExpand = subscribeContextWorkspaceExpand((detail) => {
      if (detail.contextEventId === contextEventId?.trim()) {
        refresh();
        setExpanded(true);
        setChatOpen(true);
        writeContextWorkspaceExpanded(detail.contextEventId, true);
      }
    });
    return () => {
      unsubUpdate();
      unsubOpen();
      unsubExpand();
    };
  }, [contextEventId, refresh]);

  const visibleNodes = useMemo(
    () => state?.nodes.filter((n) => n.visible) ?? [],
    [state],
  );
  const selectedId =
    state?.selectedIds[0] ??
    visibleNodes.find((n) => n.selected)?.id ??
    visibleNodes.find((n) => !n.bookmarked)?.id ??
    visibleNodes[0]?.id ??
    null;

  const mapPins = useMemo(
    () =>
      visibleNodes.map((n) => ({
        id: n.id,
        title: n.title,
        lat: n.lat,
        lng: n.lng,
        rating: n.rating,
        amountLabel: n.amountLabel,
        selected: n.id === selectedId,
        bookmarked: n.bookmarked,
        photoSpot:
          n.tags.includes("photo_spot") ||
          /포토|사진|photo/i.test(`${n.title} ${n.summaryKo}`),
      })),
    [visibleNodes, selectedId],
  );

  const onPinToggle = useCallback(
    (id: string) => {
      const node = visibleNodes.find((n) => n.id === id);
      if (!node) {
        return;
      }
      const eventId = contextEventId?.trim() ?? "";
      applyWorkspaceTransition({
        contextEventId: eventId,
        op: "bookmark",
        nodeIds: [id],
        pin: !node.bookmarked,
      });
      if (!node.bookmarked) {
        toast.success(copy.globe.workspacePinToast(node.title));
      }
    },
    [visibleNodes, contextEventId],
  );

  const onRemovePin = useCallback(
    (id: string) => {
      const eventId = contextEventId?.trim() ?? "";
      applyWorkspaceTransition({
        contextEventId: eventId,
        op: "remove",
        nodeIds: [id],
      });
    },
    [contextEventId],
  );

  const commitPreview = useMemo(
    () => (state ? buildWorkspaceCommitPreview(state) : null),
    [state],
  );

  const onSelect = useCallback(
    (nodeId: string) => {
      const id = contextEventId?.trim();
      if (!id) {
        return;
      }
      applyWorkspaceTransition({
        contextEventId: id,
        op: "select",
        nodeIds: [nodeId],
      });
      setListOpen(false);
      setPeekDismissedId(null);
      setChatOpen(true);
      const node = readContextWorkspace(id)?.nodes.find((n) => n.id === nodeId);
      if (node) {
        const photo =
          node.tags.includes("photo_spot") ||
          /포토|사진|photo|전망|야경/i.test(`${node.title} ${node.summaryKo}`);
        const why =
          node.summaryKo.trim() ||
          (photo
            ? "사진 찍기 좋은 명소로 잡힌 곳이에요"
            : `${domainLabelKo(node.kind)} 후보`);
        appendWorkspaceChatTurn({
          contextEventId: id,
          role: "assistant",
          text: photo
            ? `📸 ${node.title}\n왜 포토스팟: ${why}`
            : `${node.title}\n${why}`,
        });
      }
    },
    [contextEventId],
  );

  const runCommit = useCallback(() => {
    const id = contextEventId?.trim();
    if (!id) {
      return;
    }
    setCommitBusy(true);
    const result = commitContextWorkspaceToGlobe({ contextEventId: id });
    setCommitBusy(false);
    setCommitPreviewOpen(false);
    setExpanded(false);
    writeContextWorkspaceExpanded(id, false);
    if (result.ok) {
      toast.success(copy.globe.workspaceCommitDoneToast);
    }
  }, [contextEventId]);

  const onClose = useCallback(() => {
    const id = contextEventId?.trim();
    if (!id) {
      return;
    }
    setExpanded(false);
    setCommitPreviewOpen(false);
    writeContextWorkspaceExpanded(id, false);
  }, [contextEventId]);

  const onDiscard = useCallback(() => {
    const id = contextEventId?.trim();
    if (!id) {
      return;
    }
    applyWorkspaceTransition({ contextEventId: id, op: "close" });
    clearContextWorkspace(id);
    clearWorkspaceChat(id);
    setExpanded(false);
    setCommitPreviewOpen(false);
  }, [contextEventId]);

  if (!expanded || !state || state.status === "closed") {
    return null;
  }

  const kindLabel = domainLabelKo(state.domain);
  const title =
    projectTitleKo?.trim() ||
    state.query.trim() ||
    state.summaryKo.trim() ||
    copy.globe.workspaceOpenTitle;
  const progress = estimateWorkspaceProgressPercent(state);
  const eventId = contextEventId?.trim() ?? "";
  const selectedNode =
    visibleNodes.find((n) => n.id === selectedId) ?? null;
  const showPeek =
    selectedNode != null && peekDismissedId !== selectedNode.id;

  return (
    <div
      className={cn(
        "pointer-events-auto absolute inset-0 z-[46] bg-[#f7f8fa]",
        className,
      )}
      role="dialog"
      aria-label={copy.globe.workspaceOpenTitle}
      data-context-workspace-open
    >
      <div className="absolute inset-0">
        <WorkspaceMapView
          pins={mapPins}
          selectedId={selectedId}
          onSelectPin={onSelect}
          onPinToggle={onPinToggle}
          onRemovePin={onRemovePin}
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-[2] flex items-start justify-between gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          type="button"
          className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#191f28] shadow-[0_2px_12px_rgba(25,31,40,0.12)]"
          onClick={onClose}
          aria-label={copy.globe.workspaceCollapse}
        >
          <X className="h-4 w-4" strokeWidth={2.25} />
        </button>
        <div className="pointer-events-auto max-w-[55%] rounded-full bg-white/95 px-3 py-1 shadow-[0_2px_12px_rgba(25,31,40,0.1)]">
          <p className="truncate text-center text-[11px] font-bold tracking-tight text-[#191f28]">
            {title}
          </p>
          <p className="text-center text-[9px] tabular-nums text-[#8b95a1]">
            {domainLabelKo(state.domain)} · {visibleNodes.length}곳 · {progress}%
          </p>
        </div>
        <div className="pointer-events-auto flex flex-col items-end gap-1.5">
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#191f28] shadow-[0_2px_12px_rgba(25,31,40,0.12)]"
            onClick={() => setListOpen((v) => !v)}
            aria-label="목록"
            aria-pressed={listOpen}
          >
            <List className="h-4 w-4" strokeWidth={2.25} />
          </button>
          <button
            type="button"
            className="rounded-full bg-[#3182f6] px-2.5 py-1.5 text-[10px] font-bold text-white shadow-[0_2px_12px_rgba(49,130,246,0.35)] disabled:opacity-40"
            onClick={() => setCommitPreviewOpen(true)}
            disabled={visibleNodes.length === 0}
            data-workspace-commit
          >
            {copy.globe.workspaceCommitCta}
          </button>
        </div>
      </div>

      {listOpen ? (
        <div className="pointer-events-auto absolute inset-x-3 top-[5.25rem] z-[3] max-h-[42%] overflow-hidden rounded-[18px] bg-white shadow-[0_12px_40px_rgba(25,31,40,0.16)] ring-1 ring-black/[0.04]">
          <div className="flex items-center justify-between border-b border-black/[0.04] px-3 py-2">
            <p className="text-[12px] font-bold text-[#191f28]">
              {visibleNodes.length}개의 {kindLabel}
            </p>
            <button
              type="button"
              className="text-[11px] font-semibold text-[#8b95a1]"
              onClick={() => setListOpen(false)}
            >
              닫기
            </button>
          </div>
          <div className="max-h-[min(40vh,300px)] space-y-0.5 overflow-y-auto p-1.5">
            {visibleNodes.map((node, index) => (
              <button
                key={node.id}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left",
                  selectedId === node.id ? "bg-[#e8f3ff]" : "hover:bg-[#f9fafb]",
                )}
                onClick={() => onSelect(node.id)}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                    selectedId === node.id
                      ? "bg-[#3182f6] text-white"
                      : "bg-[#f2f4f6] text-[#191f28]",
                  )}
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-bold text-[#191f28]">
                    {node.bookmarked ? "📌 " : ""}
                    {node.title}
                  </span>
                  <span className="block text-[10px] text-[#8b95a1]">
                    ★ {formatRating(node.rating)} · {formatPrice(node)}
                  </span>
                </span>
                {selectedId === node.id ? (
                  <button
                    type="button"
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold",
                      node.bookmarked
                        ? "bg-[#191f28] text-white"
                        : "bg-[#3182f6] text-white",
                    )}
                    onClick={(event) => {
                      event.stopPropagation();
                      applyWorkspaceTransition({
                        contextEventId: eventId,
                        op: "bookmark",
                        nodeIds: [node.id],
                        pin: !node.bookmarked,
                      });
                      if (!node.bookmarked) {
                        toast.success(copy.globe.workspacePinToast(node.title));
                      }
                    }}
                  >
                    {node.bookmarked
                      ? copy.globe.workspacePinDone
                      : copy.globe.workspacePinCta}
                  </button>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Bottom: peek · chat · slim tools · prompt (pin lives on map markers) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[3] flex flex-col gap-1.5 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-20">
        {showPeek && selectedNode ? (
          <WorkspaceNodePeek
            contextEventId={eventId}
            node={selectedNode}
            onClose={() => setPeekDismissedId(selectedNode.id)}
          />
        ) : null}

        <WorkspaceChatPanel
          contextEventId={eventId}
          open={chatOpen}
          onToggle={() => setChatOpen((v) => !v)}
        />

        <div className="pointer-events-auto mx-auto flex max-w-xl gap-1 overflow-x-auto">
          {(
            [
              {
                label: copy.globe.workspaceToolCompare,
                run: () =>
                  applyWorkspaceTransition({
                    contextEventId: eventId,
                    op: "compare",
                    nodeIds:
                      state.selectedIds.length >= 2
                        ? state.selectedIds
                        : visibleNodes.slice(0, 2).map((n) => n.id),
                  }),
              },
              {
                label: copy.globe.workspaceToolOptimizeRoute,
                run: () =>
                  applyWorkspaceTransition({
                    contextEventId: eventId,
                    op: "optimize_route",
                  }),
              },
            ] as const
          ).map((tool) => (
            <button
              key={tool.label}
              type="button"
              className="shrink-0 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-semibold text-[#191f28] shadow-[0_2px_8px_rgba(25,31,40,0.08)]"
              onClick={tool.run}
            >
              {tool.label}
            </button>
          ))}
          <button
            type="button"
            className="shrink-0 rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-medium text-[#8b95a1]"
            onClick={onDiscard}
          >
            닫기
          </button>
        </div>

        <div className="pointer-events-auto mx-auto w-full max-w-xl">
          <WorkspacePromptBar
            contextEventId={eventId}
            compact
            onTurn={() => setChatOpen(true)}
          />
        </div>
      </div>

      {commitPreviewOpen && commitPreview ? (
        <WorkspaceCommitPreviewSheet
          preview={commitPreview}
          busy={commitBusy}
          onConfirm={runCommit}
          onCancel={() => setCommitPreviewOpen(false)}
        />
      ) : null}
    </div>
  );
}
