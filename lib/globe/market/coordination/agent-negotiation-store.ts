"use client";

import {
  advanceAgentNegotiationTurn,
  answerAgentNegotiationSlot,
  createAgentNegotiationRoom,
  recordAgentNegotiationPartyApproval,
  refreshAgentNegotiationPauseState,
} from "@/lib/globe/market/coordination/agent-negotiation-room-engine";
import { dispatchAgentCoordinationAttention } from "@/lib/globe/market/coordination/agent-coordination-attention-bridge";
import { detectAgentCoordinationAttentionChanges } from "@/lib/globe/market/coordination/detect-agent-coordination-attention";
import {
  readCoordinationPatchContext,
  type CoordinationPatchContext,
} from "@/lib/globe/market/coordination/client/read-coordination-patch-context";
import {
  readUserFocusDeferringNegotiationSync,
  refreshUserFocusDeferringNegotiation,
} from "@/lib/globe/market/coordination/client/read-user-focus-defer-client";
import {
  mergeCalendarBusyIntoRoom,
  parseCalendarBusyIntervalWire,
  refreshCoordinationRoomMeetSlotChips,
} from "@/lib/globe/market/coordination/coordination-calendar-busy";
import {
  isFocusDeferPaused,
  refreshAgentNegotiationFocusDeferState,
} from "@/lib/globe/market/coordination/read-user-focus-defer";
import { AGENT_NEGOTIATION_FOCUS_DEFER_MESSAGE_KO } from "@/lib/globe/market/coordination/agent-coordination-focus-copy";
import {
  fetchActiveAgentCoordinationRoomsRemote,
  fetchAgentCoordinationRoomRemote,
  patchAgentCoordinationRoomRemote,
} from "@/lib/globe/market/coordination/client/fetch-agent-coordination-client";
import type {
  AgentNegotiationRoomRecord,
  AgentNegotiationSlotKey,
  StartAgentNegotiationRoomInput,
} from "@/lib/globe/market/coordination/agent-negotiation-types";
import type { CalendarBusyInterval } from "@/lib/globe/market/coordination/agent-negotiation-slot-chips";
import type { MarketTradeSessionView } from "@/lib/globe/market/market-trade-types";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const STORAGE_KEY = "rimvio-agent-negotiation-rooms-v1";
const UPDATE_EVENT = "rimvio:agent-negotiation-updated";
const CONTEXT_UPDATE_EVENT = "rimvio:coordination-context-updated";
const CONTEXT_SNAPSHOT_TTL_MS = 60_000;

type RoomMap = Record<string, AgentNegotiationRoomRecord>;

type CoordinationContextSnapshot = {
  calendarBusyIntervals: CalendarBusyInterval[];
  focusActive: boolean;
  fetchedAtMs: number;
};

let remoteListCache: AgentNegotiationRoomRecord[] | null = null;
let remoteMigrationPending = false;
let remoteRoomsSnapshot: Record<string, AgentNegotiationRoomRecord> = {};
let coordinationContextSnapshot: CoordinationContextSnapshot | null = null;
const coordinationContextListeners = new Set<() => void>();

function wireToBusyIntervals(
  wire: CoordinationPatchContext["calendarBusyIntervals"],
): CalendarBusyInterval[] {
  return parseCalendarBusyIntervalWire(wire);
}

function emitCoordinationContextUpdate(): void {
  if (typeof window === "undefined") {
    return;
  }
  for (const listener of coordinationContextListeners) {
    listener();
  }
  window.dispatchEvent(new CustomEvent(CONTEXT_UPDATE_EVENT));
}

function setCoordinationContextSnapshot(
  patchContext: CoordinationPatchContext,
): CoordinationContextSnapshot {
  const snapshot: CoordinationContextSnapshot = {
    calendarBusyIntervals: wireToBusyIntervals(patchContext.calendarBusyIntervals),
    focusActive: patchContext.focusActive,
    fetchedAtMs: Date.now(),
  };
  coordinationContextSnapshot = snapshot;
  emitCoordinationContextUpdate();
  return snapshot;
}

export function getCoordinationCalendarBusySnapshot(): CalendarBusyInterval[] {
  return coordinationContextSnapshot?.calendarBusyIntervals ?? [];
}

