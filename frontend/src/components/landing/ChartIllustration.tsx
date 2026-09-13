import { useId } from "react";
const closes = [
  140.4, 140.1, 140.9, 140.5, 140.3, 141.1, 141.7, 141.3, 142.1, 141.6, 141.3,
  141.0, 142.1, 141.5, 141.2, 142.0, 142.9, 142.6,
];
export function ChartIllustration() {
  const id = useId();
  const y = (price: number) => 295 - (price - 139) * 56;
  return (
    <div
      className="illustration"
      role="img"
      aria-label="Illustrative historical SOL/USDT candlestick chart, with the future hidden. Not live market data."
    >
      <div className="flex items-center justify-between gap-2 p-4 text-tiny">
        <b className="rounded-lg bg-ground/60 px-3 py-2">SOL / USDT · 15m</b>
        <span className="text-ink-faint">Illustration · not live</span>
      </div>
      <svg viewBox="0 0 610 370" aria-hidden="true">
        <defs>
          <pattern
            id={id}
            width="8"
            height="8"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(135)"
          >
            <line y2="8" stroke="#fff" strokeOpacity=".06" />
          </pattern>
        </defs>
        {[139, 140, 141, 142, 143, 144].map((p) => (
          <g key={p}>
            <line
              x1="15"
              x2="550"
              y1={y(p)}
              y2={y(p)}
              stroke="#fff"
              strokeOpacity=".035"
            />
            <text x="563" y={y(p) + 4} fill="#92929d" fontSize="10">
              {p}.00
            </text>
          </g>
        ))}
        <path
          d="M20 258 Q120 225 220 201 T449 139"
          fill="none"
          stroke="#e2b45c"
          strokeWidth="1.7"
        />
        {closes.map((close, i) => {
          const open = i ? closes[i - 1] : 139.8;
          const x = 25 + i * 24;
          const color = close >= open ? "#34c77b" : "#f0524f";
          return (
            <g key={i}>
              <line
                x1={x + 5}
                x2={x + 5}
                y1={y(Math.max(open, close) + 0.3)}
                y2={y(Math.min(open, close) - 0.2)}
                stroke={color}
              />
              <rect
                x={x}
                y={y(Math.max(open, close))}
                width="11"
                height={Math.max(2, Math.abs(y(open) - y(close)))}
                fill={color}
              />
              <rect
                x={x}
                y={337 - (12 + (i % 5) * 5)}
                width="11"
                height={12 + (i % 5) * 5}
                fill={color}
                opacity=".3"
              />
            </g>
          );
        })}
        <line
          x1="453"
          x2="453"
          y1="12"
          y2="345"
          stroke="#c47a3a"
          strokeDasharray="5 5"
        />
        <rect x="454" y="12" width="96" height="333" fill={`url(#${id})`} />
        <text x="467" y="30" fontSize="10" fill="#e4bb95">
          Hidden · +1h
        </text>
        <line
          x1="15"
          x2="550"
          y1={y(142.6)}
          y2={y(142.6)}
          stroke="#a3a3ad"
          strokeDasharray="2 4"
        />
        <rect
          x="554"
          y={y(142.6) - 10}
          width="49"
          height="21"
          rx="5"
          fill="#e2b45c"
        />
        <text x="559" y={y(142.6) + 4} fontSize="10" fill="#211807">
          142.60
        </text>
        {["−5h", "−4h", "−3h", "−2h", "−1h", "0", "+1h"].map((t, i) => (
          <text
            key={t}
            x={38 + i * 80}
            y="360"
            fontSize="10"
            fill={t === "0" ? "#c47a3a" : "#92929d"}
          >
            {t}
          </text>
        ))}
      </svg>
    </div>
  );
}
