import React from "react";
import { useDisconnectPresence, useRoomHeartbeat } from "@/hooks/useRooms";
import type { Id } from "../../convex/_generated/dataModel";

const HEARTBEAT_INTERVAL_MS = 20_000;

export function useJamRoomPresence(roomId: string | undefined, enabled: boolean) {
  const roomHeartbeat = useRoomHeartbeat();
  const disconnectPresence = useDisconnectPresence();
  const sessionIdRef = React.useRef<string | null>(null);
  const sessionTokenRef = React.useRef<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isConnected, setIsConnected] = React.useState(false);

  if (!sessionIdRef.current) {
    sessionIdRef.current = `mobile-room-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
  }

  React.useEffect(() => {
    if (!roomId || !enabled) {
      if (sessionTokenRef.current) {
        disconnectPresence({ sessionToken: sessionTokenRef.current }).catch(() => {});
        sessionTokenRef.current = null;
      }
      setIsConnected(false);
      return;
    }

    let cancelled = false;

    const sendHeartbeat = async () => {
      try {
        const result = await roomHeartbeat({
          interval: HEARTBEAT_INTERVAL_MS,
          roomId: roomId as Id<"rooms">,
          sessionId: sessionIdRef.current!,
        });
        const sessionToken =
          typeof result === "string" ? result : result?.sessionToken;

        if (cancelled) return;

        if (sessionToken) {
          sessionTokenRef.current = sessionToken;
        }
        setError(null);
        setIsConnected(true);
      } catch (err) {
        if (cancelled) return;
        setIsConnected(false);
        setError(getPresenceError(err));
      }
    };

    sendHeartbeat();
    const timer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
      if (sessionTokenRef.current) {
        disconnectPresence({ sessionToken: sessionTokenRef.current }).catch(() => {});
        sessionTokenRef.current = null;
      }
    };
  }, [disconnectPresence, enabled, roomHeartbeat, roomId]);

  return { error, isConnected };
}

function getPresenceError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("ROOM_INACTIVE")) {
    return "This room is not active right now.";
  }
  if (message.includes("PRIVATE_ROOM")) {
    return "This room is private.";
  }
  if (message.includes("ROOM_NOT_FOUND")) {
    return "Room not found.";
  }

  return "Could not join this room as a listener.";
}