export function subscribeCoordinationCalendarBusy(listener: () => void): () => void {
  coordinationContextListeners.add(listener);
  return () => {
    coordinationContextListeners.delete(listener);
  };
}

function readMap(): RoomMap {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as RoomMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map: RoomMap): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
}

function cacheRoom(room: AgentNegotiationRoomRecord): AgentNegotiationRoomRecord {
  const refreshed = refreshAgentNegotiationPauseState(
    applyLocalCoordinationContext(room),
  );
  const map = readMap();
  map[refreshed.handshakeId] = refreshed;
  writeMap(map);
  return refreshed;
}

function cacheRooms(rooms: readonly AgentNegotiationRoomRecord[]): void {
  const map = readMap();
  for (const room of rooms) {
    map[room.handshakeId] = refreshAgentNegotiationPauseState(
      applyLocalCoordinationContext(room),
    );
  }
  writeMap(map);
}

function applyLocalCoordinationContext(
  room: AgentNegotiationRoomRecord,
): AgentNegotiationRoomRecord {
  const snapshot = coordinationContextSnapshot;
  const focusActive =
    snapshot && Date.now() - snapshot.fetchedAtMs <= CONTEXT_SNAPSHOT_TTL_MS
      ? snapshot.focusActive
      : readUserFocusDeferringNegotiationSync();
  let next = refreshAgentNegotiationFocusDeferState(
    room,
    focusActive,
    AGENT_NEGOTIATION_FOCUS_DEFER_MESSAGE_KO,
  );
  if (
    snapshot &&
    Date.now() - snapshot.fetchedAtMs <= CONTEXT_SNAPSHOT_TTL_MS &&
    snapshot.calendarBusyIntervals.length > 0
  ) {
    next = mergeCalendarBusyIntoRoom(next, snapshot.calendarBusyIntervals);
  }
  return refreshCoordinationRoomMeetSlotChips(next);
}

function isRemoteCoordinationEnabled(): boolean {
  return isSupabaseConfigured();
}

export function isAgentCoordinationMigrationPending(): boolean {
  return remoteMigrationPending;
}

export function listAgentNegotiationRooms(): AgentNegotiationRoomRecord[] {
  if (remoteListCache && remoteListCache.length > 0) {
    return [...remoteListCache]
      .map((room) =>
        refreshAgentNegotiationPauseState(applyLocalCoordinationContext(room)),
      )
      .sort(
        (a, b) =>
          new Date(b.updatedAtIso).getTime() - new Date(a.updatedAtIso).getTime(),
      );
  }
  return Object.values(readMap())
    .map((room) =>
      refreshAgentNegotiationPauseState(applyLocalCoordinationContext(room)),
    )
    .sort(
      (a, b) =>
        new Date(b.updatedAtIso).getTime() - new Date(a.updatedAtIso).getTime(),
    );
}

export function getAgentNegotiationRoom(
  handshakeId: string,
): AgentNegotiationRoomRecord | null {
  const remote = remoteListCache?.find((room) => room.handshakeId === handshakeId);
  if (remote) {
    return refreshAgentNegotiationPauseState(
      applyLocalCoordinationContext(remote),
    );
  }
  const room = readMap()[handshakeId] ?? null;
  return room
    ? refreshAgentNegotiationPauseState(applyLocalCoordinationContext(room))
    : null;
}

function emitCoordinationAttention(rooms: readonly AgentNegotiationRoomRecord[]): void {
  const events = detectAgentCoordinationAttentionChanges({
    previousByHandshake: remoteRoomsSnapshot,
    nextRooms: rooms,
    suppressSlotNeededToast: readUserFocusDeferringNegotiationSync(),
  });
  for (const event of events) {
    dispatchAgentCoordinationAttention(event);
  }
  const nextSnapshot: Record<string, AgentNegotiationRoomRecord> = {};
  for (const room of rooms) {
    nextSnapshot[room.handshakeId] = room;
  }
  remoteRoomsSnapshot = nextSnapshot;
}

export async function refreshAgentNegotiationRoomsFromRemote(): Promise<void> {
  if (!isRemoteCoordinationEnabled()) {
    remoteListCache = null;
    remoteRoomsSnapshot = {};
    return;
  }
  try {
    await refreshUserFocusDeferringNegotiation();
    const result = await fetchActiveAgentCoordinationRoomsRemote();
    remoteMigrationPending = result.migrationPending === true;
    emitCoordinationAttention(result.rooms);
    remoteListCache = result.rooms;
    cacheRooms(result.rooms);
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
  } catch {
    remoteListCache = null;
  }
}

