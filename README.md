# Nidorama

A local-first floor-plan controller for Home Assistant: look down into a model of your home and tap
the things in it. Web app, Home Assistant add-on and Android app / home-screen launcher.

Nothing about a particular home is built in. You draw your home in the designer (walls by exact
length, rooms, doors and windows, furniture, lights and entities, several levels and homes), or
import a home file. See `docs/home-format.md` for the home file format.

- `src/` — the web app: `scene.js` (three.js renderer and styles), `editor.js` (designer),
  `dashboard.js` (home pages), `store.js` (library, import/export, sync), `ha.js` (Home Assistant).
- `android/` — Capacitor shell for the APK (launcher mode, open-HA-app button, file export).
- `addon/nidorama/` + `Dockerfile.addon` + `repository.yaml` — the Home Assistant add-on.
- `tools/` — small helpers (model index, render test job, a preview of a home file).
- `site/` — the project's website, published by GitHub Actions.

## Getting it

**Android:** every push builds an APK (GitHub Actions → *Android APK*) and publishes it on the
Releases page of this repository. Install the APK, then *Create a home*, *Import a home file* or try the sample.
More → Settings: Home Assistant URL and a long-lived access token.
On a wall tablet: tick *Offer Nidorama as a home screen*, then *Change default launcher*.
Go to the page, plan or room that tablet should show and choose More → *Start this device here*.

**Home Assistant add-on:** Settings → Add-ons → Add-on store → ⋮ → Repositories → add
this repository's address, install *Nidorama*. It appears in the sidebar (ingress,
no token needed) and on port 8765. Images are built from `main` and pushed to GHCR — the packages
must be public for Home Assistant to pull them.

**Integrations** (More → Settings): Home Assistant (sign in, or an access token) and Homey Pro
(local API key). With nothing connected the app shows a simulated home.

## Developing

```sh
npm install
npm run dev            # http://localhost:5173
npm run android:sync   # build + copy into android/ (then open android/ in Android Studio)
```

## Licence

Copyright © 2026 the Nidorama authors.

Nidorama is free software: you can redistribute it and/or modify it under the terms of the GNU
Affero General Public License, version 3, as published by the Free Software Foundation. It is
distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the
implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See `LICENSE`.

In plain words: you may use, study, change and share Nidorama, including for money. If you
distribute a changed version, or let people use one over a network, you must make its complete
source available under this same licence.

**Additional permission (GNU AGPL version 3, section 7).** If you distribute this program, or a
work based on it, through an app store or a similar distribution service (for example Apple's
App Store or Google Play) whose terms, usage rules or technical measures add restrictions beyond
those of this licence, you are permitted to do so, provided that the complete corresponding
source code of what you distribute remains available to its recipients under this licence,
without those restrictions. This permission covers only the restrictions added by the store;
everything else in the licence still applies. Anyone who distributes a changed version may keep
or remove this permission for their version.

The name "Nidorama" and its icon are not covered by that licence: see `TRADEMARKS.md`.

Bundled third-party work keeps its own licence: three.js and the other libraries in
`package.json` (permissive licences), and the Montserrat typeface (SIL Open Font License 1.1).
Contributions are welcome: see `CONTRIBUTING.md`.
