# View Customization

This folder owns visual styling for the editor shell.

Change these files when you want to adjust the app's look without touching
editor data, rendering logic, or collaboration code.

## Files

- `styles/design-tokens.css`
  - Main theme knobs: colors, fonts, spacing, borders, radii, and control sizes.
  - Start here for pixel-art styling, custom fonts, or button frame changes.
- `styles/base.css`
  - Global browser reset and base typography.
- `styles/editor-layout.css`
  - App layout: sidebar, workspace, toolbar area, canvas area, and status bar.
- `styles/editor-controls.css`
  - Buttons, layer rows, active states, labels, and panel details.

## Notes

- React UI lives in `src/ui`.
- Canvas/WebGPU drawing lives in `src/rendering`.
- Level data and editing types live in `src/editor`.
- CSS changes affect the surrounding UI. Canvas content styling is controlled by
  renderer code and project data.
