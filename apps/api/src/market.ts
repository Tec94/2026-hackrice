import { createHash } from "node:crypto";
import { Decimal } from "decimal.js";
import { z } from "zod";
import {
  AnalysisRating, Candle, ChartSnapshot, Evaluation, Fact, Indicator, SafeReply, Submission,
  Timeframe, renderSafeReply, rubricWeights, timeframeMinutes, type ChartContext, type AnalysisSubmission, type CoachRatingStage,
} from "@hackrice/contracts";

export const MARKET_SOURCE = "binance:spot:SOLUSDT:5m" as const;
export const FORMULA_VERSION = "ema-sma-seed_rsi-wilder_rvol-prior-v1";
const MINUTE_MS = 60_000;
const BASE_MS = 5 * MINUTE_MS;
const HOUR_MS = 60 * MINUTE_MS;
// Binance's API contract, not an application history cap.
const BINANCE_PAGE_SIZE = 1_000;
const decimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export type MarketCandle = {
  openTimeMs: number;
  /** Exclusive end; Binance's inclusive last millisecond is normalized on import. */
  closeTimeMs: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
};
export type DecimalPolicy = { precision: number; rounding: Decimal.Rounding };
export type IndicatorPoint = { openTimeMs: number; closeTimeMs: number; value: string | null };
type IndicatorSpec = z.infer<typeof Indicator>;
type Reply = z.infer<typeof SafeReply>;
type ComputedFact = z.infer<typeof Fact>;
type MetricName = ComputedFact["metric"];

export class MarketError extends Error {
  constructor(public readonly code: "invalid_market_data" | "insufficient_data" | "provider_unavailable" | "invalid_request") {
    super(code);
  }
}

function canonicalDecimal(value: unknown, nonnegative = true): string {
  if (typeof value !== "string" || !decimalPattern.test(value)) throw new MarketError("invalid_market_data");
  const number = new Decimal(value);
  if (!number.isFinite() || (nonnegative && number.isNegative() && !number.isZero())) throw new MarketError("invalid_market_data");
  return number.isZero() ? "0" : number.toFixed();
}

function aligned(value: number, interval: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value % interval === 0;
}

function requireHour(cutoffTimeMs: number): void {
  if (!aligned(cutoffTimeMs, HOUR_MS)) throw new MarketError("invalid_request");
}

function normalizeCandle(candle: MarketCandle, duration: number): MarketCandle {
  if (!aligned(candle.openTimeMs, duration) || !Number.isSafeInteger(candle.closeTimeMs)
    || candle.closeTimeMs !== candle.openTimeMs + duration) throw new MarketError("invalid_market_data");
  const result = {
    openTimeMs: candle.openTimeMs, closeTimeMs: candle.closeTimeMs,
    open: canonicalDecimal(candle.open), high: canonicalDecimal(candle.high),
    low: canonicalDecimal(candle.low), close: canonicalDecimal(candle.close), volume: canonicalDecimal(candle.volume),
  };
  if (new Decimal(result.high).lessThan(Decimal.max(result.open, result.close, result.low))
    || new Decimal(result.low).greaterThan(Decimal.min(result.open, result.close))) throw new MarketError("invalid_market_data");
  return result;
}

function orderedCandles(candles: readonly MarketCandle[], duration?: number): MarketCandle[] {
  if (candles.length === 0) return [];
  const span = duration ?? candles[0]!.closeTimeMs - candles[0]!.openTimeMs;
  if (!Object.values(timeframeMinutes).some((minutes) => minutes * MINUTE_MS === span)) throw new MarketError("invalid_market_data");
  const sorted = candles.map((bar) => normalizeCandle(bar, span)).sort((a, b) => a.openTimeMs - b.openTimeMs);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1]!.closeTimeMs !== sorted[i]!.openTimeMs) throw new MarketError("invalid_market_data");
  }
  return sorted;
}

/** Decimal addition uses scaled integers, so authoritative OHLCV never rounds. */
function exactSum(values: readonly string[]): string {
  const scale = Math.max(0, ...values.map((value) => value.split(".")[1]?.length ?? 0));
  let total = 0n;
  for (const value of values) {
    const negative = value.startsWith("-");
    const [integer, fractional = ""] = (negative ? value.slice(1) : value).split(".");
    total += (negative ? -1n : 1n) * BigInt(integer! + fractional.padEnd(scale, "0"));
  }
  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(scale + 1, "0");
  const result = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
  return canonicalDecimal((negative ? "-" : "") + result, false);
}

