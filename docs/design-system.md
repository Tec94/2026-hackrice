# Chartroom design and motion system

The supplied `design_system.pdf` and `Chartroom Screens.html` replace the earlier
polish-only system. The HTML's later screen composition takes precedence: the
exploring workspace is a chart above a coach / analysis / selected-candle bench.
The PDF supplies the surface and motion vocabulary. `/design-system` is the
interactive reference.

## Screens and backend connections

- Landing: illustrative chart, replay entry, market availability, coach example,
  expandable FAQ, and authenticated account navigation.
- Account: email/password sign-up and sign-in. Starting a replay while signed out
  returns through `/start`, which creates the authenticated session.
- Exploring: timeframe, indicators, drawing rail, selected candle, typed/voice
  coach, analysis fields, progress, and a final confirmation dialog.
- Submitted: frozen chart appearance, committed thesis, findings bound to stored
  fact IDs, learning-memory retrieval, and devnet receipt states.
- Revealed/completed: server-authorized future bars, immutable evidence findings,
  observed values, the user's call, reflection, and completion.
- Your record: All / In progress / Completed filters, reopen at the saved state,
  archive confirmation, Archived view, and restore.
- Mobile: chart stage and a coach sheet with peek, half, and full detents. The
  half detent exposes the next analysis field; full exposes the complete form.
  Feedback/reveal keep the chart above independently scrolling content.

Real data always comes through the shared runtime-validated contracts. The only
illustrative candles are in the labeled landing/account illustration. Dates
before reveal remain relative; no future OHLC is embedded in hidden markup.

## Owner decisions and source limitations

The owner requested reversible archive, not deletion. The API persists
`public.archived` inside the existing session JSON. Archive/restore preserves the
session state and original expiry; old records without that field remain active.
The archive button slides into view on hover/focus; touch exposes it directly.
The source's 3-second second-click confirmation applies to archive only.

The owner selected the existing backend Flat rule: exactly equal cutoff and
horizon closes. The illustrative ±0.25% band is not implemented. A resolved call
therefore matches or does not match; the UI does not invent an unclear band.

The references' sample prices, people, dates, counts, scores, 80/20 proportions,
notifications for unavailable markets, and assessed free-text invalidation are
not backend facts. They are not shown as real results. Stocks and forex remain
unavailable. Free-text invalidation is preserved and labeled not automatically
assessed. Evidence comparisons and actual reason codes come from the evaluator.

## Shared surfaces and type

Implementation lives in `frontend/src/styles/globals.css`,
`frontend/tailwind.config.ts`, and `frontend/src/components/ui/`.

| Role | Value |
| --- | --- |
| Ground | `#0e0e10` |
| Inset | `#101012` |
| Panel | `#171719` |
| Raised | `#252529` |
| Ink / supporting | `#ececef` / `#a3a3ad` |
| Accent | `#e2b45c` |
| Replay boundary / refusal | `#c47a3a` |
| Coach | `#9184ee` |
| Bull / bear | `#34c77b` / `#f0524f`, accompanied by words/arrows |

`surface-hero` uses a vertical lit fill, `.5px` shadow ring, `1px` inset top
light, contact shadow, and ambient shadow. `surface-inset` is the recessed coach
or field plane; `control-surface` is raised. Primary actions use a lit gold fill
and dark ink. Nested radii follow the supplied 16 / 12 / 9px treatment.
Fractional rings can rasterize differently at different pixel densities.

The system font stack is retained. Eyebrows use 10.5px type with .14em tracking,
section titles 18px / 600, body 13.5px, and supporting text 12px. Tabular numbers
keep figures stable. Price displays round for readability; evaluation uses the
server's exact decimal values.

## Motion

All motion values below come from the supplied design reference and are visual
parameters, not operational deadlines or request limits.

| Token | Value / behavior |
| --- | --- |
| `--motion-feedback` | 150ms press feedback |
| `--motion-state` | 200ms controls, progress, archive pill |
| `--motion-enter` | 350ms entrance |
| `--motion-exit` | 120ms menu/dialog exit |
| `--motion-pane` | 500ms pane, mobile sheet, reveal curtain |
| `--stagger` | 40ms, six positions, then no further delay |
| `--ease-enter` | cubic-bezier(.16,1,.3,1) |
| `--ease-settle` | cubic-bezier(.25,1,.5,1) |
| `--ease-exit` | cubic-bezier(.4,0,1,1) |
| `--ease-spring-soft` | cubic-bezier(.34,1.3,.64,1), small controls only |
| `--ease-breathe` | cubic-bezier(.45,0,.55,1), voice orb |

The orb uses the reference's 1600ms listening period; thinking reduces amplitude
and brightness, speaking uses the pane timing for a faster cycle, and paused is
static. Menus/dialogs retain their DOM through exit. Dialog focus is trapped and
restored; Escape dismisses. Indicator chips, findings, and record cards stagger.

Supported browsers use a View Transition to carry the analysis bay into the
feedback column after commitment. Other browsers use the pane entrance. Chart
snapshots opt out of transition animation. Reveal animates a curtain over the
already-authorized chart; candles, indicators, prices, axes, and drawings do not
animate. No outcome earns celebratory or punitive motion.

Reduced motion disables movement, including view transitions. Controls keep
visible focus, text labels, and the existing 44px target convention. Both-axis
overscroll suppression does not disable normal document or pane scrolling.

## Snapshot behavior

Save chart stores appearance and supported calculation context. Asking a question
or reviewing analysis also captures the current context. The confirmation dialog
shows that captured revision; submission uses exactly its ID. Saved appearance
includes visual-only indicators and drawings separately from the EMA/RSI and
horizontal/trend lines supplied to calculations. Reopening feedback or the
committed chart restores the submission's snapshot, not a later snapshot.
The visible hidden-region width is derived from rendered label width so it cannot
collapse into the price axis; chart pan/zoom remains available.
