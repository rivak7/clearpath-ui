# ClearPath Accessibility Profiles

ClearPath ships with a stack of assistive profiles that can be layered together. Each profile is activated by toggling a checkbox on `/settings.html`. The root `<html>` element receives a tokenised class (for CSS) and custom data attributes (for JS).

## Runtime signals

| Profile | Class on `<html>` | JS enum key | High-level effect |
| --- | --- | --- | --- |
| Senior Comfort | `accessibility-senior` | `AccessibilityFeature.SENIOR` | Enlarged typography, relaxed motion, bigger inputs |
| Color Vision Assist | `accessibility-colorblind` | `AccessibilityFeature.COLORBLIND` | Blue/amber palette, patterned overlays, redundant icon cues |
| Reading Ease | `accessibility-dyslexia` | `AccessibilityFeature.DYSLEXIA` | Dyslexia-friendly font stack and spacing |
| Guided Focus | `accessibility-focus` | `AccessibilityFeature.FOCUS` | Persistent amber focus halos and dimmed background chrome |
| Calm Motion | `accessibility-calm` | `AccessibilityFeature.CALM` | Suppresses animation and fly-to transitions |
| Low Vision Beacon | `accessibility-lowvision` | `AccessibilityFeature.LOW_VISION` | Ultra-high contrast, thick outlines, gold-on-obsidian markers |

`web/accessibility.js` owns profile state, storage, and the `clearpath-accessibilitychange` event. The main map bootstraps by calling `initAccessibility()` and listening for updates—copy that pattern for every future page that needs to react dynamically.

## CSS guidelines

1. **Always hook into the profile classes**. When you introduce a component, add style variants under the relevant class selectors shown above. Examples live in `web/styles.css` (search for `accessibility-`).
2. **Lean on design tokens**. `web/app.js` pulls colors for map markers and overlays via CSS custom properties (e.g. `--marker-entrance-fill`). When a profile needs a palette shift, define the token override under that profile’s selector instead of hard-coding values.
3. **Keep changes dramatic and obvious.** Each profile intentionally “feels” different so users know it is active. If you add a component, reflect the profile visually (size, spacing, contrast, motion) rather than hiding the adaptation in subtle tweaks.
4. **Respect reduced motion.** If you introduce animations, gate them behind `shouldReduceMotion()` from `web/app.js`, or read `data-accessibility` and disable them when `calm` is active.

## JavaScript guidelines

- Import the helpers you need:

  ```js
  import { AccessibilityFeature, initAccessibility, onAccessibilityChange } from './accessibility.js';
  ```

- Call `initAccessibility()` exactly once per entry point. It returns the current feature list.
- Subscribe to `onAccessibilityChange` when a component needs to re-render, and clean up the listener if you create/destroy components dynamically.
- Utilities such as `shouldReduceMotion()` and `getDesignTokens()` in `web/app.js` show how to bridge JS behaviour with CSS tokens—reuse or extend them instead of duplicating logic.

## Adding a new profile

1. Extend `AccessibilityFeature` in `web/accessibility.js` and add an entry to `rawFeatures`.
2. Provide human-friendly `summary`, two bullet points, an icon, and at least one dramatic UI change.
3. Add CSS overrides in `web/styles.css` under the new class.
4. Update documentation (this file) and ensure `/settings.html` renders the card automatically (it uses the metadata from `rawFeatures`).

## QA checklist

- Toggle each profile individually on `/settings.html` and confirm the main map (`/`) updates without reload (fonts, colors, motion).
- Combine profiles (e.g. Color Vision + Focus + Calm) and verify styles stack without clashing.
- With Calm Motion active, map recentering should snap instantly and floating buttons must not pulse.
- Inspect the `<html>` element and confirm `data-accessibility` lists the active features (space-delimited).

Following these steps keeps new pages aligned with the accessibility bar we’ve set.
