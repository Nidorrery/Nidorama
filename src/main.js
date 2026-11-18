import '@fontsource/montserrat/latin-300.css';
import '@fontsource/montserrat/latin-400.css';
import '@fontsource/montserrat/latin-500.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/space-grotesk/latin-600.css';
import './style.css';
import './controlpage.js';
import { NidoramaScene, STYLES } from './scene.js';
import { HAConnection } from './ha.js';
import { Hub } from './hub.js';
import { HomeyConnection } from './homey.js';
import { lib, device, saveDevice, initStore, onLibraryChange, newHome, sampleHome, importHome, exportHome, deleteHome, getHome, homeEntities, mutate, syncWithHA, syncHousehold, newLevel, saveNow, sampleFile, readHomeText } from './store.js';
import { app, h, nodes, icon, iconOf, pickFile, st, toggle, setBrightness, stateText, toggleBtn, slider, sliding, throttled, row, menuItem, seg, modal, isOn, brightnessPct, isDimmable, domainOf, toneClass, toast } from './ui.js';
import { runSteps } from './steps.js';
import { startAlerts, alertsSettings } from './alerts.js';
import { openSketchGuide } from './sketchguide.js';
import { siteOf, makeSite, upgradeSite, planLevels, floorOf, placeOf, outlineBox, newPiece, roofLevel, floorName } from './site.js';
import { upgradeFile } from './legacy.js';
import { webPanel, viewUrl } from './webpanel.js';
import { startAlarms } from './widgetviews.js';
import { Editor } from './editor.js';
import { syncMyModels } from './mymodels.js';
import { renderPage, newPage, roomControlsOf } from './dashboard.js';
import { controlRow as ctlRow } from './controls.js';
import * as native from './native.js';
import { getBlob, putBlob } from './blobs.js';
import { gestureFor, swipeValue, swipeLabel, applySwipe } from './gestures.js';
import { remote, connectAddon, addon, getAsset, putAsset, renderName } from './remote.js';
import { librarySettings, measureGLB } from './modelpicker.js';
import { isGLB } from './gltf.js';
import { moreItems, controlRow, menuEditor, addShortcut } from './menus.js';
import { uid } from './catalog.js';
import { themeList, themeById, applyTheme, themeSettings, WALLPAPERS, setWallPhoto, ownNight, dotColour, dotKindOf } from './themes.js';
import { shrinkPhoto } from './blobs.js';
import { findUpdate, buildOf, CHANNELS, NEXT, BUILT_FOR, listBuilds, latestIn, promote, acceptedBy } from './updates.js';
import { requestsRepo, setRequestsRepo, listRequests, sendRequest, isOwner, approve, unapprove, decline, TARGETS, editRequest, vote, unvote, NEW_ISSUE_URL, AREAS, areaName, shrinkScreenshot, attachScreenshot, screenshotsOf } from './requests.js';

const VERSION = __APP_VERSION__;
const RELEASES_URL = `https://github.com/${__REPO__}/releases`;

// ---------- state ----------
let cur = null; // { homeId, kind: 'level' | 'page', id }
let selectedRoom = null;
let openSheet = null; // 'more' | 'places' | 'settings' | { thing }
let pageEditing = false;
/** One edit mode for the whole app (#35): the current dashboard, the dashboard list and More are all editable while it is on. */
let editMode = false;
let styleBeforeEdit = null;

const home = () => (cur ? getHome(cur.homeId) : null);
const level = () => (cur?.kind === 'level' ? home()?.levels.find((l) => l.id === cur.id) : null);
const page = () => (cur?.kind === 'page' ? home()?.pages?.find((p) => p.id === cur.id) : null);
const viewLabel = () => { const hm = home(); if (!hm) return 'Nidorama'; return `${hm.name} · ${(level() || page())?.name || ''}`; };
/** The top-left title, as this device wants it: home and dashboard, just the home, or just the dashboard. */
const titleText = () => { const hm = home(); if (!hm) return 'Nidorama'; const d = (level() || page())?.name || ''; return device.titleMode === 'home' ? hm.name : device.titleMode === 'page' ? d || hm.name : viewLabel(); };

// ---------- layout ----------
const root = document.getElementById('app');
const canvas = h('canvas', { class: 'plan-canvas' });
const labels = h('div', { class: 'labels' });
const bubble = h('div', { class: 'bubble hidden' });
const planBtns = h('div', { class: 'plan-btns' });
const backdrop = h('img', { class: 'backdrop hidden', alt: '' });
const photoNote = h('div', { class: 'photo-note hidden' });
const dock = h('div', { class: 'dock hidden' });
const freeLayer = h('div', { class: 'free-btns' });
const dotLayer = h('div', { class: 'ent-dots' }); // Nido styles: every entity on the plan as a coloured dot
const stage = h('div', { class: 'stage' }, backdrop, canvas, dotLayer, labels, planBtns, bubble, photoNote);
const pageHost = h('div', { class: 'page-host hidden' });
const navBtn = h('button', { class: 'chip nav-chip', onclick: () => {
  if (navBtn.classList.contains('single')) return;
  // The Nido theme: the selector opens in place as the home's layers; elsewhere, and in edit mode, the sheet.
  if (nidoTheme() && !editMode && home()) { layersOpen = !layersOpen; renderNav(); renderLayers(); } else toggleSheet('places');
} });
const nidoTheme = () => document.documentElement.classList.contains('nido');
let layersOpen = false;
const editBar = h('div', { class: 'edit-bar hidden' });
const navEye = h('button', { class: 'round small nav-eye hidden', onclick: () => {
  const d = level() || page();
  if (!d) return;
  mutate(home(), () => { if (d.hideNav) delete d.hideNav; else d.hideNav = true; }, { undoable: false });
  renderNav();
} });
const topbar = h('div', { class: 'topbar' }, navBtn, navEye, h('div', { class: 'spacer' }),
  h('button', { class: 'round more-btn', title: 'More', 'aria-label': 'More', onclick: () => toggleSheet('more') }, icon('more')));
const viewCtl = h('div', { class: 'viewctl' });
const panel = h('div', { class: 'panel-inner' });
const panelGrip = h('button', { class: 'panel-grip', type: 'button' });
const panelBox = h('aside', { class: 'panel' }, panelGrip, panel);
const sheet = h('div', { class: 'sheet hidden' });
const scrim = h('div', { class: 'scrim hidden', onclick: () => closeSheet() });
const dimmer = h('div', { class: 'dimmer hidden' });
const updateChip = h('button', { class: 'chip update-chip hidden', onclick: () => askToUpdate(true) });
const fileInput = h('input', { type: 'file', class: 'hidden' }); // any file: a backup kept in a storage app is often not labelled as JSON
const layersBox = h('nav', { class: 'nido-layers hidden', 'aria-label': 'Homes and dashboards' }); // Nido: the selector, opened (renderLayers)
document.addEventListener('pointerdown', (e) => { if (layersOpen && !layersBox.contains(e.target) && !navBtn.contains(e.target)) { layersOpen = false; renderNav(); renderLayers(); } });
root.append(h('main', { class: 'plan-area' }, stage, pageHost, freeLayer, topbar, dock, layersBox, viewCtl, updateChip, editBar), panelBox, scrim, sheet, dimmer, fileInput);

const view = new NidoramaScene(canvas);
view.onRender = () => { positionLabels(); editor.draw(); if (angleEl) angleEl.textContent = `${Math.round(view.cam.az)}°`; };
let modelWarned = false;
view.onModelError = (id, e) => { if (!modelWarned) { modelWarned = true; alert(`A 3D model could not be shown, so its plain shape is used.\n${e.message || e}`); } };
const editor = new Editor({
  view, stage, panel,
  ctx: {
    home, level,
    changed: () => { buildLabels(); buildPlanButtons(); renderDock(); ensureDemoEntities(); syncFromStates(); renderNav(); },
    done: () => setEditMode(false),
    scan: (o) => startScan(o),
    saveText: (name, text) => saveText(name, text),
    experimental: () => !!device.experimental,
    actions: () => widgetActions,
    freePosAt: (x, y) => freePosAt(x, y),
    startButton: (room) => startButton(room),
    startsHere: (room) => startsHere(room),
    apps: () => integrationApps(),
    addLevel: (copyWalls) => {
      const hm = home(), src = level();
      const name = prompt('Name of the new level', `Level ${hm.levels.length + 1}`);
      if (!name) return;
      const L = newLevel(name);
      upgradeSite(hm);
      if (src && !src.site) { L.floor = floorOf(src) + 1; L.place = { ...placeOf(src) }; }
      if (copyWalls) { L.walls = structuredClone(src.walls).map((w) => ({ ...w, openings: [] })); L.ceilingHeight = src.ceilingHeight; }
      mutate(hm, (x) => x.levels.push(L));
      editor.sel = null;
      show({ homeId: hm.id, kind: 'level', id: L.id });
    },
    openLevel: (id) => show({ homeId: home().id, kind: 'level', id }),
    deleteLevel: () => {
      const hm = home(), L = level();
      if (!confirm(`Delete the level "${L.name}" and everything on it?`)) return;
      mutate(hm, (x) => (x.levels = x.levels.filter((q) => q.id !== L.id)));
      editor.sel = null;
      show({ homeId: hm.id, kind: 'level', id: hm.levels[0].id });
    },
  },
});

// ---------- connection ----------
function demoGroups() {
  const groups = {};
  for (const hm of lib.homes) for (const L of hm.levels) for (const [room, rc] of Object.entries(L.roomControls || {})) {
    const g = rc.lampGroup?.[0]?.entity;
    const members = L.lights.filter((l) => l.room === room && l.kind !== 'ceiling' && l.entity && l.entity !== g).map((l) => l.entity);
    if (g && members.length) groups[g] = members;
  }
  return groups;
}
function ensureDemoEntities() {
  if (!app.conn?.demo) return;
  app.conn.groups = demoGroups();
  app.conn.ensure(lib.homes.flatMap(homeEntities));
}
// One hub, any number of integrations behind it (see hub.js).
const hub = new Hub();
app.conn = hub;
let syncedWith = null;
hub.on((kind, id, p) => {
  if (kind === 'status') {
    renderStatus();
    if (p === hub.ha && p.status === 'connected' && syncedWith !== p) { syncedWith = p; Promise.resolve(syncWithHA(p)).catch(() => {}).finally(() => syncMyModels(p)); setTimeout(findMusicAssistant, 1500); }
    if (openSheet === 'settings' && !document.activeElement?.matches('input')) renderSheet();
  }
  syncFromStates();
});
/** Where a camera's picture is: from Home Assistant directly, or through the add-on when the app is opened inside it. */
app.cameraUrl = (entity) => {
  const ha = hub.ha, drawn = st(entity)?.attributes?.entity_picture;
  if (drawn?.startsWith('data:')) return drawn; // the demo's pretend camera
  if (!ha || !entity) return '';
  if (ha.viaProxy) return `ha-camera/${entity}?t=${Date.now()}`;
  const pic = st(entity)?.attributes?.entity_picture;
  return pic ? `${ha.url.replace(/\/$/, '')}${pic}${pic.includes('?') ? '&' : '?'}t=${Date.now()}` : '';
};
/** Ask Home Assistant something that answers back (a forecast, a calendar's events). */
app.units = device.units === 'imperial' ? 'imperial' : 'metric'; // #123
function setUnits(u) { device.units = u; app.units = u; saveDevice(); if (editor.active) { editor.renderPanel(); editor.draw(); } }
app.haUrl = () => hub.ha?.url || '';
app.ask = (msg) => (hub.ha ? hub.ha.request(msg) : Promise.reject(new Error('not connected')));
/** Album art of what a speaker is playing (it changes with the track, so no refreshing is needed). */
app.artUrl = (entity) => {
  const ha = hub.ha, pic = st(entity)?.attributes?.entity_picture;
  if (!ha || !pic) return '';
  if (/^https?:/.test(pic)) return pic;
  return ha.viaProxy ? `ha-picture/${entity}?v=${encodeURIComponent(st(entity)?.attributes?.media_title || '')}` : `${ha.url.replace(/\/$/, '')}${pic}`;
};
const haToken = () => device.token || device.haAuth?.access_token || '';
function connect() {
  const list = [];
  if (window.__NIDORAMA_ADDON__) list.push(new HAConnection({ viaProxy: true }));
  else if (device.haUrl && (device.haAuth || device.token)) {
    list.push(new HAConnection({ urls: [device.haUrl, device.haUrlRemote], token: device.token, auth: device.haAuth, onAuth: (a) => { device.haAuth = a; saveDevice(); } }));
  }
  if (device.homey?.address && device.homey?.key) list.push(new HomeyConnection(device.homey));
  syncedWith = null;
  hub.use(list);
  ensureDemoEntities();
  renderStatus();
  syncFromStates();
  connectAddon({ haUrl: device.haUrl, token: haToken(), addonUrl: device.addonUrl }).then(() => { householdSync(); if (view.styleId === 'photo' && level()) applyPhoto(); });
}
/** Pick up what others in the household changed (never while this device is in the middle of editing). */
function householdSync() { if (!editMode && !document.querySelector('.modal-wrap')) syncHousehold().catch(() => {}); }
setInterval(householdSync, 45000);

