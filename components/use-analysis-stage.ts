"use client";

import { useEffect, useState } from "react";
import { channelFor, readStageEvent, type StageEvent } from "@/utils/progress";
import { useSupabase } from "@/utils/supabase/client";

export type Connection = "connecting" | "live" | "unavailable";

/**
 * The stage of one analysis, kept current by subscribing to its channel.
 * `since` is when `initial` was true (the row's updated_at), so anything the
 * database published between the server's read and this subscription is
 * replayed rather than missed.
 */
export function useAnalysisStage(
  analysisId: string,
  initial: StageEvent,
  since: string,
  enabled: boolean,
): { event: StageEvent; connection: Connection } {
  const supabase = useSupabase();
  const [event, setEvent] = useState(initial);
  const [connection, setConnection] = useState<Connection>("connecting");

  useEffect(() => {
    if (!enabled) return;
    // Private, so joining runs the subscribe policy against this user's token.
    const channel = supabase
      .channel(channelFor(analysisId), {
        config: { private: true, broadcast: { replay: { since: Date.parse(since), limit: 25 } } },
      })
      .on<Record<string, unknown>>("broadcast", { event: "stage" }, ({ payload }) => {
        const next = readStageEvent(payload);
        if (next) setEvent(next);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setConnection("live");
        // Said out loud: a page that silently stops updating looks like a
        // stuck run.
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setConnection("unavailable");
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, analysisId, since, enabled]);

  return { event, connection };
}
