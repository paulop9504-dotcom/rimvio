"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useCopy } from "@/hooks/use-copy";
import { subscribeCoordinationContextSignals } from "@/lib/globe/market/coordination/client/subscribe-coordination-context-signals";
import {
  openFieldTradesForCoordination,
  subscribeAgentCoordinationAttention,
} from "@/lib/globe/market/coordination/agent-coordination-attention-bridge";
import {
  agentNegotiationRoomPath,
  syncAgentCoordinationFocusState,
} from "@/lib/globe/market/coordination/agent-negotiation-store";
import { readUserFocusDeferringNegotiationSync } from "@/lib/globe/market/coordination/client/read-user-focus-defer-client";

/** Global coordination mount — attention toasts + focus/calendar room sync. */
export function useAgentCoordinationMount(): void {
  const copy = useCopy();
  const coordinationUi = copy.globe.coordination;

  useEffect(() => {
    return subscribeAgentCoordinationAttention((event) => {
      if (event.kind === "slot_needed" && readUserFocusDeferringNegotiationSync()) {
        return;
      }
      const openRoom = () => {
        window.location.assign(agentNegotiationRoomPath(event.handshakeId));
      };
      const openTrades = () => {
        openFieldTradesForCoordination(event.handshakeId);
      };

      switch (event.kind) {
        case "slot_needed":
          toast(coordinationUi.attentionSlotNeeded(event.productTitle), {
            action: { label: coordinationUi.attentionOpenRoom, onClick: openRoom },
          });
          break;
        case "proposal_ready":
          toast(coordinationUi.attentionProposalReady(event.productTitle), {
            action: { label: coordinationUi.attentionReviewCta, onClick: openTrades },
          });
          break;
        case "peer_approved":
          toast(coordinationUi.attentionPeerApproved(event.productTitle), {
            action: { label: coordinationUi.attentionReviewCta, onClick: openTrades },
          });
          break;
        case "fully_approved":
          toast.success(coordinationUi.attentionFullyApproved(event.productTitle), {
            action: { label: coordinationUi.attentionOpenTrades, onClick: openTrades },
          });
          break;
        default:
          break;
      }
    });
  }, [coordinationUi]);

  useEffect(() => {
    void syncAgentCoordinationFocusState();
    const unsubSignals = subscribeCoordinationContextSignals(() => {
      void syncAgentCoordinationFocusState();
    });
    const timer = window.setInterval(() => {
      void syncAgentCoordinationFocusState();
    }, 60_000);
    return () => {
      unsubSignals();
      window.clearInterval(timer);
    };
  }, []);
}