// "Sign in to Home Assistant": the login page is Home Assistant's own, on the user's own machine.
function haSignIn(url) {
  const clientId = `${location.origin}/`, state = Math.random().toString(36).slice(2);
  localStorage.setItem('nidorama.haLogin', JSON.stringify({ url, state, clientId }));
  location.href = `${url}/auth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(location.origin + location.pathname)}&state=${state}`;
}
/** Back from Home Assistant's login page: swap the one-time code for the sign-in that is kept. */
async function finishHaSignIn() {
  const q = new URLSearchParams(location.search), code = q.get('code');
  let pend = null;
  try { pend = JSON.parse(localStorage.getItem('nidorama.haLogin')); } catch {}
  if (!code || !pend || q.get('state') !== pend.state) return;
  localStorage.removeItem('nidorama.haLogin');
  history.replaceState(null, '', location.pathname);
  try {
    const r = await fetch(`${pend.url}/auth/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: pend.clientId }) });
    if (!r.ok) throw new Error(`Home Assistant answered ${r.status}`);
    const t = await r.json();
    Object.assign(device, { haUrl: pend.url, token: '', haAuth: { access_token: t.access_token, refresh_token: t.refresh_token, expires: Date.now() + t.expires_in * 1000, clientId: pend.clientId } });
    saveDevice();
  } catch (e) { alert(`Signing in to Home Assistant did not complete.\n${e.message || e}`); }
}
/** Connection status is shown in Settings → Integrations and the panel, never as a mark on the More button (#47). */
function renderStatus() {}

// ---------- entity helpers for the plan ----------
const lightsInRoom = (roomId) => level().lights.filter((l) => l.room === roomId && l.kind !== 'ceiling');
const controls = (roomId) => level().roomControls?.[roomId] || {};
/** The entity a light uses: its own if Home Assistant knows it, otherwise its room's lamp group. */
function effectiveEntity(light) {
  if (app.conn?.demo || st(light.entity)) return light.entity;
  const group = controls(light.room).lampGroup?.[0]?.entity;
  return group && st(group) ? group : light.entity;
}
function allLightsOff() {
  const ids = new Set();
  for (const L of home()?.levels || []) {
    for (const l of L.lights) ids.add(l.entity);
    for (const rc of Object.values(L.roomControls || {})) { ids.add(rc.mainLight); for (const g of rc.lampGroup || []) ids.add(g.entity); }
  }
  for (const d of ['light', 'switch']) {
    const x = [...ids].filter((i) => i && domainOf(i) === d && (app.conn.demo || st(i)));
    if (x.length) app.conn.call(d, 'turn_off', {}, x);
  }
}

// ---------- HA → scene + UI ----------
let syncQueued = false;
function syncFromStates() {
  if (syncQueued) return;
  syncQueued = true;
  requestAnimationFrame(() => {
    syncQueued = false;
    applyDayNight();
    const L = level();
    if (L && view.level === L) {
      let changed = false;
      for (const rec of view.lights.values()) {
        const l = rec.def, s = st(effectiveEntity(l)), on = isOn(s), lvl = on ? (brightnessPct(s) || 100) / 100 : 0;
        if (rec && (rec.on !== on || rec.level !== lvl)) { view.setLight(l.id, on, lvl, true); changed = true; }
      }
      if (changed) { view._assignLights(); view.requestRender(); }
    }
    refreshButtons();
    paintDots();
    if (sliding.active) return;
    if (page()) renderPageView();
    else if (!editor.active) renderPanel();
    if (openSheet && openSheet !== 'settings' && openSheet !== 'places') renderSheet();
  });
}
function isNight() {
  if (device.dayNight !== 'auto') return device.dayNight === 'night';
  const sun = st('sun.sun');
  if (sun) return sun.state === 'below_horizon';
  const hr = new Date().getHours();
  return hr >= 19 || hr < 6;
}
/** The user's own background photo for the Frosted glass theme, kept on this device. */
const wallUrls = { day: '', night: '' };
const WALL_KEY = { day: 'wallpaper', night: 'wallpaper-night' };
async function loadWallpaper() {
  for (const when of ['day', 'night']) {
    const blob = await getBlob(WALL_KEY[when]);
    if (wallUrls[when]) URL.revokeObjectURL(wallUrls[when]);
    wallUrls[when] = blob ? URL.createObjectURL(blob) : '';
    setWallPhoto(wallUrls[when], when);
  }
  useTheme(true);
}
/** Put the device's theme on the app and on the plan's selection (#57). */
let themeSel;
function useTheme(force = false) {
  const sel = applyTheme(force), key = JSON.stringify(sel);
  if (key !== themeSel) { themeSel = key; view.setSelection(sel); if (view.level) { buildLabels(); view.selectRoom(selectedRoom); } }
}
function applyDayNight() {
  const n = isNight();
  document.documentElement.classList.toggle('night', n);
  useTheme();
  const sun = st('sun.sun')?.attributes;
  if (!n && sun?.elevation > 5 && sun.azimuth != null && (view.sunAngles.azimuth !== sun.azimuth || view.sunAngles.elevation !== sun.elevation)) view.setSun(sun.azimuth, sun.elevation);
  if (view.night !== n) { view.setNight(n); if (view.styleId === 'photo') applyPhoto(); }
}
setInterval(applyDayNight, 60000);

// ---------- navigation ----------
/** A home's first dashboard: its first widget page, else its first plan. */
const firstViewOf = (hm) => (hm.pages?.[0] ? { homeId: hm.id, kind: 'page', id: hm.pages[0].id } : { homeId: hm.id, kind: 'level', id: hm.levels[0]?.id });
function firstView() {
  for (const hm of lib.homes) {
    if (hm.pages?.[0]) return { homeId: hm.id, kind: 'page', id: hm.pages[0].id };
    if (hm.levels[0]) return { homeId: hm.id, kind: 'level', id: hm.levels[0].id };
  }
  return null;
}
function valid(v) {
  const hm = v && getHome(v.homeId);
  return !!hm && !!(v.kind === 'page' ? hm.pages?.find((p) => p.id === v.id) : hm.levels.find((l) => l.id === v.id));
}
/** The move between two plans of the same home (#128): from the whole site down into a level, back out to the
 *  site, or up / down a floor. A picture of the old view goes one way while the new view arrives from the other. */
function moveKind(from, to) {
  if (!from || !to || from === to || editMode) return null;
  if (from.site && !to.site) return 'in';
  if (!from.site && to.site) return 'out';
  if (from.site || to.site) return null;
  const a = from.floor || 0, b = to.floor || 0;
  return b > a ? 'up' : b < a ? 'down' : 'side';
}
function playMove(kind, picture) {
  if (!kind || !stage.animate) return;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const T = calm ? 220 : 560, ease = 'cubic-bezier(.2,.7,.2,1)';
  const NEW = { in: ['scale(0.72)', 'scale(1)'], out: ['scale(1.45)', 'scale(1)'], up: ['translateY(-22%) scale(0.94)', 'none'], down: ['translateY(22%) scale(0.94)', 'none'], side: ['translateX(6%)', 'none'] }[kind];
  const OLD = { in: 'scale(1.7)', out: 'scale(0.62)', up: 'translateY(28%) scale(1.04)', down: 'translateY(-28%) scale(1.04)', side: 'translateX(-6%)' }[kind];
  if (!calm) stage.animate([{ transform: NEW[0], opacity: 0.35 }, { transform: NEW[1], opacity: 1 }], { duration: T, easing: ease });
  else stage.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: T });
  if (!picture) return;
  const img = h('img', { class: 'move-picture', src: picture, alt: '' });
  const r = stage.getBoundingClientRect(), p = stage.parentElement.getBoundingClientRect();
  Object.assign(img.style, { left: `${r.left - p.left}px`, top: `${r.top - p.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  stage.parentElement.insertBefore(img, stage.nextSibling);
  img.animate([{ transform: 'none', opacity: 1 }, { transform: calm ? 'none' : OLD, opacity: 0 }], { duration: T, easing: ease, fill: 'forwards' }).onfinish = () => img.remove();
}
function show(target, opts = {}) {
  const before = cur?.kind === 'level' && level(), same = before && target?.kind === 'level' && target.homeId === cur.homeId && target.id !== cur.id;
  const to = same ? home()?.levels.find((L) => L.id === target.id) : null, kind = same ? moveKind(before, to) : null;
  const picture = kind && !matchMedia('(prefers-reduced-motion: reduce)').matches ? view.snapshot() : null;
  showNow(target, opts);
  if (kind && cur?.id === target.id) playMove(kind, picture);
}
function showNow(target, { room = null, keepEdit = false } = {}) {
  if (!valid(target)) target = firstView();
  if (editor.active) exitEdit(true);
  cur = target;
  selectedRoom = null;
  pageEditing = editMode && cur?.kind === 'page';
  closeSheet();
  device.last = cur;
  saveDevice();
  renderNav();
  const isPage = cur?.kind === 'page';
  if (!cur || isPage) { planBtnEls = []; planBtns.replaceChildren(); }
  renderDock();
  root.classList.toggle('no-panel', !cur || isPage);
  renderViewCtl();
  root.dataset.style = cur && !isPage ? view.styleId : '';
  stage.classList.toggle('hidden', !cur || isPage);
  viewCtl.classList.toggle('hidden', !cur || isPage);
  pageHost.classList.toggle('hidden', !!cur && !isPage);
  if (!cur) return renderWelcome();
  if (isPage) return renderPageView();
  addViewButtonsOnce(home(), level());
  view.unlock();
  view.load(home(), level(), { style: editor.active ? view.styleId : planStyle() });
  afterStyle();
  buildLabels();
  buildPlanButtons();
  syncFromStates();
  if (editMode) enterEdit();
  else {
    view.isolate(null);
    renderPanel();
    goHomeView();
    if (room && level().rooms.some((r) => r.id === room)) enterRoom(room, { animate: false });
  }
  applyPanel();
}
const dashboardCount = () => lib.homes.reduce((n, hm) => n + (hm.pages || []).length + hm.levels.length, 0);
/** Is the dashboard selector hidden on the dashboard being shown (its eye closed in edit mode, #108)? */
const navHidden = () => !!(level() || page())?.hideNav;
function renderNav() {
  const single = lib.homes.length <= 1 && dashboardCount() <= 1;
  // Hidden outside edit mode when its eye is closed; in edit mode it always shows, with the eye beside it.
  navBtn.classList.toggle('hidden', !!home() && navHidden() && !editMode);
  const d = level() || page();
  navEye.classList.toggle('hidden', !editMode || !d);
  navEye.setAttribute('aria-pressed', String(!navHidden()));
  navEye.setAttribute('aria-label', navHidden() ? 'Selector hidden after editing: tap to show it' : 'Selector shown after editing: tap to hide it');
  navEye.title = navEye.getAttribute('aria-label');
  navEye.replaceChildren(icon(navHidden() ? 'eyeoff' : 'eye'));
  navBtn.classList.toggle('single', single && !editMode);
  const nido = nidoTheme() && !editMode && home();
  navBtn.classList.toggle('nido-nav', !!nido);
  navBtn.classList.toggle('open', !!nido && layersOpen);
  navBtn.setAttribute('aria-expanded', String(!!nido && layersOpen));
  const lead = nido && level() ? (level().site ? icon('home') : layerMark(layerPos(level()), true)) : icon(cur?.kind === 'page' ? 'grid' : 'plan');
  navBtn.replaceChildren(...nodes(lead, h('span', {}, nido ? (level() || page())?.name || titleText() : titleText()), editMode ? icon('edit') : single ? null : icon(nido && layersOpen ? 'up' : 'down')));
}

let labelEls = [];
function buildLabels() {
  labels.replaceChildren();
  labelEls = (level()?.rooms || []).map((r) => {
    const el = h('div', { class: 'room-label' }, r.name);
    labels.append(el);
    return { r, el };
  });
  buildDots();
}
// ---------- Nido styles: every entity on the plan as a dot, glowing while it is on ----------
// The dots only show; taps and holds go through them to the thing underneath, which keeps its own actions.
let dotEls = [];
const dotsShown = () => !editor.active && (view.styleId === 'nido' || view.styleId === 'nidoplan');
function buildDots() {
  const L = level(), list = [];
  if (L && dotsShown() && view.level === L) {
    const fixtures = new Set();
    for (const rec of view.lights.values()) {
      if (rec.def.fixture) fixtures.add(rec.def.fixture);
      if (rec.def.entity) list.push({ x: rec.pos[0], y: rec.pos[1], room: rec.room, def: rec.def, light: rec.def, kind: 'light' });
    }
    for (const o of L.objects) {
      if (!o.entity || fixtures.has(o.id)) continue;
      const b = o.bounds;
      list.push({ x: (b.min[0] + b.max[0]) / 2, y: (b.min[1] + b.max[1]) / 2, room: o.room, def: o, kind: dotKindOf(o.entity) });
    }
  }
  for (const d of list) d.el = h('div', { class: 'ent-dot', 'aria-hidden': 'true' });
  dotEls = list;
  dotLayer.replaceChildren(...list.map((d) => d.el));
  paintDots();
  positionLabels();
}
function paintDots() {
  for (const d of dotEls) {
    const on = isOn(st(d.light ? effectiveEntity(d.light) : d.def.entity));
    d.el.style.setProperty('--dot', d.def.dot || dotColour(d.kind));
    d.el.classList.toggle('on', on);
  }
}
const applyLabels = () => labels.classList.toggle('hidden', device.labels === false);
applyLabels();
function positionLabels() {
  for (const d of dotEls) {
    const [x, y] = view.project(d.x, d.y, 0.05);
    d.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    d.el.classList.toggle('hidden', (!!view.isolated && d.room !== view.isolated) || !view.shows(d.x, d.y));
  }
  for (const { b, el } of planBtnEls) { const [x, y] = view.project(b.at[0], b.at[1], 0.02); el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`; el.classList.toggle('hidden', !view.shows(b.at[0], b.at[1])); }
  for (const { r, el } of labelEls) {
    el.classList.toggle('hidden', !!view.isolated && r.id !== view.isolated);
    const at = r.labelAt || r.polygon[0];
    const [x, y] = view.project(at[0], at[1], 0.02);
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    el.classList.toggle('sel', r.id === selectedRoom);
  }
}
function selectRoom(id) {
  const leaving = view.isolated && view.isolated !== id;
  selectedRoom = id;
  view.selectRoom(id);
  if (leaving) leaveRoom();
  // A collapsed panel opens for a tapped room, and closes again with it (#46).
  if (id && !panelOpen && !editor.active) { panelOpen = true; panelAutoOpened = true; applyPanel(); }
  else if (!id && panelAutoOpened) { panelOpen = false; panelAutoOpened = false; applyPanel(); }
  renderPanel();
  positionLabels();
}

// ---------- the room view: zoom smoothly to one room and show only it (#51) ----------
function enterRoom(id, { animate = true } = {}) {
  if (!level() || view.locked) return;
  if (selectedRoom !== id) selectRoom(id);
  view.isolate(id);
  view.focusRoom(id, animate);
  positionLabels();
  renderPanel();
}
/** Back to the whole plan: the home view (or the whole plan), gliding there. */
function leaveRoom({ animate = true, to = 'home' } = {}) {
  if (!view.isolated) return;
  view.isolate(null);
  if (to === 'home') goHomeView(animate);
  else if (to === 'fit') animate ? view.animateTo(view.viewTarget({ az: 0 })) : (view.cam.az = 0, view.fit());
  positionLabels();
  renderPanel();
}

// ---------- the button panel: a fixed size set in edit mode, and collapsible (#46) ----------
let panelOpen = device.panelStart !== 'collapsed', panelAutoOpened = false;
let panelWide = false, wideTimer = 0, panelBase = 0; // swiped out to most of the screen (#89); it settles back by itself
const WIDE_FOR = 30000;
function setPanelWide(on) {
  clearTimeout(wideTimer);
  if (!panelWide) { const r = panelBox.getBoundingClientRect(); panelBase = portrait() ? r.height : r.width; } // its set size, measured before it grows
  panelWide = !!on && !editor.active && !!level();
  if (panelWide) wideTimer = setTimeout(() => setPanelWide(false), WIDE_FOR);
  applyPanel();
}
const portrait = () => window.matchMedia('(orientation: portrait)').matches;
const PANEL_LIMITS = { portrait: [120, 0.75], landscape: [240, 0.6] };
function clampPanel(kind, px) { const [min, max] = PANEL_LIMITS[kind]; return Math.round(Math.max(min, Math.min(px, (kind === 'portrait' ? window.innerHeight : window.innerWidth) * max))); }
function applyPanel() {
  const ps = device.panelSize || {};
  if (editor.active || !level()) panelWide = false;
  root.style.setProperty('--panel-h', ps.portrait ? `${clampPanel('portrait', ps.portrait)}px` : '');
  root.style.setProperty('--panel-w', ps.landscape ? `${clampPanel('landscape', ps.landscape)}px` : '');
  // Widened, the panel slides out over the plan; the plan itself keeps its size, so nothing is redrawn while it moves.
  const tall = portrait(), full = tall ? window.innerHeight : window.innerWidth;
  root.style.setProperty('--panel-extra', panelWide ? `${Math.max(0, Math.round(full * 0.9 - panelBase))}px` : '0px');
  root.classList.toggle('panel-wide', panelWide);
  const collapsed = !panelOpen && !editor.active && !!level();
  root.classList.toggle('panel-collapsed', collapsed);
  const name = selectedRoom && level()?.rooms.find((r) => r.id === selectedRoom)?.name;
  panelGrip.setAttribute('aria-label', editor.active ? 'Drag to resize the panel' : collapsed ? 'Show the widget panel' : 'Collapse the widget panel');
  panelGrip.title = panelGrip.getAttribute('aria-label');
  panelGrip.replaceChildren(...nodes(h('span', { class: 'grip-bar' }), collapsed ? h('span', { class: 'grip-text' }, icon(portrait() ? 'up' : 'left'), h('span', {}, name || 'Rooms')) : null));
}
panelGrip.addEventListener('pointerdown', (e) => {
  const kind = portrait() ? 'portrait' : 'landscape', r = panelBox.getBoundingClientRect();
  const start = kind === 'portrait' ? r.height : r.width, x0 = e.clientX, y0 = e.clientY;
  let moved = false, swipe = 0;
  panelGrip.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const d = kind === 'portrait' ? y0 - ev.clientY : x0 - ev.clientX;
    if (!moved && Math.abs(d) < 6) return;
    moved = true;
    if (!editor.active) { swipe = d; return; } // the size is only set in edit mode; outside it a swipe widens the panel or puts it back
    (device.panelSize ||= {})[kind] = clampPanel(kind, start + d);
    applyPanel();
  };
  const up = () => {
    panelGrip.removeEventListener('pointermove', move);
    panelGrip.removeEventListener('pointerup', up);
    panelGrip.removeEventListener('pointercancel', up);
    if (moved) {
      if (editor.active) return void saveDevice();
      if (!level() || Math.abs(swipe) < 36) return;
      if (swipe > 0) { if (!panelOpen) { panelOpen = true; panelAutoOpened = false; setPanelWide(false); } else setPanelWide(true); } // towards the plan: open, then widen
      else if (panelWide) setPanelWide(false); // away from it: back to the set size
      return;
    }
    if (editor.active || !level()) return;
    if (panelWide) return void setPanelWide(false); // a tap on a widened panel puts it back
    panelOpen = !panelOpen;
    panelAutoOpened = false;
    applyPanel();
  };
  panelGrip.addEventListener('pointermove', move);
  panelGrip.addEventListener('pointerup', up);
  panelGrip.addEventListener('pointercancel', up);
});
window.addEventListener('resize', () => applyPanel());
// A widened panel settles back after 30 seconds of inactivity: any touch, anywhere, starts the count again.
window.addEventListener('pointerdown', () => { if (panelWide) { clearTimeout(wideTimer); wideTimer = setTimeout(() => setPanelWide(false), WIDE_FOR); } }, true);

// ---------- editing ----------
function enterEdit() {
  if (!level()) return;
  closeSheet();
  selectRoom(null);
  view.isolate(null);
  styleBeforeEdit = view.styleId;
  view.unlock();
  view.setStyle('blueprint'); // top-down, high contrast: the clearest view to draw on
  afterStyle();
  view.cam.az = 0;
  view.fit();
  root.dataset.style = view.styleId;
  root.classList.add('editing');
  editor.start();
  renderViewCtl();
  buildPlanButtons();
  renderDock();
  applyPanel();
}
/**
 * In edit mode, swap the drawing view for the real 3D look (#59): one finger then moves or turns
 * the view and two zoom, as on the dashboard, so the home view is set seeing what it will show.
 */
let editLook = false, lookDrag = 'pan';
function setEditLook(on) {
  if (!editor.active || !level()) return;
  editLook = on;
  const style = ['photo', 'blueprint'].includes(styleBeforeEdit) || !styleBeforeEdit ? 'illustrated' : styleBeforeEdit;
  view.setStyle(on ? style : 'blueprint');
  afterStyle();
  editor.overlay.style.display = on ? 'none' : '';
  root.classList.toggle('edit-look', on);
  planArea().classList.toggle('show-grid', !on);
  renderViewCtl();
  if (!on) editor.draw();
  bubble.textContent = on ? 'Looking around: drag to move or turn, pinch to zoom, then set the home view' : 'Back to drawing';
  bubble.classList.remove('hidden');
  clearTimeout(setEditLook.t);
  setEditLook.t = setTimeout(() => bubble.classList.add('hidden'), 2600);
}
function exitEdit(silent = false) {
  if (editLook) { editLook = false; editor.overlay.style.display = ''; root.classList.remove('edit-look'); }
  editor.stop();
  root.classList.remove('editing');
  renderViewCtl();
  if (styleBeforeEdit && level()) { view.setStyle(styleBeforeEdit); goHomeView(); afterStyle(); }
  styleBeforeEdit = null;
  if (!silent) { buildLabels(); buildPlanButtons(); renderDock(); renderPanel(); syncFromStates(); }
  applyPanel();
}

function setEditMode(on) {
  editMode = on;
  closeSheet();
  if (cur?.kind === 'level') { if (on && !editor.active) enterEdit(); else if (!on && editor.active) exitEdit(); }
  if (cur?.kind === 'page') { pageEditing = on; renderPageView(); }
  applyEditChrome();
}
/** Make it obvious when the app is in edit mode, and what can be edited. */
function applyEditChrome() {
  root.classList.toggle('edit-mode', editMode);
  editBar.classList.toggle('hidden', !editMode);
  editBar.replaceChildren(h('span', { class: 'grow', title: 'Drag any button to move it. Tap the title to change dashboards, More for shortcuts.' }, 'Editing'),
    h('button', { class: 'chip small done', onclick: () => setEditMode(false) }, icon('check'), 'Done'));
  renderNav();
  renderViewCtl();
  buttonSig = '';
  refreshButtons();
}

// ---------- gestures: tap, hold, swipe to dim; two fingers pan, zoom and turn ----------
const pointers = new Map();
let g = null, pinch = null;
const HOLD_MS = 450;
const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
function pinchState() {
  const [a, b] = [...pointers.values()];
  return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, ang: Math.atan2(b.y - a.y, b.x - a.x) };
}
canvas.addEventListener('pointerdown', (e) => {
  if (wakeFromIdle()) return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    clearTimeout(g?.timer);
    g = null; editor.drag = null;
    pinch = { ...pinchState(), turned: 0 };
    return;
  }
  if (pointers.size > 2) return;
  if (editor.active && !editLook) return editor.down(e);
  const [sx, sy] = local(e);
  g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, thing: view.pickThing(sx, sy), room: view.pickRoom(sx, sy), mode: null };
  if (editLook) return; // looking around in edit mode: drags move or turn the view, nothing is tapped
  g.timer = setTimeout(() => { if (g && !g.mode) { g.mode = 'hold'; onHold(g); } }, HOLD_MS);
});
canvas.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size === 2) {
    // Two fingers only zoom (#42); moving and turning are one-finger modes chosen with the view-mode button.
    const now = pinchState(), r = canvas.getBoundingClientRect();
    if (Math.abs(now.d / pinch.d - 1) > 0.004) view.zoomAt(now.d / pinch.d, now.cx - r.left, now.cy - r.top);
    Object.assign(pinch, now);
    return;
  }
  if (editor.active && !editLook) return editor.move(e);
  if (!g || e.pointerId !== g.id) return;
  const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
  if (!g.mode && Math.hypot(dx, dy) > 12) {
    clearTimeout(g.timer);
    const mode = editLook ? lookDrag : dragMode();
    if (mode === 'pan') Object.assign(g, { mode: 'pan', lx: e.clientX, ly: e.clientY });
    else if (mode === 'orbit') Object.assign(g, { mode: 'orbit', lx: e.clientX });
    else {
      // Swipe: drags control things; only Pan moves the view (#45).
      const axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      const target = swipeTarget(g, axis);
      Object.assign(g, target ? { mode: 'swipe', axis, target, v0: target.value, last: 0 } : { mode: 'none' });
    }
  }
  if (g.mode === 'pan') {
    view.panBy(e.clientX - g.lx, e.clientY - g.ly);
    g.lx = e.clientX; g.ly = e.clientY;
  } else if (g.mode === 'orbit') {
    view.rotateBy(((e.clientX - g.lx) / window.innerWidth) * -180);
    g.lx = e.clientX;
  } else if (g.mode === 'swipe') {
    const d = g.axis === 'x' ? dx / window.innerWidth : -dy / window.innerHeight;
    const v = Math.max(0, Math.min(100, g.v0 + d * 100));
    g.value = v;
    bubble.textContent = `${g.target.name} · ${swipeLabel(g.target.entities[0], g.target.what, v)}`;
    bubble.classList.remove('hidden');
    if (g.target.what === 'brightness') for (const l of g.target.lights) view.setLight(l, v > 0, v / 100);
    const now = performance.now();
    if (now - g.last > 300) { g.last = now; for (const ent of g.target.entities) applySwipe(ent, g.target.what, v); }
  }
});
const endGesture = (e) => {
  pointers.delete(e.pointerId);
  if (pinch) { if (pointers.size < 2) pinch = null; return; }
  if (editor.active && !editLook) return e.type === 'pointerup' ? editor.up(e) : (editor.drag = null);
  if (!g || e.pointerId !== g.id) return;
  clearTimeout(g.timer);
  if (g.mode === 'swipe') {
    for (const ent of g.target.entities) applySwipe(ent, g.target.what, g.value ?? g.v0);
    setTimeout(() => bubble.classList.add('hidden'), 500);
  } else if (!g.mode && e.type === 'pointerup' && !editLook) onTap(g);
  g = null;
};
canvas.addEventListener('pointerup', endGesture);
canvas.addEventListener('pointercancel', endGesture);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); const [sx, sy] = local(e); view.zoomAt(Math.exp(-e.deltaY * 0.0015), sx, sy); }, { passive: false });

const thingEntity = (t) => (t.light ? effectiveEntity(t.light) : t.object.entity);
/** The item whose gesture settings apply: a light's fixture if it has one, else the light / object itself. */
const gestureHost = (t) => (t.light ? level().objects.find((o) => o.id === t.light.fixture) || t.light : t.object);
const thingName = (t) => (t.light || t.object).name;
function runAction(entity, action, thing, g) {
  if (action === 'steps') return runSteps(`${cur?.id}:${(thing.light || thing.object).id}`, g?.steps, entity);
  if (!entity || action === 'none') return;
  if (action === 'details') { openSheet = { thing: { object: { id: '_g', name: thingName(thing), entity } } }; renderSheet(); return; }
  if (action === 'toggle') return toggle(entity);
  const d = domainOf(entity);
  app.conn.call(['light', 'switch', 'fan', 'input_boolean', 'cover', 'media_player'].includes(d) ? d : 'homeassistant', action === 'on' ? 'turn_on' : 'turn_off', {}, entity);
}
let lastTap = { key: null, at: 0 };
function onTap({ thing, room }) {
  if (thing) { const gt = gestureFor(gestureHost(thing).gestures, 'tap', thingEntity(thing)); return runAction(gt.entity, gt.action, thing, gt); }
  // Two taps on the same spot (the same room, or empty floor), straight after one another (#95).
  const key = room || '', now = performance.now(), twice = !editor.active && lastTap.key === key && now - lastTap.at < 380;
  lastTap = twice ? { key: null, at: 0 } : { key, at: now };
  if (view.isolated) { if (twice) selectRoom(null); return; } // zoomed into a room: one tap changes nothing, two taps go back out
  const inside = room && view.siteLevelOf?.(room);
  if (inside && !editor.active) return void show({ homeId: home().id, kind: 'level', id: inside }); // the site view: a building's room opens that level
  if (room && twice) enterRoom(room); // two taps on a room zoom into it
  else if (room) selectRoom(room === selectedRoom ? null : room);
  else selectRoom(null);
}
function onHold({ thing, room }) {
  navigator.vibrate?.(15);
  if (thing) {
    const gh = gestureFor(gestureHost(thing).gestures, 'hold', thingEntity(thing));
    if (gh.action === 'details' && gh.entity === thingEntity(thing)) { openSheet = { thing }; renderSheet(); }
    else runAction(gh.entity, gh.action, thing, gh);
  } else if (room) selectRoom(room);
}
function swipeTarget({ thing, room }, axis) {
  const L = level();
  if (thing) {
    const gs = gestureFor(gestureHost(thing).gestures, axis === 'x' ? 'swipeX' : 'swipeY', thingEntity(thing));
    if (!gs.entity || gs.what === 'none') return null;
    return { name: thingName(thing), what: gs.what, entities: [gs.entity], lights: L.lights.filter((l) => effectiveEntity(l) === gs.entity).map((l) => l.id), value: swipeValue(gs.entity, gs.what) };
  }
  if (axis !== 'x') return null; // up / down on the floor does nothing in Swipe mode
  const roomId = room || selectedRoom;
  if (!roomId) return null;
  const lamps = lightsInRoom(roomId).filter((l) => isDimmable(st(effectiveEntity(l))));
  const ents = [...new Set(lamps.map(effectiveEntity))];
  if (!ents.length) return null;
  const name = L.rooms.find((r) => r.id === roomId)?.name || 'Lamps';
  return { name: `${name} lamps`, what: 'brightness', entities: ents, lights: lamps.map((l) => l.id), value: Math.max(...ents.map((e) => brightnessPct(st(e)))) };
}

// ---------- plan side panel ----------
function renderPanel() {
  if (!level() || editor.active) return;
  panel.replaceChildren(selectedRoom && level().rooms.some((r) => r.id === selectedRoom) ? roomPanel(selectedRoom) : overviewPanel());
}
/** What a widget can do beyond its entity: open a room, switch every light off. */
const widgetActions = { openRoom: (id) => { if (level()?.rooms.some((r) => r.id === id)) selectRoom(id); }, allLightsOff: () => allLightsOff(), roomName: (id) => level()?.rooms.find((r) => r.id === id)?.name };
function overviewPanel() {
  const L = level(), c = app.conn, list = L.roomList || {};
  if (L.panelView && viewUrl(L.panelView)) return webPanel(L.panelView); // a web page or Home Assistant dashboard (#118)
  if ((L.panelPage?.sections || []).some((x) => (x.tiles || []).length)) return h('div', { class: 'panel-body panel-widgets' },
    renderPage(home(), L.panelPage, { editing: false, embedded: true, actions: widgetActions, rerender: renderPanel }));
  const order = [...(list.order || []).map((id) => L.rooms.find((r) => r.id === id)).filter(Boolean), ...L.rooms.filter((r) => !(list.order || []).includes(r.id))];
  const rooms = order.filter((r) => !(list.hidden || []).includes(r.id)).map((r) => {
    const ents = [...new Set(roomControlsOf(L, r.id).flatMap((x) => [x.entity, ...(x.subs || []).map((sb) => sb.entity)]).filter(Boolean))];
    const onCount = ents.filter((e) => ['light', 'switch'].includes(domainOf(e)) && isOn(st(e))).length;
    const temp = ents.map((e) => st(e)).find((x) => x && (x.attributes?.current_temperature != null || x.attributes?.unit_of_measurement === '°C'));
    const info = list.show === 'none' ? '' : list.show === 'temperature' && temp ? `${temp.attributes.current_temperature ?? temp.state}°` : onCount ? `${onCount} on` : '';
    return h('button', { class: 'room-row', onclick: () => selectRoom(r.id) },
      h('span', { class: 'lamp-dot' + (onCount ? ' on' : '') }), h('span', { class: 'grow' }, r.name), h('span', { class: 'sub' }, info), icon('chevron'));
  });
  const empty = !L.walls.length && !L.rooms.length && !L.objects.length;
  return h('div', { class: 'panel-body' },
    c.demo ? h('p', { class: 'hint' }, 'Nothing is connected yet, so changes are simulated. Open More → Settings to connect your home.') : null,
    c.status === 'auth_invalid' ? h('p', { class: 'hint bad' }, 'Home Assistant rejected the sign-in. Check More → Settings.') : null,
    empty
      ? [h('p', { class: 'hint' }, 'This floor plan is empty. Draw its walls and rooms, then add furniture and lights.'), h('button', { class: 'wide', onclick: enterEdit }, icon('edit'), 'Start designing')]
      : [h('div', { class: 'list' }, rooms),
        h('button', { class: 'wide', onclick: allLightsOff }, icon('power'), 'All lights off')]);
}
const expandedCtl = new Set();
/** While a slider in the room panel moves, let the lamps on the plan follow it. */
function previewOnPlan(entity, pct) {
  for (const l of level()?.lights || []) if (effectiveEntity(l) === entity) view.setLight(l.id, pct > 0, pct / 100);
}
function roomPanel(roomId) {
  const L = level(), room = L.rooms.find((r) => r.id === roomId), list = roomControlsOf(L, roomId);
  return h('div', { class: 'panel-body' },
    h('div', { class: 'panel-head' }, h('h2', {}, room.name),
      view.locked ? null : view.isolated === roomId
        ? h('button', { class: 'round small on', 'aria-label': 'Show the whole plan', title: 'Show the whole plan', onclick: () => leaveRoom() }, icon('expand'))
        : h('button', { class: 'round small', 'aria-label': 'Zoom to this room', title: 'Zoom to this room', onclick: () => enterRoom(roomId) }, icon('target')),
      h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => { const was = view.isolated; selectRoom(null); if (!was) view.fit(); } }, icon('close'))),
    list.map((x) => ctlRow(x, { expanded: expandedCtl, rerender: renderPanel, onPreview: previewOnPlan, done: syncFromStates })),
    !list.length ? h('p', { class: 'hint' }, 'Nothing is connected to this room yet. In edit mode, select the room to add its buttons.') : null);
}

// ---------- home pages + welcome ----------
function renderPageView() {
  const hm = home(), pg = page();
  if (!pg) return;
  pageHost.replaceChildren(h('div', { class: 'page-wrap' },
    h('div', { class: 'page-head' }, h('h1', {}, pg.name), app.conn.demo ? h('span', { class: 'badge' }, 'Demo') : null,
      pageEditing ? startButton(null, 'chip small') : null),
    pageEditing ? null : statusChips(hm),
    renderPage(hm, pg, { editing: pageEditing, actions: widgetActions, rerender: (gone) => (gone ? show(firstView()) : renderPageView()) })));
}
/** A line of small facts about the home (lights on, doors, what is playing). Themes that want it show it (#84). */
function statusChips(hm) {
  const ids = homeEntities(hm), of = (d) => ids.filter((e) => domainOf(e) === d), state = (e) => st(e)?.state;
  const lights = of('light').filter((e) => state(e) === 'on').length, open = of('cover').filter((e) => state(e) === 'open').length;
  const locks = of('lock'), unlocked = locks.filter((e) => state(e) === 'unlocked').length, playing = of('media_player').filter((e) => state(e) === 'playing').length;
  const heat = of('climate').find((e) => state(e) && state(e) !== 'off');
  const chip = (ic, text, on) => h('span', { class: 'stat' + (on ? ' on' : '') }, icon(ic), text);
  return h('div', { class: 'status-chips' }, ...nodes(
    of('light').length ? chip('bulb', lights ? `${lights} on` : 'Lights off', lights) : null,
    of('cover').length ? chip('blind', open ? `${open} open` : 'Blinds closed', open) : null,
    locks.length ? chip('lock', unlocked ? `${unlocked} unlocked` : 'Locked', unlocked) : null,
    of('media_player').length ? chip('music', playing ? `${playing} playing` : 'Quiet', playing) : null,
    heat ? chip('flame', `${st(heat).attributes?.temperature ?? ''}°`, true) : null));
}
function renderWelcome() {
  panel.replaceChildren();
  applyPanel();
  pageHost.replaceChildren(h('div', { class: 'welcome' },
    h('img', { src: 'icon.svg', alt: '', width: 72, height: 72 }),
    h('h1', {}, 'Nidorama'),
    h('p', {}, 'Look down into a model of your home and tap the things in it. Draw your own plan, or load a home file.'),
    h('div', { class: 'row units-row' }, h('div', { class: 'row-label' }, 'Units'),
      seg([['metric', 'Metric'], ['imperial', 'Imperial']], app.units, (v) => { setUnits(v); renderWelcome(); })),
    h('button', { class: 'wide primary', onclick: createHome }, icon('plus'), 'Create a home'),
    h('button', { class: 'wide', onclick: () => sketchGuide() }, icon('edit'), 'Make a plan from a paper sketch'),
    h('button', { class: 'wide', onclick: () => fileInput.click() }, icon('file'), 'Import a home file, or restore a backup'),
    h('button', { class: 'wide ghost', onclick: () => { const hm = sampleHome(); ensureDemoEntities(); show({ homeId: hm.id, kind: 'level', id: hm.levels[0].id }); } }, icon('star'), 'Try the sample home')));
}
/** A home file's plans added to an existing home as new plan dashboards (#93). Returns the first one. */
function addPlansFromText(hm, text, name) {
  const got = readHomeText(text), added = [];
  mutate(hm, (x) => {
    for (const [i, L] of got.levels.entries()) {
      const lv = { ...structuredClone(L), id: uid('level'), name: got.levels.length === 1 ? name || L.name : `${name || got.name} · ${L.name}` };
      x.levels.push(lv); added.push(lv);
    }
  }, { undoable: false });
  ensureDemoEntities();
  return added[0];
}
let planInto = null; // { hm, name }: the next file chosen becomes a plan in that home, not a home of its own
/** The "plan from a sketch" guide (#82), wired to this app's saving and importing. `into` = { hm, name } adds the plan to that home. */
function sketchGuide(into = null) {
  const open = (homeId, id) => { editMode = true; show({ homeId, kind: 'level', id }); applyEditChrome(); };
  openSketchGuide({
    saveSample: () => saveText('sample-cottage.nidorama.json', sampleFile()),
    pickFile: () => { planInto = into; fileInput.click(); },
    canListDevices: () => !!hub.ha,
    saveDevices: async () => saveText('my-devices.json', JSON.stringify(await deviceList(), null, 1)),
    importText: async (text) => {
      try {
        if (into) { const lv = addPlansFromText(into.hm, text, into.name); open(into.hm.id, lv.id); }
        else { const hm = await importHome(text); ensureDemoEntities(); open(hm.id, hm.levels[0].id); }
        return '';
      } catch (e) { return e.message; }
    },
  });
}
/** The home system's devices as a small list for a chat assistant (#83): id, name, kind and room. Nothing else. */
async function deviceList() {
  const KINDS = ['light', 'switch', 'fan', 'cover', 'climate', 'lock', 'media_player', 'camera', 'scene', 'script', 'weather', 'vacuum'];
  const SENSORS = ['temperature', 'humidity', 'door', 'window', 'motion', 'occupancy', 'garage_door'];
  let areaOf = () => '';
  try { // rooms come from Home Assistant's registries; without them the list simply has no rooms
    const [areas, devices, entities] = await Promise.all(['area', 'device', 'entity'].map((r) => app.ask({ type: `config/${r}_registry/list` })));
    const name = new Map(areas.map((a) => [a.area_id, a.name])), dev = new Map(devices.map((d) => [d.id, d.area_id])), ent = new Map(entities.map((e) => [e.entity_id, e]));
    areaOf = (id) => { const e = ent.get(id); return name.get(e?.area_id || dev.get(e?.device_id)) || ''; };
  } catch {}
  const devices = [...hub.ha.states.values()]
    .filter((x) => KINDS.includes(domainOf(x.entity_id)) || (['sensor', 'binary_sensor'].includes(domainOf(x.entity_id)) && SENSORS.includes(x.attributes?.device_class)))
    .map((x) => ({ id: x.entity_id, name: x.attributes?.friendly_name || '', kind: domainOf(x.entity_id), room: areaOf(x.entity_id) }))
    .sort((a, b) => a.room.localeCompare(b.room) || a.id.localeCompare(b.id));
  return { about: 'Devices in my home, for making a floor-plan home file. Use these ids exactly; never invent one.', devices };
}
/** The three ways to begin a home of one's own, as on the welcome screen (#124). */
function startOwnHome() {
  const close = modal(h('div', { class: 'menu' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Start my own home'), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
    h('p', { class: 'hint pad' }, 'The sample stays here until you delete it, so you can come back to it.'),
    h('div', { class: 'stack pad' },
      h('button', { class: 'wide primary', onclick: () => { close(); createHome(); } }, icon('plus'), 'Draw it myself'),
      h('button', { class: 'wide', onclick: () => { close(); sketchGuide(); } }, icon('edit'), 'Make a plan from a paper sketch'),
      h('button', { class: 'wide', onclick: () => { close(); fileInput.click(); } }, icon('file'), 'Import a home file'))));
}
function createHome() {
  const name = prompt('Name of the home', 'My home');
  if (!name) return;
  const hm = newHome(name.trim());
  editMode = true;
  show({ homeId: hm.id, kind: 'level', id: hm.levels[0].id });
  applyEditChrome();
}
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  try {
    const text = (await file.text()).replace(/^\uFEFF/, '');
    let data = null;
    try { data = upgradeFile(JSON.parse(text)); } catch {}
    if (data && !data.schema && Array.isArray(data.homes) && data.device) data.schema = 'nidorama.backup/1'; // a backup that lost its label
    const into = planInto; planInto = null;
    if (into && data?.schema !== 'nidorama.backup/1') { const lv = addPlansFromText(into.hm, text, into.name); editMode = true; show({ homeId: into.hm.id, kind: 'level', id: lv.id }); applyEditChrome(); return; }
    if (data?.schema === 'nidorama.backup/1') return void (confirm(`Restore this backup (${(data.homes || []).length} home${(data.homes || []).length === 1 ? '' : 's'} and this device's settings)?`) && (await restoreBackup(data)));
    const hm = await importHome(text);
    ensureDemoEntities();
    show({ homeId: hm.id, kind: 'level', id: hm.levels[0].id });
  } catch (e) { alert(`Could not import "${file.name}".\n${e.message}`); }
});
/** Hand the user a text file: Android's save dialog in the app, a download in a browser. */
async function saveText(name, text) {
  if (native.isNative && (await native.saveTextFile(name, text))) return;
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
async function exportCurrent(hm) {
  saveText(`${hm.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'home'}.nidorama.json`, await exportHome(hm));
}

// ---------- sheets ----------
function toggleSheet(name) {
  if (openSheet === name) closeSheet();
  else { openSheet = name; renderSheet(); }
}
function closeSheet() {
  openSheet = null;
  moreOpen = false;
  sheet.classList.add('hidden');
  scrim.classList.add('hidden');
}
function renderSheet() {
  if (!openSheet) return closeSheet();
  const content = openSheet === 'more' ? moreSheet() : openSheet === 'places' ? placesSheet() : openSheet === 'settings' ? settingsSheet() : openSheet.menu ? menuSheet(openSheet.menu) : openSheet.integrations ? integrationsSheet() : thingSheet(openSheet.thing);
  sheet.replaceChildren(content);
  sheet.classList.toggle('left', openSheet === 'places');
  sheet.classList.remove('hidden');
  scrim.classList.remove('hidden');
}

/** "Start this device here" (#50): in edit mode, in a room's panel (start zoomed in on it), or for the whole dashboard. */
const startsHere = (room) => !!(device.start && cur && device.start.homeId === cur.homeId && device.start.id === cur.id && (device.start.room || null) === (room || null));
function startButton(room, cls = 'wide ghost') {
  const b = h('button', { class: cls + ' start-here', type: 'button' });
  const draw = () => {
    const on = startsHere(room);
    b.classList.toggle('on', on);
    b.title = on ? 'Tap to go back to opening where you left off' : room ? 'This device will open zoomed in on this room' : 'This device will open on this dashboard';
    b.replaceChildren(icon(on ? 'check' : 'target'), h('span', {}, on ? 'This device starts here' : 'Start this device here'));
  };
  b.onclick = () => { device.start = startsHere(room) ? null : { homeId: cur.homeId, kind: cur.kind, id: cur.id, room: room || null }; saveDevice(); draw(); };
  draw();
  return b;
}
function startLabel() {
  const s = device.start, hm = s && getHome(s.homeId);
  if (!hm) return 'Opens where you left off';
  const v = s.kind === 'page' ? hm.pages?.find((p) => p.id === s.id) : hm.levels.find((l) => l.id === s.id);
  const room = s.room && v?.rooms?.find((r) => r.id === s.room);
  return `Opens on ${room ? `${room.name}, ` : ''}${hm.name} · ${v?.name || '?'}`;
}

/** The apps of the platforms Nidorama is connected to. */
function integrationApps() {
  const out = [];
  if (hub.ha || window.__NIDORAMA_ADDON__) out.push({ id: 'ha', name: 'Home Assistant', icon: 'ha', open: () => native.openHomeAssistantApp(device.haUrl) });
  if (musicAssistant) out.push({ id: 'ma', name: 'Music Assistant', icon: 'music', open: () => window.open(musicAssistant, '_blank', 'noopener') });
  if (device.homey?.key) out.push({ id: 'homey', name: 'Homey', icon: 'home', open: () => native.openApp('app.homey', 'https://my.homey.app') });
  return out;
}
/** Music Assistant (#127): found through Home Assistant, by its sidebar panel (the add-on) or its integration.
 *  The address opened: the panel inside Home Assistant, else the Music Assistant server's own page (port 8095). */
let musicAssistant = null;
async function findMusicAssistant() {
  musicAssistant = null;
  const base = (window.__NIDORAMA_ADDON__ ? location.origin : hub.ha?.url || '').replace(/\/$/, '');
  if (!base || !app.ask) return;
  try {
    const panels = await app.ask({ type: 'get_panels' });
    const p = Object.values(panels || {}).find((x) => /music[ _-]?assistant/i.test(`${x.url_path} ${x.title || ''} ${x.config?.ingress || ''}`));
    if (p) musicAssistant = `${base}/${p.url_path}`;
  } catch { /* not allowed or not connected */ }
  if (!musicAssistant) {
    const found = Object.entries(app.conn?.states || {}).some(([id, x]) => id.startsWith('media_player.') && (x.attributes?.mass_player_type || x.attributes?.mass_player_id));
    if (found) { try { const u = new URL(base); musicAssistant = `${u.protocol}//${u.hostname}:8095`; } catch { /* no address */ } }
  }
}
let moreOpen = false; // whether "Settings and more" is open in the More menu; closed again each time the menu is
function moreSheet() {
  const hm = home(), c = app.conn, items = [];
  // Trying the sample: a clear way to begin one's own home (#124).
  if (hm && !editMode && (hm.sample || hm.name === 'Sample cottage')) items.push(menuItem('plus', 'Start my own home', 'draw it, from a paper sketch, or a home file', () => { closeSheet(); startOwnHome(); }, icon('chevron')), h('div', { class: 'msep' }));
  if (hm) {
    items.push(h('div', { class: 'menu-title' }, 'Shortcuts'));
    if (editMode) {
      // The home's shortcuts and own menus, editable right here.
      items.push(...menuEditor(home, { changed: () => { ensureDemoEntities(); renderDock(); }, draw: () => renderSheet() }));
    } else {
      const shortcuts = moreItems(hm);
      for (const item of shortcuts) items.push(controlRow(item, { allLightsOff, done: closeSheet }));
      if (!shortcuts.length) items.push(h('p', { class: 'hint pad' }, 'No shortcuts yet. Open "Settings and more" below and tap Edit to add some.'));
    }
    items.push(h('div', { class: 'msep' }));
  }
  // Everything that is not a shortcut sits behind one row, closed until asked for (#87) — except while editing, and an update that is waiting.
  const tucked = hm && !editMode && !moreOpen;
  if (update) items.push(menuItem('update', `Install update ${update.version}`, updateBusy || `you have v${VERSION}`, () => { closeSheet(); askToUpdate(true); }, h('span', { class: 'lamp-dot green' })));
  // With the dashboard selector removed from this dashboard, the list of homes and dashboards is here (#103).
  if (hm && navHidden()) items.push(menuItem('grid', 'Homes and dashboards', titleText(), () => { openSheet = 'places'; renderSheet(); }, icon('chevron')));
  if (hm && !editMode) items.push(menuItem('gear', 'Settings and more', tucked ? 'integrations, edit, settings, requests' : null, () => { moreOpen = !moreOpen; renderSheet(); }, icon(moreOpen ? 'down' : 'chevron')));
  if (tucked) return h('div', { class: 'menu' }, items);
  const apps = integrationApps();
  // Each connected app is one tap away (#127): Home Assistant, Music Assistant, Homey.
  for (const a of apps) items.push(menuItem(a.icon, `Open ${a.name}`, null, () => { closeSheet(); a.open(); }));
  // The one way into edit mode (and out of it), #48.
  if (hm) items.push(editMode
    ? menuItem('check', 'Finish editing', 'save and go back to using the dashboard', () => setEditMode(false))
    : menuItem('edit', 'Edit', 'dashboards, buttons, panels and menus', () => setEditMode(true)));
  // Kiosk mode can always be switched off (or on) from here while editing (#69).
  if (editMode || kioskOn()) items.push(h('div', { class: 'menu-row' }, icon('lock'), h('span', { class: 'grow' }, 'Kiosk mode', h('span', { class: 'sub' }, editMode ? 'full screen with your swipes' : 'tap Edit above to change this')),
    editMode ? seg([[true, 'On'], [false, 'Off']], kioskOn(), (v) => { setKiosk(v); renderSheet(); }) : h('span', { class: 'badge' }, 'On')));
  items.push(menuItem('gear', 'Settings', c.demo ? 'not connected' : c.status, () => { openSheet = 'settings'; settingsPage = null; renderSheet(); }));
  items.push(menuItem('help', 'Requests', 'ask for a feature or a fix', openRequests));
  // Checking for updates is in Settings → Updates and backup (#90); an update that is waiting shows at the top of this menu.
  return h('div', { class: 'menu' + (editMode ? ' editing-menu' : '') }, items);
}
function integrationsSheet() {
  return h('div', { class: 'menu' }, h('div', { class: 'menu-title' }, 'Integrations'),
    integrationApps().map((a) => menuItem(a.icon, `Open ${a.name}`, null, () => { closeSheet(); a.open(); })));
}

/** The donate note (#119). The app handles no payment: the button opens the donation page in the browser. */
function supportNote() {
  const close = modal(h('div', { class: 'menu' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Support Nidorama'), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
    h('p', { class: 'pad' }, "The Nidorama app is free and open source, and everything it does in your home, on your devices and on your own network stays free. Building and running it still costs real money: code hosting and build machines, developer memberships, and more. If it's useful to you and you'd like to help, any amount is genuinely appreciated. No pressure at all."),
    h('button', { class: 'wide primary', onclick: () => { close(); window.open(__DONATE_URL__, '_blank', 'noopener'); } }, icon('heart'), 'Donate any amount')));
}

/** Add level / Add roof (#117): a new plan dashboard on the floor above the one it starts from, with that
 *  dashboard's outside walls already drawn (a level) or a roof piece covering them (a roof), placed on top of it. */
function addFloor(hm, roof) {
  upgradeSite(hm);
  const plans = planLevels(hm).filter((L) => !L.roof && L.walls.length);
  const top = [...plans].sort((a, b) => floorOf(b) - floorOf(a))[0];
  let srcId = top?.id || '';
  const name = h('input', { type: 'text', value: roof ? 'Roof' : `Level ${top ? floorOf(top) + 1 : planLevels(hm).length}`, placeholder: roof ? 'e.g. Roof, Shed roof' : 'e.g. Upstairs' });
  const body = h('div', { class: 'menu' }), close = modal(body);
  const create = () => {
    const src = hm.levels.find((L) => L.id === srcId), n = name.value.trim() || (roof ? 'Roof' : 'Level');
    close();
    const floor = src ? floorOf(src) + 1 : Math.max(0, ...planLevels(hm).map(floorOf)) + (planLevels(hm).length ? 1 : 0), place = src ? { ...placeOf(src) } : { x: 0, y: 0, rot: 0 };
    let L;
    if (roof) {
      const b = src ? outlineBox(src) : null;
      L = roofLevel(n, floor, place, b && !b.empty ? [newPiece([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2], b.x1 - b.x0, b.y1 - b.y0)] : []);
    } else {
      L = newLevel(n);
      Object.assign(L, { floor, place });
      if (src) { const ext = src.walls.filter((w) => w.exterior); L.walls = structuredClone(ext.length ? ext : src.walls).map((w) => ({ ...w, openings: [] })); L.ceilingHeight = src.ceilingHeight || 2.4; }
    }
    mutate(hm, (x) => {
      // A roof standing where the new level goes moves up a floor, so it stays on top.
      if (!roof && src) for (const r of x.levels) if (r.roof && floorOf(r) >= floor && Math.hypot((placeOf(r).x || 0) - place.x, (placeOf(r).y || 0) - place.y) < 0.5) r.floor = floorOf(r) + 1;
      x.levels.push(L);
    }, { undoable: false });
    show({ homeId: hm.id, kind: 'level', id: L.id });
    if (!editMode) setEditMode(true);
    toast(roof ? 'Roof added. Drag its corners to fit, or use the Roof tool for more pieces.' : `${n} added on ${floorName(floor).toLowerCase()}.`);
  };
  body.replaceChildren(...nodes(
    h('div', { class: 'panel-head' }, h('h2', {}, roof ? 'Add roof' : 'Add level'), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
    h('label', { class: 'field wide-field' }, h('span', {}, 'Name'), name),
    h('label', { class: 'field wide-field' }, h('span', {}, 'Start from the outside walls of'),
      h('select', { onchange: (e) => (srcId = e.target.value) },
        h('option', { value: '', selected: !srcId }, 'Nothing: start empty'),
        plans.map((L) => h('option', { value: L.id, selected: L.id === srcId }, `${L.name} (${floorName(floorOf(L))})`)))),
    h('p', { class: 'hint' }, roof ? 'The roof goes on the floor above, covering those walls. You can resize and turn it on the plan.' : 'The new level goes on the floor above, standing exactly on top of it.'),
    h('button', { class: 'wide primary', onclick: create }, icon('plus'), 'Create')));
  setTimeout(() => name.focus(), 50);
}

/** "+ Dashboard": ask what kind it is, its name and who sees it, then open it for editing. */
function newDashboard(hm) {
  let kind = 'tiles', isPrivate = false;
  const from = new Set(); // the dashboards a new Widgets page starts from (#93)
  const boards = [...hm.levels.filter((L) => L.rooms.length).map((L) => ({ kind: 'level', id: L.id, name: L.name, what: 'plan' })), ...(hm.pages || []).map((x) => ({ kind: 'page', id: x.id, name: x.name, what: 'widgets' }))];
  const name = h('input', { type: 'text', value: '', placeholder: 'e.g. Favourites, Upstairs' });
  let multiOpen = false;
  const body = h('div', { class: 'menu' });
  const close = modal(body);
  const create = () => {
    const n = name.value.trim() || (kind === 'tiles' ? 'Dashboard' : `Floor ${hm.levels.length + 1}`);
    close();
    if (kind === 'site') {
      const L = makeSite(hm);
      L.name = name.value.trim() || 'Whole site';
      mutate(hm, (x) => { upgradeSite(x); x.levels.push(L); }, { undoable: false });
      return void show({ homeId: hm.id, kind: 'level', id: L.id });
    }
    if (kind === 'tiles') {
      const p = newPage(hm, n, { isPrivate, from: boards.filter((d) => from.has(d.id)) });
      ensureDemoEntities();
      show({ homeId: hm.id, kind: 'page', id: p.id });
    } else {
      const L = newLevel(n);
      if (isPrivate) L.private = true;
      mutate(hm, (x) => x.levels.push(L), { undoable: false });
      show({ homeId: hm.id, kind: 'level', id: L.id });
    }
  };
  const draw = () => body.replaceChildren(...nodes(
    h('div', { class: 'panel-head' }, h('h2', {}, 'New dashboard'), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
    h('div', { class: 'kinds' },
      h('button', { class: 'kind' + (kind === 'tiles' ? ' on' : ''), 'aria-pressed': String(kind === 'tiles'), onclick: () => { kind = 'tiles'; draw(); } }, icon('grid'), h('b', {}, 'Widgets'), h('span', { class: 'sub' }, 'Widgets you arrange, no plan')),
      h('button', { class: 'kind' + (kind === 'plan' ? ' on' : ''), 'aria-pressed': String(kind === 'plan'), onclick: () => { kind = 'plan'; draw(); } }, icon('plan'), h('b', {}, 'Floor plan'), h('span', { class: 'sub' }, 'Draw a floor and tap the things on it')),
      siteOf(hm) ? null : h('button', { class: 'kind' + (kind === 'site' ? ' on' : ''), 'aria-pressed': String(kind === 'site'), onclick: () => { kind = 'site'; draw(); } }, icon('home'), h('b', {}, 'Whole site'), h('span', { class: 'sub' }, 'Every building, its roof and the yard in 3D'))),
    h('label', { class: 'field wide-field' }, h('span', {}, 'Name'), name),
    h('div', { class: 'row' }, h('div', { class: 'row-label' }, 'Visibility'),
      seg([[false, 'The home'], [true, 'Only me']], isPrivate, (v) => { isPrivate = v; draw(); })),
    kind === 'tiles' && boards.length ? h('details', { class: 'multi', open: multiOpen, ontoggle: (e) => (multiOpen = e.target.open) },
      h('summary', {}, h('span', { class: 'grow' }, 'Start from page(s)'), h('span', { class: 'sub' }, from.size ? boards.filter((d) => from.has(d.id)).map((d) => d.name).join(', ') : 'none: an empty page'), icon('down')),
      boards.map((d) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: from.has(d.id), onchange: (e) => { e.target.checked ? from.add(d.id) : from.delete(d.id); draw(); } }), h('span', { class: 'grow' }, d.name), h('span', { class: 'sub' }, d.what)))) : null,
    kind === 'plan' ? h('button', { class: 'wide', onclick: () => { const n = name.value.trim(); close(); sketchGuide({ hm, name: n }); } }, icon('edit'), 'Plan from paper sketch') : null,
    h('button', { class: 'wide primary', onclick: create }, icon('plus'), 'Create')));
  draw();
  setTimeout(() => name.focus(), 50);
}
/** Where a dashboard is kept, in plain words. */
function sharingNote(isPrivate) {
  if (isPrivate) return hub.ha ? 'Kept under your own Home Assistant sign-in' : 'Kept on this device';
  if (remote.base) return 'Saved on the Home Assistant machine for everyone';
  if (hub.ha) return 'Everyone using this Home Assistant sign-in; the Nidorama add-on shares it with all';
  return 'On this device until a home system is connected';
}

function placesSheet() {
  const items = [];
  for (const hm of lib.homes) {
    const go = (kind, id) => show({ homeId: hm.id, kind, id });
    const here = (kind, id) => cur?.homeId === hm.id && cur.kind === kind && cur.id === id;
    const homeActions = () => {
      const act = (fn) => () => { close(); fn(); };
      const close = modal(h('div', { class: 'menu' },
        h('div', { class: 'panel-head' }, h('h2', {}, hm.name), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
        menuItem('edit', 'Rename', null, act(() => { const n = prompt('Home name', hm.name); if (n) { mutate(hm, (x) => (x.name = n.trim()), { undoable: false }); renderNav(); openSheet = 'places'; renderSheet(); } })),
        menuItem('file', 'Export as a file', null, act(() => exportCurrent(hm))),
        h('div', { class: 'msep' }),
        h('div', { class: 'danger-item' }, menuItem('trash', 'Delete this home', null, act(() => { if (confirm(`Delete "${hm.name}" from this app? Export it first if you want to keep it.`)) { deleteHome(hm.id); show(valid(cur) ? cur : firstView()); if (lib.homes.length) { openSheet = 'places'; renderSheet(); } } })))));
    };
    items.push(editMode ? h('div', { class: 'home-head' }, h('h3', {}, hm.name),
      h('button', { class: 'round small', 'aria-label': `${hm.name}: more`, title: 'More', onclick: homeActions }, icon('more'))) : h('div', { class: 'home-head' }, h('h3', {}, hm.name)));
    if (editMode) {
      const ed = (fn) => { mutate(hm, fn, { undoable: false }); renderNav(); renderSheet(); };
      // One ⋯ button per dashboard (#125): its actions in a small menu, each with its words.
      const row = (d, kind, list) => {
        const actions = () => {
          const idx = list.indexOf(d), act = (fn) => () => { close(); fn(); };
          const close = modal(h('div', { class: 'menu' },
            h('div', { class: 'panel-head' }, h('h2', {}, d.name), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
            idx > 0 ? menuItem('up', 'Move up', null, act(() => ed(() => list.splice(idx - 1, 0, list.splice(idx, 1)[0])))) : null,
            idx < list.length - 1 ? menuItem('down', 'Move down', null, act(() => ed(() => list.splice(idx + 1, 0, list.splice(idx, 1)[0])))) : null,
            menuItem(d.hideList ? 'eye' : 'eyeoff', d.hideList ? 'Show in this list' : 'Hide from this list', 'outside edit mode', act(() => ed(() => { if (d.hideList) delete d.hideList; else d.hideList = true; }))),
            menuItem(d.private ? 'home' : 'lock', d.private ? 'Share with the home' : 'Only me', d.private ? 'now: only you see it' : 'now: shared with the home', act(() => ed(() => { if (d.private) delete d.private; else d.private = true; }))),
            menuItem('edit', 'Rename', null, act(() => { const n = prompt('Dashboard name', d.name); if (n && n.trim()) ed(() => (d.name = n.trim())); })),
            menuItem('copy', 'Duplicate', null, act(() => {
              const n = prompt('Name of the copy', `${d.name} copy`);
              if (!n || !n.trim()) return;
              // A separate copy: changing its furniture, buttons or settings leaves the original alone (#55).
              const copy = structuredClone(d);
              copy.id = uid(kind === 'page' ? 'page' : 'level');
              copy.name = n.trim();
              for (const b of copy.buttons || []) if (b.id.endsWith(`-${d.id}`)) b.id = `${b.id.slice(0, -d.id.length)}${copy.id}`;
              mutate(hm, () => list.splice(list.indexOf(d) + 1, 0, copy), { undoable: false });
              show({ homeId: hm.id, kind, id: copy.id });
            })),
            h('div', { class: 'msep' }),
            h('div', { class: 'danger-item' }, menuItem('trash', 'Delete', null, act(() => {
              if (kind === 'level' && hm.levels.length === 1) return alert('A home needs at least one floor plan, so the last one cannot be deleted. Delete the whole home instead, or add another floor plan first.');
              if (!confirm(`Delete the dashboard "${d.name}"?${kind === 'level' ? ' Everything drawn on this floor plan goes with it.' : ''}`)) return;
              const wasHere = cur?.id === d.id;
              ed(() => list.splice(list.indexOf(d), 1));
              if (wasHere) { show(firstView()); openSheet = 'places'; renderSheet(); }
            })))));
        };
        return h('div', { class: 'row pad dash-row' }, icon(kind === 'page' ? 'grid' : 'plan'),
          h('button', { class: 'row-label linkish', 'aria-label': `Open ${d.name}`, onclick: () => show({ homeId: hm.id, kind, id: d.id }) },
            h('div', {}, d.name), d.hideList || d.private ? h('div', { class: 'sub' }, [d.hideList ? 'hidden from the list' : '', d.private ? 'only me' : ''].filter(Boolean).join(' · ')) : null),
          h('button', { class: 'round small', 'aria-label': `${d.name}: more`, title: 'More', onclick: actions }, icon('more')));
      };
      items.push(h('div', { class: 'menu-title sub-title' }, 'Plans'));
      for (const L of hm.levels) items.push(row(L, 'level', hm.levels));
      if ((hm.pages || []).length) items.push(h('div', { class: 'menu-title sub-title' }, 'Widgets'));
      for (const p of hm.pages || []) items.push(row(p, 'page', hm.pages));
    } else {
      const item = (kind, d) => { const el = menuItem(kind === 'page' ? 'grid' : 'plan', d.name, null, () => go(kind, d.id), d.private ? icon('lock') : null); if (here(kind, d.id)) el.classList.add('sel'); return el; };
      items.push(h('div', { class: 'menu-title sub-title' }, 'Plans'));
      // A dashboard with its eye closed (#116) is left out here, unless it is the one showing.
      for (const L of hm.levels) if (!L.hideList || here('level', L.id)) items.push(item('level', L));
      const pages = (hm.pages || []).filter((p) => !p.hideList || here('page', p.id));
      if (pages.length) items.push(h('div', { class: 'menu-title sub-title' }, 'Widgets'));
      for (const p of pages) items.push(item('page', p));
    }
    if (editMode) items.push(h('div', { class: 'btns pad' },
      h('button', { class: 'wide ghost', onclick: () => { closeSheet(); addFloor(hm, false); } }, icon('layers'), 'Add level'),
      h('button', { class: 'wide ghost', onclick: () => { closeSheet(); addFloor(hm, true); } }, icon('roof'), 'Add roof')),
      h('div', { class: 'btns pad' }, h('button', { class: 'wide ghost', onclick: () => { closeSheet(); newDashboard(hm); } }, icon('plus'), 'Dashboard')));
    items.push(h('div', { class: 'msep' }));
  }
  if (editMode) items.push(h('div', { class: 'btns pad' },
    h('button', { class: 'wide', onclick: () => { closeSheet(); createHome(); } }, icon('plus'), 'New home'),
    h('button', { class: 'wide', onclick: () => { closeSheet(); fileInput.click(); } }, icon('file'), 'Import file')));
  return h('div', { class: 'menu' + (editMode ? ' editing-menu' : '') }, h('div', { class: 'menu-head places-head' }, h('span', { class: 'grow' }, editMode ? 'Edit homes and dashboards' : 'Homes and dashboards')), items);
}

function menuSheet(id) {
  const m = home()?.menus?.find((q) => q.id === id);
  if (!m) return h('div', { class: 'menu' }, h('p', { class: 'hint' }, 'This menu no longer exists.'));
  return h('div', { class: 'menu' }, h('div', { class: 'menu-title' }, m.name),
    m.items.map((item) => controlRow(item, { allLightsOff, done: closeSheet })),
    !m.items.length ? h('p', { class: 'hint' }, 'This menu is empty. Add to it in edit mode: More → pencil.') : null);
}

// ---------- the user's buttons: beside the plan (dock) and on it ----------
const levelButtons = () => level()?.buttons || [];
function pressable(el, onTap, onHold) {
  let timer, held = false;
  el.addEventListener('pointerdown', (e) => { e.stopPropagation(); held = false; timer = setTimeout(() => { held = true; navigator.vibrate?.(15); onHold(); }, HOLD_MS); });
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerup', () => { cancel(); if (!held) onTap(); });
}
const VIEW_BUTTONS = { left: { name: 'Turn left', icon: 'rotateL' }, right: { name: 'Turn right', icon: 'rotate' }, home: { name: 'Home view', icon: 'compass' }, fit: { name: 'Whole plan', icon: 'expand' }, mode: { name: 'Swipe / Pan / Orbit', icon: 'swipe' } };
/** What one finger dragging on the plan does (#45): Swipe (controls things; the view stays put), Pan (moves the view) or Orbit (turns it). Per device. */
const DRAG_MODES = ['swipe', 'pan', 'orbit'];
const DRAG_OLD = { off: 'swipe', move: 'pan' };
const DRAG_ICON = { swipe: 'swipe', pan: 'hand', orbit: 'orbit' };
const DRAG_NAME = { swipe: 'Swipe', pan: 'Pan', orbit: 'Orbit' };
const DRAG_TEXT = { swipe: 'Swipe: drag across lamps and things to control them', pan: 'Pan: drag to move the view', orbit: 'Orbit: drag to turn the view' };
const dragMode = () => { const m = DRAG_OLD[device.dragMode] || device.dragMode; return DRAG_MODES.includes(m) ? m : 'swipe'; };
function viewAction(kind) {
  if (kind === 'left') turnTo(view.cam.az - 45);
  else if (kind === 'right') turnTo(view.cam.az + 45);
  else if (kind === 'home') { if (view.isolated) selectRoom(null); else goHomeView(true); }
  else if (kind === 'fit' && !view.locked) { if (view.isolated) { leaveRoom({ to: 'fit' }); selectRoom(null); } else view.animateTo(view.viewTarget({ az: 0 })); }
  else if (kind === 'mode') {
    device.dragMode = DRAG_MODES[(DRAG_MODES.indexOf(dragMode()) + 1) % DRAG_MODES.length];
    saveDevice();
    bubble.textContent = DRAG_TEXT[device.dragMode];
    bubble.classList.remove('hidden');
    clearTimeout(viewAction.t);
    viewAction.t = setTimeout(() => bubble.classList.add('hidden'), 1400);
    buttonSig = '';
    refreshButtons();
  }
}
/** The value a button's − / + changes, by kind of device: { text, step(dir) }, or null when it has none (#56). */
function stepperOf(entity) {
  const s = st(entity), d = domainOf(entity || ''), a = s?.attributes || {};
  if (!s) return null;
  const lim = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  if (d === 'climate') { const step = a.target_temp_step || 0.5; return { now: `${a.current_temperature ?? '–'}°`, text: `${a.temperature ?? '–'}°`, on: s.state !== 'off', step: (dir) => app.conn.call('climate', 'set_temperature', { temperature: lim((a.temperature ?? 20) + dir * step, a.min_temp ?? 5, a.max_temp ?? 30) }, entity) }; }
  if (d === 'light' && isDimmable(s)) { const v = brightnessPct(s); return { text: `${isOn(s) ? v : 0}%`, on: isOn(s), step: (dir) => setBrightness(entity, lim((isOn(s) ? v : 0) + dir * 10, 0, 100)) }; }
  if (d === 'cover' && a.current_position != null) return { text: `${a.current_position}%`, on: a.current_position > 0, step: (dir) => app.conn.call('cover', 'set_cover_position', { position: lim(a.current_position + dir * 10, 0, 100) }, entity) };
  if (d === 'fan' && a.percentage != null) return { text: `${a.percentage}%`, on: isOn(s), step: (dir) => app.conn.call('fan', 'set_percentage', { percentage: lim(a.percentage + dir * (a.percentage_step || 25), 0, 100) }, entity) };
  if (d === 'media_player' && a.volume_level != null) return { text: `${Math.round(a.volume_level * 100)}%`, on: isOn(s), step: (dir) => app.conn.call('media_player', 'volume_set', { volume_level: lim(a.volume_level + dir * 0.05, 0, 1) }, entity) };
  return null;
}
/** The one "icon, opens when tapped" button that is open just now; it closes itself a few seconds after the last touch. */
let openBtn = null, openBtnTimer = null;
function holdOpen(id) {
  openBtn = id;
  clearTimeout(openBtnTimer);
  openBtnTimer = setTimeout(() => { openBtn = null; buttonSig = ''; refreshButtons(); }, 6000);
  buttonSig = '';
  refreshButtons();
}
function buttonActions(b) {
  if (editor.active) return [() => { editor.tool = 'select'; editor.select({ type: 'button', id: b.id }); }, () => {}];
  if (b.size === 'expand' && !b.view && openBtn !== b.id && stepperOf(b.entity)) return [() => holdOpen(b.id), () => { openSheet = { thing: { object: b } }; renderSheet(); }];
  if (b.view) return [() => viewAction(b.view), () => viewAction(b.view)];
  if (b.app) { const go = () => { const a = integrationApps().find((x) => x.id === b.app); if (a) a.open(); else toast('That app is not connected on this device.'); }; return [go, go]; } // #127
  if (b.gestures?.tap || b.gestures?.hold) {
    const thing = { object: { id: b.id, name: b.name, entity: b.entity } };
    const gt = gestureFor(b.gestures, 'tap', b.entity), gh = gestureFor(b.gestures, 'hold', b.entity);
    return [() => runAction(gt.entity, gt.action, thing, gt), () => runAction(gh.entity, gh.action, thing, gh)];
  }
  return [() => toggle(b.entity), () => { openSheet = { thing: { object: b } }; renderSheet(); }];
}
/** Extra live controls inside a large button: temperature and − / + for climate, level for lights. */
function buttonExtras(b) {
  const s = st(b.entity), d = domainOf(b.entity || '');
  const sp = b.size === 'expand' && d !== 'climate' ? stepperOf(b.entity) : null;
  if (sp) { // an opened button: − value +, each touch keeping it open a little longer
    const stop = (e) => e.stopPropagation(), go = (dir) => (e) => { e.stopPropagation(); sp.step(dir); holdOpen(b.id); };
    return [h('span', { class: 'pm', role: 'button', 'aria-label': `${b.name} down`, onpointerdown: stop, onpointerup: go(-1) }, '−'),
      h('span', { class: 'set' }, sp.text),
      h('span', { class: 'pm', role: 'button', 'aria-label': `${b.name} up`, onpointerdown: stop, onpointerup: go(1) }, '+')];
  }
  if (d !== 'climate') return h('span', { class: 'sub' }, stateText(b.entity));
  const a = s?.attributes || {}, step = a.target_temp_step || 0.5;
  const set = (dir) => (e) => { e.stopPropagation(); app.conn.call('climate', 'set_temperature', { temperature: Math.min(a.max_temp ?? 30, Math.max(a.min_temp ?? 5, (a.temperature ?? 20) + dir * step)) }, b.entity); if (b.size === 'expand') holdOpen(b.id); };
  const stop = (e) => e.stopPropagation();
  return [h('span', { class: 'sub' }, `${a.current_temperature ?? '–'}°`),
    h('span', { class: 'pm', role: 'button', 'aria-label': `${b.name} cooler`, onpointerdown: stop, onpointerup: set(-1) }, '−'),
    h('span', { class: 'set' }, `${a.temperature ?? '–'}°`),
    h('span', { class: 'pm', role: 'button', 'aria-label': `${b.name} warmer`, onpointerdown: stop, onpointerup: set(1) }, '+')];
}
// ---------- button groups (#100): a plan button that fans out a row of other buttons ----------
const openGroups = new Set();
let groupTimer = 0;
const GROUP_REST = 30000;
/** Fold every open group back after 30 seconds without a touch anywhere. */
function armGroups() {
  clearTimeout(groupTimer);
  if (openGroups.size) groupTimer = setTimeout(() => { openGroups.clear(); buttonSig = ''; refreshButtons(); }, GROUP_REST);
}
window.addEventListener('pointerdown', () => { if (openGroups.size) armGroups(); }, { capture: true, passive: true });
function toggleGroup(id) {
  if (openGroups.has(id)) openGroups.delete(id); else openGroups.add(id);
  armGroups();
  buttonSig = '';
  refreshButtons();
}
/** What a tap and a hold on a group's own button do. 'own': tap is the button's own action and a double tap opens or closes; otherwise a tap opens or closes. */
function groupActions(b) {
  const [ownTap, ownHold] = buttonActions({ ...b, group: null });
  if (b.group.tap !== 'own') return [() => toggleGroup(b.id), ownHold];
  let last = 0, pending = 0;
  return [() => {
    const now = performance.now();
    if (now - last < 380) { clearTimeout(pending); last = 0; toggleGroup(b.id); return; } // second tap: fan out or fold back
    last = now;
    pending = setTimeout(ownTap, 380); // a single tap waits a moment, in case a second one follows
  }, ownHold];
}
/** A group: its own button with the row beside it, in the chosen direction. In edit mode only the group's button shows. */
function groupEl(b, base, main) {
  if (editor.active) return main;
  const open = openGroups.has(b.id), dir = b.group.dir || 'right';
  main.classList.toggle('group-open', open);
  main.setAttribute('aria-expanded', String(open));
  const row = open ? h('div', { class: `group-row dir-${dir}` }, (b.group.items || []).map((it) => buttonEl({ ...it, size: 'small', scale: b.scale }, 'ubtn'))) : null;
  return h('div', { class: `bgroup ${base.includes('pbtn') ? 'pbtn' : ''}` }, main, row);
}
function buttonEl(b, base) {
  const opens = b.size === 'expand' && !b.view, large = b.size === 'large' || (opens && openBtn === b.id && !editor.active);
  // Closed, a heating / cooling button that is on still shows what it is set to (#56).
  const sp = opens && !large ? stepperOf(b.entity) : null, badge = sp && sp.on && domainOf(b.entity) === 'climate' ? sp.text : null;
  const mode = b.view === 'mode', name = mode ? `${DRAG_NAME[dragMode()]} (tap for ${DRAG_NAME[DRAG_MODES[(DRAG_MODES.indexOf(dragMode()) + 1) % 3]]})` : b.name;
  const el = h('button', { class: `${base} ${large ? 'large' : 'small'}` + (isOn(st(b.entity)) || (mode && dragMode() !== 'swipe') ? ' on' : '') + toneClass(b.entity), style: b.scale && b.scale !== 1 ? `--s:${b.scale}` : null, 'aria-label': name, title: name },
    icon(mode ? DRAG_ICON[dragMode()] : b.view ? b.icon || VIEW_BUTTONS[b.view]?.icon : iconOf(b)), large ? [h('span', { class: 'bname' }, mode ? DRAG_NAME[dragMode()] : b.name), b.view ? null : buttonExtras(b)] : badge ? h('span', { class: 'set' }, badge) : null);
  if (badge) el.classList.add('badged');
  if (opens && large) el.classList.add('opened');
  if (b.group && !editor.active) { el.classList.add('has-group'); pressable(el, ...groupActions(b)); return groupEl(b, base, el); }
  pressable(el, ...buttonActions(b));
  return el;
}
/** Floor plans made before view buttons were ordinary buttons get the three they used to have, beside the plan, bottom left. */
function addViewButtonsOnce(hm, L) {
  if (!hm || !L || (L.viewButtonsAdded && L.dragButtonAdded && L.navFixed)) return;
  const make = (v, i) => ({ id: `view-${v}-${L.id}`, view: v, name: VIEW_BUTTONS[v].name, dock: true, scale: 0.9, pos: { h: 'l', x: 12 + i * 44, v: 'b', y: 12 } });
  mutate(hm, () => {
    if (!L.viewButtonsAdded && device.viewButtons !== false) (L.buttons ||= []).push(...['left', 'right', 'home'].map(make));
    if (!L.dragButtonAdded) (L.buttons ||= []).push(make('mode', 3));
    // 0.20.2 put the dashboard selector on plans as a button (#103); it is the fixed one again (#108).
    // A plan whose button was removed keeps that choice: its selector is hidden outside edit mode.
    if (L.navButtonAdded) {
      if (!(L.buttons || []).some((b) => b.view === 'dashboards')) L.hideNav = true;
      L.buttons = (L.buttons || []).filter((b) => b.view !== 'dashboards');
      delete L.navButtonAdded;
    }
    L.navFixed = true;
    L.viewButtonsAdded = true;
    L.dragButtonAdded = true;
  }, { undoable: false });
}
const gridPx = () => level()?.screenGrid || 24;
const planArea = () => stage.parentElement;
/** A "beside the plan" place for a point on screen, snapped to the screen grid. */
function freePosAt(clientX, clientY) {
  const area = planArea().getBoundingClientRect(), g = gridPx(), sn = (v) => Math.max(0, Math.round(v / g) * g);
  const left = clientX - area.left - 20, right = area.right - clientX - 20, top = clientY - area.top - 20, bottom = area.bottom - clientY - 20;
  return { ...(left <= right ? { h: 'l', x: sn(left) } : { h: 'r', x: sn(right) }), ...(top <= bottom ? { v: 't', y: sn(top) } : { v: 'b', y: sn(bottom) }) };
}
/** Where a freely placed button sits: measured from the nearest edges, so it stays put on any screen size. */
function placeFree(el, p) {
  Object.assign(el.style, { left: p.h === 'l' ? `${p.x}px` : '', right: p.h === 'r' ? `${p.x}px` : '', top: p.v === 't' ? `${p.y}px` : '', bottom: p.v === 'b' ? `${p.y}px` : '' });
}
/** The strip under the top bar (the user's own menus, then this level's buttons that have no place of their own), and the buttons placed around the plan. */
/** The Nido theme: the dashboard selector, opened in place as the home's layers. Floors top first, each with its layers
 *  mark; then the widget dashboards; then the other homes. Tap one to go there. */
// The layers mark with one of its three sheets lit: top for the highest floor, bottom for the ground floor.
const layerMark = (pos, on) => {
  const one = (d, me) => `<path d="${d}" style="fill:${me && pos === 'top' && on ? 'var(--accent)' : 'none'};stroke:${me ? (on ? 'var(--accent)' : 'var(--ok, #5FC4B0)') : '#3A4642'}" stroke-width="1.6" stroke-linejoin="round"/>`;
  const el = document.createElement('span');
  el.innerHTML = `<svg width="22" height="22" viewBox="0 0 26 26" aria-hidden="true">${one('M13 3 24 9 13 15 2 9z', pos === 'top')}${one('M2 13.5 13 19.5 24 13.5', pos === 'mid')}${one('M2 18 13 24 24 18', pos === 'low')}</svg>`;
  return el.firstChild;
};
/** Where a floor sits among its home's floors: top, mid or low (for its layers mark). */
function layerPos(x) {
  const floors = (home()?.levels || []).filter((q) => !q.site && !q.roof).map((q) => q.floor || 0);
  const f = x.floor || 0, top = Math.max(...floors, 0), low = Math.min(...floors, 0);
  return f === top && top !== low ? 'top' : f === low ? 'low' : 'mid';
}
function renderLayers() {
  const hm = home();
  const open = !!(hm && layersOpen && nidoTheme() && !editMode && !editor.active);
  layersBox.classList.toggle('hidden', !open);
  if (!open) return void layersBox.replaceChildren();
  const here = (kind, id) => cur?.homeId === hm.id && cur.kind === kind && cur.id === id;
  const go = (t) => { layersOpen = false; renderNav(); renderLayers(); show(t); };
  const item = (on, mark, name, t, sub) => h('button', { class: on ? 'on' : '', 'aria-current': on ? 'page' : 'false', onclick: () => { if (on) { layersOpen = false; renderNav(); renderLayers(); } else go(t); } }, mark, h('span', {}, name, sub ? h('small', {}, sub) : null));
  const levels = hm.levels.filter((x) => !x.roof && (!x.hideList || here('level', x.id))).sort((a, b) => (b.site ? 99 : (b.floor || 0)) - (a.site ? 99 : (a.floor || 0)));
  const pages = (hm.pages || []).filter((p) => !p.hideList || here('page', p.id));
  const kids = levels.map((x) => item(here('level', x.id), x.site ? icon('home') : layerMark(layerPos(x), here('level', x.id)), x.name, { homeId: hm.id, kind: 'level', id: x.id }, x.site ? null : floorName(x.floor || 0)));
  if (pages.length) kids.push(h('div', { class: 'layers-sep' }));
  for (const p of pages) kids.push(item(here('page', p.id), icon('grid'), p.name, { homeId: hm.id, kind: 'page', id: p.id }));
  const others = lib.homes.filter((x) => x !== hm);
  if (others.length) {
    kids.push(h('div', { class: 'layers-sep' }));
    for (const o of others) kids.push(item(false, icon('home'), o.name, firstViewOf(o), 'another home'));
  }
  layersBox.replaceChildren(...kids);
  const r = navBtn.getBoundingClientRect(), pa = planArea().getBoundingClientRect();
  Object.assign(layersBox.style, { left: `${Math.round(r.left - pa.left)}px`, top: `${Math.round(r.bottom - pa.top + 6)}px` });
}
const show_ = (t) => show(t);
function renderDock() {
  const hm = home(), kids = [], free = [];
  if (hm) for (const m of hm.menus || []) kids.push(h('button', { class: 'chip small', onclick: () => { openSheet = { menu: m.id }; renderSheet(); } }, h('span', {}, m.name), icon('down')));
  // The site view (#112): lift the roofs and upper floors away to look inside.
  if (level()?.site && !editor.active) {
    const PEEL = [['all', 'Roofs on'], ['open', 'Roofs off'], ['ground', 'Ground floors']], i = Math.max(0, PEEL.findIndex(([k]) => k === (view.peel || 'all')));
    kids.push(h('button', { class: 'chip small peel', 'aria-label': `Showing: ${PEEL[i][1]}. Tap for ${PEEL[(i + 1) % 3][1].toLowerCase()}`, onclick: () => { view.setPeel(PEEL[(i + 1) % 3][0]); afterStyle?.(); syncFromStates(); renderDock(); } }, icon('layers'), h('span', {}, PEEL[i][1])));
  }
  for (const b of levelButtons().filter((x) => x.dock)) {
    const el = buttonEl(b, 'ubtn');
    if (b.pos) { el.classList.add('free'); placeFree(el, b.pos); free.push(el); } else kids.push(el);
    if (editor.active) dockDrag(el, b);
  }
  dock.replaceChildren(...kids);
  freeLayer.replaceChildren(...free);
  renderLayers();
  dock.classList.toggle('hidden', !kids.length);
  dock.classList.toggle('editing', editor.active);
  root.classList.toggle('has-dock', kids.length > 0);
  planArea().style.setProperty('--g', `${gridPx()}px`);
  planArea().classList.toggle('show-grid', editor.active && !!level());
}
/** In edit mode: drag a button beside the plan anywhere around it (it snaps to the grid), or back into the strip. */
function dockDrag(el, b) {
  el.addEventListener('pointerdown', (e) => {
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    const move = (ev) => {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 6) moved = true;
      el.style.transform = `translate(${ev.clientX - x0}px, ${ev.clientY - y0}px)`;
    };
    const up = (ev) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      if (!moved) { el.style.transform = ''; return; }
      const r = el.getBoundingClientRect(), area = planArea().getBoundingClientRect(), strip = dock.getBoundingClientRect();
      el.style.transform = '';
      const inStrip = ev.clientY < Math.max(strip.bottom, area.top + 112) && ev.clientY > area.top + 50;
      const cr = canvas.getBoundingClientRect(), onPlan = view.unproject(ev.clientX - cr.left, ev.clientY - cr.top);
      const vb = view.bounds, overPlan = !inStrip && onPlan && onPlan[0] > vb.x0 && onPlan[0] < vb.x1 && onPlan[1] > vb.y0 && onPlan[1] < vb.y1;
      if (overPlan) {
        const step = editor.btnGrid || 0.25, sn = (v) => Math.round(Math.round(v / step) * step * 1000) / 1000;
        mutate(home(), () => { const btn = level().buttons.find((x) => x.id === b.id); delete btn.dock; delete btn.pos; btn.at = [sn(onPlan[0]), sn(onPlan[1])]; });
        editor.refresh?.();
        buttonSig = '';
        refreshButtons();
        return;
      }
      const g = gridPx(), snapTo = (v) => Math.max(0, Math.round(v / g) * g);
      mutate(home(), () => {
        const L = level(), btn = L.buttons.find((x) => x.id === b.id);
        if (inStrip) {
          delete btn.pos;
          // Put it among the strip's other buttons where it was dropped.
          const others = [...dock.querySelectorAll('.ubtn')].filter((x) => x !== el);
          const ids = L.buttons.filter((x) => x.dock && !x.pos && x.id !== b.id).map((x) => x.id);
          let at = others.findIndex((x) => { const rr = x.getBoundingClientRect(); return ev.clientX < rr.left + rr.width / 2; });
          if (at < 0) at = ids.length;
          ids.splice(at, 0, b.id);
          const strips = ids.map((id) => L.buttons.find((x) => x.id === id));
          L.buttons = [...L.buttons.filter((x) => !(x.dock && !x.pos)), ...strips];
        } else {
          const left = r.left - area.left, right = area.right - r.right, top = r.top - area.top, bottom = area.bottom - r.bottom;
          btn.pos = left <= right ? { h: 'l', x: snapTo(left) } : { h: 'r', x: snapTo(right) };
          Object.assign(btn.pos, top <= bottom ? { v: 't', y: snapTo(top) } : { v: 'b', y: snapTo(bottom) });
        }
      });
      buttonSig = '';
      refreshButtons();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
}
let planBtnEls = [], buttonSig = '';
/** Redraw the user's buttons only when something they show has changed (so a press is never interrupted). */
function refreshButtons() {
  const one = (b) => `${b.id}:${b.view || stateText(b.entity)}:${st(b.entity)?.attributes?.temperature ?? ''}`;
  const sig = titleText() + lib.homes.length + dashboardCount() + dragMode() + (openBtn || '') + [...openGroups].join(',') + levelButtons().map((b) => one(b) + (b.group?.items || []).map(one).join('')).join('|') + (editMode ? '|e' : '');
  if (sig === buttonSig) return;
  buttonSig = sig;
  buildPlanButtons();
  renderDock();
}

function buildPlanButtons() {
  planBtnEls = levelButtons().filter((b) => !b.dock && b.at).map((b) => ({ b, el: buttonEl(b, 'ubtn pbtn') }));
  planBtns.replaceChildren(...planBtnEls.map((x) => x.el));
  positionLabels();
}

function thingSheet(thing) {
  const item = thing.light || thing.object, ent = thingEntity(thing), s = st(ent), t = throttled();
  return h('div', { class: 'menu' },
    h('div', { class: 'panel-head' }, h('h2', {}, item.name), h('button', { class: 'round small', 'aria-label': 'Close', onclick: closeSheet }, icon('close'))),
    domainOf(ent || '') === 'climate' ? controlRow({ name: item.name, entity: ent }, { allLightsOff }) : row(stateText(ent) || 'Off', ent || 'No entity connected', toggleBtn(ent, item.name)),
    isDimmable(s) ? slider(brightnessPct(s), (v, fin) => { if (thing.light) view.setLight(item.id, v > 0, v / 100); t(() => setBrightness(ent, v), fin); }, 'Brightness', syncFromStates) : null,
    thing.light && ent !== item.entity ? h('p', { class: 'hint' }, `${item.entity} is not in Home Assistant; using the room's lamp group.`) : null);
}

/** What each plan style is, in a line (#63). */
const STYLE_ABOUT = {
  realistic: 'Lifelike materials, sunlight through the windows and soft shadows.',
  illustrated: 'A drawn, three-quarter view with flat colours. The lightest on a slow tablet.',
  photo: 'A lifelike picture computed once and kept as the backdrop (experimental).',
  pear: 'Calm and minimal: white walls, soft matte colours, gentle shadows.',
  cyber: 'A dark model drawn in glowing neon outlines.',
  clay: 'Everything in one pale clay colour, like an architect\'s model.',
  plan: 'A flat plan seen from straight above.',
  blueprint: 'White lines on blue, from straight above.',
  nido: 'Conceptual: rooms as soft dark tiles with low walls, every entity a dot, and the other floors drawn faintly as layers.',
  nidoplan: 'Nido without walls: just the rooms as tiles, the furniture as outlines, and every entity a coloured dot.',
};
/** The plan style this device uses. Photo render is experimental, so without that mode it falls back to Realistic. */
const planStyle = () => (device.style === 'photo' && !device.experimental ? 'realistic' : device.style);
const styleChoices = () => Object.entries(STYLES).filter(([k]) => k !== 'photo' || device.experimental);

/** Experimental features are hidden until the version at the bottom of Settings is tapped ten times. */
let versionTaps = 0, versionTapAt = 0;
function tapVersion() {
  const now = Date.now();
  versionTaps = now - versionTapAt < 1500 ? versionTaps + 1 : 1;
  versionTapAt = now;
  if (versionTaps < 10) { if (versionTaps >= 6) toast(`${10 - versionTaps} more…`); return; }
  versionTaps = 0;
  setExperimental(!device.experimental);
}
function setExperimental(on) {
  device.experimental = on;
  saveDevice();
  toast(on ? 'Experimental features are on' : 'Experimental features are off');
  if (!on && view.styleId === 'photo' && level() && !editor.active) { view.unlock(); view.setStyle('realistic'); afterStyle(); buildLabels(); syncFromStates(); }
  if (editor.active) editor.renderPanel();
  if (openSheet === 'settings') renderSheet();
}

/** Frosted glass (#74): its background, how clear the glass is, how strong the lettering is — with a sample that shows it as you choose. */
let lookTab = 'day'; // which glass look is being edited (#85)
function frostSettings() {
  const night = lookTab === 'night', own = ownNight();
  // The Day look is kept on the device settings themselves; the Night look in device.night.
  const L = night ? (device.night ||= {}) : device, f = (L.frost ||= {});
  const apply = () => { saveDevice(); useTheme(true); };
  // Show the look being edited while it is edited, whatever the time of day.
  const showing = document.documentElement.classList.contains('night');
  const preview = night !== showing ? h('p', { class: 'hint' }, `The app is showing the ${showing ? 'Night' : 'Day'} look just now. To see this one while you change it, set Day / night above to ${night ? 'Night' : 'Day'}.`) : null;
  const tabs = seg([['day', 'Day look'], ['night', 'Night look']], lookTab, (v) => { lookTab = v; renderSheet(); });
  if (night && !own) return [
    h('div', { class: 'row pad' }, h('div', { class: 'row-label' }, h('div', {}, 'Day and night'), h('div', { class: 'sub' }, 'each can have its own background and glass')), tabs),
    h('p', { class: 'hint' }, 'At night the app uses your Day look, a little dimmed. You can give the night a look of its own.'),
    h('div', { class: 'btns pad' }, h('button', { class: 'wide primary', onclick: () => { device.night = { own: true, wallpaper: device.wallpaper, wallColor: device.wallColor, frost: { ...(device.frost || {}) } }; apply(); renderSheet(); } }, icon('moon'), 'Make a Night look')),
  ];
  const range = (label, key, min, max, def) => {
    const out = h('span', { class: 'sub' }, `${Math.round((f[key] ?? def) * 100)}%`);
    const i = h('input', { type: 'range', min: min * 100, max: max * 100, step: 1, value: Math.round((f[key] ?? def) * 100), 'aria-label': label });
    i.addEventListener('input', () => { f[key] = +i.value / 100; out.textContent = `${i.value}%`; apply(); });
    return h('div', { class: 'nat pad' }, h('span', { class: 'nat-label' }, label), i, out);
  };
  const when = night ? 'night' : 'day', wallUrl = wallUrls[when], usual = device.theme === 'jack' ? (night ? 'stone' : 'sand') : 'indigo';
  const colour = h('input', { type: 'color', value: L.wallColor || '#3136d8', 'aria-label': 'Background colour' });
  colour.addEventListener('input', () => { L.wallColor = colour.value; L.wallpaper = 'color'; apply(); for (const w of document.querySelectorAll('.wall')) w.classList.toggle('on', w.classList.contains('pick')); });
  const pickWall = (id) => () => { L.wallpaper = id; apply(); renderSheet(); };
  return [
    h('div', { class: 'row pad' }, h('div', { class: 'row-label' }, h('div', {}, 'Day and night'), h('div', { class: 'sub' }, 'each can have its own background and glass')), tabs),
    preview,
    h('div', { class: 'frost-sample', 'aria-label': 'Sample of how widgets will look' },
      h('div', { class: 'tile' }, h('div', { class: 'tile-top' }, icon('bulb')), h('div', { class: 'tile-name' }, 'Lamp'), h('div', { class: 'tile-state' }, 'Off')),
      h('div', { class: 'tile on' }, h('div', { class: 'tile-top' }, icon('bulb')), h('div', { class: 'tile-name' }, 'Lamp'), h('div', { class: 'tile-state' }, 'On · 60%')),
      h('div', { class: 'frost-btns' }, h('span', { class: 'round' }, icon('more')), h('span', { class: 'chip small' }, 'Button'))),
    h('div', { class: 'row pad' }, h('div', { class: 'row-label' }, h('div', {}, night ? 'Background at night' : 'Background by day'), h('div', { class: 'sub' }, 'a ready-made one, any colour, or a photo of your own'))),
    h('div', { class: 'walls pad' }, Object.entries(WALLPAPERS).map(([id, [name, css]]) => h('button', { class: 'wall' + ((L.wallpaper || usual) === id ? ' on' : ''), style: `background:${css}`, 'aria-label': `${name} background`, title: name, onclick: pickWall(id) })),
      h('label', { class: 'wall pick' + (L.wallpaper === 'color' ? ' on' : ''), title: 'Any colour', style: `background:${L.wallColor || 'conic-gradient(#f66, #fc6, #6c6, #6cf, #96f, #f66)'}` }, colour),
      wallUrl ? h('button', { class: 'wall' + (L.wallpaper === 'photo' ? ' on' : ''), style: `background:url("${wallUrl}") center / cover`, 'aria-label': 'Your photo', title: 'Your photo', onclick: pickWall('photo') }) : null,
      h('button', { class: 'wall add', 'aria-label': 'Use a photo of your own', title: 'Use a photo of your own', onclick: async () => {
        const file = await pickFile('image/*');
        if (!file) return;
        try { await putBlob(WALL_KEY[when], await shrinkPhoto(file, 1920)); L.wallpaper = 'photo'; saveDevice(); await loadWallpaper(); renderSheet(); } catch (e) { alert(`Could not use that photo. ${e.message || ''}`); }
      } }, icon('image'))),
    range('Glass', 'glass', 0.03, 0.7, 0.15),
    range('Buttons', 'buttons', 0.05, 0.9, 0.34),
    range('Lettering', 'text', 0.35, 1, 1),
    h('p', { class: 'hint' }, 'Glass is how solid the widgets and panels are; Buttons is the same for the round buttons and chips; Lettering is how strong the words and icons on widgets are. The sample above changes as you slide.'),
    f.glass != null || f.buttons != null || f.text != null ? h('div', { class: 'btns pad' }, h('button', { class: 'wide ghost', onclick: () => { delete f.glass; delete f.buttons; delete f.text; apply(); renderSheet(); } }, icon('undo'), 'Back to the usual glass')) : null,
    night ? h('div', { class: 'btns pad' }, h('button', { class: 'wide ghost', onclick: () => { device.night = { own: false }; apply(); renderSheet(); } }, icon('sun'), 'Same as day again')) : null,
  ];
}

/** Settings has two sub-pages (#67, #68): Look and feel, and Launching. */
let settingsPage = null;
const subHead = (title) => h('div', { class: 'panel-head' },
  h('button', { class: 'round small', 'aria-label': 'Back to Settings', onclick: () => { settingsPage = null; renderSheet(); } }, icon('left')),
  h('h2', {}, title), h('button', { class: 'round small', 'aria-label': 'Close', onclick: closeSheet }, icon('close')));

function lookSettings() {
  const L = level();
  return h('div', { class: 'menu settings' }, subHead('Look and feel'),
    h('h3', { class: 'pad' }, 'Plan'),
    h('p', { class: 'hint' }, 'How a floor plan is drawn on this device: its materials, light and camera angle. It does not change what is in the plan.'),
    L ? [h('div', { class: 'menu-row' }, icon('layers'), h('span', { class: 'grow' }, 'Plan style'),
      h('select', { 'aria-label': 'Plan style', onchange: (e) => { if (!editor.active) { device.style = e.target.value; saveDevice(); } view.unlock(); view.setStyle(e.target.value); afterStyle(); buildLabels(); syncFromStates(); renderSheet(); } },
        styleChoices().map(([k, st2]) => h('option', { value: k, selected: k === view.styleId }, st2.label)))),
      h('p', { class: 'hint' }, STYLE_ABOUT[view.styleId] || '')]
      : h('p', { class: 'hint' }, 'Open a floor plan to choose its style.'),
    h('div', { class: 'menu-row' }, icon('room'), h('span', { class: 'grow' }, 'Room labels on the plan'),
      seg([[true, 'Show'], [false, 'Hide']], device.labels !== false, (v) => { device.labels = v; saveDevice(); applyLabels(); renderSheet(); })),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: device.refine !== false, onchange: (e) => { device.refine = e.target.checked; saveDevice(); view.refineEnabled = device.refine; view.requestRender(); } }), 'Refine the picture while idle (soft shadows; turn off on slow tablets)'),
    L && !editor.active && device.experimental ? menuItem('camera', 'Photo render', 'experimental: compute a lifelike picture of this view', () => { closeSheet(); startPhotoRender(); }) : null,
    h('div', { class: 'msep' }),
    h('h3', { class: 'pad' }, 'Buttons / interface'),
    h('p', { class: 'hint' }, 'Everything around the plan: panels, buttons, menus and Widgets dashboards. A theme sets their colours, corners and lettering.'),
    themeSettings({ changed: () => { useTheme(true); renderNav(); renderLayers(); view.washColor = dotColour('light'); paintDots(); view._assignLights?.(); view.requestRender(); if (level() && !editor.active && view.styleId !== planStyle()) { view.setStyle(planStyle()); afterStyle?.(); buildLabels(); syncFromStates(); } if (openSheet === 'settings') renderSheet(); }, saveText }),
    device.theme === 'frost' || device.theme === 'jack' ? frostSettings() : null,
    h('div', { class: 'menu-row' }, icon('sun'), h('span', { class: 'grow' }, 'Day / night'),
      seg([['auto', 'Auto'], ['day', 'Day'], ['night', 'Night']], device.dayNight, (v) => { device.dayNight = v; saveDevice(); applyDayNight(); renderSheet(); })),
    home() ? h('div', { class: 'menu-row wraps' }, icon('edit'), h('span', { class: 'grow' }, 'Title at the top left'),
      seg([['both', 'Home · Dashboard'], ['home', 'Home'], ['page', 'Dashboard']], device.titleMode || 'both', (v) => { device.titleMode = v; saveDevice(); renderNav(); renderPanel(); renderSheet(); })) : null,
    h('div', { class: 'menu-row' }, icon('layers'), h('span', { class: 'grow' }, 'Widget panel beside a plan', h('span', { class: 'sub' }, 'how it is when the app opens; its size is set in edit mode')),
      seg([['open', 'Open'], ['collapsed', 'Collapsed']], device.panelStart === 'collapsed' ? 'collapsed' : 'open', (v) => { device.panelStart = v; saveDevice(); panelOpen = v !== 'collapsed'; panelAutoOpened = false; applyPanel(); renderSheet(); })));
}

function launchSettings() {
  const body = h('div', { class: 'menu settings' }, subHead('Start-up and wall tablet'),
    h('h3', { class: 'pad' }, 'Start page'),
    h('div', { class: 'menu-row' }, icon('home'), h('span', { class: 'grow' }, 'When the app opens', h('span', { class: 'sub' }, startLabel())),
      h('select', { 'aria-label': 'Dashboard this device opens on', onchange: (e) => {
        const d = allDashboards().find((x) => dashKey(x) === e.target.value);
        device.start = d ? { homeId: d.homeId, kind: d.kind, id: d.id, room: null } : null;
        saveDevice(); renderSheet();
      } }, [h('option', { value: '', selected: !valid(device.start) }, 'Where I left off'),
        ...allDashboards().map((d) => h('option', { value: dashKey(d), selected: valid(device.start) && dashKey(device.start) === dashKey(d) }, d.name))])),
    h('p', { class: 'hint' }, 'This is for this device only. To open zoomed in on one room: in edit mode, select the room and use Start this device here in its panel.'));
  // Everything for a device that lives on the wall: the screen, the home screen, kiosk mode.
  body.append(...nodes(h('div', { class: 'msep' }), h('h3', { class: 'pad' }, 'Wall tablet'),
    h('p', { class: 'hint' }, 'For a tablet that stays on the wall and shows your home all day.'),
    native.isNative ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: device.keepAwake, onchange: (e) => { device.keepAwake = e.target.checked; saveDevice(); native.setKeepScreenOn(device.keepAwake); } }), 'Keep the screen on') : null,
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: device.idleDim, onchange: (e) => { device.idleDim = e.target.checked; saveDevice(); bumpIdle(); } }), 'Dim the screen after 2 minutes idle')));
  if (native.isNative) {
    const launcher = h('div', { class: 'launcher' }, h('p', { class: 'hint' }, 'Checking launcher…'));
    body.append(launcher);
    native.getLauncherState().then((ls) => {
      if (!ls) return launcher.replaceChildren();
      launcherEnabled = ls.enabled;
      launcher.replaceChildren(
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: ls.enabled, onchange: async (e) => { await native.setLauncherMode(e.target.checked); renderSheet(); } }), 'Offer Nidorama as a home screen'),
        h('p', { class: 'hint' }, ls.isDefault ? 'Nidorama is the default home screen: pressing Home returns here.' : 'Not the default home screen.'),
        h('button', { class: 'wide', onclick: () => native.openDefaultLauncherSettings() }, 'Change default launcher'));
    });
  }
  body.append(...nodes(h('div', { class: 'msep' }), kioskSettings()));
  return body;
}

