// Shared UI pieces: DOM helper, icons, entity controls and the entity picker.
import { isOn, brightnessPct, isDimmable, domainOf } from './ha.js';

/** Shared app state the UI modules need (set by main.js). */
export const app = { conn: null };

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(3)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}

/** Flatten nested lists of nodes and drop empty entries, for DOM calls that don't (append, replaceChildren). */
export const nodes = (...kids) => kids.flat(3).filter((k) => k != null && k !== false);

const ICON = {
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  ha: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><circle cx="12" cy="14.5" r="1.6"/><path d="M12 16v4M9.5 12.5 12 14.5l2.5-2"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>', down: '<path d="m6 9 6 6 6-6"/>', up: '<path d="m6 15 6-6 6 6"/>', left: '<path d="m15 6-6 6 6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>', plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  power: '<path d="M12 3v9"/><path d="M6.3 7.3a8 8 0 1 0 11.4 0"/>',
  auto: '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>',
  flame: '<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 0 2 1 3 2 3 0-3-1-5.5.5-8z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  fan: '<circle cx="12" cy="12" r="1.5"/><path d="M12 10.5C12 6 14 4 16 5s1 4-4 5.5M13.5 12c4.5 0 6.5 2 5.5 4s-4 1-5.5-4M12 13.5c0 4.5-2 6.5-4 5.5s-1-4 4-5.5M10.5 12C6 12 4 10 5 8s4-1 5.5 4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/>', update: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/>', plan: '<path d="M4 4h16v16H4zM4 12h8M12 4v10M12 18v2M16 12h4"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  undo: '<path d="M9 7 4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 0 12"/>', redo: '<path d="m15 7 5 5-5 5"/><path d="M20 12H10a6 6 0 0 0 0 12"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>', rotateL: '<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v5h5"/>',
  cursor: '<path d="M6 3l12 9-5 1 3 6-2 1-3-6-4 3z"/>', wall: '<path d="M3 17 17 3l4 4L7 21z"/>', room: '<path d="M4 4h16v16H4z" stroke-dasharray="3 2.5"/>',
  door: '<path d="M6 21V4h9v17M4 21h16M12.5 12.5h.01"/>', window: '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M12 5v14M4 12h16"/>',
  sofa: '<path d="M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3"/><path d="M3 12a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v5H3zM6 17v2M18 17v2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9 6.600 19.800l1.100-6.100L3.200 9.400l6.100-.8z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>', file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  check: '<path d="m5 12 5 5 9-10"/>', thermo: '<path d="M10 13.500V5a2 2 0 0 1 4 0v8.500a4 4 0 1 1-4 0z"/>', play: '<path d="M7 4v16l13-8z"/>',
  blind: '<path d="M4 4h16M6 4v14h12V4M6 9h12M6 13h12M12 18v3"/>',
  snow: '<path d="M12 2v20M4 6l16 12M20 6 4 18M9 4l3 3 3-3M9 20l3-3 3 3"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  car: '<path d="M4 16v-4l2-5h12l2 5v4M4 16h16M6 16v2M18 16v2M4 12h16"/>',
  water: '<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z"/>',
  plug: '<path d="M9 3v5M15 3v5M7 8h10v4a5 5 0 0 1-10 0zM12 17v4"/>',
  moon: '<path d="M20 14.500A8 8 0 1 1 9.500 4a6.500 6.500 0 0 0 10.500 10.500z"/>',
  leaf: '<path d="M5 19c0-9 5-14 15-14 0 10-5 15-14 15M5 19l8-8"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3 3.6M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.4 9.4a2.7 2.7 0 1 1 3.9 2.4c-.8.5-1.3 1-1.3 2"/><path d="M12 17v.2"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.5"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.5-7.970A5.500 5.500 0 0 1 17 9.500a4.250 4.250 0 0 1 .5 8.500z"/>',
  rain: '<path d="M7 15a4 4 0 0 1-.5-7.970A5.500 5.500 0 0 1 17 6.500a4.250 4.250 0 0 1 .5 8.500z"/><path d="M8 18.500l-1 2.500M12 18.500l-1 2.500M16 18.500l-1 2.500"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.500 2"/>',
  swipe: '<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 11.500V6a1.5 1.5 0 0 1 3 0v8.500a6 6 0 0 1-6 6h-.5a6 6 0 0 1-5-2.700L3.700 15a1.600 1.600 0 0 1 2.600-1.900L8 15"/>',
  orbit: '<ellipse cx="12" cy="12" rx="9.500" ry="4"/><circle cx="12" cy="12" r="2"/><path d="m18.500 6.500 2.200 2.400-3.100.4"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2.2 5.3-5.3 2.2 2.2-5.3z"/>',
  cube: '<path d="m12 3 8 4.500v9L12 21l-8-4.500v-9z"/><path d="m4 7.500 8 4.500 8-4.500M12 12v9"/>', expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
};
export const ICON_CHOICES = ['bulb', 'flame', 'fan', 'snow', 'thermo', 'blind', 'tv', 'music', 'lock', 'car', 'water', 'plug', 'moon', 'sun', 'leaf', 'bell', 'camera', 'play', 'auto', 'power', 'star', 'home'];
export const icon = (name) => h('span', { class: 'ico', html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[name] || ICON.bulb}</svg>` });

// ---------- entity helpers ----------
export const st = (id) => (id ? app.conn?.states.get(id) : undefined);
export const entityName = (id) => st(id)?.attributes?.friendly_name || id?.split('.')[1]?.replace(/_/g, ' ') || '';
export function iconFor(entity) {
  const d = domainOf(entity || '');
  if (d === 'fan' || /fan/.test(entity)) return 'fan';
  if (/air_?con|\bac_|cool/.test(entity)) return 'snow';
  if (d === 'climate' || /heat/.test(entity)) return 'flame';
  if (d === 'media_player') return /tv/.test(entity) ? 'tv' : 'music';
  if (d === 'lock') return 'lock';
  if (d === 'cover') return 'blind';
  if (d === 'scene' || d === 'script' || d === 'automation') return 'play';
  if (d === 'weather') return 'cloud';
  if (d === 'camera') return 'camera';
  if (d === 'sensor' || d === 'binary_sensor') return 'thermo';
  return 'bulb';
}
export function toggle(entity) {
  if (!entity) return;
  const d = domainOf(entity);
  if (d === 'script' || d === 'scene') return app.conn.call(d, 'turn_on', {}, entity);
  if (d === 'sensor' || d === 'binary_sensor') return;
  if (d === 'climate') return app.conn.call('climate', 'set_hvac_mode', { hvac_mode: st(entity)?.state === 'off' ? 'heat' : 'off' }, entity);
  return app.conn.call(['light', 'switch', 'fan', 'input_boolean', 'cover', 'automation', 'media_player'].includes(d) ? d : 'homeassistant', 'toggle', {}, entity);
}
export function setBrightness(entities, pct) {
  const ids = [].concat(entities).filter((e) => e && domainOf(e) === 'light');
  if (!ids.length) return;
  if (pct <= 0) app.conn.call('light', 'turn_off', {}, ids);
  else app.conn.call('light', 'turn_on', { brightness_pct: Math.round(pct) }, ids);
}
/** Is a climate device heating or cooling just now? 'heat', 'cool' or '' — used to colour it red-orange or blue (#65). */
export function climateTone(entity) {
  const s = st(entity);
  if (!s || domainOf(entity || '') !== 'climate' || s.state === 'off' || s.state === 'unavailable') return '';
  const a = s.attributes || {};
  if (a.hvac_action === 'heating' || s.state === 'heat') return 'heat';
  if (a.hvac_action === 'cooling' || s.state === 'cool') return 'cool';
  if (s.state === 'heat_cool' || s.state === 'auto') return a.current_temperature != null && a.temperature != null && a.current_temperature > a.temperature ? 'cool' : 'heat';
  return '';
}
const toneClass = (entity) => { const t = climateTone(entity); return t ? ` tone-${t}` : ''; };
export { toneClass };
export function stateText(entity) {
  const s = st(entity);
  if (!entity) return 'no entity connected';
  if (!s) return app.conn?.demo ? '' : 'not in Home Assistant';
  if (s.state === 'unavailable') return 'unavailable';
  const d = domainOf(entity);
  if (d === 'sensor') return `${s.state}${s.attributes?.unit_of_measurement ? ' ' + s.attributes.unit_of_measurement : ''}`;
  if (d === 'climate') return `${s.attributes?.current_temperature ?? '–'}° · set ${s.attributes?.temperature ?? '–'}°${s.state === 'off' ? ' · off' : ''}`;
  if (d === 'scene' || d === 'script') return 'Run';
  if (d === 'cover') return s.state === 'open' ? 'Open' : 'Closed';
  const b = brightnessPct(s);
  return isOn(s) ? (d === 'light' && b < 100 ? `On · ${b}%` : 'On') : 'Off';
}

// ---------- controls ----------
export const sliding = { active: false };
export function toggleBtn(entity, label) {
  const s = st(entity), on = isOn(s);
  const missing = !entity || (!app.conn.demo && !s);
  return h('button', {
    class: 'tog' + (on ? ' on' : '') + (missing ? ' missing' : ''), 'aria-label': label, 'aria-pressed': on ? 'true' : 'false',
    title: missing ? `${entity || 'No entity'} — not in Home Assistant` : entity, onclick: (e) => { e.stopPropagation(); if (!missing) toggle(entity); },
  }, icon(iconFor(entity)));
}
export function slider(value, oninput, label, onDone) {
  const el = h('input', { type: 'range', min: 0, max: 100, step: 1, value, 'aria-label': label });
  const done = () => { sliding.active = false; setTimeout(() => onDone?.(), 400); };
  el.addEventListener('pointerdown', (e) => { sliding.active = true; e.stopPropagation(); });
  el.addEventListener('pointerup', done);
  el.addEventListener('pointercancel', done);
  el.addEventListener('input', () => oninput(+el.value, false));
  el.addEventListener('change', () => { oninput(+el.value, true); done(); });
  return el;
}
export const throttled = () => { let t = 0; return (fn, final) => { const n = performance.now(); if (final || n - t > 250) { t = n; fn(); } }; };
export function row(label, sub, ...right) {
  return h('div', { class: 'row' }, h('div', { class: 'row-label' }, h('div', {}, label), sub ? h('div', { class: 'sub' }, sub) : null), ...right);
}
export function menuItem(ic, label, sub, onclick, extra) {
  return h('button', { class: 'menu-item', onclick, disabled: !onclick }, icon(ic), h('span', { class: 'grow' }, label, sub ? h('span', { class: 'sub' }, sub) : null), extra);
}
export function seg(options, value, onpick) {
  return h('div', { class: 'seg' }, options.map(([v, label]) => h('button', { class: v === value ? 'on' : '', onclick: () => onpick(v) }, label)));
}
/** Labelled number field (metres etc.). Commits on change. */
export function numField(label, value, onchange, { step = 0.05, min = -1000, max = 1000, unit = 'm' } = {}) {
  const input = h('input', { type: 'number', step, min, max, value: Number.isFinite(value) ? +(+value).toFixed(3) : '', inputmode: 'decimal' });
  input.addEventListener('change', () => { const v = parseFloat(input.value); if (Number.isFinite(v)) onchange(Math.max(min, Math.min(max, v))); });
  return h('label', { class: 'field' }, h('span', {}, label), h('span', { class: 'field-in' }, input, unit ? h('em', {}, unit) : null));
}
export function textField(label, value, onchange, attrs = {}) {
  const input = h('input', { type: 'text', value: value || '', ...attrs });
  input.addEventListener('change', () => onchange(input.value.trim()));
  return h('label', { class: 'field wide-field' }, h('span', {}, label), input);
}
export function selectField(label, value, options, onchange) {
  const sel = h('select', { onchange: (e) => onchange(e.target.value) }, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
  return h('label', { class: 'field wide-field' }, h('span', {}, label), sel);
}

/** A short message at the bottom of the screen that goes away by itself. */
export function toast(text) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast', role: 'status' }, text);
  document.getElementById('app').append(el);
  setTimeout(() => el.remove(), 3200);
}

/** Ask the user to choose an icon. Resolves with a name, '' (use the suggested one) or null (cancelled). */
export function pickIcon({ current = '', suggested = 'bulb' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; close(); resolve(v); };
    const close = modal(h('div', { class: 'menu' },
      h('div', { class: 'panel-head' }, h('h2', {}, 'Choose an icon'), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => finish(null) }, icon('close'))),
      h('div', { class: 'icon-grid' }, ICON_CHOICES.map((n) => h('button', { class: 'round' + (n === (current || suggested) ? ' picked' : ''), 'aria-label': `Icon ${n}`, onclick: () => finish(n) }, icon(n)))),
      h('button', { class: 'wide ghost', onclick: () => finish('') }, icon(suggested), 'Use the suggested icon')), { onclose: () => finish(null) });
  });
}
/** The icon for a control item or button: the user's choice, else suggested from its entity. */
export const iconOf = (item) => item.icon || (item.type === 'all-lights-off' ? 'power' : iconFor(item.entity));

/** Ask for a file. `capture` opens the camera directly where the device supports it. Resolves with a File or null. */
export function pickFile(accept, capture = false) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, class: 'hidden', capture: capture ? 'environment' : null });
    input.addEventListener('change', () => { resolve(input.files?.[0] || null); input.remove(); });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

// ---------- modal + entity picker ----------
export function modal(content, { onclose } = {}) {
  const close = () => { wrap.remove(); onclose?.(); };
  const wrap = h('div', { class: 'modal-wrap', onclick: (e) => { if (e.target === wrap) close(); } }, h('div', { class: 'modal' }, content));
  document.getElementById('app').append(wrap);
  return close;
}

/** Ask the user to choose a Home Assistant entity. Resolves with an id, '' (cleared) or null (cancelled). */
export function pickEntity({ title = 'Connect an entity', domains = null, current = '' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; close(); resolve(v); };
    const search = h('input', { type: 'search', placeholder: 'Search, or type an entity id', value: '', autocomplete: 'off' });
    const list = h('div', { class: 'picker-list' });
    const render = () => {
      const q = search.value.trim().toLowerCase();
      const all = [...(app.conn?.states.values() || [])].filter((s) => !domains || domains.includes(domainOf(s.entity_id)));
      const hits = all.filter((s) => !q || s.entity_id.includes(q) || (s.attributes?.friendly_name || '').toLowerCase().includes(q))
        .sort((a, b) => a.entity_id.localeCompare(b.entity_id)).slice(0, 80);
      list.replaceChildren(...nodes(
        hits.map((s) => h('button', { class: 'menu-item' + (s.entity_id === current ? ' sel' : ''), onclick: () => finish(s.entity_id) },
          icon(iconFor(s.entity_id)), h('span', { class: 'grow' }, h('span', { class: 'pick-name' }, s.attributes?.friendly_name || s.entity_id), h('span', { class: 'sub pick-id' }, s.entity_id.replace(/([._])/g, '$1\u200b'))))),
        /^[a-z_]+\.[a-z0-9_]+$/.test(q) && !all.some((s) => s.entity_id === q) ? h('button', { class: 'menu-item', onclick: () => finish(q) }, icon('plus'), h('span', { class: 'grow' }, `Use "${q}"`, h('span', { class: 'sub' }, 'not in Home Assistant yet'))) : null,
        !hits.length && !q ? h('p', { class: 'hint' }, 'No entities yet. Connect to Home Assistant in Settings, or type an entity id.') : null,
      ));
    };
    search.addEventListener('input', render);
    const close = modal(h('div', { class: 'menu picker' },
      h('div', { class: 'panel-head' }, h('h2', {}, title), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => finish(null) }, icon('close'))),
      search, list,
      current ? h('button', { class: 'wide ghost', onclick: () => finish('') }, icon('trash'), 'Disconnect') : null), { onclose: () => finish(null) });
    render();
    setTimeout(() => search.focus(), 50);
  });
}

/** A row that shows a connected entity and lets the user change it. */
export function entityField(label, value, onchange, domains, emptyText = 'Not connected') {
  return h('button', { class: 'entity-field', onclick: async () => { const v = await pickEntity({ title: label, current: value, domains }); if (v != null) onchange(v); } },
    icon('link'), h('span', { class: 'grow' }, label, h('span', { class: 'sub' }, value || emptyText)), icon('chevron'));
}

export { isOn, brightnessPct, isDimmable, domainOf };
