# What to ask the coach

## The five for the demo

Ask these in this order. Each one shows something the last did not, and the
last one is the point of the whole project.

**1. "What's the closing price?"**

> Closing price: 130.83 USDT.

The plain case. Say that the server computed it from the candles and the model
is not allowed to do arithmetic.

**2. "What does the candle look like?"**

> Opening price: 130.78. High price: 131.03. Low price: 130.23. Closing price: 130.83.

Four values from one ordinary question. Shows it understands what you mean,
not just keywords.

**3. "What was the opening price thirty six hours before the cutoff?"**

> Opening price: 129.24 USDT.

A spoken number and a time reference in one breath. It can reach any earlier
candle, and never past the cutoff.

**4. "What was the trend?"**

> It describes the shape from the values it holds.

No formula exists for this, so the coach reads the chart in words. Say that it
is told to present this as a reading rather than a fact.

**5. "Should I buy here?"**

> I can calculate values from the visible chart. You choose your own conclusion
> and hypothetical action.

The refusal, and your best moment. Advice, the future and news are refused
before the question is even matched, so rephrasing does not get past them.

### If you have time for a sixth

**"How volatile was it?"** answers with the visible high of **142.72** and low
of **124.17**. It also doubles as your check that you are on the demo chart,
since that high holds whatever timeframe you are viewing.

### Numbers on this chart

Answers come from the candle you are looking at, so the close reads 130.83 on
the fifteen minute view and 131.10 on the hourly. Both are right. The visible
high stays 142.72 either way.

---

## Everything else you can ask

Every question below was run against the live parser. The ones marked answered
return a computed value; the ones marked described have no formula, so the
coach reads the chart values it was given and says so.

For the real numbers on the session you are about to film, run:

```
npm run demo:brief
```

---

## Values on the candle — answered

```
What is the closing price?
What is the opening price?
What is the high?
What is the low?
What is the volume?
What is the price change?
What is the percent change?
```

## Several at once — answered

```
What is the high and low?
What is the open and close?
What is the candle?
What does the candle look like?
What is the OHLC?
```

## Across the visible range — answered

```
What is the range?
What was the biggest move?
How volatile was it?
What is the highest visible price?
What is the lowest visible price?
```

## Indicators — answered

```
What is the RSI 14?
What is the EMA 21?
What is the relative volume 20?
```

## Definitions — answered

```
What is RSI?
What is an EMA?
Explain invalidation.
What is relative volume?
```

## An earlier candle — answered

Counted in bars or in time, in digits or spoken words. Works with any question
above.

```
What was the close 3 candles ago?
What was the opening price thirty six hours before the cutoff?
What was the RSI 14 three candles ago?
What did the candle look like two hours ago?
What was the high before the cutoff?
```

## Reading the chart — described, not calculated

The coach answers these from the values it was given and is told to say it is
how it reads the chart. Numbers in the answer are still server-computed.

```
What was the trend?
Is this bullish?
Where is support?
Describe the chart.
What stands out?
```

---

## Refused, by design

Worth demonstrating one of these on camera. The refusal runs before the
question is matched, so rephrasing does not get past it.

| Ask | Refused as |
|---|---|
| Should I buy here? | advice |
| Where should I put my stop? | advice |
| Is this a good trade? | advice |
| What happens next? | future |
| What will the price be? | future |
| What is the close after the cutoff? | future data |
| What news moved this? | news |
| What is the date? | news |

---

## Filling the analysis by voice

Say this as one natural sentence. The coach extracts each part and writes it
into the form. You review it before submitting.

**A full one, all four fields:**

> "I think it's heading lower. It failed at the recent high twice and it's
> drifting toward the bottom of the range, so I'd stay short. I'm about sixty
> five percent confident. I'd be wrong if it closes back above that high."

| Said | Lands in |
|---|---|
| "heading lower" | Prediction → lower |
| "I'd stay short" | Action → short |
| "sixty five percent confident" | Confidence → 65 |
| "wrong if it closes back above" | Invalidation |
| the reasoning itself | Thesis |

**Piece by piece,** if you would rather show it building up:

```
"I think this is going higher."              -> prediction
"I'd go long here."                          -> action
"I'm about seventy percent confident."       -> confidence
"I'd be wrong if it breaks below the low."   -> invalidation
"What have you got so far?"                  -> reads the form back
```

**Correcting it, which is worth showing:**

```
"Actually make that fifty five percent."
```

### Notes

- Say the confidence in words. "Sixty five percent" is heard more reliably
  than "65%".
- Name a direction explicitly. "Up", "down", "higher", "lower" all work;
  "I like this setup" does not.
- The form is a draft. Read it back on camera and edit anything misheard.
  That is the honest behaviour and it shows the human stays in control.
