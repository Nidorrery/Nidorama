# Nidorama home format — `nidorama.home/1`

One JSON file per home (`homes/<id>/home.json`). Renderer-agnostic: no SVG, screen or camera data.

- **Units:** metres. **Axes:** x east, y south (from the outside face of the north wall), z up from finished floor.
- `levels[]` — each floor of the home:
  - `walls[]` — centre line `a`→`b`, `thickness`, `height`, `exterior`, `openings[]`
    (`type`: window, slider, door, barn-door, cavity-slider, opening; `offset` from `a` along the wall,
    `width`, `sill`, `head`).
  - `rooms[]` — `polygon` (may be L-shaped), `floor` material, `labelAt`.
  - `floors[]` — floor-material rectangles (`[x0, y0, x1, y1]`, `material`), drawn over room floors.
  - `voids[]` — holes in the floor (stairwells).
  - `stairs[]` — parametric stair (type, direction, rise, tread, flights, landing, rails).
  - `objects[]` — furniture and fixtures: `id`, `name`, `kind`, `room`, `bounds`, `rotation`
    (degrees), `parts[]` of boxes (`min`, `max`, `color`, optional `shape: cylinder`, `radius`,
    `opacity`, `sideColor`). Parts are in level coordinates. `zFixed: true` means the original card drew
    it low and the height was corrected to a real mounting height.
  - `lights[]` — `position` (or `kind: ceiling` for a room's main light), `fixture` (object it belongs
    to; moves with it), `entity`, `dimmable`.
  - `roomControls{}` — per-room HA entities: `mainLight`, `lampGroup`, `extras`, `temperature`,
    `fan`, `cover`, `climate`.
- `homeAssistant` — home-wide entities (heating, automations) and notes.

Materials so far: `timber-dark`, `marble-tile`, `mosaic-tile`, `decking`, `stair-void`.

## Additions made by the app (all optional, still `nidorama.home/1`)

- `pages[]` — home pages (tile dashboards without a plan): `id`, `name`,
  `sections[]` of `{ id, title, tiles[] }`, each tile `{ id, entity, name }`.
- `updatedAt` — when the home was last changed (used to merge copies between devices).
- `levels[].footprint` may be absent: levels drawn in the app get their floor slab from the rooms.
- `rooms[].floorPainted: true` — the floor was chosen in the designer and is drawn over `floors[]`.
- `objects[].entity` — an HA entity for a thing that is not a light (tap toggles, hold for details).
- `objects[].kind` — for furniture placed in the app, the catalogue id (`src/catalog.js`).
- More floor materials: see `FLOOR_MATERIALS` in `src/catalog.js`.
- `more[]` — the user's shortcuts at the top of the More menu: `{ id, name, entity, stateEntity? }`,
  or `{ type: "all-lights-off" }`. When absent the app offers All lights off plus
  `homeAssistant.heating` / `homeAssistant.automations` if the file names them.
- `menus[]` — the user's own drop-down menus: `{ id, name, items[] }` (items as in `more[]`).
- `levels[].buttons[]` — control buttons: `{ id, name, entity }` with `at: [x, y]` (on the plan) or
  `dock: true` (in the strip beside the plan).
