# Chartroom design and motion system

Use this system to polish the existing interface without changing its identity.
Open `/design-system` for live controls, surface samples, a dialog, and motion
previews. The samples do not submit analysis or call voice providers.

## Source of truth

The system extends the existing frontend rather than adding a component library.

- `frontend/tailwind.config.ts`: palette, type sizes, radii, touch targets,
  workspace columns, and Tailwind aliases for motion and shadows.
- `frontend/src/styles/globals.css`: semantic depth, spacing, and motion tokens;
  surface and interaction classes; reduced motion; and overscroll behavior.
- `frontend/src/components/ui/index.tsx`: shared controls, fields, cards,
  progress, dialogs, and focus management.

## Surface language

The owner's reference defines the treatment: a **0.5px border**, **soft inner
white shadow**, and **double drop shadow**. Apply it with `surface` to cards
and overlays, or `control-surface` to filled buttons. Use plain dividers and
spacing inside panels; do not add a shadow to every nested group.

| Token | Value | Role |
| --- | --- | --- |
| `--border-hairline` | `0.5px` | Owner-specified edge |
| `--shadow-inner` | `inset 0 1px 2px rgb(255 255 255 / 0.06)` | Soft white inner light |
| `--shadow-contact` | `0 1px 2px rgb(0 0 0 / 0.4)` | Close contact with the plane below |
| `--shadow-ambient` | `0 8px 30px -12px rgb(0 0 0 / 0.7)` | Broad ambient depth |

`--shadow-surface` combines all three shadows. Contact and ambient values come
from the checkout's existing panel and lift shadows. The inner-light opacity
is a visual treatment, not a contrast or accessibility guarantee. Fractional
borders can rasterize differently by display density. Focus rings stay distinct
and do not rely on the hairline border.

## Color and type

Retain the existing palette and font stack. This pass does not introduce a
new font download or a new theme.

| Role | Existing token | Use |
| --- | --- | --- |
| Page | `ground` | Deepest background |
| Content plane | `panel` | Cards, coach, and menus |
| Control plane | `raised` | Inputs and selected states |
| Text | `ink`, `ink-muted` | Primary content and supporting text |
| Quiet annotation | `ink-faint` | Nonessential metadata, not required instructions |
| Brand and replay | `accent`, `replay` | Actions and historical boundaries |
| Voice | `coach` | Coach identity and activity |
| Direction | `bull`, `bear` | Chart direction, always paired with other cues |

Use `text-base` for dense app content, `text-lead` for emphasis, and
`text-title` for sections. Reserve `text-display` and `text-hero` for landing
and reference pages. Use `.nums` for prices and counts to prevent digit jitter.
Do not animate a price, prediction, or confidence value to imply correctness.

## Layout relationships

Use the existing spacing scale as the base. The semantic aliases describe
relationships, not a requirement to wrap every group in a component.

| Token or class | Value or behavior |
| --- | --- |
| `--space-related` | `0.5rem`: labels and their fields |
| `--space-group` | `1rem`: related control groups |
| `--space-section` | `1.5rem`: sections within a panel |
| `.page-shell` | Existing `88rem` page width, shared horizontal gutters |
| `.section-space` | Fluid spacing between the existing `4rem` and `6rem` section sizes |
| `.replay-shell` | Dynamic viewport height, with a `100vh` fallback |
| `.analysis-form` | Grid labels with a visible label-to-field gap |

Keep the desktop chart and coach side by side. Preserve the existing mobile
Chart and Coach tabs. Let the coach scroll independently. Do not apply page
entrance transforms to the chart canvas, price axes, or drawing tools.

## Motion language

The timing tokens reuse values already present in the checkout. They are
visual durations, not API timeouts, performance budgets, or interaction delays.
Controls remain usable throughout their transitions.

| Token | Value | Applied behavior |
| --- | --- | --- |
| `--motion-feedback` | `150ms` | Button feedback and field color changes |
| `--motion-state` | `200ms` | Actionable-card hover and progress changes |
| `--motion-enter` | `350ms` | Existing 6px fade-and-settle entrance |
| `--motion-cycle` | `1600ms` | Existing voice pulse alias, when used |
| `--ease-settle` | `cubic-bezier(0.25, 1, 0.5, 1)` | Quick response followed by a smooth stop |
| `--ease-enter` | `cubic-bezier(0.16, 1, 0.3, 1)` | Overlay and preview entrance |

Use `motion-control` for press feedback and `motion-card` for actionable
surfaces. Card lift only runs on fine pointers that support hover. Use
`animate-rise-in` for a mounted menu, dialog, or the landing preview; do not
replay it whenever chart data changes. Menus and dialogs currently close
immediately so existing focus and dismissal behavior stays intact.

Progress fills use `scaleX`, keeping their layout width stable. Surface shadows
remain static. Avoid bounce, scroll hijacking, chart parallax, and artificial
loading delays. Do not add route-transition infrastructure for this polish pass.

## Accessibility and scrolling

The browser's `prefers-reduced-motion: reduce` setting disables animations and
transitions. Press and hover movement are only defined for the no-preference
case. Status text and progress values remain available without motion.

Keep the existing 44px control targets and visible focus rings. These are
retained project values, not a claim that the complete app is accessibility
certified. Dialogs retain Escape dismissal and focus restoration, and their
contents can scroll when the viewport is short.

`overscroll-behavior: none` applies to all app elements, covering horizontal
and vertical scroll boundaries, including nested scrollers. It does not set
`overflow: hidden` on the document, intercept wheel events, or disable touch
gestures. Browser support determines boundary-effect suppression; normal
page scrolling and chart pan/zoom remain available.

## Applying the system

Use the live reference before changing a screen. Reuse shared components and
semantic classes, preserve functional states, then check the screen at desktop
and mobile widths. Check keyboard focus and reduced motion alongside the
normal visual treatment. Keep backend and voice behavior outside visual edits.
