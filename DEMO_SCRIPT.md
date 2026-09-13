# Chartroom — Demo Video Script

**Total: 3 minutes 30 seconds.** Word counts assume ~150 words per minute, an
unhurried pace on camera. Spoken lines are in quotes. Everything else is a
direction for what to show or do.

Fill in before filming: `[MEMBER NAMES]`, `[TRACK / CHALLENGE]`.

---

## 1. Intro — 30 seconds (~70 words)

**Screen:** the landing page, logo visible.

> "This is Chartroom, by [MEMBER NAMES], for [TRACK / CHALLENGE].
>
> Most people learn to read a price chart by scrolling back through history,
> where they already know what happened next. That teaches you to recognise the
> answer, not to reason toward it.
>
> Chartroom hides the right-hand side of a real chart and asks you to explain
> what you see, out loud, before it shows you what happened.
>
> It's a TypeScript monorepo: Next.js and React on the front, Fastify and
> Postgres behind it, a live voice coach, and a Solana commitment that makes the
> whole thing honest."

**Note:** that last clause sets up the demo's most interesting moment. Don't
explain it yet.

---

## 2. Demo — 2 minutes

The core of the video. Show the loop end to end, once, without cutting away.

### 2a. The blind chart (~20s)

**Screen:** open a replay session. The chart renders, then stops mid-history.

> "Here's real Solana price data, five-minute candles from Binance. The chart
> stops at a cutoff. Everything to the right exists in the database, but the
> server will not send it to my browser. I can't inspect my way to the answer."

**Do:** scrub the chart, change the timeframe, add an indicator. Show it's a
real chart, not a picture.

### 2b. Talking to the coach (~45s)

**Screen:** open the voice panel. Speak naturally.

**Say aloud:** *"What's the closing price?"*

> "Every number it says is computed by my server from the actual candles. The
> model is not allowed to do arithmetic."

**Say aloud:** *"What was the opening price thirty six hours before the cutoff?"*

> "It handles spoken numbers and time references, and it can look back to any
> earlier candle."

**Say aloud:** *"What was the trend before the cutoff?"*

> "That one has no formula, so the coach describes what it reads from the
> values the server already gave it — and it's told to say that's a reading, not
> a fact."

**Then, the important one. Say aloud:** *"Should I buy here?"*

> "And it won't. Trading advice, anything after the cutoff, news, the date —
> those are refused before the question is even matched, so you can't rephrase
> your way past them."

**Note:** the refusal is the most persuasive thing in the video. Let it land
before moving on.

### 2c. The analysis fills itself (~25s)

**Screen:** the analysis form beside the chart.

**Say aloud, conversationally:** *"I think it's heading lower, I'm about sixty
percent confident, and I'd be wrong if it closes back above the recent high."*

**Do:** let the form fill. Point at it.

> "I didn't fill that in. The coach listened, pulled out the prediction, the
> confidence, and what would change my mind, and wrote them down. I still
> review it and I can edit anything before it goes."

### 2d. Submit and commit (~20s)

**Do:** submit.

> "On submit, my analysis is hashed and that hash is written to the Solana
> devnet. Not the analysis — just a fingerprint of it.
>
> That's what makes the exercise real. I can prove afterwards that this is
> exactly what I predicted, and I couldn't have quietly edited it once I saw
> the outcome."

**Screen:** show the confirmed receipt, ideally the transaction on an explorer.

### 2e. Reveal and grading (~30s)

**Do:** click reveal. The hidden candles animate in.

> "Now the future arrives."

**Screen:** the feedback panel with scores.

> "Two gradings, and they're deliberately separate. On submission it judged the
> reasoning blind, with no idea what happened. After the reveal it judges the
> call against the real outcome.
>
> Both are kept. A lucky guess never retroactively improves a weak analysis,
> and that's the whole point — you're being trained on your reasoning, not your
> results.
>
> Evidence claims are checked arithmetically against the candles. Those are
> measured, not judged."

---

## 3. Technical design — 30 seconds (~70 words)

**Screen:** briefly, the repo structure or an architecture sketch.

> "The design problem was trust. A language model that invents a price is worse
> than useless in a teaching tool.
>
> So the model chooses words and never numbers. When you ask for a value it
> calls into my server, which computes it with exact decimal arithmetic from the
> frozen candles. Every spoken number is checked against an allowlist of values
> the server actually produced — if the coach says a number nobody gave it, the
> turn is killed.
>
> Refusals run before any matching, so they can't be worked around. One set of
> schemas is shared by the API and the browser, and it's covered by 95 tests."

---

## 4. Impact — 30 seconds (~70 words)

**Screen:** back to the chart, or your faces.

> "People lose real money learning this by doing it live. Chartroom gives you
> the reps without the losses, and grades the reasoning rather than the outcome
> — which is what actually transfers.
>
> The commitment makes it credible enough to build on: a track record you can
> prove, not one you edited afterwards.
>
> Next, we'd widen it beyond one asset, and use the stored history to show you
> your own patterns — the setups you misread, and the times you were confident
> and wrong."

---

## Filming notes

- **Do a dry run of the voice section.** It's live and it can mishear. Know
  what you'll say, and have a second phrasing ready.
- **The refusal is your best moment.** "Should I buy here?" being declined
  proves the guarantee better than any explanation.
- **Show the reveal animating.** The hidden candles arriving is the emotional
  beat of the whole project.
- **Have the API running and the receipt already working.** Check the coach
  answers one question before you start recording.
- **If voice fails on camera**, type the same questions. The typed path uses the
  identical calculator and refusals, so nothing about the claims changes.

## Facts used, if you're asked

| Claim | Value |
|---|---|
| Market data | Binance spot SOLUSDT, 5-minute candles |
| Candles loaded | 2,016 |
| Tests passing | 95 |
| TypeScript lines | ~11,000 |
| Rubric categories | 9, weighted |
| Chain | Solana devnet, SPL Memo |
| Commitment | SHA-256, prefixed `hackrice-analysis-v1` |