- `levels[].buttons[]` also take `size` (`small` | `large`) and `icon` (a name from the app's icon set).
  `more[]` / `menus[].items[]` take `icon` too.
- `rooms[].floorPhoto: { id, size }` — the floor is the user's photo; one photo covers `size` metres.
- `objects[].photo: { id, mode: "fit" | "tile", size }` — the shape is wrapped in the user's photo.
- `objects[].model: { id, name }` — an imported `.glb` shown instead of `parts` (kept on the device only).
- `photos: { id: dataURL }` — only in exported files: the photos the home uses, so the file is complete.
- **Controls** (dashboard tiles in `pages[].sections[].tiles[]`, and `levels[].roomPanels.<room>.controls[]`):
  `{ id, entity, name?, icon?, size?: small|wide|large, color?, opacity?, tap?: toggle|details,
  features?: { <key>: false }, subs?: [{ id, entity, name?, icon? }] }`.
- `levels[].roomList: { order[], hidden[], show: lights|temperature|none }` — the room list beside the plan.
- `private: true` on a page or level — only its creator sees it; it is left out of the household copy.
- `levels[].buttons[]` also take `scale` (size multiplier) and, beside the plan, `pos: { h: l|r, x, v: t|b, y }`
  (screen points from the nearest edges); `levels[].screenGrid` is that grid's size in points.
- Dashboard tiles take `w` and `h` (grid squares) in place of `size`.
- `levels[].homeView: { cx, cy, zoom, az }` — the view the compass button and opening the plan return to.
- `gestures` on objects, lights and plan buttons: `{ tap: { entity?, action: toggle|on|off|details|none },
  hold: {…}, swipeX: { entity?, what: brightness|speed|temperature|position|volume|none }, swipeY: {…} }`.
  An empty entity means the item's own. A light's gestures are stored on its fixture object.
- `levels[].buttons[].view` may also be `mode` (one-finger drag: off / move / orbit, per device).
- v0.11: `walls[].bulge` — a curved wall: how far (metres) its middle bows out from the straight
  line `a`→`b`, positive to the right when walking from `a` to `b`; at most half the straight
  length. Opening `offset`s on a curved wall are measured along the curve.
- v0.11: `walls[].openings[]` also take `style` (door: `hinged` | `double` | `sliding` | `none`;
  window: `fixed` | `sliding` | `double-hung` | `grid` | `none`), `hinge: 'end'` (hinged / slides at
  the far jamb), `swing: -1` (opens to the other face of the wall) and `color` (door leaf / window
  frame). Openings without `style` are drawn as before: a plain gap, or plain glass.
- v0.11: `levels[].buttons[].size` may be `expand`: an icon that opens its controls when tapped and
  closes again after a few seconds.
- v0.11: a `rooms[]` entry is called an *area* in the app: any polygon, with no walls of its own.
- Themes are per device, not part of a home file: see `docs/themes.md`.
- v0.12: `pages[].tabs: [{ id, name }]` and `pages[].sections[].tab` (a tab's id; sections without
  one belong to the first tab); `pages[].columns` (2–30 squares across; unset = automatic).
  Tiles take `w` up to 30 and `h` up to 8.
- v0.13: a gesture's `tap` / `hold` may be `{ action: 'steps', steps: [...] }`, and a widget may have
  `tap: 'steps'` with `steps`. A step is `{ id, type: 'do', entity?, action: on | off | toggle }`,
  `{ id, type: 'set', entity?, what: brightness | temperature | position | speed | volume, value }`
  or `{ id, type: 'wait', seconds }`. A step without `entity` uses the item's own.
- v0.13: a widget (tile) may have `kind`: `weather`, `camera`, `sensor` (each with `entity`), `clock`,
  `room` (with `room`: a room id) or `alloff`. `levels[].panelPage` is a page (`sections`, `tabs`,
  `columns`) shown beside the plan when no room is selected, in place of the automatic room list.
- v0.13.1: more widget `kind`s: `thermostat` (a `climate` entity), `calendar` (optional `calendar` entity),
  `music` and `announce` (a `media_player` entity); a `clock` may have `face: 'analog'`.
- v0.13.2: `pages[].font` (`system` | `rounded` | `serif` | `mono`), `pages[].fontSize` (`s` | `l` | `xl`),
  and `sections[].hideTitle` (the section's name is not shown outside edit mode). They also apply to `levels[].panelPage`.
- v0.16: the app's sample cottage (`src/sample.js`) uses most of the above and can be saved as a file
  from "Make a plan from a paper sketch"; it is a good worked example of the format.
- v0.20: `levels[].buttons[].group: { dir: 'left' | 'right' | 'up' | 'down', tap: 'toggle' | 'own', items: [{ id, entity, name, icon? }] }`
  — a button that fans out a row of more buttons.
- v0.20.2: `levels[].buttons[].view` may be `dashboards` (the dashboard selector); `levels[].navButtonAdded`;
  `pages[].hideNav: true` hides the selector on a widget page.
- v0.21: `buildings: [{ id, name, x, y, rot, roof?: { type: gable | hip | skillion | flat | none, pitch, overhang,
  material: tiles | charcoal | metal | slate | light, turn?, extend?: { n, e, s, w } } }]`; `levels[].building`,
  `levels[].loft`, `levels[].site` (the whole-site dashboard), `levels[].hideNav` / `pages[].hideNav`.
- v0.22: floors and placements replace buildings (files with `buildings` are converted when opened).
  `siteV: 2`; `levels[].floor` (0 = ground … 40); `levels[].place: { x, y, rot }` (where the level's 0, 0 stands
  on the site, and its turn in degrees); `floorHeights: { "<floor>": metres }` (optional exact heights);
  `levels[].roof: true` (a roof dashboard: nothing to walk in); `levels[].roofs: [{ id, x, y, w, d, rot, type:
  gable | hip | skillion | flat, pitch, overhang, material, turn? }]` (roof pieces: centre, width, depth and turn;
  on a level with walls they make it a loft); `levels[].hideList` / `pages[].hideList` (left out of the dashboard
  list outside edit mode); `levels[].panelView: { kind: 'web', url } | { kind: 'ha', path }` (a web page or a Home
  Assistant dashboard in the widget panel).