function settingsSheet() {
  if (settingsPage === 'look') return lookSettings();
  if (settingsPage === 'launch') return launchSettings();
  if (settingsPage === 'updates') return updatesSettings();
  if (settingsPage === 'alerts') return alertsSettings(subHead('Alerts'), renderSheet);
  const c = app.conn;
  const go = (pg) => () => { settingsPage = pg; renderSheet(); };
  const body = h('div', { class: 'menu settings' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Settings'), h('button', { class: 'round small', 'aria-label': 'Close', onclick: closeSheet }, icon('close'))),
    h('div', { class: 'menu-row' }, icon('edit'), h('span', { class: 'grow' }, 'Units'),
      seg([['metric', 'Metric'], ['imperial', 'Imperial']], app.units, (v) => { setUnits(v); renderSheet(); })),
    menuItem('star', 'Look and feel', 'plan style, theme, day / night, labels, title', go('look'), icon('chevron')),
    menuItem('home', 'Start-up and wall tablet', `default dashboard, screen, home screen, kiosk mode${kioskOn() ? ' (on)' : ''}`, go('launch'), icon('chevron')),
    menuItem('bell', 'Alerts', (device.alerts || []).filter((a) => a.on).length ? `${device.alerts.filter((a) => a.on).length} on this device` : 'tell me when something happens at home', go('alerts'), icon('chevron')),
    menuItem('update', 'Updates and backup', native.isNative && buildOf(VERSION) ? `${CHANNELS[deviceChannel()]} builds · v${VERSION}` : `v${VERSION}`, go('updates'), icon('chevron')),
    h('div', { class: 'msep' }),
    h('h3', { class: 'pad' }, 'Integrations'),
    h('p', { class: 'hint' }, c.demo ? 'Nothing is connected yet, so the app is showing a simulated home.' : 'Nidorama sits on top of the system that runs your home; your devices and automations stay there.'),
    h('div', { class: 'int-grid' }, INTEGRATIONS.filter((it) => !it.experimental || device.experimental).sort((a, b) => (a.order || 0) - (b.order || 0)).map((it) => {
      const st2 = it.status();
      return h('button', { class: 'int-tile' + (st2.cls ? ' ' + st2.cls : ''), onclick: () => openIntegration(it.id) },
        brandMark(it),
        h('b', {}, it.name), h('span', { class: 'sub' }, st2.text));
    })),
  );
  body.append(...nodes(
    device.experimental ? [h('div', { class: 'msep' }), h('div', { class: 'row pad' }, h('div', { class: 'row-label' }, h('div', {}, 'Experimental features are on'), h('div', { class: 'sub' }, 'Photo render, Scaniverse scans and anything else still being tried. Unfinished: they may not work.')),
      h('button', { class: 'chip small', onclick: () => setExperimental(false) }, 'Turn off'))] : null,
    __DONATE_URL__ ? h('button', { class: 'wide ghost pad-x', onclick: () => supportNote() }, icon('heart'), 'Support Nidorama') : null,
    h('button', { class: 'version-line', onclick: tapVersion }, `Nidorama v${VERSION}`),
    // The licence asks that everyone using the app can get its source.
    __REPO__ ? h('p', { class: 'hint pad' }, 'Nidorama is free software under the GNU Affero General Public License, version 3. ', h('a', { href: `https://github.com/${__REPO__}`, target: '_blank', rel: 'noopener' }, 'Source code and licence'), ' · ', h('a', { href: 'https://nidorama.io', target: '_blank', rel: 'noopener' }, 'nidorama.io')) : null));
  return body;
}

/** Settings → Updates (#78): the channel, checking, notifications, a backup, and GitHub access. */
function updatesSettings() {
  const body = h('div', { class: 'menu settings' }, subHead('Updates and backup'));
  if (native.isNative) body.append(...nodes(
    // First: whether the app looks for updates by itself (#126).
    h('div', { class: 'menu-row' }, icon('update'), h('span', { class: 'grow' }, 'Check for updates automatically', h('span', { class: 'sub' }, device.autoUpdate !== false ? 'On: the app asks GitHub now and then' : 'Off: only when you tap Check for updates now')),
      seg([[true, 'On'], [false, 'Off']], device.autoUpdate !== false, (v) => { device.autoUpdate = v; saveDevice(); if (v) checkForUpdate(); else { update = null; renderUpdate(); } renderSheet(); })),
    channelSettings(),
    h('div', { class: 'btns pad' }, h('button', { class: 'wide', onclick: async () => { await checkForUpdate(true); renderSheet(); } }, icon('update'), updateBusy || (update ? `Update ${update.version} is available` : 'Check for updates now'))),
    h('div', { class: 'msep' })));
  else body.append(...nodes(
    h('p', { class: 'hint' }, `This is Nidorama v${VERSION} in a browser. It is updated wherever it is served from (for example the Home Assistant add-on); the choice of Stable, Beta or Alpha builds is for the Android app.`),
    h('h3', { class: 'pad' }, 'Backup'),
    h('div', { class: 'btns pad' }, h('button', { class: 'wide', onclick: openBackup }, icon('file'), 'Back up this device'), h('button', { class: 'wide', onclick: pickBackup }, icon('undo'), 'Restore a backup')),
    h('p', { class: 'hint' }, `${backupAge()} Restoring brings back the homes, dashboards and settings in a backup file; homes with the same name are replaced.`),
    h('div', { class: 'msep' })));
  if (!REPO_PRIVATE) return body; // public builds: nothing to sign in to (#121)
  // GitHub access (the owner's builds): the private repository needs a token for updates.
  const gh = h('input', { type: 'password', value: device.githubToken || '', placeholder: 'GitHub access token', autocomplete: 'off' });
  gh.addEventListener('change', async () => { device.githubToken = gh.value.trim(); saveDevice(); updateError = ''; syncNotifications(); await checkForUpdate(true); renderSheet(); });
  body.append(...nodes(
    h('h3', { class: 'pad' }, 'GitHub access'),
    h('label', {}, REPO_PRIVATE ? 'GitHub access token (updates and requests)' : 'GitHub access token (optional)', gh),
    h('p', { class: 'hint' + (updateError ? ' bad' : '') }, updateError ? `Updates: ${updateError}.` : REPO_PRIVATE
      ? 'Needed while the Nidorama repository is private: a fine-grained GitHub token for it with "Contents: read" (updates) and "Issues: read and write" (requests). Stored on this device only.'
      : 'Not needed for updates or for reading the requests log. With a token from your own GitHub account ("Issues: read and write") you can send requests and vote on them from the app. Stored on this device only.')));
  if (requestsRepo() !== __REPO__) {
    const rq = h('input', { type: 'password', value: device.requestsToken || '', placeholder: 'GitHub access token', autocomplete: 'off' });
    rq.addEventListener('change', () => { device.requestsToken = rq.value.trim(); saveDevice(); });
    body.append(...nodes(h('label', {}, `Token for the requests log (${requestsRepo()})`, rq),
      h('p', { class: 'hint' }, 'A token for that repository with "Issues: read and write", so you can approve and decline requests here. Stored on this device only.')));
  }
  return body;
}
/** Is the repository this build belongs to private? (Then GitHub answers nothing without a token.) Only the owner's
 *  builds come from a private repository: they keep the token field, the Private channel and approving in the app.
 *  Public builds need no token and have none (#121). */
const REPO_PRIVATE = __REPO_PRIVATE__;
const ghToken = () => (REPO_PRIVATE ? device.githubToken || '' : '');
/** The token for the requests log: the owner's builds may read the public repository's log with a second token. */
const reqToken = () => (!REPO_PRIVATE ? '' : requestsRepo() !== __REPO__ ? device.requestsToken || '' : device.githubToken || '');

// ---------- kiosk mode (#69, #71): full screen, and a row of cards to swipe along ----------
// A card is a dashboard. Swiping left / right moves to the card beside it, like cards in a
// wallet; each card also says what a swipe up and a swipe down do while it is showing.
const kioskOn = () => !!device.kiosk?.on;
const dashKey = (v) => `${v.homeId}|${v.kind}|${v.id}`;
function allDashboards() {
  const out = [];
  for (const hm of lib.homes) {
    for (const L of hm.levels) out.push({ homeId: hm.id, kind: 'level', id: L.id, name: lib.homes.length > 1 ? `${hm.name} · ${L.name}` : L.name });
    for (const p of hm.pages || []) out.push({ homeId: hm.id, kind: 'page', id: p.id, name: lib.homes.length > 1 ? `${hm.name} · ${p.name}` : p.name });
  }
  return out;
}
/** The kiosk cards that still point at a dashboard. The first time, every dashboard gets a card. */
function kioskCards() {
  const k = (device.kiosk ||= {}), dashes = allDashboards();
  if (!k.cards) {
    const old = (v) => (v === 'tray' ? 'tray' : v === 'start' ? 'first' : v?.startsWith?.('go|') ? v : 'none');
    k.cards = dashes.map((d) => ({ id: uid('k'), dash: dashKey(d), up: old(k.all?.up), down: old(k.all?.down ?? 'tray') }));
    delete k.all; delete k.pages;
  }
  return k.cards.filter((c) => dashes.some((d) => dashKey(d) === c.dash));
}
function setKiosk(on) {
  const k = (device.kiosk ||= {});
  k.on = on;
  if (k.lock == null) k.lock = true;
  kioskCards();
  saveDevice();
  applyKiosk(true);
  toast(on ? 'Kiosk mode is on. To leave it: More → Edit, then More → Kiosk mode.' : 'Kiosk mode is off');
}
/** Full screen while kiosk mode is on. `fromTap` is needed by browsers, which only go full screen on a touch. */
function applyKiosk(fromTap = false) {
  const on = kioskOn();
  root.classList.toggle('kiosk', on);
  if (native.isNative) native.setFullscreen(on, on && device.kiosk.lock !== false);
  else if (fromTap) { try { if (on) document.documentElement.requestFullscreen?.().catch(() => {}); else if (document.fullscreenElement) document.exitFullscreen?.(); } catch {} }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && kioskOn()) applyKiosk(); });
