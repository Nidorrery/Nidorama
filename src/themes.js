// Themes (#57): how the app looks — its colours, corners, lettering, and how a selected area is
// marked on the plan. "Original" is the look Nidorama was designed with and the default; people
// can make their own here, or load a theme file. Themes belong to the device (not the home).
//
// A theme only ever holds colours and a few fixed choices, never CSS, so a theme file from
// someone else cannot do anything but restyle.
import { h, nodes, icon, seg, modal, pickFile } from './ui.js';
import { device, saveDevice } from './store.js';
import { upgradeFile } from './legacy.js';

const HEX = /^#[0-9a-f]{6}$/i;
export const FONTS = {
  system: ['System', "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"],
  rounded: ['Rounded', "ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, sans-serif"],
  serif: ['Serif', "ui-serif, Georgia, 'Times New Roman', serif"],
  mono: ['Mono', "ui-monospace, 'Roboto Mono', Menlo, Consolas, monospace"],
  geometric: ['Geometric', "'Montserrat', 'Avenir Next', 'Century Gothic', system-ui, sans-serif"], // bundled with the app (open font licence)
};
export const SELECTION_STYLES = [['glow', 'Glow'], ['grid', 'Grid'], ['stripes', 'Stripes'], ['dots', 'Dots']];
/** The original look, written out so a new theme can start from it. */
const BASE = {
  accent: '#ff9a3c', selection: { style: 'glow', color: '#ffd9a8' }, radius: 18, font: 'system',
  day: { bg: '#ece4da', panel: '#fbf8f4', ink: '#2a2622' }, night: { bg: '#171b35', panel: '#1a1e33', ink: '#ecebf3' },
};
const BUILTIN = [
  { id: 'original', name: 'Original', builtin: true },
  // Pear: light, quiet and glassy — frosted panels, hairline edges, generous round corners.
  { id: 'pear', name: 'Pear', builtin: true, accent: '#0a84ff', selection: { style: 'glow', color: '#8ec5ff' }, radius: 22, font: 'system', glass: true,
    day: { bg: '#f2f2f7', panel: '#ffffff', ink: '#1c1c1e' }, night: { bg: '#000000', panel: '#1c1c1e', ink: '#f5f5f7' } },
  // Frosted glass: clear, blurred glass tiles and panels floating over a colourful background the
  // user chooses (see WALLPAPERS); white lettering, and whatever is switched on turns to bright glass.
  { id: 'frost', name: 'Frosted glass', builtin: true, accent: '#ffffff', selection: { style: 'glow', color: '#ffffff' }, radius: 26, font: 'system', glass: true,
    day: { bg: '#3a3fd6', panel: '#ffffff', ink: '#ffffff' }, night: { bg: '#1c1f7a', panel: '#ffffff', ink: '#ffffff' } },
  // Jack: a whole look, not only colours. Soft glass over a dark picture, thin geometric lettering,
  // small spaced capitals, a warm glow on whatever is on, and devices that open as a full page
  // with one tall slab to drag (`pages: 'slab'`, see controlpage.js). Built on the glass theme.
  { id: 'jack', name: 'Jack', builtin: true, accent: '#f2c14e', selection: { style: 'glow', color: '#ffe7ad' }, radius: 22, font: 'geometric', glass: true, caps: true, pages: 'slab',
    day: { bg: '#3a3d48', panel: '#ffffff', ink: '#ffffff' }, night: { bg: '#15161c', panel: '#ffffff', ink: '#ffffff' } },
  { id: 'neon', name: 'Neon grid', builtin: true, accent: '#b46bff', selection: { style: 'grid', color: '#c77dff' }, radius: 6, font: 'mono',
    day: { bg: '#17122b', panel: '#211a3d', ink: '#f1eaff' }, night: { bg: '#0c0919', panel: '#151029', ink: '#f1eaff' } },
];

export const themeList = () => [...BUILTIN, ...(device.themes || [])];
export const themeById = (id) => themeList().find((t) => t.id === id) || BUILTIN[0];
const current = () => themeById(device.theme);