export function normalizeBinanceKlines(rows: unknown): MarketCandle[] {
  if (!Array.isArray(rows)) throw new MarketError("invalid_market_data");
  return orderedCandles(rows.map((row: unknown) => {
    if (!Array.isArray(row) || row.length < 7 || typeof row[0] !== "number" || typeof row[6] !== "number") {
      throw new MarketError("invalid_market_data");
    }
    return {
      openTimeMs: row[0], closeTimeMs: row[6] + 1,
      open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5],
    } as MarketCandle;
  }), BASE_MS);
}

export function candleDigest(candles: readonly MarketCandle[]): string {
  return createHash("sha256").update(JSON.stringify({ source: MARKET_SOURCE, candles: orderedCandles(candles, BASE_MS) })).digest("hex");
}

/** Fetch exactly the supplied half-open interval of Binance spot SOLUSDT 5m candles. */
export async function fetchBinanceCandles(input: {
  startTimeMs: number; endTimeMs: number; fetchImpl?: typeof fetch;
}): Promise<{ source: typeof MARKET_SOURCE; digest: string; candles: MarketCandle[] }> {
  if (!aligned(input.startTimeMs, BASE_MS) || !aligned(input.endTimeMs, BASE_MS) || input.startTimeMs >= input.endTimeMs) {
    throw new MarketError("invalid_request");
  }
  const candles: MarketCandle[] = [];
  let next = input.startTimeMs;
  while (next < input.endTimeMs) {
    const url = new URL("https://data-api.binance.vision/api/v3/klines");
    url.search = new URLSearchParams({
      symbol: "SOLUSDT", interval: "5m", startTime: String(next),
      endTime: String(input.endTimeMs - 1), limit: String(BINANCE_PAGE_SIZE), timeZone: "0",
    }).toString();
    let rows: unknown;
    try {
      const response = await (input.fetchImpl ?? fetch)(url);
      if (!response.ok) throw new MarketError("provider_unavailable");
      rows = await response.json();
    } catch {
      throw new MarketError("provider_unavailable");
    }
    const page = normalizeBinanceKlines(rows);
    if (page.length === 0 || page[0]!.openTimeMs !== next) throw new MarketError("insufficient_data");
    if (page.length > BINANCE_PAGE_SIZE || page.at(-1)!.closeTimeMs > input.endTimeMs) throw new MarketError("invalid_market_data");
    candles.push(...page);
    next = page.at(-1)!.closeTimeMs;
  }
  return { source: MARKET_SOURCE, digest: candleDigest(candles), candles };
}

export function aggregateCandles(candles: readonly MarketCandle[], timeframe: z.infer<typeof Timeframe>, cutoffTimeMs: number): MarketCandle[] {
  requireHour(cutoffTimeMs);
  const duration = timeframeMinutes[Timeframe.parse(timeframe)] * MINUTE_MS;
  const allowed = orderedCandles(candles.filter((bar) => bar.closeTimeMs <= cutoffTimeMs), BASE_MS);
  const result: MarketCandle[] = [];
  const members = duration / BASE_MS;
  for (let i = 0; i < allowed.length; i += members) {
    const group = allowed.slice(i, i + members);
    const first = group[0]!;
    const last = group.at(-1)!;
    if (group.length !== members || first.openTimeMs % duration !== 0 || last.closeTimeMs !== first.openTimeMs + duration) {
      throw new MarketError("insufficient_data");
    }
    result.push({
      openTimeMs: first.openTimeMs, closeTimeMs: last.closeTimeMs,
      open: first.open, close: last.close,
      high: Decimal.max(...group.map((bar) => bar.high)).toFixed(),
      low: Decimal.min(...group.map((bar) => bar.low)).toFixed(),
      volume: exactSum(group.map((bar) => bar.volume)),
    });
  }
  return result;
}

/** Projection contains no absolute market timestamps; caller controls reveal authorization. */
export function toPublicCandles(candles: readonly MarketCandle[], cutoffTimeMs: number): z.infer<typeof Candle>[] {
  requireHour(cutoffTimeMs);
  return orderedCandles(candles).map((bar) => Candle.parse({
    openOffsetMinutes: (bar.openTimeMs - cutoffTimeMs) / MINUTE_MS,
    closeOffsetMinutes: (bar.closeTimeMs - cutoffTimeMs) / MINUTE_MS,
    open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume,
  }));
}

function arithmetic(policy: DecimalPolicy): typeof Decimal {
  if (!Number.isSafeInteger(policy.precision) || policy.precision <= 0 || !Number.isInteger(policy.rounding)) {
    throw new MarketError("invalid_request");
  }
  return Decimal.clone({ precision: policy.precision, rounding: policy.rounding });
}

