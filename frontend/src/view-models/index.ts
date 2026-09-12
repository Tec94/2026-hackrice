/**
 * View-only types.
 *
 * Everything describing the API — sessions, candles, snapshots, submissions,
 * evaluations — now comes from `@hackrice/contracts`. Only types that exist
 * purely for rendering live here.
 */

export const SESSION_PHASES = ["explore", "analyze", "feedback", "reveal"] as const;
export type SessionPhase = (typeof SESSION_PHASES)[number];

/** Voice-coach states surfaced in the sidebar. */
export type AgentStatus =
  | "connecting"
  | "ready"
  | "listening"
  | "transcribing"
  | "checking_chart"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "offline"
  | "error";

/** Every agent state carries a visible label (spec §18). */
export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  connecting: "Connecting…",
  ready: "Ready",
  listening: "Listening…",
  transcribing: "Understanding…",
  checking_chart: "Checking visible chart data…",
  thinking: "Preparing feedback…",
  speaking: "Speaking",
  interrupted: "Interrupted",
  offline: "Voice unavailable",
  error: "Voice error",
};

/**
 * Landing-page markets.
 *
 * The API is SOL/USDT only (`symbol: z.literal("SOL/USDT")`), so stocks and
 * forex are flagged unavailable rather than offered and then failing.
 */
export interface MarketOption {
  id: "crypto" | "stocks" | "forex";
  label: string;
  blurb: string;
  symbol: string;
  available: boolean;
}

export const MARKETS: MarketOption[] = [
  {
    id: "crypto",
    label: "Crypto",
    blurb: "24/7 markets with fast, volatile structure.",
    symbol: "SOL/USDT",
    available: true,
  },
  {
    id: "stocks",
    label: "Stocks",
    blurb: "Daily equity charts. Coming soon.",
    symbol: "—",
    available: false,
  },
  {
    id: "forex",
    label: "Forex",
    blurb: "Intraday currency pairs. Coming soon.",
    symbol: "—",
    available: false,
  },
];
