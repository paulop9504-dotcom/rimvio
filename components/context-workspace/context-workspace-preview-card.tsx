"use client";

/**
 * Workspace Preview — map teaser only.
 * 펼치기 → full Context Workspace (cards · prompt · tools).
 */

import { useMemo } from "react";
import type { WorkspacePreviewComposePayload } from "@/lib/globe/assistant/context-agent-compose-thread-store";
import { dispatchContextWorkspaceExpand } from "@/lib/context-workspace/workspace-expand-bridge";
import { WorkspaceMapView } from "@/components/context-workspace/workspace-map-view";
import { copy } from "@/lib/copy/human-ko";
import { cn } from "@/lib/utils";

export type ContextWorkspacePreviewCardProps = {
  contextEventId: string;
  payload: WorkspacePreviewComposePayload;
  className?: string;
};

export function ContextWorkspacePreviewCard({
  contextEventId,
  payload,
  className,
}: ContextWorkspacePreviewCardProps) {
  const openWorkspace = () => {
    dispatchContextWorkspaceExpand({
      contextEventId,
      source: "preview_expand",
    });
  };

  const count = payload.nodes.length;
  const pins = useMemo(
    () =>
      payload.nodes.map((n) => ({
        id: n.id,
        title: n.title,
        lat: n.lat,
        lng: n.lng,
        rating: n.rating,
        amountLabel: n.amountLabel,
      })),
    [payload.nodes],
  );

  return (
    <div
      className={cn(
        "w-full max-w-[min(100%,360px)] overflow-hidden rounded-[20px] bg-white shadow-[0_8px_24px_rgba(25,31,40,0.08)] ring-1 ring-black/[0.04]",
        className,
      )}
      data-workspace-preview
    >
      <div className="relative h-44">
        <WorkspaceMapView pins={pins} compact preferPlaceholder />
        <button
          type="button"
          className="absolute right-2.5 top-2.5 z-[2] rounded-full bg-[#3182f6] px-3 py-1.5 text-[11px] font-bold text-white shadow-sm"
          onClick={openWorkspace}
          data-workspace-preview-expand
        >
          {copy.globe.workspacePreviewExpand}
        </button>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/35 to-transparent px-3 pb-2.5 pt-8">
          <p className="text-[12px] font-semibold text-white">
            {copy.globe.workspacePreviewReady(count)}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <p className="min-w-0 flex-1 truncate text-[12px] text-[#8b95a1]">
          {payload.summaryKo || copy.globe.workspaceDraftHint}
        </p>
        <button
          type="button"
          className="shrink-0 rounded-full bg-[#e8f3ff] px-3 py-1.5 text-[12px] font-bold text-[#3182f6]"
          onClick={openWorkspace}
        >
          {copy.globe.workspacePreviewExpand}
        </button>
      </div>
    </div>
  );
}
