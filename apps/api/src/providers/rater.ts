import WebSocket, { type RawData } from "ws";
import { z } from "zod";
import { AnalysisRating, type AnalysisSubmission } from "@hackrice/contracts";

/**
 * Rates the parts of an analysis that arithmetic cannot settle.
 *
 * The only model this deployment can reach is the one Deepgram hosts for
 * agent sessions, and it answers only over an agent socket. So a rating is a
 * short text-only agent session: open, send settings, inject the brief as the
 * user message, take the model's one function call as the rating, close.
 * Nothing here listens to audio; the frames the session emits are dropped.
 */

export type RatingStage = "submission" | "reveal";
export type RatingOutcome = {
  referenceClose: string; horizonClose: string; percentChange: string;
  observedDirection: "higher" | "lower" | "unchanged";
};
export type RatingRequest = {
  stage: RatingStage;
  submission: AnalysisSubmission;
  /** What the learner could see, rendered by the same calculator that answers questions. */
  chart: string[];
  /** Present only at reveal. */
  outcome?: RatingOutcome;
};
export type Rating = z.infer<typeof AnalysisRating>;
export type AnalysisRater = {
  /** False when no key or model is configured; `rate` then resolves null at once. */
  enabled: boolean;
  rate(request: RatingRequest): Promise<Rating | null>;
};
type SocketFactory = (url: string, init: { headers: Record<string, string> }) => WebSocket;

const providerEndpoint = "wss://agent.deepgram.com/v1/agent/converse";
const DEFAULT_TIMEOUT_MS = 30_000;

const SUBMISSION_PROMPT = [
  "You are a trading chart coach reviewing a learner's written analysis of a historical chart.",
  "You will be given the values that were visible on the chart and the learner's analysis.",
  "Judge the reasoning only. You do not know what happened next and must not guess.",
  "Score 0-100: thesisScore for how specific the thesis is and how well it follows from the stated chart values;",
  "invalidationScore for whether the invalidation names a level or condition that would actually prove the thesis wrong;",
  "riskScore for whether the risk is thought through rather than asserted.",
  "Score every field. A part the learner did not write scores 0; the server ignores it, so do not skip it.",
  "Never use a number that is not in the brief.",
  "Call rate_analysis exactly once with all scores and a one-sentence comment on what would make the reasoning stronger.",
].join(" ");

const REVEAL_PROMPT = [
  "You are a trading chart coach reviewing a learner's analysis now that the outcome is known.",
  "You will be given the chart values they saw, their analysis, and what the price then did.",
  "Score 0-100: confirmationScore for how far the market did what the thesis and prediction said it would,",
  "considering direction and size of the move; calibrationScore for whether the stated confidence was justified,",
  "so high confidence in a wrong call scores low and modest confidence in a right call scores in the middle.",
  "Do not re-score the reasoning. A right call can rest on weak reasoning and a wrong one on sound reasoning;",
  "your comment should say which of those this was, in one sentence, and name what the learner should examine next time.",
  "Never use a number that is not in the brief. Call rate_analysis exactly once with both scores and the comment.",
].join(" ");

/** The fields each stage asks for. Every one is required: a blank part is
 *  scored 0 by the model and then ignored by the server, which is more
 *  reliable than asking a model to leave fields out. */
const STAGE_FIELDS: Record<RatingStage, string[]> = {
  submission: ["thesisScore", "invalidationScore", "riskScore"],
  reveal: ["confirmationScore", "calibrationScore"],
};

function rateFunction(stage: RatingStage) {
  const properties: Record<string, unknown> = { comment: { type: "string", description: "One sentence." } };
  for (const field of STAGE_FIELDS[stage]) properties[field] = { type: "number", description: "0 to 100." };
  return {
    name: "rate_analysis",
    description: "Record the coach's rating. Score every field; a part the learner did not write scores 0.",
    parameters: { type: "object", properties, required: [...STAGE_FIELDS[stage], "comment"] },
  };
}