/** Check a theme from a file (or storage) and keep only what a theme may hold. Throws if it is not one. */
export function cleanTheme(raw) {
  upgradeFile(raw);
  if (!raw || typeof raw !== 'object' || (raw.schema && raw.schema !== 'nidorama.theme/1')) throw new Error('This is not a Nidorama theme file.');
  const col = (v, d) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
  const side = (v, d) => ({ bg: col(v?.bg, d.bg), panel: col(v?.panel, d.panel), ink: col(v?.ink, d.ink) });
  if (!HEX.test(raw.accent || '') && !raw.day && !raw.night) throw new Error('This is not a Nidorama theme file.');
  return {
    id: typeof raw.id === 'string' && /^[\w-]{1,40}$/.test(raw.id) ? raw.id : `theme-${Date.now().toString(36)}`,
    name: String(raw.name || 'My theme').slice(0, 40),
    accent: col(raw.accent, BASE.accent),
    selection: { style: SELECTION_STYLES.some(([k]) => k === raw.selection?.style) ? raw.selection.style : 'glow', color: col(raw.selection?.color, BASE.selection.color) },
    radius: Math.max(0, Math.min(28, Math.round(+raw.radius >= 0 ? +raw.radius : BASE.radius))),
    font: FONTS[raw.font] ? raw.font : 'system',
    ...(raw.glass ? { glass: true } : {}),
    ...(raw.caps ? { caps: true } : {}),
    ...(raw.pages === 'slab' ? { pages: 'slab' } : {}),
    day: side(raw.day, BASE.day), night: side(raw.night, BASE.night),
  };
}

/** Backgrounds for the Frosted glass theme: soft colour fields, made here (no pictures are bundled). The user can also use a photo of their own. */
const mesh = (base, a, b, c) => `radial-gradient(120% 90% at 15% 8%, ${a} 0%, transparent 55%), radial-gradient(90% 80% at 88% 28%, ${b} 0%, transparent 60%), radial-gradient(110% 90% at 50% 105%, ${c} 0%, transparent 70%), ${base}`;
export const WALLPAPERS = {
  indigo: ['Indigo', mesh('#3136d8', '#97a4ff', '#6a48ea', '#1a1cae')],
  sky: ['Sky', mesh('#2f7fe6', '#bfe1ff', '#5aa8ff', '#1557c8')],
  sand: ['Sand', mesh('#b9a48c', '#efe3d2', '#cdb59a', '#8f7a66')],
  rose: ['Rose', mesh('#c8597f', '#ffc2d4', '#f08aa6', '#8e3a76')],
  forest: ['Forest', mesh('#2f8f5b', '#b6ecc4', '#57b77c', '#17603f')],
  graphite: ['Graphite', mesh('#3a3d48', '#8a8f9f', '#565b6b', '#1d1f27')],
  stone: ['Stone', mesh('#4b443b', '#b3a48f', '#75695a', '#1d1a17')],
  dusk: ['Dusk', mesh('#2b2f45', '#b98a6a', '#565a80', '#12131f')],
};
const wallPhotos = { day: '', night: '' };
/** The address of the user's own background photo (kept on the device), or '' for none. One for day, one for night. */
export function setWallPhoto(url, when = 'day') { wallPhotos[when] = url || ''; applied = ''; }
/**
 * The glass look in use (#85): the Day look lives on the device settings themselves
 * (`wallpaper`, `wallColor`, `frost`); `device.night` holds the Night look when the person has
 * made one (`own: true`). Without one, night is the Day look, dimmed.
 */
export const ownNight = () => !!device.night?.own;
const look = (night) => (night && ownNight() ? { ...device.night, when: 'night' } : { wallpaper: device.wallpaper, wallColor: device.wallColor, frost: device.frost, when: 'day' });
const wallpaper = (L, night) => {
  if (L.wallpaper === 'photo' && wallPhotos[L.when]) return `url("${wallPhotos[L.when]}") center / cover no-repeat`;
  if (L.wallpaper === 'color' && HEX.test(L.wallColor || '')) { // a colour of the user's own, given the same soft light and shade
    const c = L.wallColor;
    return mesh(c, `color-mix(in srgb, ${c} 45%, #fff)`, `color-mix(in srgb, ${c} 75%, #fff)`, `color-mix(in srgb, ${c} 62%, #000)`);
  }
  // Nothing chosen: Jack is warm sand by day and dark stone at night (#88); the glass theme is indigo.
  return (WALLPAPERS[L.wallpaper] || (current().id === 'jack' ? (night ? WALLPAPERS.stone : WALLPAPERS.sand) : WALLPAPERS.indigo))[1];
};

const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
const VARS = ['--accent', '--accent-soft', '--on-accent', '--bg', '--panel', '--ink', '--muted', '--line', '--chip', '--radius', 'color-scheme', 'font-family', '--glass', '--glass-btn', '--wtext'];
let applied = '';
/** Themes drawn as clear glass over a background picture. */
export const glassy = (t) => t.id === 'frost' || t.id === 'jack';
/**
 * Put the chosen theme on the page (for day or night, whichever is showing). The Original theme
 * sets nothing at all, so the app looks exactly as designed. Returns the plan's selection look.
 */