function goDash(key) {
  const [homeId, kind, id] = key.split('|'), to = { homeId, kind, id };
  if (!valid(to)) return;
  if (cur && dashKey(cur) === key) { if (level()) { selectRoom(null); goHomeView(true); } return; }
  show(to);
}
function runKiosk(dir) {
  const cards = kioskCards();
  if (!cards.length) return;
  const i = cur ? cards.findIndex((c) => c.dash === dashKey(cur)) : -1;
  if (dir === 'left' || dir === 'right') { // along the row of cards; it stops at each end
    const to = i < 0 ? 0 : i + (dir === 'left' ? 1 : -1);
    if (cards[to]) goDash(cards[to].dash);
    return;
  }
  const act = cards[i]?.[dir] || 'none';
  if (act === 'tray') { if (native.isNative) native.showNotifications(); else toast('Android notifications open here in the Android app'); }
  else if (act === 'first') goDash(cards[0].dash);
  else if (act.startsWith('go|')) goDash(act.slice(3));
}
// Swipes. Sideways: anywhere on a Widgets dashboard, and on a plan wherever the swipe is not
// already dimming or moving something. Up / down: on a plan the same, and anywhere from the
// top or bottom edge. Edit mode, sheets and pop-ups are left alone.
let kSwipe = null;
window.addEventListener('pointerdown', (e) => {
  kSwipe = null;
  if (!kioskOn() || editMode || openSheet || document.querySelector('.modal-wrap, .wpage') || !e.isPrimary) return;
  if (e.target.closest?.('input, select, textarea, .slider, .seg, .ubtn, .tabs')) return;
  const Z = 48, w = window.innerWidth, hh = window.innerHeight;
  kSwipe = { x: e.clientX, y: e.clientY, id: e.pointerId, onPlan: e.target === canvas, onPage: !!e.target.closest?.('.page-host'),
    edge: e.clientY < Z ? 'down' : e.clientY > hh - Z ? 'up' : e.clientX < Z ? 'right' : e.clientX > w - Z ? 'left' : null };
}, true);
window.addEventListener('pointermove', (e) => {
  const sw = kSwipe;
  if (!sw || e.pointerId !== sw.id) return;
  const dx = e.clientX - sw.x, dy = e.clientY - sw.y, flat = Math.abs(dx) > Math.abs(dy);
  const dir = flat ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down', along = Math.abs(flat ? dx : dy), across = Math.abs(flat ? dy : dx);
  if (along < 90 || across > along * 0.6) return;
  const busy = sw.onPlan && g && ['swipe', 'pan', 'orbit'].includes(g.mode); // the plan is using this drag
  const free = sw.edge === dir || (sw.onPage && flat) || (sw.onPlan && !busy);
  kSwipe = null;
  if (!free) return;
  if (g) { clearTimeout(g.timer); g = null; }
  runKiosk(dir);
}, true);
window.addEventListener('pointerup', () => (kSwipe = null), true);