export async function loadAgentNegotiationRoomRemote(
  handshakeId: string,
): Promise<AgentNegotiationRoomRecord | null> {
  if (!isRemoteCoordinationEnabled()) {
    return getAgentNegotiationRoom(handshakeId);
  }
  try {
    const room = await fetchAgentCoordinationRoomRemote(handshakeId);
    if (room) {
      emitCoordinationAttention([room]);
      cacheRoom(room);
      return room;
    }
  } catch {
    // fall through to cache
  }
  return getAgentNegotiationRoom(handshakeId);
}

export async function startAgentNegotiationRoom(
  input: StartAgentNegotiationRoomInput,
): Promise<AgentNegotiationRoomRecord> {
  const patchContext = await readCoordinationPatchContext({
    refreshGoogle: !input.calendarBusyIntervals?.length,
  });
  setCoordinationContextSnapshot(patchContext);
  const startInput: StartAgentNegotiationRoomInput = {
    ...input,
    calendarBusyIntervals:
      input.calendarBusyIntervals ??
      patchContext.calendarBusyIntervals.map((wire) => ({
        startMs: new Date(wire.start).getTime(),
        endMs: new Date(wire.end).getTime(),
      })),
  };
  if (isRemoteCoordinationEnabled()) {
    try {
      const room = await patchAgentCoordinationRoomRemote({
        handshakeId: input.handshakeId,
        action: "start",
        start: startInput,
        calendarBusyIntervals: patchContext.calendarBusyIntervals,
        focusActive: patchContext.focusActive,
        focusDeferMessageKo: patchContext.focusDeferMessageKo,
      });
      return cacheRoom(room);
    } catch {
      // local fallback when migration pending
    }
  }
  const existing = getAgentNegotiationRoom(input.handshakeId);
  if (existing) {
    return existing;
  }
  return cacheRoom(
    mergeCalendarBusyIntoRoom(
      createAgentNegotiationRoom(startInput),
      startInput.calendarBusyIntervals,
    ),
  );
}

export async function bootstrapAgentNegotiationFromSession(
  session: Pick<
    MarketTradeSessionView,
    | "handshakeId"
    | "threadId"
    | "productTitle"
    | "priceLine"
    | "viewerRole"
    | "availabilityPreset"
    | "preferredMeetAtIso"
  >,
  peerDisplayName = "상대",
): Promise<AgentNegotiationRoomRecord> {
  const patchContext = await readCoordinationPatchContext({ refreshGoogle: true });
  return startAgentNegotiationRoom({
    handshakeId: session.handshakeId,
    threadId: session.threadId,
    productTitle: session.productTitle,
    priceLine: session.priceLine,
    peerDisplayName,
    viewerRole: session.viewerRole,
    availabilityPreset: session.availabilityPreset,
    preferredMeetAtIso: session.preferredMeetAtIso,
    calendarBusyIntervals: patchContext.calendarBusyIntervals.map((wire) => ({
      startMs: new Date(wire.start).getTime(),
      endMs: new Date(wire.end).getTime(),
    })),
  });
}

export async function runAgentNegotiationTurn(
  handshakeId: string,
  patchContext?: CoordinationPatchContext,
): Promise<AgentNegotiationRoomRecord | null> {
  const context = patchContext ?? (await readCoordinationPatchContext());
  if (!patchContext) {
    setCoordinationContextSnapshot(context);
  }
  if (isRemoteCoordinationEnabled()) {
    try {
      const room = await patchAgentCoordinationRoomRemote({
        handshakeId,
        action: "tick",
        ...context,
      });
      return cacheRoom(room);
    } catch {
      // local fallback
    }
  }
  const room = getAgentNegotiationRoom(handshakeId);
  if (!room) {
    return null;
  }
  const withBusy = mergeCalendarBusyIntoRoom(
    room,
    wireToBusyIntervals(context.calendarBusyIntervals),
  );
  return cacheRoom(advanceAgentNegotiationTurn(withBusy));
}