/** Finite-precision decimal arithmetic; policy is required and must be persisted with facts. */
export function indicatorSeries(candles: readonly MarketCandle[], spec: IndicatorSpec, policy: DecimalPolicy): IndicatorPoint[] {
  const indicator = Indicator.parse(spec);
  const bars = orderedCandles(candles);
  const D = arithmetic(policy);
  const period = indicator.period;
  let ema: Decimal | undefined;
  let gain: Decimal | undefined;
  let loss: Decimal | undefined;
  return bars.map((bar, i) => {
    let value: Decimal | undefined;
    if (indicator.name === "ema" && i >= period - 1) {
      if (ema === undefined) ema = new D(exactSum(bars.slice(0, period).map((item) => item.close))).div(period);
      else ema = new D(bar.close).minus(ema).times(new D(2).div(period + 1)).plus(ema);
      value = ema;
    }
    if (indicator.name === "rsi" && i >= period) {
      if (gain === undefined || loss === undefined) {
        const changes = bars.slice(1, period + 1).map((item, index) => exactSum([item.close, `-${bars[index]!.close}`]));
        gain = new D(exactSum(changes.map((change) => new D(change).greaterThan(0) ? change : "0"))).div(period);
        loss = new D(exactSum(changes.map((change) => new D(change).lessThan(0) ? change.slice(1) : "0"))).div(period);
      } else {
        const change = new D(exactSum([bar.close, `-${bars[i - 1]!.close}`]));
        gain = gain.times(period - 1).plus(D.max(change, 0)).div(period);
        loss = loss.times(period - 1).plus(D.max(change.negated(), 0)).div(period);
      }
      if (!gain.isZero() || !loss.isZero()) value = loss.isZero() ? new D(100) : gain.isZero() ? new D(0) : new D(100).minus(new D(100).div(new D(1).plus(gain.div(loss))));
    }
    if (indicator.name === "relative_volume" && i >= period) {
      const mean = new D(exactSum(bars.slice(i - period, i).map((item) => item.volume))).div(period);
      if (!mean.isZero()) value = new D(bar.volume).div(mean);
    }
    return { openTimeMs: bar.openTimeMs, closeTimeMs: bar.closeTimeMs, value: value === undefined ? null : value.isZero() ? "0" : value.toFixed() };
  });
}

type Intent = { kind: "metric"; metric: MetricName; period?: number; drawingId?: string; barsBack?: number; minutesBack?: number }
  | { kind: "metrics"; metrics: MetricName[] }
  | { kind: "concept"; concept: "ema" | "rsi" | "relative_volume" | "invalidation" }
  | { kind: "refusal"; reason: "advice" | "future" | "news" | "unsupported" };

/** What speech recognition tends to hear instead of each chart term. */
const MISHEARD: [RegExp, string][] = [
  // Acronyms come back spelled out, or as the words they sound like.
  [/\b(?:r\s*s\s*i|are\s*s\s*i|are size|rsl|rs eye)\b/g, "rsi"],
  [/\b(?:e\s*m\s*a|emma|ima|e ma|email)\b/g, "ema"],
  [/\b(?:m\s*a\s*c\s*d|mac d)\b/g, "macd"],
  // Chart vocabulary that sounds like common words.
  [/\b(?:vall?\s*you\s*m|value m|val um|volumn)\b/g, "volume"],
  [/\bclosing (?:prize|price is|prices)\b/g, "closing price"],
  [/\b(?:clothing|closin|closer) price\b/g, "closing price"],
  [/\bopening (?:prize|prices)\b/g, "opening price"],
  [/\b(?:loan|lo|law)\b/g, "low"],
  [/\b(?:hi|height|hive)\b/g, "high"],
  [/\brelative (?:vall?\s*you\s*m|value|volumn)\b/g, "relative volume"],
  [/\bexponential (?:moving|move in) averages?\b/g, "exponential moving average"],
  [/\brelative strength index(?:es)?\b/g, "relative strength index"],
  // Numbers spoken as words, for the periods indicators need.
  [/\bfourteen\b/g, "14"], [/\btwenty one\b/g, "21"], [/\btwenty-one\b/g, "21"],
  [/\btwenty\b/g, "20"], [/\bfifty\b/g, "50"], [/\bnine\b/g, "9"],
  [/\btwo hundred\b/g, "200"], [/\bone hundred\b/g, "100"],
];

/**
 * Repairs a spoken question enough for the patterns below to recognise it.
 *
 * Only rewrites vocabulary, never structure, so a question that means
 * something else after correction was already unanswerable before it.
 */