let kioskSel = 0;
function kioskSettings() {
  const k = device.kiosk || {}, dashes = allDashboards();
  if (!kioskOn()) return [
    h('h3', { class: 'pad' }, 'Kiosk mode'),
    h('div', { class: 'menu-row' }, icon('lock'), h('span', { class: 'grow' }, 'Kiosk mode', h('span', { class: 'sub' }, 'full screen, with dashboards as cards you swipe between')),
      seg([[true, 'On'], [false, 'Off']], false, (v) => { setKiosk(v); renderSheet(); })),
    h('p', { class: 'hint' }, 'For a wall tablet: Nidorama fills the screen, and you swipe between the dashboards you line up as cards. To leave kiosk mode: More → Edit, then More → Kiosk mode.')];
  const cards = kioskCards(), nameOf = (key) => dashes.find((d) => dashKey(d) === key)?.name || 'Removed dashboard';
  const all = device.kiosk.cards, save = (fn) => { fn(); saveDevice(); renderSheet(); };
  kioskSel = Math.max(0, Math.min(cards.length - 1, kioskSel));
  const sel = cards[kioskSel];
  const acts = [['none', 'Nothing'], ['first', 'Go to the first card'], ['tray', 'Android notifications'], ...dashes.map((d) => [`go|${dashKey(d)}`, `Go to ${d.name}`])];
  const short = (a) => (a === 'none' || !a ? 'nothing' : a === 'first' ? 'first card' : a === 'tray' ? 'notifications' : nameOf(a.slice(3)));
  const actRow = (dir, label) => h('div', { class: 'menu-row' }, icon(dir === 'up' ? 'up' : 'down'), h('span', { class: 'grow' }, label),
    h('select', { 'aria-label': `${label} on this card`, onchange: (e) => save(() => (sel[dir] = e.target.value)) }, acts.map(([v, l]) => h('option', { value: v, selected: v === (sel[dir] || 'none') }, l))));
  const move = (d) => save(() => { const i = all.indexOf(sel), other = cards[kioskSel + d], j = all.indexOf(other); all.splice(i, 1); all.splice(j, 0, sel); kioskSel += d; });
  return [
    h('h3', { class: 'pad' }, 'Kiosk mode'),
    h('div', { class: 'menu-row' }, icon('lock'), h('span', { class: 'grow' }, 'Kiosk mode', h('span', { class: 'sub' }, 'full screen, with dashboards as cards you swipe between')),
      seg([[true, 'On'], [false, 'Off']], true, (v) => { setKiosk(v); renderSheet(); })),
    h('p', { class: 'hint' }, 'To leave kiosk mode: More → Edit, then More → Kiosk mode.'),
    h('h3', { class: 'pad' }, 'Cards'),
    h('p', { class: 'hint' }, 'Swipe left and right to move along these cards, in this order. Tap a card to choose its dashboard and what a swipe up or down does on it. + adds a card beside the one selected.'),
    h('div', { class: 'kcards' }, cards.map((c, i) => h('button', { class: 'kcard' + (i === kioskSel ? ' on' : ''), 'aria-pressed': String(i === kioskSel), 'aria-label': `Card ${i + 1}: ${nameOf(c.dash)}`, onclick: () => { kioskSel = i; renderSheet(); } },
      icon(c.dash.split('|')[1] === 'page' ? 'grid' : 'plan'), h('b', {}, nameOf(c.dash)),
      h('span', { class: 'sub' }, `↑ ${short(c.up)}`), h('span', { class: 'sub' }, `↓ ${short(c.down)}`))),
      h('button', { class: 'kcard add', 'aria-label': 'Add a card', disabled: !dashes.length, onclick: () => save(() => {
        const next = dashes.find((d) => !cards.some((c) => c.dash === dashKey(d))) || dashes[0], at = sel ? all.indexOf(sel) + 1 : all.length;
        all.splice(at, 0, { id: uid('k'), dash: dashKey(next), up: 'none', down: 'none' });
        kioskSel = sel ? kioskSel + 1 : 0;
      }) }, icon('plus'), h('b', {}, 'Add card'))),
    sel ? [
      h('h3', { class: 'pad' }, `Card ${kioskSel + 1} of ${cards.length}`),
      h('div', { class: 'menu-row' }, icon('grid'), h('span', { class: 'grow' }, 'Shows'),
        h('select', { 'aria-label': 'Dashboard on this card', onchange: (e) => save(() => (sel.dash = e.target.value)) }, dashes.map((d) => h('option', { value: dashKey(d), selected: dashKey(d) === sel.dash }, d.name)))),
      actRow('up', 'Swipe up'), actRow('down', 'Swipe down'),
      h('div', { class: 'btns pad' },
        h('button', { class: 'wide ghost', disabled: kioskSel === 0, onclick: () => move(-1) }, icon('left'), 'Move left'),
        h('button', { class: 'wide ghost', disabled: kioskSel >= cards.length - 1, onclick: () => move(1) }, icon('chevron'), 'Move right'),
        h('button', { class: 'wide ghost danger', disabled: cards.length <= 1, onclick: () => save(() => { all.splice(all.indexOf(sel), 1); kioskSel = Math.max(0, kioskSel - 1); }) }, icon('trash'), 'Remove'))] : null,
    native.isNative ? [
      h('h3', { class: 'pad' }, 'Android'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: k.lock !== false, onchange: (e) => { device.kiosk.lock = e.target.checked; saveDevice(); applyKiosk(); } }), 'Pin Nidorama to the screen (stops the notification tray and leaving the app)'),
      h('p', { class: 'hint' }, 'Android asks you to confirm pinning the first time. While pinned, the notification tray, Home and recent apps are blocked by Android. Turning kiosk mode off here unpins it; Android\'s own way out is holding Back and Recents together.'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!k.back, onchange: (e) => { device.kiosk.back = e.target.checked; saveDevice(); } }), 'Android\'s Back swipe goes to the card before (otherwise it does nothing)')] : null,
  ];
}

