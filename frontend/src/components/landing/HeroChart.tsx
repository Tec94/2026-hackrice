import { heroBars, heroMa, HERO_H, HERO_W, priceToY, CUT_X, AXIS_W, type HeroBar } from "./hero-data";

const UP = "#4ec9a0";
const DOWN = "#e8695f";

function Candle({ bar }: { bar: HeroBar }) {
  const rising = bar.close >= bar.open;
  const color = rising ? UP : DOWN;
  const top = priceToY(Math.max(bar.open, bar.close));
  const bottom = priceToY(Math.min(bar.open, bar.close));
  // Keep doji bodies visible rather than collapsing to zero height.
  const height = Math.max(1.2, bottom - top);

  return (
    <g>
      <line
        x1={bar.x}
        x2={bar.x}
        y1={priceToY(bar.high)}
        y2={priceToY(bar.low)}
        stroke={color}
        strokeWidth={1}
      />
      <rect x={bar.x - 2.6} y={top} width={5.2} height={height} fill={color} rx={0.5} />
    </g>
  );
}

/**
 * Static SVG preview of a replay session for the landing hero.
 *
 * Deliberately not the live chart component: this is marketing furniture, so it
 * ships as inline SVG with no charting library and no client JS.
 */
export function HeroChart() {
  const gridPrices = [108.57, 106.09, 103.61, 101.13, 98.65];

  return (
    <div className="surface animate-rise-in rounded-xl2 bg-panel p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="rounded-md border border-accent-500/45 px-2.5 py-1 text-micro font-medium text-accent-300">
          Illustrative preview
        </span>
        <span className="nums text-base text-ink-muted">SOL/USDT · 15m</span>
        <span className="nums ml-auto text-base text-ink-faint">30 candles hidden</span>
      </div>

      <svg
        viewBox={`0 0 ${HERO_W} ${HERO_H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Illustrative candlestick chart preview, not session market data."
      >
        {/* Horizontal price grid */}
        {gridPrices.map((p) => (
          <g key={p}>
            <line
              x1={0}
              x2={HERO_W - AXIS_W}
              y1={priceToY(p)}
              y2={priceToY(p)}
              stroke="#1f1f1f"
              strokeWidth={1}
            />
            <text
              x={HERO_W - AXIS_W + 7}
              y={priceToY(p) + 3.5}
              fill="#6b6b6b"
              fontSize={9.5}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
            >
              {p.toFixed(2)}
            </text>
          </g>
        ))}

        {/* Hidden region: shaded, amber-bounded, labelled */}
        <rect
          x={CUT_X}
          y={4}
          width={HERO_W - AXIS_W - CUT_X}
          height={HERO_H - 22}
          fill="#c08a33"
          fillOpacity={0.055}
        />
        <line
          x1={CUT_X}
          x2={CUT_X}
          y1={4}
          y2={HERO_H - 18}
          stroke="#c08a33"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
        <text
          x={CUT_X + (HERO_W - AXIS_W - CUT_X) / 2}
          y={HERO_H / 2}
          fill="#d4a24b"
          fontSize={10}
          textAnchor="middle"
          letterSpacing="0.3"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          hidden until you commit
        </text>

        {/* Moving average, in the coach violet */}
        <path d={heroMa} fill="none" stroke="#7c6ce4" strokeWidth={1.8} strokeLinejoin="round" />

        {heroBars.map((bar, i) => (
          <Candle key={i} bar={bar} />
        ))}
      </svg>

      <div className="mt-3 flex flex-wrap items-baseline gap-2 border-t border-line pt-3">
        <span className="flex items-center gap-1.5 text-base font-medium text-coach-300">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-coach-400" />
          Coach
        </span>
        <span className="text-base text-ink-muted">
          &ldquo;Which lows are you reading that off?&rdquo;
        </span>
      </div>
    </div>
  );
}
