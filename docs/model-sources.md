# 3D model libraries

Nidorama's built-in furniture is simple block shapes. Any object can use a real 3D model instead
(Edit plan → select it → *Use a 3D model*, or Furnish → *Realistic 3D models…*). Models come from
**libraries**; picking one downloads a single `.glb`, stores it on the device and, when the
Nidorama add-on is installed, in `/share/nidorama/models` so every device gets it.

## 1. Poly Haven (on by default)

<https://polyhaven.com> — about 270 indoor models (seating, tables, shelves, lighting, appliances,
decor, plants). **Licence: CC0 / public domain** — per <https://polyhaven.com/license> the assets
may be used for any purpose including commercial work, redistributed and included in a product,
with no credit required. That is why it can be offered to everybody.

The app reads the public catalogue (`api.polyhaven.com`) and downloads the 1k-texture glTF of the
model you pick (about 1 MB), packing it into one `.glb` (`src/library.js`). Nothing is fetched
until you open the picker. Switch it off in More → Settings → 3D model libraries.

## 2. Your own Home Assistant library

With the Nidorama add-on installed, copy `.glb` files into **`/share/nidorama/library`** on the Home
Assistant machine (Samba, File editor or SSH add-ons). One level of sub-folders is allowed and
becomes the category (`library/Sofas/my-sofa.glb`). A picture with the same name
(`my-sofa.jpg`) is shown as its thumbnail. They appear in the picker as *Your Home Assistant
library* — no index file needed.

## 3. Any other library, by link

A library is a folder of `.glb` files plus an `index.json`:

```json
{
  "name": "My furniture",
  "license": "CC0",
  "models": [
    { "name": "Corner sofa", "category": "Sofas", "file": "Sofas/corner-sofa.glb",
      "thumb": "Sofas/corner-sofa.jpg", "size": [2.6, 1.7, 0.85] }
  ]
}
```

`file` and `thumb` are relative to the index (or full addresses). `size` is optional
(width, depth, height in metres); without it the app measures the model.
`tools/make_model_index.py <folder>` writes the index for you.

Host the folder anywhere a browser can fetch it with cross-origin access allowed — for a quick
test, Home Assistant's `/config/www/models` is served at
`http://<home-assistant>:8123/local/models/index.json`. Then More → Settings → *Link another
library* and paste the address of `index.json`.

## Where to find models

- Poly Haven (CC0) — built in.
- Phone 3D-scanning apps that export `.glb` — your actual furniture.
- Other sites: check each model's licence before sharing a library publicly. Models must be
  glTF binary (`.glb`) without Draco / Meshopt compression, in metres, Y up.
