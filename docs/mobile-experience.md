# Mobile Experience Guidelines

This app already ships with an opinionated, mobile‑first layout system. Use the notes below when you add new flows or tweak existing components so we keep the experience fast and thumb‑friendly on every screen size.

## Core layout primitives

- **Safe areas** – CSS custom properties (`--safe-area-*`) mirror `env(safe-area-inset-*)`. Always prefer those tokens over hard-coded offsets. Example: `padding-bottom: calc(var(--safe-area-bottom) + clamp(16px, 6vh, 44px));`.
- **Fluid typography and radii** – The root defines scales (e.g., `--type-base`, `--radius-lg`). Reuse them so text and surfaces resize smoothly between phones and tablets.
- **Sheet mechanics** – The arrival sheet relies on `state.sheet.snapPoints` and `computeSheetBaselineVisible()` in `web/app.js`. When you add new sections or change heights, call `refreshSheetSnap({ animate: false })` after DOM updates instead of forcing your own `transform`.
- **Floating actions** – `.fab-tray` manages install/locate buttons with flex layout, safe-area padding, and pointer scaling. If you add another floating action, extend that tray rather than positioning a new element manually.
- **Touch targets** – `--touch-target` defines the minimum size. Route modes, chips, and toggles clamp up when `pointer: coarse` matches; keep custom controls inside that media query if they must grow on touch devices.

## Adding new components

1. **Define spacing with tokens** – Stacks should use `--gutter`, `--gutter-tight`, or `--gutter-loose` to stay aligned with the rest of the UI.
2. **Respect the sheet lifecycle** – Append content inside `#sheetContent`; never change `position` or `overflow` on `.sheet` itself. For dynamic content, set `aria-live="polite"` if the update is meaningful.
3. **Prefer CSS media queries to JS** – Only use JavaScript for interactions (e.g., toggling classes or recalculating snap points). Breakpoints live in `web/styles.css` near the bottom.
4. **Hook into accessibility profiles** – Many selectors are namespaced (e.g., `:root.accessibility-calm`). When styling new components, add overrides inside those sections if motion, contrast, or focus states need tuning.
5. **Leverage shared utilities** – Use helper classes such as `.nav-linkButton`, `.route-planner__add`, and `.fab` to keep affordances consistent. If a new pattern repeats, add a utility class in CSS and document it here.

### Floating navigation trays

- The bottom navigation tray (`.nav-links`) becomes a fixed, thumb-reachable surface on narrow screens. When you add another quick action, place it inside that container so the breakpoint logic continues to work.
- Keep the tray light—two primary links fit comfortably on small devices. If you need more, promote them into the sheet or convert them into a launcher that opens a dedicated card.
- Test with and without safe-area insets; padding is computed from `--safe-area-bottom`, so inflating the tray with absolute positioning elsewhere can cause overlaps.

## Updating the route planner

- Collapse/expand logic is centralized in `setRoutePlannerExpanded()` (in `web/app.js`). Call it if a feature changes planner visibility, instead of toggling DOM classes manually.
- Route stops are rendered via `renderRouteStops()`. When you add metadata (ETA, cost, etc.), extend the stop template inside that function and adjust `.route-stop__meta` styles.
- Extra buttons should be placed inside `.route-planner__headerBar` so the header stays flexible at small widths.

## QA checklist for new mobile features

- ✅ **Thumb reach** – Controls that need frequent taps should sit inside the bottom half of portrait layouts (check 360×780 and 414×896 viewports).
- ✅ **Safe-area padding** – Test on devices with notches/home indicators (iPhone X/13+ and Android Edge-to-edge). Nothing should be obscured under the indicator bars.
- ✅ **Orientation** – Rotate to landscape; `.fab-tray` and `.sheet` should still fit without overlapping the system UI.
- ✅ **Pointer modes** – Simulate coarse pointer in dev tools. Confirm buttons pick up the larger `min-height` and hit areas.
- ✅ **Reduced motion** – Enable the in-app Calm profile and `prefers-reduced-motion`. Animated elements should stop or slow to avoid distracting loops.

## When in doubt

- Inspect existing components for patterns before inventing new ones—the map shell, install banner, and route planner cover most layout scenarios.
- If you need new breakpoints or tokens, define them at the top of `web/styles.css` and add a short comment explaining the intended use.
- Update this document whenever you add a reusable mobile pattern or significant interaction so future contributors can follow the same playbook.