export function applyTheme(force = false) {
  const t = current(), night = document.documentElement.classList.contains('night');
  const key = `${t.id}:${night}:${glassy(t) ? JSON.stringify(look(night)) : ''}:${t.builtin ? '' : JSON.stringify(t)}`;
  const sel = t.id === 'original' ? null : t.selection;
  if (key === applied && !force) return sel;
  applied = key;
  const st = document.documentElement.style;
  for (const v of VARS) st.removeProperty(v);
  document.documentElement.classList.toggle('glass', !!t.glass);
  document.documentElement.classList.toggle('frost', glassy(t));
  document.documentElement.classList.toggle('jack', t.id === 'jack');
  document.documentElement.classList.toggle('caps', !!t.caps);
  document.documentElement.dataset.pages = t.pages || '';
  if (t.id === 'original') return sel;
  const m = night ? t.night : t.day, L = look(night), dim = night && !ownNight(); // a Night look of the person's own is shown as they made it
  const set = { '--accent': t.accent, '--accent-soft': `color-mix(in srgb, ${t.accent} 82%, #fff)`, '--on-accent': lum(t.accent) > 0.5 ? '#231a10' : '#ffffff',
    '--bg': m.bg, '--panel': `${m.panel}${t.glass ? 'b8' : 'ee'}`, '--ink': m.ink, '--muted': `color-mix(in srgb, ${m.ink} 62%, ${m.panel})`, '--line': `color-mix(in srgb, ${m.ink} 11%, transparent)`,
    '--chip': `color-mix(in srgb, ${m.panel} 90%, ${m.ink})`, '--radius': `${t.radius}px`, 'color-scheme': lum(m.panel) < 0.45 ? 'dark' : 'light', 'font-family': FONTS[t.font][1] };
  if (glassy(t)) Object.assign(set, { // real glass: nearly clear, over the chosen background (dimmed a little at night)
    '--bg': dim ? `linear-gradient(#00001466, #00001466), ${wallpaper(L, night)}` : wallpaper(L, night), '--panel': 'rgba(255, 255, 255, 0.16)', '--muted': 'rgba(255, 255, 255, 0.74)',
    '--line': 'rgba(255, 255, 255, 0.26)', '--chip': 'rgba(40, 42, 80, 0.36)', '--on-accent': '#1c1c2e', 'color-scheme': 'dark',
    '--glass': String(L.frost?.glass ?? 0.15), '--glass-btn': String(L.frost?.buttons ?? 0.34), '--wtext': String(L.frost?.text ?? 1) });
  if (t.id === 'jack') Object.assign(set, { '--chip': 'rgba(18, 18, 22, 0.42)', '--on-accent': '#1a1a1e', '--accent-soft': '#ffe7ad', '--bg': dim && L.wallpaper ? `linear-gradient(#00000055, #00000055), ${wallpaper(L, night)}` : !night && (!L.wallpaper || L.wallpaper === 'sand') ? `linear-gradient(#2a1f1038, #2a1f1038), ${wallpaper(L, night)}` : wallpaper(L, night) });
  for (const [k, v] of Object.entries(set)) st.setProperty(k, v);
  return sel;
}

const colour = (label, value, onpick) => h('label', {}, h('span', { class: 'colbtn' }, h('input', { type: 'color', value, 'aria-label': label, oninput: (e) => onpick(e.target.value) })), label);