// ---------- integrations: one tile each in Settings, each with its own set-up screen ----------
/** Platforms whose official logo file has been bundled (none yet: their brand rules have to allow it first). */
const BRAND_LOGOS = new Set(__BRAND_LOGOS__);
const INTEGRATIONS = [
  { id: 'models', name: '3D models', mark: '3D', color: '#7a6cf0', order: 9,
    status: () => { const n = (device.onlineLibrary !== false ? 1 : 0) + (device.modelSources || []).length + (remote.base ? 1 : 0); return { text: n ? `${n} librar${n === 1 ? 'y' : 'ies'}` : 'Off' }; } },
  { id: 'ha', name: 'Home Assistant', mark: 'HA', color: '#18bcf2',
    status: () => (window.__NIDORAMA_ADDON__ || hub.ha?.status === 'connected' ? { text: 'Connected', cls: 'ok' } : hub.ha ? { text: hub.ha.status === 'auth_invalid' ? 'Sign-in rejected' : 'Not reachable', cls: 'bad' } : { text: 'Not set up' }) },
  { id: 'homey', name: 'Homey', mark: 'Hy', color: '#2f2f2f',
    status: () => { const p = hub.providers.find((x) => x.prefix === 'homey'); return p?.status === 'connected' ? { text: 'Connected', cls: 'ok' } : p ? { text: 'Not reachable', cls: 'bad' } : { text: 'Not set up' }; } },
];
// Local additions: any file in src/local/ is loaded here and may add to the app (for example more
// integration tiles). The folder is not part of the open-source core, so a build without it is complete.
for (const mod of Object.values(import.meta.glob('./local/*.js', { eager: true }))) mod.default?.({ integrations: INTEGRATIONS, h, icon, setRequestsRepo });
/**
 * A platform's mark: its official logo if one has been bundled at public/brands/<id>.svg (only
 * once its owner's brand rules allow it — see public/brands/README.md), otherwise a plain badge.
 */
function brandMark(it) {
  const badge = h('span', { class: 'int-mark', style: `background:${it.color}` }, it.mark);
  if (!BRAND_LOGOS.has(it.id)) return badge;
  const img = h('img', { class: 'int-logo', src: `brands/${it.id}.svg`, alt: '' });
  img.addEventListener('error', () => img.replaceWith(badge));
  return img;
}
function openIntegration(id) {
  const it = INTEGRATIONS.find((x) => x.id === id);
  const box = h('div', { class: 'menu settings integration-screen' });
  const close = modal(box, { onclose: () => { if (openSheet === 'settings') renderSheet(); } });
  const redraw = () => box.replaceChildren(...nodes(
    h('div', { class: 'panel-head' }, brandMark(it), h('h2', {}, it.name), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
    integrationBody(id, redraw)));
  redraw();
  const off = hub.on((kind) => { if (!box.isConnected) return off(); if (kind === 'status' && !box.contains(document.activeElement)) redraw(); });
}
/** The Nidorama add-on in Home Assistant: where photos, models and renders are kept for every device (#78: part of the Home Assistant screen). */
/** A step-by-step guide to adding the add-on to Home Assistant (#97). */
function addonGuide() {
  const repoUrl = __REPO__ ? `https://github.com/${__REPO__}` : '';
  const store = device.haUrl ? `${device.haUrl.replace(/\/$/, '')}/hassio/store` : '';
  const copy = async () => { try { await navigator.clipboard.writeText(repoUrl); toast('Address copied'); } catch { toast('Select the address and copy it'); } };
  const step = (n, title, ...kids) => h('section', { class: 'guide-step' }, h('div', { class: 'guide-n' }, String(n)), h('div', { class: 'grow' }, h('h3', {}, title), ...nodes(kids)));
  const close = modal(h('div', { class: 'menu guide' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Add the add-on to Home Assistant'), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
    h('p', { class: 'hint' }, 'The add-on puts Nidorama in Home Assistant\'s sidebar, keeps every device in the household on the same homes, and stores photos and models for all of them. It needs Home Assistant OS or Supervised (the kind with an add-on store).'),
    step(1, 'Open the add-on store',
      h('p', { class: 'hint' }, 'In Home Assistant: Settings → Add-ons → Add-on store.'),
      store ? h('button', { class: 'wide', onclick: () => window.open(store, '_blank', 'noopener') }, icon('ha'), 'Open the add-on store') : null),
    step(2, 'Add this repository',
      h('p', { class: 'hint' }, 'Tap ⋮ at the top right → Repositories, paste this address, then Add.'),
      repoUrl ? h('div', { class: 'copy-row' }, h('code', {}, repoUrl), h('button', { class: 'round small', 'aria-label': 'Copy the address', onclick: copy }, icon('copy'))) : h('p', { class: 'hint' }, 'This build does not know its repository address; ask whoever gave you the app for it.'),
      REPO_PRIVATE ? h('p', { class: 'hint' }, 'This repository is private, so Home Assistant needs permission: add your GitHub name and an access token to the start of the address (name, a colon, the token, then @ before github.com); the token needs read access to the repository contents. Then add ghcr.io under ⋮ → Registries with a token that can read packages.') : null),
    step(3, 'Install it',
      h('p', { class: 'hint' }, 'Find Nidorama in the store (refresh if it is not there yet), open it, Install, then Start. Turn on "Show in sidebar".')),
    step(4, 'Back here',
      h('p', { class: 'hint' }, 'This app finds the add-on by itself; the Home Assistant screen then shows "Nidorama add-on: Connected". If it does not, check port 8765 in the add-on\'s Network settings and type http://your-home-assistant:8765 into "Add-on address".'))));
}
function addonSection(redraw) {
  const addonIn = h('input', { type: 'url', value: device.addonUrl || '', placeholder: 'found automatically (port 8765)', autocomplete: 'off' });
  addonIn.addEventListener('change', async () => { device.addonUrl = addonIn.value.trim(); saveDevice(); await connectAddon({ haUrl: device.haUrl, token: haToken(), addonUrl: device.addonUrl }); redraw(); });
  return [
    h('h3', {}, 'Nidorama add-on'),
    h('p', { class: 'hint' + (remote.info ? '' : ' bad') }, remote.info
      ? `Connected (v${remote.info.version}). Photos, 3D models and renders are kept in ${remote.info.folder} for every device. Render engine: ${remote.info.render.available ? `ready · ${remote.info.machine.cores} cores, ${remote.info.machine.memoryGB} GB` : 'not installed'}.`
      : 'Not found. Without it, photos sync through Home Assistant but 3D models and renders stay on this device.'),
    window.__NIDORAMA_ADDON__ ? null : h('label', {}, 'Add-on address (only if it is not found)', addonIn),
    remote.info ? null : h('div', { class: 'btns' }, h('button', { class: 'wide', onclick: addonGuide }, icon('help'), 'How to add the add-on')),
    h('div', { class: 'msep' }),
    h('h3', {}, 'Connection')];
}
/** What each integration needs, or its current settings. */
function integrationBody(id, redraw) {
  const c = app.conn;
  const ha = hub.ha, homey = hub.providers.find((p) => p.prefix === 'homey');
  const clean = (v) => v.trim().replace(/\/$/, '');
  const url = h('input', { type: 'url', value: device.haUrl, placeholder: 'http://homeassistant.local:8123', autocomplete: 'off' });
  const remoteUrl = h('input', { type: 'url', value: device.haUrlRemote || '', placeholder: 'optional, for when you are away', autocomplete: 'off' });
  const token = h('input', { type: 'password', value: device.token, placeholder: 'Long-lived access token', autocomplete: 'off' });
  const hAddr = h('input', { type: 'text', value: device.homey?.address || '', placeholder: 'e.g. 192.168.1.50', autocomplete: 'off' });
  const hKey = h('input', { type: 'password', value: device.homey?.key || '', placeholder: 'Homey API key', autocomplete: 'off' });
  const saveUrls = () => { device.haUrl = clean(url.value); device.haUrlRemote = clean(remoteUrl.value); saveDevice(); return device.haUrl; };
  const slowAddress = /nabu\.casa|^https:\/\/(?!192\.|10\.|172\.)/.test(device.haUrl || '');
  const statusLine = (p, name) => h('p', { class: 'hint' + (p?.status === 'connected' ? '' : ' bad') }, !p ? `${name}: not connected.` : p.status === 'connected' ? `${name}: connected` : `${name}: ${p.status}${p.error ? ' — ' + p.error : ''}`);
  if (id === 'models') return librarySettings(redraw);
  if (id === 'ha') return [
      addonSection(redraw),
      window.__NIDORAMA_ADDON__
        ? h('p', { class: 'hint' }, 'Connected through the Nidorama add-on. Nothing to set up.')
        : [
          h('label', {}, 'Address at home', url),
          h('label', {}, 'Address when away', remoteUrl),
          h('p', { class: 'hint' }, 'The home address is always tried first because it is fastest; the away address is only used when the home one cannot be reached.'),
          slowAddress ? h('p', { class: 'hint bad' }, 'The home address looks like a remote one. Use the local address (http://…:8123) there for the quickest response.') : null,
          h('button', { class: 'wide primary', onclick: () => { const u = saveUrls(); if (!u) return alert('Enter the Home Assistant address first.'); haSignIn(u); } }, icon('ha'), device.haAuth ? 'Sign in again' : 'Sign in to Home Assistant'),
          h('label', {}, 'Or connect with an access token', token),
          h('p', { class: 'hint' }, 'Both ways are equally fast. A token is made in Home Assistant under your profile → Security → Long-lived access tokens.'),
          h('div', { class: 'btns' },
            h('button', { class: 'wide', onclick: () => { saveUrls(); device.token = token.value.trim(); if (device.token) device.haAuth = null; saveDevice(); connect(); redraw(); } }, 'Connect with token'),
            device.token || device.haAuth ? h('button', { class: 'wide ghost', onclick: () => { device.token = ''; device.haAuth = null; saveDevice(); connect(); redraw(); } }, 'Disconnect') : null),
          ha ? h('p', { class: 'hint' + (ha.status === 'connected' ? '' : ' bad') }, ha.status === 'connected'
            ? `Connected at the ${ha.route === 0 ? 'home' : 'away'} address${device.haAuth ? ', signed in' : ', with a token'}. Your homes are also saved in Home Assistant for your other devices.`
            : `Status: ${ha.status}${ha.error ? ' — ' + ha.error : ''}`) : statusLine(null, 'Home Assistant'),
        ]];
  if (id === 'homey') return [
      h('label', {}, 'Homey address on your network', hAddr),
      h('label', {}, 'API key', hKey),
      h('p', { class: 'hint' }, 'For Homey Pro (2023 or newer). Create a key in the Homey web app: Settings → API Keys. Nidorama then talks straight to the Homey on your network, which is the fastest route. Devices and Flows appear when you connect an entity.'),
      h('div', { class: 'btns' },
        h('button', { class: 'wide', onclick: () => { device.homey = { address: hAddr.value.trim(), key: hKey.value.trim() }; saveDevice(); connect(); redraw(); } }, 'Connect Homey'),
        device.homey?.key ? h('button', { class: 'wide ghost', onclick: () => { device.homey = null; saveDevice(); connect(); redraw(); } }, 'Remove') : null),
      homey ? h('p', { class: 'hint' + (homey.status === 'connected' ? '' : ' bad') }, homey.status === 'connected'
        ? `Connected locally · ${homey.states.size} devices and Flows${homey.latency != null ? ` · last command took ${homey.latency} ms` : ''}.`
        : `Status: ${homey.status}${homey.error ? ' — ' + homey.error : ''}`) : null,
      h('p', { class: 'hint' }, 'Signing in with a Homey account (for use away from home) is not available yet.')];
  return INTEGRATIONS.find((it) => it.id === id)?.body?.() || [];
}

// ---------- view controls: turn, recentre on the home view; set the home view in edit mode ----------
let angleEl = null;
/** Go to this floor plan's home view (or the whole plan from the default angle). */
function goHomeView(animate = false) {
  const hv = level()?.homeView;
  if (view.locked || !view.level) return;
  if (animate) return view.animateTo(view.viewTarget(hv ? { az: hv.az || 0, cx: hv.cx, cy: hv.cy, zoom: hv.zoom || 1 } : { az: 0 }));
  if (!hv) { view.cam.az = 0; view.fit(); return; }
  view.cam.az = hv.az || 0;
  view.baseExt = view._extents(view.bounds);
  Object.assign(view.cam, { cx: hv.cx, cy: hv.cy, zoom: hv.zoom || 1, off: view.baseExt.off });
  view.resize();
}
function turnTo(deg) { view.rotateBy((((deg - view.cam.az) % 360) + 540) % 360 - 180); if (angleEl) angleEl.textContent = `${Math.round(view.cam.az)}°`; }
function renderViewCtl() {
  const L = level(), editing = editor.active;
  viewCtl.classList.toggle('hidden-pref', !editing);
  angleEl = editing ? h('span', {}, `${Math.round(view.cam.az)}°`) : null;
  // In edit mode the view tools fold behind one button (#99), closed until opened; remembered on this device.
  const open = !editing || device.viewToolsOpen === true;
  const fold = editing ? h('button', { class: 'round small view-fold' + (open ? ' on' : ''), 'aria-expanded': String(open), 'aria-label': open ? 'Hide the view tools' : 'Show the view tools', title: open ? 'Hide the view tools' : 'View tools: turn, home view, look around', onclick: () => { device.viewToolsOpen = !open; saveDevice(); renderViewCtl(); } }, icon(open ? 'left' : 'compass')) : null;
  viewCtl.classList.toggle('folded', !open);
  if (!open) return void viewCtl.replaceChildren(fold);
  viewCtl.replaceChildren(...nodes(fold,
    h('button', { class: 'round small', 'aria-label': 'Turn the view left', onclick: () => turnTo(view.cam.az - 45) }, icon('rotateL')),
    h('button', { class: 'round small', 'aria-label': 'Turn the view right', onclick: () => turnTo(view.cam.az + 45) }, icon('rotate')),
    h('button', { class: 'round small', 'aria-label': 'Go to the home view', title: 'Home view', onclick: () => goHomeView(editLook) }, icon('compass')),
    editing && L ? [
      // Draw (the blueprint, for editing), or look around the real plan with one finger panning or orbiting (#107).
      h('div', { class: 'seg look-seg' }, [['draw', 'edit', 'Draw: edit the plan'], ['pan', 'hand', 'Pan: drag moves the view'], ['orbit', 'orbit', 'Orbit: drag turns the view']].map(([m, ic, label]) =>
        h('button', { class: (m === 'draw' ? !editLook : editLook && lookDrag === m) ? 'on' : '', 'aria-label': label, title: label, onclick: () => { if (m === 'draw') { if (editLook) setEditLook(false); } else { lookDrag = m; if (!editLook) setEditLook(true); else renderViewCtl(); } } }, icon(ic)))),
      h('button', { class: 'chip small', 'aria-label': 'Set an exact angle', title: 'Set an exact angle', onclick: () => { const v = prompt('Angle of the view in degrees (0 = north at the top, 90 = east at the top)', String(Math.round(view.cam.az))); if (v != null && Number.isFinite(+v)) turnTo(((+v % 360) + 360) % 360); } }, angleEl),
      h('button', { class: 'chip small', onclick: () => { mutate(home(), () => (level().homeView = { cx: +view.cam.cx.toFixed(3), cy: +view.cam.cy.toFixed(3), zoom: +view.cam.zoom.toFixed(3), az: +view.cam.az.toFixed(1) }), { undoable: false }); renderViewCtl(); } }, icon('check'), L.homeView ? 'Update home view' : 'Set as home view'),
      L.homeView ? h('button', { class: 'chip small', onclick: () => { mutate(home(), () => delete level().homeView, { undoable: false }); renderViewCtl(); } }, 'Reset') : null,
    ] : null));
}

// ---------- build channels (#75): which builds this device takes, and going back to an earlier one ----------
/** The channel this device follows. A build with the private layer follows Private until told otherwise; everything else, Stable. */
// Public builds never follow the owner's Private channel, even after restoring a backup made on the owner's device (#121).
const deviceChannel = () => (CHANNELS[device.channel] && (device.channel !== 'private' || REPO_PRIVATE) ? device.channel : BUILT_FOR === 'private' && REPO_PRIVATE ? 'private' : 'stable');
const STAGE = { stable: 0, beta: 1, dev: 2, private: 3 };
const CHANNEL_ABOUT = { stable: 'finished builds', beta: 'builds being tested before release', dev: 'every new build as it is made; may break', private: 'the owner\'s own builds' };
function setChannel(ch) {
  if (ch === deviceChannel()) return;
  if (ch === 'dev' && !confirm('Alpha builds are work in progress.\n\nThere may be several updates a day, and things can break or change without warning. You can go back to Beta or Stable later, but that means removing and reinstalling the app.\n\nGet Alpha builds on this device?')) return renderSheet();
  const back = STAGE[ch] < STAGE[deviceChannel()];
  device.channel = ch;
  saveDevice();
  syncNotifications();
  update = null;
  renderUpdate();
  if (openSheet === 'settings') renderSheet();
  if (back && native.isNative) goBackTo(ch); else checkForUpdate(true);
}
/** Everything on this device in one file: homes, dashboards and settings. Restored from the welcome screen. */
async function backupFile() {
  const homes = [];
  for (const hm of lib.homes) homes.push(JSON.parse(await exportHome(hm)));
  return { name: `nidorama-backup-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.json`, text: JSON.stringify({ schema: 'nidorama.backup/1', savedAt: new Date().toISOString(), version: VERSION, device, homes }) };
}
/**
 * Keep a backup (#80). `how`: 'device' = straight into Downloads (a browser downloads it),
 * 'choose' = the system's "save to" screen, which also lists the storage apps on the device,
 * 'share' = hand it to another app. Nidorama signs in to no storage service itself.
 * Resolves true when the file was saved (for 'share': when it was handed over).
 */
async function saveBackup(how = 'choose') {
  const { name, text } = await backupFile();
  let ok = false;
  if (how === 'share') {
    if (native.isNative) ok = await native.shareTextFile(name, text);
    else try { const file = new File([text], name, { type: 'application/json' }); if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'Nidorama backup' }); ok = true; } } catch { return false; }
    if (!ok) { toast('Sharing is not available here. Use "Save to this device".'); return false; }
  } else if (how === 'device' && native.isNative) {
    ok = (await native.saveToDownloads(name, text)) || (await native.saveTextFile(name, text));
    if (ok) toast(`Backup saved in Downloads: ${name}`);
  } else if (native.isNative) ok = await native.saveTextFile(name, text);
  else { await saveText(name, text); ok = true; }
  if (ok) { device.lastBackup = { at: Date.now(), how, version: VERSION }; saveDevice(); }
  return ok;
}
const backupAge = () => { const at = device.lastBackup?.at; if (!at) return 'No backup has been saved from this device yet.'; const d = Math.floor((Date.now() - at) / 86400000); return `Last backup: ${d < 1 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`}.`; };
/** The ways to keep a backup, as buttons. `done` is called after one has worked. */
function backupChoices(done = () => {}) {
  const go = (how) => async () => { if (await saveBackup(how)) done(how); };
  return h('div', { class: 'backup-choices' },
    h('button', { class: 'wide primary', onclick: go('device') }, icon('file'), native.isNative ? 'Save to this device (Downloads)' : 'Download the backup file'),
    native.isNative ? h('button', { class: 'wide', onclick: go('choose') }, icon('layers'), 'Choose where to save…') : null,
    native.isNative || navigator.canShare ? h('button', { class: 'wide', onclick: go('share') }, icon('up'), 'Send to another app…') : null,
    h('p', { class: 'hint' }, native.isNative
      ? '"Choose where" and "Send to another app" are your device\'s own screens: they list the storage apps you have installed, such as a cloud drive, so the backup can live off this device. Nidorama itself signs in to none of them.'
      : 'Keep the file somewhere other than this device if you can.'),
    h('p', { class: 'hint' }, 'The file holds your homes, dashboards and this device\'s settings, including its sign-ins. Keep it somewhere private. To bring it back: on the first screen of the app, choose "Import a home file, or restore a backup".'));
}
/** Settings → Updates → Back up. */
function openBackup() {
  const body = h('div', { class: 'menu' });
  const close = modal(body);
  const draw = () => body.replaceChildren(...nodes(
    h('div', { class: 'panel-head' }, h('h2', {}, 'Back up this device'), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
    h('p', { class: 'hint' }, `One file with every home, plan, dashboard and setting on this device. ${backupAge()}`),
    backupChoices(() => { draw(); if (openSheet === 'settings') renderSheet(); })));
  draw();
}
async function restoreBackup(data) {
  // One home that will not load must not stop the rest (#86).
  const done = [], failed = [];
  for (const hm of data.homes || []) {
    try { done.push((await importHome(JSON.stringify(hm))).name); } catch (e) { failed.push(`${hm?.name || 'a home'}: ${e.message}`); }
  }
  if (!done.length && failed.length) return void alert(`Nothing could be restored from this backup.\n${failed.join('\n')}`);
  // Settings come back too, except what belongs to this install rather than to the person.
  const { lastBackup, updateAsked, votes, ...settings } = data.device || {};
  Object.assign(device, settings);
  saveDevice();
  await saveNow(); // the homes must be on the device before the app restarts
  try { sessionStorage.setItem('nidorama.restored', `Restored ${done.length} home${done.length === 1 ? '' : 's'} and this device's settings.${failed.length ? ` ${failed.length} could not be read: ${failed.join('; ')}` : ''}`); } catch {}
  location.reload();
}
/** Choose a backup file to restore (also offered on the first screen). */
const pickBackup = () => { closeSheet(); fileInput.click(); };
/**
 * Go back to the newest build of an earlier stage. Android will not put an older build over a
 * newer one, so this is: save a backup, keep the older build in Downloads, remove the app,
 * install the older build, restore the backup.
 */