export async function syncAgentCoordinationFocusState(): Promise<void> {
  const patchContext = await readCoordinationPatchContext();
  setCoordinationContextSnapshot(patchContext);
  const rooms = listAgentNegotiationRooms().filter(
    (room) => room.state !== "APPROVED" && room.state !== "STUCK",
  );
  if (rooms.length === 0) {
    return;
  }
  const resumeHandshakeIds: string[] = [];
  if (isRemoteCoordinationEnabled()) {
    await Promise.all(
      rooms.map(async (room) => {
        const wasFocusPaused = isFocusDeferPaused(
          room,
          patchContext.focusDeferMessageKo,
        );
        try {
          const next = await patchAgentCoordinationRoomRemote({
            handshakeId: room.handshakeId,
            action: "focus_sync",
            ...patchContext,
          });
          cacheRoom(next);
          if (
            !patchContext.focusActive &&
            wasFocusPaused &&
            next.state === "NEGOTIATING"
          ) {
            resumeHandshakeIds.push(room.handshakeId);
          }
        } catch {
          const local = refreshAgentNegotiationFocusDeferState(
            room,
            patchContext.focusActive,
            patchContext.focusDeferMessageKo,
          );
          cacheRoom(local);
          if (
            !patchContext.focusActive &&
            wasFocusPaused &&
            local.state === "NEGOTIATING"
          ) {
            resumeHandshakeIds.push(room.handshakeId);
          }
        }
      }),
    );
  } else {
    for (const room of rooms) {
      const wasFocusPaused = isFocusDeferPaused(
        room,
        patchContext.focusDeferMessageKo,
      );
      const local = refreshAgentNegotiationFocusDeferState(
        room,
        patchContext.focusActive,
        patchContext.focusDeferMessageKo,
      );
      cacheRoom(local);
      if (
        !patchContext.focusActive &&
        wasFocusPaused &&
        local.state === "NEGOTIATING"
      ) {
        resumeHandshakeIds.push(room.handshakeId);
      }
    }
  }
  for (const handshakeId of resumeHandshakeIds) {
    await runAgentNegotiationTurn(handshakeId, patchContext);
  }
}

export function applyCoordinationCalendarBusyToRoom(
  room: AgentNegotiationRoomRecord,
  busyIntervals: Parameters<typeof mergeCalendarBusyIntoRoom>[1],
): AgentNegotiationRoomRecord {
  return applyLocalCoordinationContext(
    mergeCalendarBusyIntoRoom(room, busyIntervals),
  );
}

export async function submitAgentNegotiationSlotAnswer(input: {
  handshakeId: string;
  slotKey: AgentNegotiationSlotKey;
  valueKo: string;
}): Promise<AgentNegotiationRoomRecord | null> {
  if (isRemoteCoordinationEnabled()) {
    try {
      const room = await patchAgentCoordinationRoomRemote({
        handshakeId: input.handshakeId,
        action: "submit_slot",
        slotKey: input.slotKey,
        valueKo: input.valueKo,
      });
      return cacheRoom(room);
    } catch {
      // local fallback
    }
  }
  const room = getAgentNegotiationRoom(input.handshakeId);
  if (!room) {
    return null;
  }
  return cacheRoom(
    answerAgentNegotiationSlot(room, input.slotKey, input.valueKo),
  );
}

export async function approveAgentNegotiationRoom(
  handshakeId: string,
): Promise<AgentNegotiationRoomRecord | null> {
  if (isRemoteCoordinationEnabled()) {
    try {
      const room = await patchAgentCoordinationRoomRemote({
        handshakeId,
        action: "approve",
      });
      return cacheRoom(room);
    } catch {
      // local fallback
    }
  }
  const room = getAgentNegotiationRoom(handshakeId);
  if (!room) {
    return null;
  }
  return cacheRoom(recordAgentNegotiationPartyApproval(room));
}

export function countActiveAgentNegotiationRooms(): number {
  return listAgentNegotiationRooms().filter(
    (room) => room.state !== "APPROVED" && room.state !== "STUCK",
  ).length;
}

export function subscribeAgentNegotiationRooms(
  listener: () => void,
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(UPDATE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(UPDATE_EVENT, listener);
  };
}

export function agentNegotiationRoomPath(handshakeId: string): string {
  return `/peers/ai-coordination/${encodeURIComponent(handshakeId)}`;
}