/** The user message the model rates. Plain lines, so nothing in it reads as an instruction. */
export function ratingBrief(request: RatingRequest): string {
  const { submission, chart, outcome, stage } = request;
  const lines = [
    "Chart values the learner could see:",
    ...(chart.length ? chart.map((fact) => `- ${fact}`) : ["- (none available)"]),
    "",
    "Learner's analysis:",
    `- Thesis: ${submission.thesis}`,
    `- Prediction: ${submission.prediction}`,
    `- Hypothetical action: ${submission.hypotheticalAction}`,
    `- Confidence: ${submission.confidencePercent}%`,
    `- Evidence: ${submission.claimedEvidence.length ? submission.claimedEvidence.join("; ") : "(none)"}`,
    `- Invalidation: ${submission.invalidation ?? "(none written)"}`,
    `- Risk reasoning: ${submission.riskReasoning ?? "(none written)"}`,
  ];
  if (stage === "reveal" && outcome) {
    lines.push("", "What the price then did:",
      `- Close at the cutoff: ${outcome.referenceClose}`,
      `- Close at the horizon: ${outcome.horizonClose}`,
      `- Change: ${outcome.percentChange}%`,
      `- Direction: ${outcome.observedDirection}`);
  }
  lines.push("", "Rate this now by calling rate_analysis.");
  return lines.join("\n");
}

/** Keeps only the fields the stage asked for, rounded, so a chatty model cannot smuggle in extra scores. */
function normalise(stage: RatingStage, raw: unknown): Rating | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const rating: Record<string, unknown> = {};
  for (const key of STAGE_FIELDS[stage]) {
    const value = Number(input[key]);
    if (Number.isFinite(value)) rating[key] = Math.min(100, Math.max(0, Math.round(value)));
  }
  if (typeof input.comment === "string" && input.comment.trim()) rating.comment = input.comment.trim().slice(0, 400);
  const parsed = AnalysisRating.safeParse(rating);
  return parsed.success && Object.keys(parsed.data).length ? parsed.data : null;
}

export function createAnalysisRater(options: {
  deepgramApiKey?: string; model?: string; socketFactory?: SocketFactory; timeoutMs?: number;
}): AnalysisRater {
  const { deepgramApiKey, model } = options;
  if (!deepgramApiKey || !model) return { enabled: false, rate: async () => null };
  const connect: SocketFactory = options.socketFactory ?? ((url, init) => new WebSocket(url, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function rate(request: RatingRequest): Promise<Rating | null> {
    const socket = connect(providerEndpoint, { headers: { Authorization: `Token ${deepgramApiKey}` } });
    return new Promise<Rating | null>((resolve) => {
      let settled = false;
      const finish = (value: Rating | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { socket.close(); } catch { /* Already closed. */ }
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      const send = (message: Record<string, unknown>) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
      };
      socket.on("message", (data: RawData, isBinary: boolean) => {
        if (isBinary || settled) return;
        let event: { type?: string; functions?: { id: string; name: string; arguments: string }[] };
        try { event = JSON.parse(data.toString()); } catch { return; }
        if (event.type === "Welcome") {
          send({
            type: "Settings", mip_opt_out: true, flags: { history: false },
            audio: {
              input: { encoding: "linear16", sample_rate: 16000 },
              output: { encoding: "linear16", sample_rate: 16000, container: "none" },
            },
            agent: {
              listen: { provider: { type: "deepgram", model: "flux-general-en", version: "v2" } },
              think: {
                provider: { type: "open_ai", model },
                prompt: request.stage === "reveal" ? REVEAL_PROMPT : SUBMISSION_PROMPT,
                functions: [rateFunction(request.stage)],
              },
              // Speech is required by the session and discarded here; the
              // cheapest voice keeps a text-only rating from paying for audio.
              speak: { provider: { type: "deepgram", model: "aura-2-thalia-en" } },
            },
          });
        } else if (event.type === "SettingsApplied") {
          send({ type: "InjectUserMessage", content: ratingBrief(request) });
        } else if (event.type === "FunctionCallRequest") {
          for (const call of event.functions ?? []) {
            if (call.name !== "rate_analysis") continue;
            let args: unknown = null;
            try { args = JSON.parse(call.arguments || "{}"); } catch { /* Handled as null below. */ }
            const rating = normalise(request.stage, args);
            send({ type: "FunctionCallResponse", id: call.id, name: call.name, content: rating ? "Recorded." : "Nothing usable was recorded." });
            finish(rating);
            return;
          }
        } else if (event.type === "Error") {
          finish(null);
        }
      });
      socket.on("error", () => finish(null));
      socket.on("close", () => finish(null));
    });
  }

  return { enabled: true, rate };
}