/** Make or change a theme, seeing it on the app as you go. Resolves with the saved theme, or null. */
function editTheme(start, changed) {
  return new Promise((resolve) => {
    const before = device.theme, t = cleanTheme({ ...BASE, ...structuredClone(start) });
    const fresh = !(device.themes || []).some((x) => x.id === t.id);
    const list = () => (device.themes ||= []);
    const preview = () => { const i = list().findIndex((x) => x.id === t.id); if (i >= 0) list()[i] = t; else list().push(t); device.theme = t.id; changed(); };
    const body = h('div', { class: 'menu theme-edit' });
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      if (!keep) { if (fresh) device.themes = list().filter((x) => x.id !== t.id); else list()[list().findIndex((x) => x.id === t.id)] = start; device.theme = before; }
      saveDevice();
      changed();
      close();
      resolve(keep ? t : null);
    };
    const close = modal(body, { onclose: () => finish(false) });
    const name = h('input', { type: 'text', value: t.name, maxlength: 40, oninput: () => (t.name = name.value.trim() || 'My theme') });
    const draw = () => {
      body.replaceChildren(...nodes(
        h('div', { class: 'panel-head' }, h('h2', {}, fresh ? 'New theme' : 'Edit theme'), h('button', { class: 'round small', 'aria-label': 'Close without saving', onclick: () => finish(false) }, icon('close'))),
        h('p', { class: 'hint' }, 'The app changes as you choose, so you can see it. Nothing is kept until you save.'),
        h('label', { class: 'field wide-field' }, h('span', {}, 'Name'), name),
        h('h3', { class: 'pad' }, 'Colours'),
        h('div', { class: 'cols pad' }, colour('Highlight', t.accent, (v) => { t.accent = v; preview(); })),
        h('div', { class: 'cols pad' }, h('b', {}, 'Day'), colour('Background', t.day.bg, (v) => { t.day.bg = v; preview(); }), colour('Panels', t.day.panel, (v) => { t.day.panel = v; preview(); }), colour('Text', t.day.ink, (v) => { t.day.ink = v; preview(); })),
        h('div', { class: 'cols pad' }, h('b', {}, 'Night'), colour('Background', t.night.bg, (v) => { t.night.bg = v; preview(); }), colour('Panels', t.night.panel, (v) => { t.night.panel = v; preview(); }), colour('Text', t.night.ink, (v) => { t.night.ink = v; preview(); })),
        h('h3', { class: 'pad' }, 'A selected area on the plan'),
        h('div', { class: 'cols pad' }, seg(SELECTION_STYLES, t.selection.style, (v) => { t.selection.style = v; preview(); draw(); }), colour('Colour', t.selection.color, (v) => { t.selection.color = v; preview(); })),
        h('h3', { class: 'pad' }, 'Shape and lettering'),
        h('div', { class: 'row pad' }, h('div', { class: 'row-label' }, 'Corners'), seg([[4, 'Square'], [10, 'Soft'], [18, 'Round']], [4, 10, 18].reduce((a, b) => (Math.abs(b - t.radius) < Math.abs(a - t.radius) ? b : a)), (v) => { t.radius = v; preview(); draw(); })),
        h('div', { class: 'row pad' }, h('div', { class: 'row-label' }, 'Lettering'), seg(Object.entries(FONTS).map(([k, f]) => [k, f[0]]), t.font, (v) => { t.font = v; preview(); draw(); })),
        h('label', { class: 'check pad' }, h('input', { type: 'checkbox', checked: !!t.glass, onchange: (e) => { if (e.target.checked) t.glass = true; else delete t.glass; preview(); } }), 'Frosted glass panels'),
        h('div', { class: 'btns pad' },
          h('button', { class: 'wide ghost', onclick: () => finish(false) }, 'Cancel'),
          h('button', { class: 'wide primary', onclick: () => finish(true) }, icon('check'), 'Save theme'))));
    };
    preview();
    draw();
  });
}

/** The Theme part of Settings. `changed` re-applies the theme and redraws; `saveText(name, text)` hands over a file. */
export function themeSettings({ changed, saveText }) {
  const t = current(), custom = !t.builtin;
  const pick = (id) => { device.theme = id; saveDevice(); changed(); };
  const fresh = () => editTheme({ ...BASE, ...structuredClone(t), id: `theme-${Date.now().toString(36)}`, name: t.builtin ? 'My theme' : `${t.name} copy`, builtin: undefined }, changed);
  const load = async () => {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    try {
      const th = cleanTheme(JSON.parse(await file.text()));
      if (themeList().some((x) => x.id === th.id)) th.id = `theme-${Date.now().toString(36)}`;
      (device.themes ||= []).push(th);
      pick(th.id);
    } catch (e) { alert(`Could not load "${file.name}".\n${e.message || 'It is not a Nidorama theme file.'}`); }
  };
  return [
    h('div', { class: 'menu-row' }, icon('star'), h('span', { class: 'grow' }, 'Theme', h('span', { class: 'sub' }, 'colours, corners, lettering and how a selected area looks')),
      h('select', { 'aria-label': 'Theme', onchange: (e) => pick(e.target.value) }, themeList().map((x) => h('option', { value: x.id, selected: x.id === t.id }, x.name)))),
    h('div', { class: 'btns pad' },
      h('button', { class: 'wide ghost', onclick: fresh }, icon('plus'), 'New theme'),
      custom ? h('button', { class: 'wide ghost', onclick: () => editTheme(t, changed) }, icon('edit'), 'Edit') : null,
      h('button', { class: 'wide ghost', onclick: load }, icon('file'), 'Load file')),
    t.id !== 'original' ? h('div', { class: 'btns pad' },
      h('button', { class: 'wide ghost', onclick: () => saveText(`${t.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'theme'}.nidorama-theme.json`, JSON.stringify({ schema: 'nidorama.theme/1', ...cleanTheme({ ...BASE, ...t }) }, null, 1)) }, icon('file'), 'Save as a file'),
      custom ? h('button', { class: 'wide ghost danger', onclick: () => { if (confirm(`Delete the theme "${t.name}"?`)) { device.themes = device.themes.filter((x) => x.id !== t.id); pick('original'); } } }, icon('trash'), 'Delete') : null) : null,
  ];
}
