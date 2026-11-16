# Nidorama add-on

## What the add-on is for

You can use Nidorama without it, as an app or in a browser. The add-on adds:

- **Nidorama in the sidebar** of Home Assistant, on any device, with no extra sign-in.
- **One household.** Every device connected to this Home Assistant shares the same homes,
  plans and widget dashboards. A change on one device appears on the others within about a
  minute. A dashboard marked "Only me" stays on the device it was made on.
- **A shared folder** for photos, 3D models and your model library: `/share/nidorama`. You can
  reach it with the Samba or File editor add-ons.
- **Photo renders** made on the Home Assistant machine instead of a tablet.

## Installing

1. Install this add-on and start it.
2. Turn on **Show in sidebar**.
3. Open Nidorama from the sidebar, or open the Android app and sign in to this Home Assistant
   (Settings and more → Settings → Home Assistant). The app finds the add-on by itself; its
   Home Assistant screen then shows **Nidorama add-on: Connected**.

If the app says the add-on is not found, check that port 8765 is set under this add-on's
**Network** settings, then type `http://<your Home Assistant address>:8765` into "Add-on
address" in the app.

## Options

- **lan_without_login** (off by default): when on, devices on your network can use the add-on's
  port without signing in to Home Assistant. Leave it off unless every device on your network is
  trusted.

## What is shared, and what is not

| Shared by every device | Kept on each device |
|---|---|
| Homes, plans, levels, furniture | Theme, day and night looks |
| Widget dashboards and the panel beside a plan | Which dashboard the device starts on |
| Buttons, button groups, step lists, shortcuts | Kiosk mode, panel size, screen settings |
| Photos used on floors and furniture | Imported 3D scans and photo renders |

Two people editing the same home at the same moment: the later save wins for that home.

## Photo renders

A photo render is a lifelike picture of the plan, computed once. On the Home Assistant machine
it needs at least 4 processor cores and 4 GB of memory; it is much faster on an Intel or AMD
machine than on a Raspberry Pi.

## Updates

Each update is listed in the Changelog tab. Before updating the Android app, it offers to save a
backup of your homes and settings.
