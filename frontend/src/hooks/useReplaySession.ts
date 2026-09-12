"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as C from "@hackrice/contracts";
import type { z } from "zod";
import { request, isApiError } from "@/services/api-client";
import { toChartCandles, type ChartCandle, type Timeframe } from "@/adapters/chart";

type Session = z.infer<typeof C.PublicSession>;
type Snapshot = z.infer<typeof C.ChartSnapshot>;

export interface ReplaySessionState {
  session: Session | null;
  candles: ChartCandle[];
  snapshot: Snapshot | null;
  loading: boolean;
  error: string | null;
  /** Set when the failure is a missing session cookie, so the UI can redirect. */
  unauthenticated: boolean;
}

const MESSAGES: Partial<Record<z.infer<typeof C.ErrorCode>, string>> = {
  insufficient_data: "Not enough imported history for this timeframe. Run the candle import for a wider range.",
  not_found: "That session does not exist, or belongs to another account.",
  session_expired: "This session has expired. Start a new one.",
  provider_unavailable: "The API is unreachable. Check that it is running.",
};

function messageFor(error: unknown): string {
  if (isApiError(error)) return MESSAGES[error.code] ?? `Request failed (${error.code}).`;
  return error instanceof Error ? error.message : "Something went wrong.";
}

/**
 * Loads one replay session and its visible bars.
 *
 * The server owns the cutoff: `chartRange.to` is 0 while exploring, and
 * `/chart/bars` clamps to `allowedRange`, so future candles are never sent.
 * There is no client-side hidden-bar fixture any more.
 */
export function useReplaySession(sessionId: string | null) {
  const [state, setState] = useState<ReplaySessionState>({
    session: null,
    candles: [],
    snapshot: null,
    loading: true,
    error: null,
    unauthenticated: false,
  });

  /** Guards against a slow response overwriting a newer one. */
  const requestSeq = useRef(0);

  const load = useCallback(
    async (id: string, timeframe?: Timeframe) => {
      const seq = ++requestSeq.current;
      setState((s) => ({ ...s, loading: true, error: null }));

      try {
        const session = await request("getSession", { params: { sessionId: id } });
        const tf = timeframe ?? session.timeframe;

        const bars = await request("getBars", {
          params: { sessionId: id },
          query: { timeframe: tf, from: session.chartRange.from, to: session.chartRange.to },
        });

        if (seq !== requestSeq.current) return;
        setState({
          session,
          candles: toChartCandles(bars.bars),
          snapshot: null,
          loading: false,
          error: null,
          unauthenticated: false,
        });
      } catch (error) {
        if (seq !== requestSeq.current) return;
        setState({
          session: null,
          candles: [],
          snapshot: null,
          loading: false,
          error: messageFor(error),
          unauthenticated: isApiError(error, "unauthenticated"),
        });
      }
    },
    [],
  );

  useEffect(() => {
    if (!sessionId) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    void load(sessionId);
  }, [sessionId, load]);

  /** Refetches bars for a different timeframe without recreating the session. */
  const changeTimeframe = useCallback(
    async (timeframe: Timeframe) => {
      if (!sessionId) return;
      await load(sessionId, timeframe);
    },
    [sessionId, load],
  );

  return { ...state, reload: load, changeTimeframe };
}

/** Creates a session and returns its id, for the landing page's market cards. */
export async function createSession(
  timeframe: Timeframe,
  predictionHorizon: Timeframe,
): Promise<string> {
  const session = await request("createSession", { body: { timeframe, predictionHorizon } });
  return session.id;
}
