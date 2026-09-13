# The demo session

One fixed chart to rehearse on. Everything else about the app is unchanged:
real candles, real calculation, real grading, real commitment. The only thing
pinned is **where the chart is cut**, so the same situation comes up every run
and you can learn your lines.

Turn it on for filming, turn it off afterwards.

---

## Turn it on

Add to `.env`:

```
DEMO_CUTOFF=2024-03-05T19:00:00Z
```

Restart the API. It prints a line confirming demo mode, so you cannot leave it
on by accident:

```
Demo mode: every new session cuts at 2024-03-05T19:00:00.000Z.
```

Remove the line and restart to go back to random cutoffs.

---

## The situation

Solana against the dollar, hourly bars, one hour ahead. 115 bars of history
are visible.

Price spiked to **142.72**, then failed three hours running. Each bar made a
lower high, and the last one closed at **131.10**, below its 21-period average.
Momentum is neutral, not oversold, so there is nothing holding it up.

| On the chart | Value |
|---|---|
| Last close | 131.10 |
| 24-hour high | 142.72 |
| 24-hour low | 127.68 |
| RSI 14 | 47.88 |
| EMA 21 | 132.45 |

**The last three hours, which are the story:**

| Hour | High | Close |
|---|---|---|
| 15:00 | 142.72 | 139.18 |
| 16:00 | 140.59 | 133.10 |
| 17:00 | 135.63 | 135.02 |
| 18:00 | 135.08 | 131.10 |

---

## What happens next

**Do not say this part on camera.** It is hidden from the chart and revealed
only after you submit.

Price falls from **131.10** to **119.24**, a drop of **9.05 percent**. The
prediction to make is **lower**.

---

## The analysis to give

Say this to the coach as one natural sentence. It fills the form itself.

> "I think this is heading lower. It spiked to a hundred and forty two seventy
> two and got rejected, and every hour since has made a lower high. It just
> closed at a hundred and thirty one ten, back under the twenty one EMA. I'd
> stay short. I'm about seventy percent confident. I'd be wrong if it closes
> back above a hundred and thirty five."

**The form should end up as:**

| Field | Value |
|---|---|
| Prediction | lower |
| Action | short |
| Confidence | 70 |
| Thesis | the rejection and the lower highs |
| Invalidation | a close back above 135 |

Read the form back on camera before submitting, and correct anything it
misheard. That is the honest behaviour, and it shows you stay in control.

### Why this analysis is worth showing

It is right, and it is right **for stated reasons that the chart supports**.
A rejection from a high, successive lower highs, and a close below the average
are all visible before the cutoff. So the submission grading scores the
reasoning well, and the reveal grading scores the call well. You get to show
both halves of the rubric agreeing, which is the clearest way to explain what
the two gradings are for.

---

## Questions to ask on this chart

The answers are fixed, so you can rehearse against them.

| Ask | Answer |
|---|---|
| What is the closing price? | 131.10 USDT |
| What is the high and low? | from the final hour |
| What was the opening price thirty six hours before the cutoff? | an earlier candle |
| What is the RSI 14? | 47.88 index |
| How volatile was it? | high 142.72, low 127.68 |
| What was the trend? | described, not calculated |
| **Should I buy here?** | **refused — advice** |

Small differences are expected if you change the timeframe on screen, since
the coach answers about the candle you are actually looking at.

---

## Before filming

1. `DEMO_CUTOFF` set in `.env`, API restarted, demo line printed.
2. Start a **new** session. Existing sessions keep the cutoff they were born
   with.
3. Ask the coach one question and check it answers.
4. Confirm the devnet wallet still has a balance, or the receipt will not
   confirm and reveal stays locked.

## After filming

Delete the `DEMO_CUTOFF` line and restart. If a judge opens the app later, it
should pick a random chart like it always did.
