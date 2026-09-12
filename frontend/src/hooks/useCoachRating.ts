"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalysisEvaluation } from "@hackrice/contracts";
import { request } from "@/services/api-client";

type ReasonCode = AnalysisEvaluation["findings"][number]["reasonCode"];

/**
 * Follows an evaluation while the coach is still rating it.
 *
 * The rating lands a few seconds after the request that triggered it, so the
 * page polls while the evaluation says `processing`, or, when `waitFor` is
 * given, until a finding with that reason code appears. Polling stops after
 * `patience` attempts so a coach that never answers does not pin the page.
 */
export function useCoachRating(
  sessionId: string,
  initial: AnalysisEvaluation | null,
  options: { waitFor?: ReasonCode; patience?: number } = {},
) {
  const { waitFor, patience = 15 } = options;
  const [evaluation, setEvaluation] = useState<AnalysisEvaluation | null>(initial);
  const [rating, setRating] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const attempts = useRef(0);

  useEffect(() => {
    setEvaluation(initial);
    attempts.current = 0;
    setGaveUp(false);
  }, [initial]);

  const waiting = !!evaluation && (
    evaluation.status === "processing"
    || (!!waitFor && !evaluation.findings.some((finding) => finding.reasonCode === waitFor))
  );

  useEffect(() => {
    if (!evaluation || !waiting || gaveUp) return;
    if (attempts.current >= patience) { setGaveUp(true); return; }
    const timer = setTimeout(async () => {
      attempts.current += 1;
      try {
        setEvaluation(await request("getEvaluation", { params: { evaluationId: evaluation.id } }));
      } catch {
        // A missed poll is retried on the next tick; the attempt still counts.
        setEvaluation((current) => (current ? { ...current } : current));
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [evaluation, waiting, gaveUp, patience]);

  /** Asks the coach for a fresh rating, for a restart or a rating that never came. */
  const rateNow = useCallback(async () => {
    setRating(true);
    attempts.current = 0;
    setGaveUp(false);
    try {
      setEvaluation(await request("rateAnalysis", { params: { sessionId } }));
    } finally {
      setRating(false);
    }
  }, [sessionId]);

  return { evaluation, pending: waiting && !gaveUp, rating, rateNow };
}