async function goBackTo(ch) {
  const body = h('div', { class: 'menu' });
  const close = modal(body);
  let target = null, note = 'Looking for the build…', backedUp = false, saved = '';
  const mine = buildOf(VERSION);
  const draw = () => body.replaceChildren(...nodes(
    h('div', { class: 'panel-head' }, h('h2', {}, `Go back to ${CHANNELS[ch]}`), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
    note ? h('p', { class: 'hint' }, note) : null,
    target && target.build < mine ? [
      h('p', { class: 'hint' }, `This device has build ${mine}. The newest ${CHANNELS[ch]} build is ${target.version}, which is older. Android does not install an older build over a newer one, so the app has to be removed and put back. Three steps:`),
      h('button', { class: 'wide' + (backedUp ? ' ghost' : ' primary'), onclick: async () => { if (await saveBackup('device')) { backedUp = true; draw(); } } }, icon(backedUp ? 'check' : 'file'), backedUp ? '1. Backup saved' : '1. Save a backup of this device'),
      h('button', { class: 'wide' + (saved ? ' ghost' : ''), disabled: !backedUp || !!saved && saved !== 'failed', onclick: async () => {
        note = 'Downloading…'; draw();
        try {
          const st2 = await native.installUpdate(target.url, ghToken(), (f) => { note = `Downloading ${Math.round(f * 100)}%`; body.querySelector('.hint').textContent = note; }, { save: true, name: `Nidorama-${target.version}.apk` });
          if (st2 === 'needs-permission') { note = 'Allow installs from Nidorama, then tap step 2 again.'; }
          else if (st2 === 'saved') { saved = `Nidorama-${target.version}.apk`; note = ''; }
          else { saved = 'failed'; note = 'This Android version cannot save the file from here. Download the build from the releases page instead, then continue with step 3.'; window.open(RELEASES_URL, '_blank', 'noopener'); }
        } catch (e) { note = `Could not download: ${e.message || e}`; }
        draw();
      } }, icon(saved && saved !== 'failed' ? 'check' : 'update'), saved && saved !== 'failed' ? `2. Saved in Downloads: ${saved}` : `2. Download ${CHANNELS[ch]} ${target.version}`),
      h('button', { class: 'wide danger', disabled: !backedUp || !saved, onclick: () => native.uninstallSelf() }, icon('trash'), '3. Remove this app'),
      h('p', { class: 'hint' }, 'Then open Downloads, tap the Nidorama file to install it, open it, and choose "Restore a backup" on the first screen. Homes kept in Home Assistant also come back by themselves once it is connected.')] : null));
  draw();
  try {
    target = await latestIn(ch, ghToken());
    note = !target ? `There is no ${CHANNELS[ch]} build yet. This device stays on its current build until there is one.` : target.build >= mine ? `Nothing to undo: the newest ${CHANNELS[ch]} build (${target.version}) is not older than this one. This device now follows ${CHANNELS[ch]}.` : '';
  } catch (e) { note = `Could not look: ${e.message || e}`; }
  if (document.body.contains(body)) draw();
}
/** Settings → updates: the channel this device follows. */
function channelSettings() {
  const ch = deviceChannel(), mine = buildOf(VERSION);
  const choices = ['stable', 'beta', 'dev', ...(REPO_PRIVATE && (BUILT_FOR === 'private' || ch === 'private') ? ['private'] : [])];
  return [
    h('div', { class: 'menu-row' }, icon('update'), h('span', { class: 'grow' }, 'Get updates from', h('span', { class: 'sub' }, CHANNEL_ABOUT[ch])),
      h('select', { 'aria-label': 'Update channel', onchange: (e) => setChannel(e.target.value) }, choices.map((c) => h('option', { value: c, selected: c === ch }, CHANNELS[c])))),
    h('p', { class: 'hint' }, `Stable is for everyday use. Beta gets builds a little earlier, to test them. Alpha gets every build as it is made, sometimes several a day.${mine ? ` This device has build ${mine}${BUILT_FOR ? `, made as a ${CHANNELS[BUILT_FOR] || BUILT_FOR} build` : ''}.` : ''}`),
    ch !== 'dev' && ch !== 'private' ? null : h('div', { class: 'btns pad' },
      h('button', { class: 'wide ghost', onclick: () => setChannel('beta') }, icon('undo'), 'Go back to Beta'),
      h('button', { class: 'wide ghost', onclick: () => setChannel('stable') }, icon('undo'), 'Go back to Stable')),
    ch === 'beta' ? h('div', { class: 'btns pad' }, h('button', { class: 'wide ghost', onclick: () => setChannel('stable') }, icon('undo'), 'Go back to Stable')) : null,
    h('h3', { class: 'pad' }, 'Backup'),
    h('div', { class: 'btns pad' }, h('button', { class: 'wide', onclick: openBackup }, icon('file'), 'Back up this device'), h('button', { class: 'wide', onclick: pickBackup }, icon('undo'), 'Restore a backup')),
    h('p', { class: 'hint' }, `${backupAge()} Restoring brings back the homes, dashboards and settings in a backup file; homes with the same name are replaced.`),
  ];
}

// ---------- in-app updates (Android app only) ----------
let update = null, updateBusy = '', updateError = '';
function renderUpdate() {
  // A waiting update is a green dot on the More button (#126); More's first row installs it. No chip on the plan.
  updateChip.classList.add('hidden');
  document.querySelector('.more-btn')?.classList.toggle('has-update', !!update);
  updateChip.replaceChildren(icon('update'), h('span', {}, updateBusy || `Update ${update?.version || ''} · Install`));
  if (openSheet === 'more') renderSheet();
}
async function checkForUpdate(manual = false) {
  if (!native.isNative || !buildOf(VERSION) || (!manual && device.autoUpdate === false)) return;
  try {
    if (manual) { updateBusy = 'Checking…'; renderUpdate(); }
    update = await findUpdate(VERSION, ghToken(), deviceChannel());
    updateBusy = '';
    if (update && !manual) askToUpdate();
  } catch (e) { updateBusy = manual ? `Could not check: ${e.message}` : ''; updateError = e.message; }
  renderUpdate();
}
/**
 * "Would you like to update?" — asked when the app is opened or brought back with an update waiting.
 * Not now = ask again next time it is opened. As a wall-tablet home screen (opened at every press of
 * Home) it asks at most every 4 hours for the same update.
 */
let askedAt = 0;
/** What an update brings (#130): a few short lines, new and improved first, then fixes; at most six in all. */
function whatsNew(notes) {
  if (!notes || !(notes.add?.length || notes.fix?.length)) return null;
  const MAX = 6, add = notes.add.slice(0, MAX), fix = notes.fix.slice(0, Math.max(0, MAX - add.length)), more = notes.add.length + notes.fix.length - add.length - fix.length;
  return h('div', { class: 'whats-new' },
    add.length ? [h('h3', {}, 'New and improved'), h('ul', {}, add.map((t) => h('li', {}, t)))] : null,
    fix.length ? [h('h3', {}, 'Fixes'), h('ul', {}, fix.map((t) => h('li', {}, t)))] : null,
    more > 0 ? h('p', { class: 'hint' }, `and ${more} more`) : null);
}
function askToUpdate(force = false) {
  if (!update || document.querySelector('.update-ask') || updateBusy.startsWith('Downloading')) return;
  const last = device.updateAsked?.build === update.build ? device.updateAsked.at : 0;
  if (!force && (Date.now() - askedAt < 60000 || (launcherEnabled && Date.now() - last < 4 * 3600000))) return;
  askedAt = Date.now();
  device.updateAsked = { build: update.build, at: Date.now() };
  saveDevice();
  // Back up first (#80): an update should never be able to cost someone their homes and settings.
  const body = h('div', { class: 'menu update-ask' });
  const close = modal(body);
  let backedUp = Date.now() - (device.lastBackup?.at || 0) < 3600000; // saved within the hour: no need to ask again
  const draw = () => body.replaceChildren(...nodes(
    h('div', { class: 'panel-head' }, icon('update'), h('h2', {}, 'Update available')),
    h('p', { class: 'hint' }, `Nidorama ${update.version} is available (you have ${VERSION}).`),
    whatsNew(update.notes),
    h('h3', {}, backedUp ? '1. Backup saved' : '1. Save a backup first'),
    backedUp ? h('p', { class: 'hint' }, 'Your homes, dashboards and settings are in the backup file.')
      : h('p', { class: 'hint' }, `An update keeps everything as it is, but a backup means nothing can be lost if something goes wrong. ${backupAge()}`),
    backedUp ? null : backupChoices(() => { backedUp = true; draw(); }),
    h('h3', {}, '2. Update'),
    h('div', { class: 'btns' },
      h('button', { class: 'wide ghost', onclick: () => close() }, 'Not now'),
      h('button', { class: 'wide' + (backedUp ? ' primary' : ''), onclick: () => { close(); installUpdate(); } }, icon('update'), backedUp ? 'Update' : 'Update without a backup'))));
  draw();
}
// Going to the background: write any change that is still waiting, in case the app is closed there.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
// Check every time the app comes back to the front, not only when it starts.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });

async function installUpdate() {
  if (!update || updateBusy.startsWith('Downloading')) return;
  try {
    updateBusy = 'Downloading…';
    renderUpdate();
    const status = await native.installUpdate(update.url, ghToken(), (f) => { updateBusy = `Downloading ${Math.round(f * 100)}%`; updateChip.lastChild.textContent = updateBusy; });
    updateBusy = status === 'needs-permission' ? 'Allow installs from Nidorama, then tap again' : '';
  } catch (e) { updateBusy = `Update failed — tap to retry`; console.warn(e); }
  renderUpdate();
}
// An update is only ever announced on screen (#79): the background check that raised an Android notification is switched off.
const syncNotifications = () => native.setUpdateNotifications(false, '', '');
/** The user tapped Install on the update notification. */
async function onLaunchAction(action) {
  if (action !== 'install_update') return;
  await checkForUpdate(true);
  if (update) installUpdate();
}
native.onLaunchAction(onLaunchAction);
setTimeout(() => { syncNotifications(); checkForUpdate(); }, 4000);
setInterval(checkForUpdate, 6 * 3600 * 1000);

// ---------- photo render: a path-traced picture kept as the backdrop of the Photo style ----------
const renderKey = (night) => `render/${cur.homeId}/${cur.id}/${night ? 'night' : 'day'}`;
let backdropURL = null, photoRec = null;
function layoutStage() {
  if (!photoRec || view.styleId !== 'photo') { stage.style.cssText = ''; return; }
  const area = stage.parentElement, W = area.clientWidth, H = area.clientHeight;
  const w = Math.min(W, H * photoRec.aspect), hgt = w / photoRec.aspect;
  stage.style.cssText = `inset:auto;left:${(W - w) / 2}px;top:${(H - hgt) / 2}px;width:${w}px;height:${hgt}px`;
}
new ResizeObserver(layoutStage).observe(stage.parentElement);
/** Called after the plan's style is set: keeps the page background, backdrop and camera lock right. */
function afterStyle() {
  renderLayers();
  view.washColor = dotColour('light');
  buildDots();
  root.dataset.style = view.styleId;
  if (view.styleId === 'photo' && view.isolated) view.isolate(null);
  if (view.styleId === 'photo' && level()) return applyPhoto();
  photoRec = null;
  view.unlock();
  backdrop.classList.add('hidden');
  photoNote.classList.add('hidden');
  layoutStage();
}
async function applyPhoto() {
  const n = isNight(), at = cur;
  let rec = (await getBlob(renderKey(n))) || (await getBlob(renderKey(!n)));
  for (const night of [n, !n]) {
    // The Home Assistant folder may hold a render this device has not got yet, or a newer one.
    if (!remote.base || !cur) break;
    const name = renderName(cur.homeId, cur.id, night);
    const meta = await getAsset('renders', `${name}.json`).then((b) => b?.text()).then((t) => (t ? JSON.parse(t) : null)).catch(() => null);
    const local = await getBlob(renderKey(night));
    if (!meta || (local && local.at >= meta.at)) continue;
    const image = await getAsset('renders', `${name}.jpg`);
    if (!image) continue;
    await putBlob(renderKey(night), { ...meta, image });
    if (!rec || night === n) rec = await getBlob(renderKey(night));
  }
  if (cur !== at || view.styleId !== 'photo') return;
  photoRec = rec || null;
  if (backdropURL) URL.revokeObjectURL(backdropURL);
  backdropURL = rec ? URL.createObjectURL(rec.image) : null;
  backdrop.classList.toggle('hidden', !rec);
  if (rec) backdrop.src = backdropURL;
  layoutStage();
  if (rec) view.lock(rec.cam); else view.unlock();
  const stale = rec && (home().updatedAt || 0) > rec.homeUpdatedAt;
  photoNote.classList.toggle('hidden', !!rec && !stale);
  photoNote.classList.toggle('corner', !!rec);
  photoNote.replaceChildren(...nodes(
    rec ? null : h('p', {}, 'No photo render of this plan yet. Frame the view you want in another style, then render it.'),
    h('button', { class: 'chip', onclick: startPhotoRender }, icon('camera'), rec ? 'Plan changed · Render again' : 'Render now')));
}
async function startPhotoRender() {
  if (!level() || editor.active || view.tracing) return;
  const m = remote.info?.machine, canRemote = !!remote.info?.render?.available;
  const weak = m && (m.cores < 4 || m.memoryGB < 3.5 || !/x64|x86/.test(m.arch));
  let where = device.renderOn === 'ha' && canRemote ? 'ha' : 'device';
  const quality = await new Promise((resolve) => {
    const pick = (v) => { resolve(v); close(); };
    const body = h('div', { class: 'menu' });
    const draw = () => body.replaceChildren(...nodes(
      h('div', { class: 'panel-head' }, h('h2', {}, 'Photo render'), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => pick(0) }, icon('close'))),
      h('p', { class: 'hint' }, 'Computes a lifelike picture of the plan as it is framed now: light bounces around the rooms, with soft shadows and reflections. It becomes the backdrop of the Photo render style, where your lights still glow live on top.'),
      h('p', { class: 'hint' }, `It renders ${isNight() ? 'the night look, with the lights that are on now' : 'the daytime look'}.`),
      canRemote ? [h('div', { class: 'row pad' }, h('div', { class: 'row-label' }, 'Render on'),
        seg([['device', 'This device'], ['ha', 'Home Assistant']], where, (v) => { where = v; device.renderOn = v; saveDevice(); draw(); })),
        where === 'ha' ? h('p', { class: 'hint' + (weak ? ' bad' : '') }, `The Home Assistant machine has ${m.cores} cores and ${m.memoryGB} GB (${m.arch}). ${weak ? 'That is below the suggested minimum of a 4-core, 4 GB PC-class machine: expect it to be very slow, and it may fail.' : 'It renders without a graphics card, so allow several minutes.'} You can close the app; the picture is saved in Home Assistant for every device.` + (remote.info.render.busy ? ' Another render is running; this one will wait its turn.' : '')) : null]
        : h('p', { class: 'hint' }, 'Rendered on this device. If it is too slow here, install the Nidorama add-on in Home Assistant and the Home Assistant machine can do it.'),
      menuItem('camera', 'Draft', 'quick, a little grainy', () => pick(48)),
      menuItem('camera', 'Good', 'the usual choice', () => pick(160)),
      menuItem('camera', 'Best', 'slow; cleanest picture', () => pick(500))));
    const close = modal(body, { onclose: () => resolve(0) });
    draw();
  });
  if (!quality) return;
  if (view.styleId !== 'realistic') {
    const cam = view.styleId === 'photo' && photoRec ? photoRec.cam : null;
    view.unlock();
    view.setStyle('realistic');
    afterStyle();
    if (cam) { Object.assign(view.cam, cam); view.resize(); }
  }
  let stop = false, early = false, t0 = performance.now();
  const status = h('p', { class: 'hint' }, 'Preparing…');
  const bar = h('div', { class: 'bar' }, h('i', {}));
  const card = h('div', { class: 'render-card' }, h('h3', {}, 'Rendering'), status, bar,
    h('div', { class: 'btns' },
      h('button', { class: 'wide', onclick: () => { early = true; } }, icon('check'), 'Use it as it is'),
      h('button', { class: 'wide ghost', onclick: () => { stop = true; } }, 'Cancel')));
  const blocker = h('div', { class: 'render-block' }, card);
  root.append(blocker);
  if (!device.keepAwake) native.setKeepScreenOn(true);
  let blob = null, meta = null;
  const night = isNight(), name = renderName(cur.homeId, cur.id, night);
  const progress = (frac) => {
    const secs = (performance.now() - t0) / 1000, left = frac > 0.02 ? (secs / frac) * (1 - frac) : 0;
    bar.firstChild.style.width = `${frac * 100}%`;
    status.textContent = `${Math.round(frac * 100)}%${left ? ` · about ${left > 90 ? `${Math.round(left / 60)} min` : `${Math.max(1, Math.round(left))} s`} left` : ''}`;
  };
  try {
    if (where === 'ha') {
      // Hand the job to the add-on: the plan, the view, and which lights are on.
      card.querySelector('h3').textContent = 'Rendering on Home Assistant';
      card.querySelector('.wide').classList.add('hidden'); // no "use it as it is" for remote renders
      const scale = Math.min(1.5, 1600 / Math.max(canvas.clientWidth, canvas.clientHeight));
      const job = {
        key: name, home: home(), levelId: cur.id, night, sun: view.sunAngles, samples: quality,
        width: Math.round(canvas.clientWidth * scale), height: Math.round(canvas.clientHeight * scale),
        cam: { ...view.cam, off: [...view.cam.off] }, lights: [...view.lights.values()].filter((l) => l.on).map((l) => [l.def.id, true, l.level]),
      };
      const { id } = await (await addon('render', { method: 'POST', body: JSON.stringify(job) })).json();
      for (;;) {
        await new Promise((res) => setTimeout(res, 3000));
        if (stop) { await addon(`render/${id}`, { method: 'DELETE' }).catch(() => {}); break; }
        const s = await (await addon(`render/${id}`)).json();
        if (s.state === 'queued') status.textContent = 'Waiting for another render to finish…';
        else if (s.state === 'running') s.progress ? progress(s.progress) : (status.textContent = 'Starting the render engine…');
        else if (s.state === 'done') {
          meta = JSON.parse(await (await getAsset('renders', `${name}.json`)).text());
          blob = await getAsset('renders', `${name}.jpg`);
          break;
        } else throw new Error(s.error || 'The render did not finish.');
      }
    } else blob = await view.trace({
      samples: quality, cancelled: () => stop, finishEarly: () => early,
      onProgress: (s) => progress(Math.min(1, s / quality)),
    });
  } catch (e) {
    alert(`${where === 'ha' ? 'Home Assistant' : 'This device'} could not make the photo render.\n${e.message || e}`);
  }
  blocker.remove();
  if (!device.keepAwake) native.setKeepScreenOn(false);
  if (!blob) return;
  meta ||= { cam: { ...view.cam, off: [...view.cam.off] }, aspect: canvas.clientWidth / canvas.clientHeight, at: Date.now(), homeUpdatedAt: home().updatedAt || 0 };
  await putBlob(renderKey(night), { ...meta, image: blob });
  if (where !== 'ha' && remote.base) { // keep a copy in the Home Assistant folder so other devices get it
    putAsset('renders', `${name}.jpg`, blob);
    putAsset('renders', `${name}.json`, new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  }
  device.style = 'photo';
  saveDevice();
  view.setStyle('photo');
  afterStyle();
  buildLabels();
  syncFromStates();
}

