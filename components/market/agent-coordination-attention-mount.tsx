"use client";

import { useAgentCoordinationMount } from "@/hooks/use-agent-coordination-mount";

/** Global toast bridge for agent coordination attention events. */
export function AgentCoordinationAttentionMount() {
  useAgentCoordinationMount();
  return null;
}
