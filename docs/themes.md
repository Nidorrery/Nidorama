# Theme files (`nidorama.theme/1`)

A theme restyles the app: its colours, corner roundness, lettering, and how a selected area is
marked on the plan. Themes belong to the device (Settings → This device → Theme). "Original" is
the built-in default and sets nothing. A theme can be made in the app, saved as a
`*.nidorama-theme.json` file, and loaded on another device.

```json
{
  "schema": "nidorama.theme/1",
  "id": "neon",
  "name": "Neon grid",
  "accent": "#b46bff",
  "selection": { "style": "grid", "color": "#c77dff" },
  "radius": 6,
  "font": "mono",
  "day":   { "bg": "#17122b", "panel": "#211a3d", "ink": "#f1eaff" },
  "night": { "bg": "#0c0919", "panel": "#151029", "ink": "#f1eaff" }
}
```

- Colours are `#rrggbb` only. `selection.style`: `glow` | `grid` | `stripes` | `dots`.
- `radius`: 0–28 (px). `font`: `system` | `rounded` | `serif` | `mono` | `geometric` (the first four are fonts already on the device; `geometric` is Montserrat, bundled with the app under the SIL Open Font License;
  nothing is downloaded).
- `glass: true` (optional): frosted, see-through panels and buttons.
- A theme holds values only, never CSS: anything else in the file is ignored (`cleanTheme` in
  `src/themes.js`). It does not change the 3D materials of the plan.

The built-in **Frosted glass** theme also has a background behind the glass, chosen per device in
Look and feel (`device.wallpaper`: a built-in colour field, or the user's own photo). It is not part
of a theme file.

## Whole-look themes (v0.17)

A theme can change more than colours:

- `"caps": true`: names and labels are set in small, spaced capitals.
- `"pages": "slab"`: holding a light, blind, fan, heating or speaker opens it as a full page (its
  value large, one tall slab to drag, an on / off pill, and for lights a field for warmth or
  colour) in place of the pop-up with rows of controls.
- `"font": "geometric"`: the bundled geometric typeface.

The built-in **Jack** theme uses all three, on clear glass over a dark background picture that is
chosen in Look and feel (a colour field, any colour, or a photo of your own). It is an original
design; no other product's artwork, icons, fonts or screens are used.
