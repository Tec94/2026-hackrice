# What you can ask the coach

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