export function correctHearing(question: string): string {
  let corrected = question;
  for (const [heard, term] of MISHEARD) corrected = corrected.replace(heard, term);
  return corrected.replace(/\s+/g, " ").trim();
}

/**
 * Strips a trailing "N candles before the cutoff" or "2 hours ago" from a
 * question and reports how far back it points.
 *
 * Durations are returned in minutes and converted to bars later, once the
 * chart's timeframe is known. Everything here is relative to the cutoff, so
 * no phrasing can reach a candle the learner is not allowed to see.
 */
function parseLookback(expression: string): { rest: string; barsBack?: number; minutesBack?: number } {
  const words: Record<string, number> = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  };
  const count = (raw: string) => {
    const value = /^\d+$/.test(raw) ? Number(raw) : words[raw];
    return Number.isSafeInteger(value) && value! > 0 && value! <= 500 ? value : undefined;
  };
  // "... 3 candles before the cutoff" / "... 3 bars back" / "... 3 candles ago"
  const bars = /^(.*?)\s+(\d+|[a-z]+)\s+(?:candles?|bars?)\s+(?:before\s+(?:the\s+)?cut-?\s?off|back|ago|earlier|prior)$/.exec(expression);
  if (bars) {
    const value = count(bars[2]!);
    if (value !== undefined) return { rest: bars[1]!.trim(), barsBack: value };
  }
  // "... 2 hours before the cutoff" / "... 30 minutes ago"
  const units: Record<string, number> = { minute: 1, min: 1, hour: 60, day: 1440, week: 10080 };
  const time = /^(.*?)\s+(?:(\d+|[a-z]+)\s+)?(minutes?|mins?|hours?|days?|weeks?)\s+(?:before\s+(?:the\s+)?cut-?\s?off|back|ago|earlier|prior)$/.exec(expression);
  if (time) {
    const value = time[2] === undefined ? 1 : count(time[2]);
    const unit = units[time[3]!.replace(/s$/, "")];
    if (value !== undefined && unit) return { rest: time[1]!.trim(), minutesBack: value * unit };
  }
  return { rest: expression };
}