// ---------- scanning real furniture with Scaniverse ----------
/** Guide the user to scan an item; the scan comes back by "share to Nidorama" or as a chosen file. */
function startScan(o) {
  device.pendingScan = { homeId: cur.homeId, levelId: cur.id, objectId: o.id, name: o.name, at: Date.now() };
  saveDevice();
  const close = modal(h('div', { class: 'menu' },
    h('div', { class: 'panel-head' }, h('h2', {}, `Scan ${o.name}`), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
    h('p', { class: 'hint' }, 'Scaniverse is a free 3D scanning app. Nidorama hands over to it and takes the finished scan back.'),
    h('ol', { class: 'steps' },
      h('li', {}, 'In Scaniverse, start a new scan and walk slowly all the way around the piece.'),
      h('li', {}, 'When it has processed, crop away the floor and walls if it offers to.'),
      h('li', {}, 'Share → Export model → GLB, then choose Nidorama from the list of apps.')),
    h('p', { class: 'hint' }, `Nidorama then puts the scan on ${o.name} at its real size and saves it for your other devices. If Nidorama is not in Scaniverse's list, save the file and choose it below.`),
    native.isNative ? h('button', { class: 'wide primary', onclick: async () => { if (!(await native.openScanner())) alert('Could not open Scaniverse. Install it from the Play Store, then try again.'); } }, icon('camera'), 'Open Scaniverse') : null,
    h('button', { class: 'wide', onclick: async () => { const file = await pickFile('.glb,model/gltf-binary'); if (file) { close(); receiveScan({ blob: file, name: file.name }); } } }, icon('file'), 'I have the scan file')));
}
/** A .glb arrived (shared from the scanning app, or chosen): put it on the item that was waiting, or let the user place it. */
async function receiveScan({ blob, name }) {
  if (!(await isGLB(blob))) return alert(`"${name}" is not a .glb 3D model. In Scaniverse choose Export model → GLB.`);
  const m = { blob, name: name.replace(/\.glb$/i, ''), size: await measureGLB(blob), source: 'scan' };
  const p = device.pendingScan, hm = p && Date.now() - p.at < 86400000 ? getHome(p.homeId) : null;
  const target = hm?.levels.find((l) => l.id === p.levelId)?.objects.find((ob) => ob.id === p.objectId);
  device.pendingScan = null;
  saveDevice();
  document.querySelectorAll('.modal-wrap').forEach((w) => w.click());
  if (target) {
    if (cur?.homeId !== p.homeId || cur.id !== p.levelId || cur.kind !== 'level') show({ homeId: p.homeId, kind: 'level', id: p.levelId });
    if (!editMode) setEditMode(true);
    await editor.applyModel(target, { ...m, name: target.name });
  } else if (level()) {
    if (!editMode) setEditMode(true);
    await editor.placeGiven(m);
  } else alert('Open a plan first, then share the scan again.');
}
native.onSharedFile(receiveScan);

// ---------- requests: logged for the owner, never built automatically ----------
function openRequests() {
  closeSheet();
  const token = reqToken(), buildsToken = ghToken();
  let items = null, owner = false, error = '', note = '', kind = 'feature', area = '', target = 'dev', experimental = false, builds = null;
  const loadBuilds = () => listBuilds(buildsToken).then((b) => { builds = b; if (document.body.contains(body)) draw(); }, () => {});
  const doPromote = async (b) => {
    const to = NEXT[b.channel];
    if (!confirm(`Promote build ${b.version} to ${CHANNELS[to]}?\n\nEveryone following ${CHANNELS[to]}${to === 'beta' ? '' : ' or Beta'} will be offered it. It is the same build, not a new one.`)) return;
    note = 'Promoting…'; draw();
    try { const now = await promote(buildsToken, b); b.channel = now; note = `Build ${b.version} is now ${CHANNELS[now]}.`; } catch (e) { note = `Could not promote: ${e.message}`; }
    draw();
    setTimeout(loadBuilds, 3000);
  };
  // Votes (#77): a thumbs-up on the request, one per GitHub account. This device remembers its own so it can take one back.
  let byVotes = false;
  const myVotes = (device.votes ||= {});
  const doVote = async (r) => {
    if (!token) return window.open(r.url, '_blank', 'noopener');
    try {
      if (myVotes[r.number]) { await unvote(token, r.number, myVotes[r.number]).catch(() => {}); delete myVotes[r.number]; r.votes = Math.max(0, r.votes - 1); }
      else { myVotes[r.number] = await vote(token, r.number); r.votes += 1; }
      saveDevice();
    } catch (e) { note = `Could not vote: ${e.message}`; }
    draw();
  };
  const editReq = (r) => {
    const t = h('input', { type: 'text', value: r.title, maxlength: 120 }), b = h('textarea', { rows: 8 }, r.body);
    b.value = r.body;
    const c = modal(h('div', { class: 'menu requests' }, h('div', { class: 'panel-head' }, h('h2', {}, `Edit request #${r.number}`), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => c() }, icon('close'))),
      h('label', { class: 'field wide-field' }, h('span', {}, 'Title'), t), h('label', { class: 'field wide-field' }, h('span', {}, 'Details'), b),
      h('button', { class: 'wide primary', onclick: async () => {
        if (!t.value.trim()) return;
        c(); note = 'Saving…'; draw();
        try { await editRequest(token, r.number, { title: t.value.trim(), body: b.value }); Object.assign(r, { title: t.value.trim(), body: b.value }); note = `Request #${r.number} changed.`; } catch (e) { note = `Could not save: ${e.message}`; }
        draw();
      } }, icon('check'), 'Save')));
  };
  const shots = [], shown = new Map(); // screenshots to send; screenshots of opened requests (number → urls | 'loading')
  const addShot = async () => {
    const file = await pickFile('image/*');
    if (!file) return;
    try { shots.push(await shrinkScreenshot(file)); } catch (e) { note = `Could not use that picture: ${e.message || e}`; }
    draw();
  };
  const openReq = (r) => {
    if (expanded.has(r.number)) expanded.delete(r.number);
    else {
      expanded.add(r.number);
      if (r.comments && !shown.has(r.number)) { shown.set(r.number, 'loading'); screenshotsOf(token, r.number).then((u) => shown.set(r.number, u), () => shown.set(r.number, [])).then(() => document.body.contains(body) && draw()); }
    }
    draw();
  };
  const picked = new Set(), expanded = new Set();
  const body = h('div', { class: 'menu requests' });
  const close = modal(body);
  const title = h('input', { type: 'text', placeholder: 'In a few words', maxlength: 120 });
  const details = h('textarea', { rows: 4, placeholder: 'What should it do? What happens now? (at least 20 characters)' });
  const MIN_DETAILS = 20;
  const ready = () => !!area && title.value.trim().length > 0 && details.value.trim().length >= MIN_DETAILS;
  const sendBtn = h('button', { class: 'wide primary', disabled: true, onclick: () => send() }, icon('plus'), 'Log this request');
  const counter = h('p', { class: 'hint' });
  const refreshSend = () => {
    sendBtn.disabled = !ready();
    const n = details.value.trim().length;
    counter.textContent = ready() ? 'Ready to log.' : !area ? 'Choose what it is about: Widget pages, Floor plans or Interface.' : !title.value.trim() ? 'Add a title.' : `Details: ${n} of at least ${MIN_DETAILS} characters.`;
  };
  title.addEventListener('input', refreshSend);
  details.addEventListener('input', refreshSend);
  // GitHub's list can take a few seconds to catch up with a change just made, so what this device
  // did is shown at once and kept on top of whatever the list says for a little while (#58).
  const recent = new Map(); // number → { at, status | gone | item }
  const settle = (list) => {
    const out = list.filter((r) => !recent.get(r.number)?.gone).map((r) => { const c = recent.get(r.number); return c?.status ? { ...r, status: c.status, target: c.target ?? r.target, experimental: c.experimental ?? r.experimental } : r; });
    for (const [n, c] of recent) if (c.item && !c.gone && !out.some((r) => r.number === n)) out.unshift({ ...c.item, status: c.status || c.item.status });
    return out.sort((a, b) => b.number - a.number);
  };
  const remember = (n, change) => { recent.set(n, { ...recent.get(n), ...change, at: Date.now() }); if (items) items = settle(items); };
  const load = async () => {
    if (!token && REPO_PRIVATE) return draw();
    for (const [n, c] of recent) if (Date.now() - c.at > 60000) recent.delete(n);
    try { const [list, own] = await Promise.all([listRequests(token), token ? isOwner(token) : false]); items = settle(list); owner = own; error = ''; } catch (e) { error = e.message; }
    loadBuilds();
    if (document.body.contains(body)) draw();
  };
  const reloadSoon = () => { setTimeout(load, 4000); setTimeout(load, 15000); };
  const act = async (fn, done, change) => {
    note = 'Working…'; draw();
    try { for (const n of [...picked]) { await fn(token, n); remember(n, change); picked.delete(n); } note = done; } catch (e) { note = `Failed: ${e.message}`; }
    draw();
    reloadSoon();
  };
  const send = async () => {
    if (!ready()) return;
    note = 'Sending…'; draw();
    try {
      const made = await sendRequest(token, { kind, area, title: title.value.trim(), details: details.value.trim(), version: VERSION });
      let failed = 0;
      if (made?.number) for (const [i, u] of shots.entries()) { note = `Sending screenshot ${i + 1} of ${shots.length}…`; draw(); try { await attachScreenshot(token, made.number, u, i + 1); } catch { failed++; } }
      if (made?.number && shots.length) shown.set(made.number, shots.slice());
      const sent = shots.length - failed;
      shots.length = 0;
      if (made?.number) { items ||= []; remember(made.number, { item: { number: made.number, title: made.title, body: made.body || '', kind, area, comments: sent, votes: 0, status: 'new', by: made.user?.login || '', at: made.created_at || new Date().toISOString(), url: made.html_url } }); }
      title.value = ''; details.value = '';
      note = `Logged${made?.number ? ` as #${made.number}` : ''}${sent ? ` with ${sent} screenshot${sent === 1 ? '' : 's'}` : ''}${failed ? ` (${failed} screenshot${failed === 1 ? '' : 's'} could not be sent)` : ''}. It will only be built if the owner approves it.`;
    } catch (e) { note = `Could not send: ${e.message}`; }
    draw();
    reloadSoon();
  };
  const when = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  function draw() {
    const anyPicked = picked.size > 0;
    const kids = [
      h('div', { class: 'panel-head' }, h('h2', {}, 'Requests'), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
      h('p', { class: 'hint' }, 'Ask for a new feature, a change or a fix. Requests are logged for the owner to review — nothing is built until they approve it.'),
      token ? [
        seg([['feature', 'New feature'], ['change', 'Change'], ['fix', 'Fix']], kind, (v) => { kind = v; draw(); }),
        h('div', { class: 'field wide-field' }, h('span', {}, 'What is it about? (needed)'), seg(AREAS, area, (v) => { area = v; draw(); })),
        h('label', { class: 'field wide-field' }, h('span', {}, 'Title'), title),
        h('label', { class: 'field wide-field' }, h('span', {}, 'Details'), details),
        h('div', { class: 'shots' }, shots.map((u, i) => h('div', { class: 'shot' }, h('img', { src: u, alt: `Screenshot ${i + 1}` }),
          h('button', { class: 'round small', 'aria-label': `Remove screenshot ${i + 1}`, onclick: () => { shots.splice(i, 1); draw(); } }, icon('close')))),
          shots.length < 4 ? h('button', { class: 'chip small', onclick: addShot }, icon('image'), shots.length ? 'Add another' : 'Add a screenshot (optional)') : null),
        counter, sendBtn,
        REPO_PRIVATE ? null : h('p', { class: 'hint' }, 'Requests are public: anyone can read what you write here, and any screenshot you attach.'),
      ] : REPO_PRIVATE ? h('p', { class: 'hint bad' }, 'Sending and viewing requests needs a GitHub access token: More → Settings → Updates → GitHub access.')
        : [h('p', { class: 'hint' }, 'Requests are kept on GitHub, where anyone can read them. To send one, or to vote, sign in to GitHub there.'),
          h('button', { class: 'wide primary', onclick: () => window.open(NEW_ISSUE_URL, '_blank', 'noopener') }, icon('plus'), 'Send a request on GitHub')],
      note ? h('p', { class: 'hint' }, note) : null,
      error ? h('p', { class: 'hint bad' }, `Could not load the log: ${error}.`) : null,
      items ? [
        h('div', { class: 'msep' }),
        h('h3', {}, `Log · ${items.length} open`),
        h('div', { class: 'row' }, h('div', { class: 'row-label' }, 'Order'), seg([[false, 'Newest'], [true, 'Most wanted']], byVotes, (v) => { byVotes = v; draw(); })),
        h('p', { class: 'hint' }, owner ? 'Tap a request to read it. Tick the ones you want, then Approve. Approved requests are built together when you start the next build.' : 'Tap a request to read it. Only the owner can approve or decline.'),
        h('div', { class: 'req-list' }, [...items].sort((a, b) => (byVotes ? b.votes - a.votes : 0) || b.number - a.number).map((r) => h('div', { class: 'req' + (r.status === 'approved' ? ' ok' : '') },
          h('div', { class: 'req-head' },
            owner ? h('input', { type: 'checkbox', checked: picked.has(r.number), 'aria-label': `Select request ${r.number}`, onchange: (e) => { e.target.checked ? picked.add(r.number) : picked.delete(r.number); draw(); } }) : null,
            h('button', { class: 'req-open grow', 'aria-expanded': expanded.has(r.number) ? 'true' : 'false', onclick: () => openReq(r) },
              r.title, h('span', { class: 'sub' }, `#${r.number} · ${r.kind}${r.area ? ` · ${areaName(r.area).toLowerCase()}` : ''} · ${r.by} · ${when(r.at)}${r.status === 'approved' ? ` · approved for ${r.target === 'private' ? 'Private' : 'Alpha'}${r.experimental ? ', experimental' : ''}` : ''}`)),
            h('button', { class: 'chip small vote' + (myVotes[r.number] ? ' on' : ''), 'aria-pressed': String(!!myVotes[r.number]), 'aria-label': `${myVotes[r.number] ? 'Take back your vote for' : 'Vote for'} request ${r.number} (${r.votes} vote${r.votes === 1 ? '' : 's'})`, title: token ? (myVotes[r.number] ? 'Take back your vote' : 'I want this too') : 'Vote on GitHub', onclick: () => doVote(r) }, icon('up'), String(r.votes)),
            icon(expanded.has(r.number) ? 'up' : 'down')),
          expanded.has(r.number) ? [h('p', { class: 'req-body' }, r.body.trim() || 'No details were given.'),
            owner ? h('button', { class: 'chip small', onclick: () => editReq(r) }, icon('edit'), 'Edit this request') : null,
            Array.isArray(shown.get(r.number)) && shown.get(r.number).length ? h('div', { class: 'shots' }, shown.get(r.number).map((u, i) => h('button', { class: 'shot big', 'aria-label': `Screenshot ${i + 1}: see it bigger`, onclick: () => { const c = modal(h('div', { class: 'menu' }, h('div', { class: 'panel-head' }, h('h2', {}, `Screenshot ${i + 1}`), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => c() }, icon('close'))), h('img', { src: u, alt: '', style: 'width:100%;height:auto;border-radius:12px' }))); } }, h('img', { src: u, alt: `Screenshot ${i + 1}` })))) : null,
            shown.get(r.number) === 'loading' ? h('p', { class: 'hint' }, 'Looking for screenshots…') : null] : null))),
        !items.length ? h('p', { class: 'hint' }, 'No open requests.') : null,
        owner && items.length ? h('div', { class: 'field wide-field' }, h('span', {}, 'Approve the ticked requests for'),
          seg(TARGETS, target, (v) => { target = v; draw(); }),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: experimental, onchange: (e) => (experimental = e.target.checked) }), 'Experimental: build it, but keep it behind experimental mode')) : null,
        owner && items.length ? h('p', { class: 'hint' }, 'Alpha: it goes into the next Alpha build, and reaches Beta and Stable only when you promote that build below. Private: it is built only into your own private build.') : null,
        owner && items.length ? h('div', { class: 'btns' },
          h('button', { class: 'wide primary', disabled: !anyPicked, onclick: () => act((t, n) => approve(t, n, { target, experimental }), 'Approved. It will be in the next build made for that stage.', { status: 'approved', target, experimental }) }, icon('check'), 'Approve'),
          h('button', { class: 'wide', disabled: !anyPicked, onclick: () => act(unapprove, 'Moved back to the log.', { status: 'new' }) }, 'Un-approve'),
          h('button', { class: 'wide danger', disabled: !anyPicked, onclick: () => { if (confirm(`Decline ${picked.size} request(s)? They are closed on GitHub.`)) act(decline, 'Declined.', { gone: true }); } }, 'Decline')) : null,
        builds?.length ? [
          h('div', { class: 'msep' }),
          h('h3', {}, 'Builds'),
          h('p', { class: 'hint' }, owner ? 'Every build starts as Alpha (or Private). Promote one when you are happy with it: Alpha → Beta → Stable. Nothing can skip a stage.' : 'The newest builds and the stage each has reached.'),
          h('div', { class: 'req-list' }, builds.slice(0, 12).map((b) => h('div', { class: 'row build-row' },
            h('div', { class: 'row-label' }, h('div', {}, b.version, ' ', h('span', { class: `badge ch-${b.channel}` }, CHANNELS[b.channel] || 'Test')),
              h('div', { class: 'sub' }, `${when(b.at)}${b.requests.length ? ` · requests ${b.requests.map((n) => `#${n}`).join(', ')}` : ''}`)),
            owner && NEXT[b.channel] ? h('button', { class: 'chip small', onclick: () => doPromote(b) }, icon('up'), `Promote to ${CHANNELS[NEXT[b.channel]]}`) : null)))] : null,
      ] : token && !error ? h('p', { class: 'hint' }, 'Loading the log…') : null];
    body.replaceChildren(...nodes(kids));
    refreshSend();
  }
  draw();
  load();
}

// ---------- idle dim (wall tablet) ----------
let idleTimer;
function bumpIdle() {
  clearTimeout(idleTimer);
  if (device.idleDim) idleTimer = setTimeout(() => dimmer.classList.remove('hidden'), 120000);
}
function wakeFromIdle() {
  const wasDim = !dimmer.classList.contains('hidden');
  dimmer.classList.add('hidden');
  bumpIdle();
  return wasDim;
}
dimmer.addEventListener('pointerdown', (e) => { e.preventDefault(); wakeFromIdle(); });
window.addEventListener('pointerdown', bumpIdle, true);

// ---------- back to the device's default view after 30 seconds of inactivity (#96) ----------
// A plan's default view on this device is one room, when "Start this device here" was set on that
// room of this plan; otherwise it is the whole plan. Nothing happens while something is open or being edited.
let restTimer = 0;
const REST_AFTER = 30000;
function restToDefault() {
  if (!level() || editMode || editor.active || openSheet || sliding.active || view.locked || document.querySelector('.modal-wrap, .wpage')) return armRest();
  const s = device.start, room = s && cur && s.homeId === cur.homeId && s.kind === 'level' && s.id === cur.id && level().rooms.some((r) => r.id === s.room) ? s.room : null;
  if (room && view.isolated !== room) enterRoom(room); // the default is a room: glide back into it
  else if (!room && view.isolated) selectRoom(null); // the default is the whole plan: glide back out
}
function armRest() { clearTimeout(restTimer); restTimer = setTimeout(restToDefault, REST_AFTER); }
for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel']) window.addEventListener(ev, armRest, { capture: true, passive: true });
armRest();

// ---------- boot ----------
let launcherEnabled = false;
native.getLauncherState().then((ls) => (launcherEnabled = !!ls?.enabled));
native.onBackButton(() => {
  const wp = [...document.querySelectorAll('.wpage')].pop(); // a widget's page: Back returns from it
  if (wp && !document.querySelector('.modal-wrap')) { wp.goBack?.(); return true; }
  if (document.querySelector('.modal-wrap')) { document.querySelector('.modal-wrap').click(); return true; }
  if (openSheet) { closeSheet(); return true; }
  if (editMode) { setEditMode(false); return true; }
  if (selectedRoom) { selectRoom(null); view.fit(); return true; }
  if (kioskOn()) { if (device.kiosk.back) runKiosk('right'); return true; } // in kiosk mode Back never leaves the app
  return false;
}, () => launcherEnabled /* as a home screen, Back never leaves */);
if (native.isNative && device.keepAwake) native.setKeepScreenOn(true);
view.refineEnabled = device.refine !== false;
window.__nidorama = { view, editor, show, home, setEditMode: (on) => setEditMode(on), testUpdate: (u) => { update = u; renderUpdate(); askToUpdate(); } }; // handles for automated tests

new ResizeObserver(() => view.resize()).observe(stage);
onLibraryChange((why) => {
  if (why !== 'sync' && why !== 'undo') return;
  if (!valid(cur)) return show(firstView());
  if (why === 'sync' && !editor.active) show(cur);
});

async function boot() {
  native.takeLaunchAction().then((a) => a && onLaunchAction(a));
  try {
    const r = await fetch('nidorama-config.json', { cache: 'no-store' });
    if (r.ok) { const cfg = await r.json(); if (cfg.addon) window.__NIDORAMA_ADDON__ = cfg; }
  } catch {}
  await initStore();
  app.units = device.units === 'imperial' ? 'imperial' : 'metric';
  await finishHaSignIn();
  connect();
  const start = valid(device.start) ? device.start : valid(device.last) ? device.last : firstView();
  show(start, { room: start && start === device.start ? start.room : null });
  bumpIdle();
  startAlerts(hub);
  try { const note = sessionStorage.getItem('nidorama.restored'); if (note) { sessionStorage.removeItem('nidorama.restored'); setTimeout(() => toast(note), 600); } } catch {}
  startAlarms();
  loadWallpaper();
  applyKiosk();
  native.takeSharedFile().then((f) => f && receiveScan(f));
}
boot();