export function parseQuestionIntent(text: string): Intent {
  // Speech arrives contracted and conversational. Normalising here, before any
  // matching, keeps the concept and expression paths below working from one
  // spelling instead of each growing its own set of prefixes.
  const question = text.toLowerCase().trim().replace(/[?.!]+$/, "").replace(/\s+/g, " ")
    .replace(/\b(what|that|it|here)'s\b/g, "$1 is").replace(/\bwhats\b/g, "what is")
    .replace(/^how much did (?:it|the price) change$/, "what is the price change")
    .replace(/^how much (?:is |are )?(?:the )?/, "what is the ")
    .replace(/^how (?:high|low|big) (?:is |was )?(?:the )?/, "what is the ")
    .replace(/ (?:in|on|over|across|within) (?:this|the) (?:area|region|zone|range|window|screen|view|chart|section)$/, " visible")
    .replace(/ (?:in|on) (?:this|the) (?:visible )?(?:area|range|window|view)$/, " visible")
    .replace(/ (?:right )?(?:here|on screen|on the screen)$/, " visible")
    .replace(/^what should (?:the )?(.+?) be$/, "what is the $1")
    .replace(/\s+/g, " ").trim();
  if (/\b(news|headline|date|year)\b/.test(question)) return { kind: "refusal", reason: "news" };
  if (/\b(future|next|tomorrow|outcome|predict|prediction|will|win|reveal)\b/.test(question)) return { kind: "refusal", reason: "future" };
  // "should" alone also refuses neutral questions such as "what should the RSI
  // be", so the advice test names the actions being sought instead.
  if (/\b(buy|sell|trade|trading|recommend|advice|long|short|profit|entry|exit|position|stop loss|take profit)\b/.test(question)
    || /\bshould (?:i|we|you)\b/.test(question) || /\b(enter|entering)\b/.test(question)) return { kind: "refusal", reason: "advice" };
  // Speech recognition hears trading vocabulary as ordinary words, and spells
  // acronyms out letter by letter. Correcting here rather than listing every
  // mishearing as its own metric keeps the table about meaning, not phonetics.
  // Deliberately after the refusals above: a correction must never turn a
  // question this coach declines into one it answers.
  const corrected = correctHearing(question);
  const concepts: Record<string, "ema" | "rsi" | "relative_volume" | "invalidation"> = {
    ema: "ema", "exponential moving average": "ema", rsi: "rsi", "relative strength index": "rsi",
    "relative volume": "relative_volume", invalidation: "invalidation",
  };
  const concept = /^(?:what is|explain|define) (?:the |an? )?(.+)$/.exec(corrected);
  if (concept && concepts[concept[1]!]) return { kind: "concept", concept: concepts[concept[1]!]! };
  // "what was" belongs here too: a question about an earlier candle is
  // naturally asked in the past tense.
  const expression = corrected.replace(/^(?:(?:what is|what was|what were|calculate|show me|give me|tell me|read me|show) )(?:the )?/, "")
    .replace(/^(?:the |a |an )/, "").replace(/^current /, "")
    .replace(/ (?:for |of )?(?:the )?(?:selected|latest) (?:candle|bar)$/, "").replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  const indicator = /^(ema|exponential moving average|rsi|relative strength index|relative volume)(?: over| period)? (\d+)(?: bars| periods)?$/.exec(expression);
  if (indicator) {
    const period = Number(indicator[2]);
    if (Number.isSafeInteger(period) && period > 0) return { kind: "metric", metric: concepts[indicator[1]!] as "ema" | "rsi" | "relative_volume", period };
  }
  // Asking for two related values in one breath is normal speech; the reply
  // already renders a list of facts, so both halves can be answered at once.
  const pairs: Record<string, MetricName[]> = {
    "high and low": ["high", "low"], "low and high": ["low", "high"],
    "high and low visible": ["visible_high", "visible_low"],
    "low and high visible": ["visible_low", "visible_high"],
    "visible high and low": ["visible_high", "visible_low"],
    "high and low price visible": ["visible_high", "visible_low"],
    "high price and low price visible": ["visible_high", "visible_low"],
    "low and high price visible": ["visible_low", "visible_high"],
    "visible low and high": ["visible_low", "visible_high"],
    "open and close": ["open", "close"], "close and open": ["close", "open"],
    "high and low price": ["high", "low"], "low and high price": ["low", "high"],
    "range": ["visible_high", "visible_low"], "range visible": ["visible_high", "visible_low"],
  };
  if (pairs[expression]) return { kind: "metrics", metrics: pairs[expression]! };
  // Spoken synonyms only. Every value is an existing Metric member, so widening
  // the wording adds no arithmetic and no new data reaches the reply.
  const metrics: Record<string, MetricName> = {
    open: "open", "opening price": "open", "open price": "open", opening: "open",
    high: "high", "high price": "high", "highest price": "high",
    low: "low", "low price": "low", "lowest price": "low",
    close: "close", "closing price": "close", "close price": "close", closing: "close",
    price: "close", "last price": "close", "current price": "close",
    // "trade volume"/"trading volume" are unreachable: the advice guard above
    // refuses any question containing trade or trading.
    volume: "volume",
    "price change": "price_change", change: "price_change", "change in price": "price_change",
    "percent change": "percent_change", "percentage change": "percent_change",
    "change in percent": "percent_change", percent: "percent_change",
    "high visible": "visible_high", "low visible": "visible_low",
    "high price visible": "visible_high", "low price visible": "visible_low",
    "highest price visible price": "visible_high",
    "closing price visible": "close", "close visible": "close",
    "opening price visible": "open", "open visible": "open",
    "volume visible": "volume", "price visible": "close",
    "visible high": "visible_high", "highest visible price": "visible_high",
    "highest price visible": "visible_high", "high of the visible range": "visible_high",
    "visible low": "visible_low", "lowest visible price": "visible_low",
    "lowest price visible": "visible_low", "low of the visible range": "visible_low",
  };
  if (metrics[expression]) return { kind: "metric", metric: metrics[expression]! };
  // A question may name a past candle. The wording is stripped here and the
  // metric matched on what is left, so every phrasing above works with a
  // lookback too. Minutes become bars later, once the timeframe is known.
  const lookback = parseLookback(expression);
  if ((lookback.barsBack !== undefined || lookback.minutesBack !== undefined) && metrics[lookback.rest]) {
    return {
      kind: "metric", metric: metrics[lookback.rest]!,
      ...(lookback.barsBack !== undefined ? { barsBack: lookback.barsBack } : {}),
      ...(lookback.minutesBack !== undefined ? { minutesBack: lookback.minutesBack } : {}),
    };
  }
  const drawing = /^distance to drawing ([0-9a-f-]+)$/.exec(expression);
  if (drawing) return { kind: "metric", metric: "distance_to_drawing", drawingId: drawing[1]! };
  return { kind: "refusal", reason: "unsupported" };
}

type CalculationInput = { snapshot: ChartContext; candles: readonly MarketCandle[]; cutoffTimeMs: number; decimalPolicy: DecimalPolicy };

function deterministicFactId(value: unknown): string {
  const bytes = createHash("sha256").update(JSON.stringify(value)).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function calculateIntent(intent: Extract<Intent, { kind: "metric" }>, input: CalculationInput): ComputedFact | null {
  const snapshot = ChartSnapshot.parse(input.snapshot);
  const all = aggregateCandles(input.candles, snapshot.timeframe, input.cutoffTimeMs);
  const visible = all.filter((bar) => (bar.openTimeMs - input.cutoffTimeMs) / MINUTE_MS >= snapshot.visibleRange.from
    && (bar.closeTimeMs - input.cutoffTimeMs) / MINUTE_MS <= snapshot.visibleRange.to);
  const current = snapshot.selectedCandleOffsetMinutes === undefined ? visible.at(-1)
    : visible.find((bar) => (bar.openTimeMs - input.cutoffTimeMs) / MINUTE_MS === snapshot.selectedCandleOffsetMinutes);
  if (!current) return null;
  // A question may ask about an earlier candle. Counting back from the one in
  // hand keeps every answer inside the bars already on screen, so no wording
  // can reach past the cutoff. A lookback beyond the chart refuses rather than
  // silently answering about the oldest bar there is.
  const step = snapshot.timeframe ? timeframeMinutes[snapshot.timeframe] : undefined;
  const back = intent.barsBack ?? (intent.minutesBack !== undefined && step ? Math.round(intent.minutesBack / step) : undefined);
  let selected = current;
  if (back !== undefined) {
    if (back < 1) return null;
    const index = visible.indexOf(current) - back;
    if (index < 0) return null;
    selected = visible[index]!;
  }
  const D = arithmetic(input.decimalPolicy);
  let value: string | null = null;
  let unit: ComputedFact["unit"] = "USDT";
  let through = selected.closeTimeMs;
  if (["open", "high", "low", "close", "volume"].includes(intent.metric)) {
    value = selected[intent.metric as "open" | "high" | "low" | "close" | "volume"];
    if (intent.metric === "volume") unit = "SOL";
  } else if (intent.metric === "price_change" || intent.metric === "percent_change") {
    const change = exactSum([selected.close, `-${selected.open}`]);
    if (intent.metric === "price_change") value = change;
    else if (!new D(selected.open).isZero()) { value = new D(change).div(selected.open).times(100).toFixed(); unit = "percent"; }
  } else if (intent.metric === "visible_high" || intent.metric === "visible_low") {
    value = (intent.metric === "visible_high" ? Decimal.max(...visible.map((bar) => bar.high)) : Decimal.min(...visible.map((bar) => bar.low))).toFixed();
    through = visible.at(-1)!.closeTimeMs;
  } else if (intent.metric === "distance_to_drawing") {
    const drawing = snapshot.drawings.find((item) => item.id === intent.drawingId);
    if (!drawing) return null;
    const offset = (selected.openTimeMs - input.cutoffTimeMs) / MINUTE_MS;
    const price = drawing.type === "horizontal_line" ? new D(drawing.price)
      : new D(drawing.end.price).minus(drawing.start.price).times(offset - drawing.start.offsetMinutes)
        .div(drawing.end.offsetMinutes - drawing.start.offsetMinutes).plus(drawing.start.price);
    value = new D(selected.close).minus(price).toFixed();
  } else if (intent.period !== undefined) {
    const series = indicatorSeries(all.filter((bar) => bar.closeTimeMs <= selected.closeTimeMs), {
      name: intent.metric as "ema" | "rsi" | "relative_volume", period: intent.period,
    }, input.decimalPolicy);
    value = series.at(-1)?.value ?? null;
    unit = intent.metric === "rsi" ? "index" : intent.metric === "relative_volume" ? "ratio" : "USDT";
  }
  if (value === null) return null;
  const fact = {
    chartSnapshotId: snapshot.id, metric: intent.metric, value: canonicalDecimal(value, false), unit,
    ...(intent.period === undefined ? {} : { period: intent.period }),
    calculatedThroughOffsetMinutes: (through - input.cutoffTimeMs) / MINUTE_MS,
  };
  return Fact.parse({ id: deterministicFactId({ ...fact, drawingId: intent.drawingId, policy: input.decimalPolicy, formulaVersion: FORMULA_VERSION }), ...fact });
}

export function answerQuestion(input: CalculationInput & { text: string }): Reply {
  const intent = parseQuestionIntent(input.text);
  if (intent.kind === "refusal" && intent.reason === "unsupported" && /\band\b/i.test(input.text)) {
    const text = input.text.replace(/^(?:what(?:'s| is)|calculate|show me)\s+(?:the\s+)?/i, "")
      .replace(/\s+(?:on|for) the selected candle[?.!]*$/i, "");
    const parts = text.split(/\s+and\s+/i).map(part => parseQuestionIntent(part));
    if (parts.every(part => part.kind === "metric")) {
      const facts = parts.map(part => calculateIntent(part, input));
      return SafeReply.parse(facts.every(fact => fact !== null) ? { kind: "calculation", facts } : { kind: "refusal", reason: "insufficient_data" });
    }
  }
  if (intent.kind === "metrics") {
    // Every half must compute, so a partial pair refuses rather than quietly
    // answering only the side that happened to succeed.
    const facts = intent.metrics.map((metric) => calculateIntent({ kind: "metric", metric }, input));
    return SafeReply.parse(facts.every((fact) => fact !== null)
      ? { kind: "calculation", facts }
      : { kind: "refusal", reason: "insufficient_data" });
  }
  if (intent.kind !== "metric") return SafeReply.parse(intent);
  const fact = calculateIntent(intent, input);
  return SafeReply.parse(fact ? { kind: "calculation", facts: [fact] } : { kind: "refusal", reason: "insufficient_data" });
}

/** Grade only explicit numerical comparisons; prose remains unassessed, without a fabricated score. */
export function evaluateSubmission(input: CalculationInput & {
  id: string; submissionId: string; submission: AnalysisSubmission;
}): { evaluation: z.infer<typeof Evaluation>; facts: ComputedFact[] } {
  const submission = Submission.parse(input.submission);
  if (submission.chartSnapshotId !== input.snapshot.id) throw new MarketError("invalid_request");
  const facts: ComputedFact[] = [];
  const findings: z.infer<typeof Evaluation>["findings"] = [];
  for (const claim of submission.claimedEvidence) {
    const comparison = /^(.+?)\s*(>=|<=|>|<|=)\s*(.+)$/.exec(claim);
    const intent = comparison ? parseQuestionIntent(comparison[1]!) : null;
    const literal = comparison && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(comparison[3]!.trim());
    const rightIntent = comparison && !literal ? parseQuestionIntent(comparison[3]!) : null;
    if (!comparison || intent?.kind !== "metric" || (!literal && rightIntent?.kind !== "metric")) {
      findings.push({ category: "evidence", status: "not_assessable", score: null, factIds: [], reasonCode: "subjective_judgment" });
      continue;
    }
    const fact = calculateIntent(intent, input);
    const rightFact = rightIntent?.kind === "metric" ? calculateIntent(rightIntent, input) : null;
    if (!fact || (!literal && !rightFact)) {
      findings.push({ category: "evidence", status: "insufficient_evidence", score: null, factIds: [], reasonCode: "insufficient_data" });
      continue;
    }
    if (rightFact && rightFact.unit !== fact.unit) {
      findings.push({ category: "evidence", status: "not_assessable", score: null, factIds: [], reasonCode: "subjective_judgment" });
      continue;
    }
    if (!facts.some((existing) => existing.id === fact.id)) facts.push(fact);
    if (rightFact && !facts.some(existing => existing.id === rightFact.id)) facts.push(rightFact);
    const order = new Decimal(fact.value).comparedTo(rightFact?.value ?? comparison[3]!.trim());
    const supported = ({ ">": order > 0, "<": order < 0, "=": order === 0, ">=": order >= 0, "<=": order <= 0 } as Record<string, boolean>)[comparison[2]!]!;
    findings.push({ category: "evidence", status: supported ? "supported" : "contradicted", score: null, factIds: rightFact ? [fact.id, rightFact.id] : [fact.id], reasonCode: supported ? "claim_supported" : "claim_contradicted" });
  }
  if (findings.length === 0) findings.push({ category: "evidence", status: "insufficient_evidence", score: null, factIds: [], reasonCode: "missing_comparison" });
  findings.push(
    { category: "structure", status: "not_assessable", score: null, factIds: [], reasonCode: "subjective_judgment" },
    { category: "confirmation", status: "not_assessable", score: null, factIds: [], reasonCode: "subjective_judgment" },
    { category: "invalidation", status: submission.invalidation ? "not_assessable" : "insufficient_evidence", score: null, factIds: [], reasonCode: submission.invalidation ? "subjective_judgment" : "missing_invalidation" },
    { category: "risk_reasoning", status: submission.riskReasoning ? "not_assessable" : "insufficient_evidence", score: null, factIds: [], reasonCode: submission.riskReasoning ? "subjective_judgment" : "missing_risk_reasoning" },
    { category: "confidence_calibration", status: "not_assessable", score: null, factIds: [], reasonCode: "uncalibrated_rubric" },
    // Scored only at the reveal, against what the price actually did.
    { category: "thesis_outcome", status: "not_assessable", score: null, factIds: [], reasonCode: "subjective_judgment" },
    { category: "choice_quality", status: "not_assessable", score: null, factIds: [], reasonCode: "subjective_judgment" },
    { category: "confidence_fit", status: "not_assessable", score: null, factIds: [], reasonCode: "subjective_judgment" },
  );
  return { evaluation: Evaluation.parse({
    id: input.id, submissionId: input.submissionId, status: "completed", rubricVersion: "explicit-comparison-v1",
    formulaVersion: FORMULA_VERSION, overallScore: null, findings,
    scoreMeaning: "educational_rubric_not_validated_prediction_probability",
  }), facts };
}

/** Where each score lands. Evidence is deliberately absent from both. */
const RATED_CATEGORIES: Record<CoachRatingStage, Partial<Record<keyof z.infer<typeof AnalysisRating>, z.infer<typeof Evaluation>["findings"][number]["category"]>>> = {
  submission: { thesisScore: "structure", invalidationScore: "invalidation", riskScore: "risk_reasoning" },
  reveal: {
    confirmationScore: "confirmation", calibrationScore: "confidence_calibration",
    // Their own categories, so the blind scores above survive the reveal.
    thesisOutcomeScore: "thesis_outcome", choiceScore: "choice_quality", confidenceScore: "confidence_fit",
  },
};

/**
 * Adds the coach's scores to the categories the evaluator left unrated.
 *
 * Evidence findings are computed from candles and are never touched: a model
 * opinion cannot overturn a comparison that either held or did not. Before
 * the reveal the coach scores the reasoning; after it, only how the call
 * compared with the outcome, so a right guess never retroactively improves
 * weak reasoning. The overall score is the rubric's weighting over whatever
 * has actually been rated, so it describes the judged part of the analysis
 * rather than averaging in blanks.
 */
export function applyRating(
  evaluation: z.infer<typeof Evaluation>,
  rating: z.infer<typeof AnalysisRating>,
  stage: CoachRatingStage = "submission",
): z.infer<typeof Evaluation> {
  const scores = new Map<string, number>();
  for (const [field, category] of Object.entries(RATED_CATEGORIES[stage])) {
    const score = rating[field as keyof typeof rating];
    if (typeof score === "number" && category) scores.set(category, score);
  }
  const reasonCode = stage === "reveal" ? "outcome_judgment" as const : "model_judgment" as const;
  const findings = evaluation.findings.map((finding) => {
    const score = scores.get(finding.category);
    // Evidence is measured, not judged, and a blank field has nothing to judge.
    if (score === undefined || finding.category === "evidence" || finding.status !== "not_assessable") return finding;
    return { ...finding, score, reasonCode };
  });
  const rated = findings.flatMap((finding) => typeof finding.score === "number" ? [{ category: finding.category, score: finding.score }] : []);
  const weight = rated.reduce((total, finding) => total + rubricWeights[finding.category], 0);
  const overallScore = weight
    ? Math.round(rated.reduce((total, finding) => total + finding.score * rubricWeights[finding.category], 0) / weight)
    : null;
  const coachNotes = (evaluation.coachNotes ?? []).filter((note) => note.stage !== stage);
  if (rating.comment) coachNotes.push({ stage, text: rating.comment });
  return Evaluation.parse({ ...evaluation, status: "completed", findings, overallScore, ...(coachNotes.length ? { coachNotes } : {}) });
}

/**
 * The chart as the learner saw it, in the calculator's own words.
 *
 * A rating brief is built from these lines rather than from raw candles, so
 * the only numbers a model ever reads are ones this server computed from the
 * visible range. A metric the snapshot cannot supply is left out, never
 * estimated.
 */
export function describeChart(input: CalculationInput): string[] {
  const questions = [
    "what is the opening price", "what is the closing price", "what is the high", "what is the low",
    "volume", "percent change", "visible high", "visible low", "ema 21", "rsi 14",
  ];
  const facts: string[] = [];
  for (const text of questions) {
    try {
      const reply = answerQuestion({ ...input, text });
      if (reply.kind === "calculation") facts.push(renderSafeReply(reply));
    } catch { /* Left out rather than guessed. */ }
  }
  return facts;
}
