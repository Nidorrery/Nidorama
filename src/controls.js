// Controls: one model and one editor for every button the user arranges — tiles on a dashboard
// and rows in a room's panel. A control points at an entity and carries how the user wants it
// shown; the app then offers the controls that are natural for that kind of device (brightness for
// a light, speeds for a fan, temperature and modes for heating and cooling, position for a blind…).
//
//   { id, entity, name?, icon?, size?: 'small' | 'wide' | 'large', color?, opacity?,
//     tap?: 'toggle' | 'details', features?: { <key>: false }, subs?: [{ id, entity, name?, icon? }] }
import { h, nodes, icon, st, toggle, stateText, iconOf, pickIcon, pickEntity, entityName, slider, throttled, seg, modal, isOn, isDimmable, brightnessPct, domainOf, setBrightness, sliding, app, toneClass, toast } from './ui.js';
import { uid } from './catalog.js';
import { runSteps, stepsEditor } from './steps.js';
import { openWidget } from './widgetviews.js';

export const newControl = (entity, name = '') => ({ id: uid('c'), entity, name });
const call = (ent, service, data = {}) => app.conn.call(domainOf(ent), service, data, ent);
const label = (c) => c.name || entityName(c.entity) || 'Button';

/** A sub-button with no entity of its own in the system falls back to its parent's (a lamp without its own switch follows the group). */
export const effective = (sub, parent) => (!sub.entity || (!app.conn?.demo && !st(sub.entity) && parent?.entity && st(parent.entity)) ? parent?.entity || sub.entity : sub.entity);

/** The native controls an entity can offer: [{ key, label }]. Decided from what the device reports, else from its kind. */
export function featuresFor(entity) {
  const s = st(entity), a = s?.attributes || {}, d = domainOf(entity || ''), out = [];
  const modes = a.supported_color_modes || [];
  if (d === 'light') {
    if (!s || isDimmable(s)) out.push({ key: 'brightness', label: 'Brightness' });
    if (modes.includes('color_temp')) out.push({ key: 'colorTemp', label: 'Warm / cool white' });
    if (modes.some((m) => ['hs', 'rgb', 'xy', 'rgbw', 'rgbww'].includes(m))) out.push({ key: 'color', label: 'Colour' });
  } else if (d === 'fan') {
    if (!s || a.percentage != null || a.percentage_step) out.push({ key: 'speed', label: 'Speed' });
    if (a.oscillating != null) out.push({ key: 'oscillate', label: 'Oscillate' });
    if (a.direction != null) out.push({ key: 'direction', label: 'Direction' });
  } else if (d === 'climate') {
    out.push({ key: 'temperature', label: 'Temperature' });
    if (!s || (a.hvac_modes || []).length > 1) out.push({ key: 'modes', label: 'Modes (heat, cool…)' });
    if ((a.fan_modes || []).length) out.push({ key: 'fanMode', label: 'Fan setting' });
  } else if (d === 'cover') {
    out.push({ key: 'buttons', label: 'Open / stop / close' });
    if (!s || a.current_position != null) out.push({ key: 'position', label: 'Position' });
    if (a.current_tilt_position != null) out.push({ key: 'tilt', label: 'Tilt' });
  } else if (d === 'media_player') {
    out.push({ key: 'transport', label: 'Play / pause' });
    if (!s || a.volume_level != null) out.push({ key: 'volume', label: 'Volume' });
    if ((a.source_list || []).length) out.push({ key: 'source', label: 'Source' });
  }
  return out;
}
const has = (c, key) => c.features?.[key] !== false && featuresFor(c.entity).some((f) => f.key === key);

const chip = (text, on, onclick, aria) => h('button', { class: 'chip small' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', 'aria-label': aria || text, onclick: (e) => { e.stopPropagation(); onclick(); } }, text);
const labelled = (text, node) => h('div', { class: 'nat' }, h('span', { class: 'nat-label' }, text), node);
const stop = (el) => { for (const ev of ['pointerdown', 'pointerup', 'click']) el.addEventListener(ev, (e) => e.stopPropagation()); return el; };

/** The live controls for one entity, as the user has them switched on. `onPreview(entity, pct)` lets the plan glow follow a slider. */
export function nativeControls(c, { onPreview, done } = {}) {
  const ent = c.entity, s = st(ent), a = s?.attributes || {}, d = domainOf(ent || ''), out = [], t = throttled();
  if (d === 'light') {
    if (has(c, 'brightness')) out.push(labelled('Brightness', slider(brightnessPct(s), (v, fin) => { onPreview?.(ent, v); t(() => setBrightness(ent, v), fin); }, `${label(c)} brightness`, done)));
    if (has(c, 'colorTemp')) {
      const lo = a.min_color_temp_kelvin || 2000, hi = a.max_color_temp_kelvin || 6500, cur = a.color_temp_kelvin || lo;
      const el = slider(((cur - lo) / (hi - lo)) * 100, (v, fin) => t(() => call(ent, 'turn_on', { color_temp_kelvin: Math.round(lo + (v / 100) * (hi - lo)) }), fin), `${label(c)} warm to cool`, done);
      el.classList.add('temp');
      out.push(labelled('Warm / cool', el));
    }
    if (has(c, 'color')) {
      const el = slider(((a.hs_color?.[0] ?? 30) / 360) * 100, (v, fin) => t(() => call(ent, 'turn_on', { hs_color: [Math.round((v / 100) * 360), 100] }), fin), `${label(c)} colour`, done);
      el.classList.add('hue');
      out.push(labelled('Colour', el));
    }
  } else if (d === 'fan') {
    if (has(c, 'speed')) {
      const step = a.percentage_step || 0, pct = isOn(s) ? a.percentage ?? 100 : 0;
      if (step >= 20) { // a few fixed speeds: offer them as buttons
        const n = Math.round(100 / step);
        out.push(labelled('Speed', h('div', { class: 'chips' }, chip('Off', pct === 0, () => call(ent, 'turn_off'), `${label(c)} off`),
          Array.from({ length: n }, (_, i) => chip(String(i + 1), Math.round(pct / step) === i + 1, () => call(ent, 'set_percentage', { percentage: Math.round((i + 1) * step) }), `${label(c)} speed ${i + 1}`)))));
      } else out.push(labelled('Speed', slider(pct, (v, fin) => t(() => call(ent, 'set_percentage', { percentage: Math.round(v) }), fin), `${label(c)} speed`, done)));
    }
    const extra = [];
    if (has(c, 'oscillate')) extra.push(chip('Oscillate', !!a.oscillating, () => call(ent, 'oscillate', { oscillating: !a.oscillating })));
    if (has(c, 'direction')) extra.push(chip(a.direction === 'reverse' ? 'Reverse' : 'Forward', a.direction === 'reverse', () => call(ent, 'set_direction', { direction: a.direction === 'reverse' ? 'forward' : 'reverse' }), `${label(c)} direction`));
    if (extra.length) out.push(h('div', { class: 'chips' }, extra));
  } else if (d === 'climate') {
    if (has(c, 'temperature')) {
      const step = a.target_temp_step || 0.5;
      const set = (dir) => (e) => { e.stopPropagation(); call(ent, 'set_temperature', { temperature: Math.min(a.max_temp ?? 30, Math.max(a.min_temp ?? 5, (a.temperature ?? 20) + dir * step)) }); };
      out.push(h('div', { class: 'nat temp-row' }, h('span', { class: 'nat-label' }, `Now ${a.current_temperature ?? '–'}°`),
        h('button', { class: 'round small', 'aria-label': `${label(c)} cooler`, onclick: set(-1), disabled: !s }, '−'),
        h('span', { class: 'set' }, `${a.temperature ?? '–'}°`),
        h('button', { class: 'round small', 'aria-label': `${label(c)} warmer`, onclick: set(1), disabled: !s }, '+')));
    }
    if (has(c, 'modes')) out.push(h('div', { class: 'chips' }, (a.hvac_modes || ['off', 'heat']).map((m) => chip(m.replace('_', ' / '), s?.state === m, () => call(ent, 'set_hvac_mode', { hvac_mode: m }), `${label(c)} mode ${m}`))));
    if (has(c, 'fanMode')) out.push(labelled('Fan', stop(h('select', { 'aria-label': `${label(c)} fan setting`, onchange: (e) => call(ent, 'set_fan_mode', { fan_mode: e.target.value }) }, a.fan_modes.map((m) => h('option', { value: m, selected: m === a.fan_mode }, m))))));
  } else if (d === 'cover') {
    if (has(c, 'buttons')) out.push(h('div', { class: 'chips' }, chip('Open', false, () => call(ent, 'open_cover'), `${label(c)} open`), chip('Stop', false, () => call(ent, 'stop_cover'), `${label(c)} stop`), chip('Close', false, () => call(ent, 'close_cover'), `${label(c)} close`)));
    if (has(c, 'position')) out.push(labelled('Position', slider(a.current_position ?? (isOn(s) ? 100 : 0), (v, fin) => { if (fin) call(ent, 'set_cover_position', { position: Math.round(v) }); }, `${label(c)} position`, done)));
    if (has(c, 'tilt')) out.push(labelled('Tilt', slider(a.current_tilt_position ?? 0, (v, fin) => { if (fin) call(ent, 'set_cover_tilt_position', { tilt_position: Math.round(v) }); }, `${label(c)} tilt`, done)));
  } else if (d === 'media_player') {
    if (has(c, 'transport')) out.push(h('div', { class: 'chips' }, chip(s?.state === 'playing' ? 'Pause' : 'Play', s?.state === 'playing', () => call(ent, 'media_play_pause'), `${label(c)} play or pause`)));
    if (has(c, 'volume')) out.push(labelled('Volume', slider((a.volume_level ?? 0) * 100, (v, fin) => t(() => call(ent, 'volume_set', { volume_level: +(v / 100).toFixed(2) }), fin), `${label(c)} volume`, done)));
    if (has(c, 'source')) out.push(labelled('Source', stop(h('select', { 'aria-label': `${label(c)} source`, onchange: (e) => call(ent, 'select_source', { source: e.target.value }) }, a.source_list.map((m) => h('option', { value: m, selected: m === a.source }, m))))));
  } else if (d === 'lock') {
    out.push(h('div', { class: 'chips' }, chip('Lock', s?.state === 'locked', () => call(ent, 'lock')), chip('Unlock', s?.state === 'unlocked', () => call(ent, 'unlock'))));
  }
  return out;
}

/** Tap = toggle (or open details), hold = details. Never fires while a slider inside is being dragged. */
function press(el, c, opts) {
  let timer, held = false;
  el.addEventListener('pointerdown', () => { held = false; timer = setTimeout(() => { held = true; navigator.vibrate?.(15); details(c, opts); }, 450); });
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerup', () => { cancel(); if (!held && !sliding.active) (c.tap === 'steps' ? runSteps(c.id, c.steps, c.entity) : c.tap === 'details' ? details(c, opts) : toggle(c.entity)); });
}
const tint = (c) => (c.color ? `--c:${c.color};` : '') + (c.opacity != null && c.opacity < 1 ? `--o:${c.opacity};` : '');

function subButton(sub, parent, opts) {
  const ent = effective(sub, parent), view = { ...sub, entity: ent };
  const el = h('button', { class: 'subbtn' + (isOn(st(ent)) ? ' on' : ''), 'aria-label': label(sub), title: label(sub) }, icon(iconOf(view)));
  if (opts.editing) return el;
  stop(el);
  let timer, held = false;
  el.addEventListener('pointerdown', () => { held = false; timer = setTimeout(() => { held = true; details(view, opts); }, 450); });
  el.addEventListener('pointerup', () => { clearTimeout(timer); if (!held) toggle(ent); });
  return el;
}

/** A dashboard tile. Small = icon, name, state. Wide and large also carry the native controls and sub-buttons. */
/** A tile's size in grid cells. Older files used named sizes. */
export const tileSize = (c) => ({ w: c.w || (c.size === 'wide' || c.size === 'large' ? 2 : 1), h: c.h || (c.size === 'large' ? 2 : 1) });
// ---------- widgets that are more than a switch (#71): weather, a camera, a clock, a reading, a room, all lights off ----------
export const WIDGET_KINDS = { weather: 'Weather', camera: 'Camera', sensor: 'Reading', clock: 'Clock', room: 'Room', alloff: 'All lights off', thermostat: 'Thermostat', calendar: 'Calendar', music: 'Music', announce: 'Announce' };
const SVGNS = 'http://www.w3.org/2000/svg';
const WEATHER_ICON = { sunny: 'sun', 'clear-night': 'moon', rainy: 'rain', pouring: 'rain', lightning: 'rain', 'lightning-rainy': 'rain', snowy: 'snow', 'snowy-rainy': 'snow', hail: 'snow', windy: 'leaf', 'windy-variant': 'leaf' };
const camImgs = new Map(); // widget id → its <img>, kept between redraws so the picture never blinks
/** A camera's picture, refreshed every few seconds for as long as it is on screen. */
export function cameraImage(id, entity, every = 3000) {
  let img = camImgs.get(id);
  if (img && img.dataset.entity === entity) return img;
  img = h('img', { class: 'cam', alt: '', 'data-entity': entity });
  camImgs.set(id, img);
  let misses = 0;
  const load = () => {
    const url = app.cameraUrl?.(entity);
    if (!url) { img.classList.add('none'); return; }
    const next = new Image();
    next.onload = () => { img.src = next.src; img.classList.remove('none'); };
    next.onerror = () => img.classList.add('none');
    next.src = url;
  };
  load();
  const timer = setInterval(() => {
    if (!img.isConnected) { if (++misses > 2) { clearInterval(timer); if (camImgs.get(id) === img) camImgs.delete(id); } return; }
    misses = 0;
    if (document.visibilityState === 'visible') load();
  }, every);
  return img;
}
function widgetTile(c, opts) {
  const { w, h: ht } = tileSize(c), big = w > 1 || ht > 1, s = st(c.entity), a = s?.attributes || {};
  const make = (cls, kids, on = false) => h('div', { class: `tile widget w-${cls}` + (big ? ' big' : '') + (on ? ' on' : '') + (opts.editing ? ' editing' : '') + (c.color ? ' tinted' : ''), 'data-w': w,
    style: tint(c) + `grid-column:span ${w};grid-row:span ${ht};`, role: 'button', tabindex: 0, 'aria-label': label(c) }, kids);
  let el, tap = null;
  if (c.kind === 'clock' && c.face === 'analog') {
    // A clock face: twelve marks and two hands.
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('class', 'face');
    const line = (cls, x1, y1, x2, y2) => { const l = document.createElementNS(SVGNS, 'line'); for (const [k, v] of Object.entries({ class: cls, x1, y1, x2, y2 })) l.setAttribute(k, v); svg.append(l); return l; };
    for (let i = 0; i < 12; i++) { const r = (i * Math.PI) / 6; line(i % 3 ? 'tick' : 'tick strong', 50 + Math.sin(r) * 40, 50 - Math.cos(r) * 40, 50 + Math.sin(r) * 46, 50 - Math.cos(r) * 46); }
    const hour = line('hand hour', 50, 50, 50, 26), min = line('hand', 50, 50, 50, 12);
    const tick = () => { const d = new Date(), m = d.getMinutes() + d.getSeconds() / 60, hh = (d.getHours() % 12) + m / 60; hour.setAttribute('transform', `rotate(${hh * 30} 50 50)`); min.setAttribute('transform', `rotate(${m * 6} 50 50)`); };
    tick();
    el = make('clock analog', [svg]);
    const timer = setInterval(() => (el.isConnected ? tick() : clearInterval(timer)), 15000);
  } else if (c.kind === 'thermostat') {
    const step = a.target_temp_step || 0.5, stopEv = (e) => e.stopPropagation();
    const set = (dir) => (e) => { e.stopPropagation(); if (s) call(c.entity, 'set_temperature', { temperature: Math.min(a.max_temp ?? 30, Math.max(a.min_temp ?? 5, (a.temperature ?? 20) + dir * step)) }); };
    const arrow = (dir, ic, text) => { const b = h('button', { class: 'thermo-btn', 'aria-label': `${label(c)} ${text}`, onclick: set(dir) }, icon(ic)); b.addEventListener('pointerdown', stopEv); return b; };
    el = make('thermo' + toneClass(c.entity), [
      h('div', { class: 'w-huge' }, a.temperature != null ? String(Math.round(a.temperature * 2) / 2) : s && a.current_temperature != null ? String(Math.round(a.current_temperature)) : '–'),
      h('div', { class: 'thermo-row' }, arrow(-1, 'down', 'cooler'),
        h('div', { class: 'thermo-name' }, h('b', {}, label(c)), h('span', { class: 'tile-state' }, s ? `${s.state === 'off' ? 'Off' : s.state.replace('_', ' / ')}${a.current_temperature != null ? ` · now ${a.current_temperature}°` : ''}` : 'not found')),
        arrow(1, 'up', 'warmer'))], !!s && s.state !== 'off');
    tap = () => details(c, opts);
  } else if (c.kind === 'calendar') {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth(), first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
    const next = a.message ? `${a.message}${a.start_time ? ` · ${new Date(a.start_time.replace(' ', 'T')).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}` : '';
    el = make('calendar', big ? [
      h('div', { class: 'cal-head' }, h('b', {}, now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))),
      h('div', { class: 'cal-grid' }, ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => h('span', { class: 'cal-dow' }, d)), Array.from({ length: first }, () => h('span', {})),
        Array.from({ length: days }, (_, i) => h('span', { class: i + 1 === now.getDate() ? 'today' : '' }, String(i + 1)))),
      c.entity ? h('div', { class: 'tile-state cal-next' }, next || (s ? 'Nothing coming up' : 'Calendar not found')) : null,
    ] : [h('div', { class: 'tile-state' }, now.toLocaleDateString(undefined, { weekday: 'long' })), h('div', { class: 'w-big' }, String(now.getDate())), h('div', { class: 'tile-state cal-next' }, next || now.toLocaleDateString(undefined, { month: 'long' }))]);
  } else if (c.kind === 'music') {
    const art = app.artUrl?.(c.entity), playing = s?.state === 'playing', stopEv = (e) => e.stopPropagation();
    const btn = (ic, text, service) => { const b = h('button', { class: 'music-btn', 'aria-label': `${label(c)}: ${text}`, disabled: !s, onclick: (e) => { e.stopPropagation(); call(c.entity, service); } }, icon(ic)); b.addEventListener('pointerdown', stopEv); return b; };
    el = make('music' + (art ? ' has-art' : ''), [
      art ? h('img', { class: 'art', src: art, alt: '' }) : h('div', { class: 'tile-top' }, icon('music')),
      h('div', { class: 'music-info' }, h('div', { class: 'tile-name' }, a.media_title || label(c)), h('div', { class: 'tile-state' }, a.media_artist || (s ? (playing ? 'Playing' : s.state === 'paused' ? 'Paused' : 'Nothing playing') : 'not found'))),
      h('div', { class: 'music-row' }, btn('left', 'previous', 'media_previous_track'), btn(playing ? 'pause' : 'play', playing ? 'pause' : 'play', 'media_play_pause'), btn('chevron', 'next', 'media_next_track'))], playing);
    tap = () => details(c, opts);
  } else if (c.kind === 'announce') {
    el = make('announce', [h('div', { class: 'tile-top' }, icon(c.icon || 'bell')), h('div', { class: 'tile-name' }, c.name || 'Announce'), h('div', { class: 'tile-state' }, st(c.entity)?.attributes?.friendly_name || entityName(c.entity) || 'choose a speaker')]);
    tap = () => { // typed, then spoken by the home system's text-to-speech on that speaker
      const tts = [...(app.conn?.states.values() || [])].find((x) => x.entity_id.startsWith('tts.'));
      if (!tts) return toast('This needs text-to-speech set up in Home Assistant (a tts entity).');
      const text = prompt(`What should ${st(c.entity)?.attributes?.friendly_name || 'the speaker'} say?`, '');
      if (text && text.trim()) { app.conn.call('tts', 'speak', { media_player_entity_id: c.entity, message: text.trim() }, tts.entity_id); toast('Announcing…'); }
    };
  } else if (c.kind === 'clock') {
    const time = h('div', { class: 'w-big' }), date = h('div', { class: 'tile-state' });
    const tick = () => { const d = new Date(); time.textContent = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); date.textContent = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }); };
    tick();
    el = make('clock', [time, date]);
    const timer = setInterval(() => (el.isConnected ? tick() : clearInterval(timer)), 15000);
  } else if (c.kind === 'weather') {
    const unit = a.temperature_unit || '°';
    el = make('weather', [
      h('div', { class: 'tile-top' }, icon(WEATHER_ICON[s?.state] || 'cloud'), h('div', { class: 'w-big' }, a.temperature != null ? `${Math.round(a.temperature)}${unit.replace(/[CF]/, '')}` : '–')),
      h('div', { class: 'tile-name' }, c.name || a.friendly_name || 'Weather'),
      h('div', { class: 'tile-state' }, s ? s.state.replace(/-/g, ' ') : 'not found'),
      big && s ? h('div', { class: 'tile-state' }, [a.humidity != null ? `Humidity ${a.humidity}%` : '', a.wind_speed != null ? `Wind ${Math.round(a.wind_speed)} ${a.wind_speed_unit || ''}` : ''].filter(Boolean).join(' · ')) : null]);
    tap = () => details(c, opts);
  } else if (c.kind === 'camera') {
    el = make('camera', [cameraImage(c.id, c.entity), h('div', { class: 'cam-none' }, icon('camera'), s ? 'No picture yet' : 'Camera not found'), h('div', { class: 'cam-name' }, label(c))]);
  } else if (c.kind === 'sensor') {
    const v = s ? (Number.isFinite(+s.state) ? String(Math.round(+s.state * 10) / 10) : s.state) : '–';
    el = make('sensor', [h('div', { class: 'tile-top' }, icon(iconOf(c))), h('div', { class: 'w-big' }, v, a.unit_of_measurement ? h('span', { class: 'w-unit' }, a.unit_of_measurement) : null), h('div', { class: 'tile-name' }, label(c))]);
    tap = () => details(c, opts);
  } else if (c.kind === 'room') {
    el = make('room', [h('div', { class: 'tile-top' }, icon(c.icon || 'room'), icon('chevron')), h('div', { class: 'tile-name' }, c.name || opts.actions?.roomName?.(c.room) || 'Room')]);
    tap = () => opts.actions?.openRoom?.(c.room);
  } else {
    el = make('alloff', [h('div', { class: 'tile-top' }, icon(c.icon || 'power')), h('div', { class: 'tile-name' }, c.name || 'All lights off')]);
    tap = () => opts.actions?.allLightsOff?.();
  }
  if (opts.editing) el.addEventListener('click', () => opts.edit?.(c));
  else el.addEventListener('click', () => { if (!openWidget(c, opts)) tap?.(); });
  return el;
}

export function controlTile(c, opts = {}) {
  if (c.kind && WIDGET_KINDS[c.kind]) return widgetTile(c, opts);
  const { w, h: ht } = tileSize(c), on = isOn(st(c.entity));
  const big = w > 1 || ht > 1, room = w * ht;
  // A scene, a script or a step list is a "scene" tile: a theme may draw it as a wide picture band (its colour comes from its name).
  const scene = c.tap === 'steps' || ['scene', 'script'].includes(domainOf(c.entity || ''));
  const hue = [...label(c)].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 360, 7);
  const el = h('div', { class: 'tile' + (scene ? ' scene' : '') + (big ? ' big' : '') + (on ? ' on' : '') + (opts.editing ? ' editing' : '') + (c.color ? ' tinted' : '') + toneClass(c.entity), 'data-w': w, style: (scene ? `--scene-h:${hue};` : '') + tint(c) + `grid-column:span ${w};grid-row:span ${ht};`, role: 'button', tabindex: 0, 'aria-label': label(c) },
    h('div', { class: 'tile-top' }, icon(iconOf(c)), (c.subs || []).length ? h('div', { class: 'subs' }, c.subs.map((sb) => subButton(sb, c, opts))) : null),
    h('div', { class: 'tile-name' }, label(c)),
    h('div', { class: 'tile-state' }, c.entity ? stateText(c.entity) : `${(c.subs || []).length} buttons`),
    big && !opts.editing ? h('div', { class: 'tile-native' }, nativeControls(c, opts).slice(0, Math.max(1, room - 1))) : null);
  if (opts.editing) el.addEventListener('click', () => opts.edit?.(c));
  else press(el, c, opts);
  return el;
}

/** A row in a room panel: name and state, a toggle, the native controls, and its sub-buttons as an expandable list. */
export function controlRow(c, opts = {}) {
  const on = isOn(st(c.entity)), subs = c.subs || [], open = opts.expanded?.has(c.id);
  const groupDim = subs.filter((sb) => isDimmable(st(effective(sb, c))));
  const t = throttled();
  const head = h('div', { class: 'row' },
    h(subs.length ? 'button' : 'div', { class: 'row-label' + (subs.length ? ' expander' : ''), 'aria-expanded': subs.length ? String(!!open) : null, onclick: subs.length ? () => { open ? opts.expanded.delete(c.id) : opts.expanded.add(c.id); opts.rerender?.(); } : null },
      h('div', {}, label(c)),
      h('div', { class: 'sub' }, subs.length ? [`${subs.length} ${subs.length === 1 ? 'button' : 'buttons'}`, icon(open ? 'down' : 'chevron')] : stateText(c.entity))),
    opts.editing ? h('button', { class: 'round small', 'aria-label': `Edit ${label(c)}`, onclick: () => opts.edit?.(c) }, icon('edit'))
      : c.entity ? h('button', { class: 'tog' + (on ? ' on' : '') + toneClass(c.entity) + (!app.conn.demo && !st(c.entity) ? ' missing' : ''), 'aria-label': label(c), 'aria-pressed': String(on), onclick: () => toggle(c.entity) }, icon(iconOf(c)))
        : h('button', { class: 'tog' + (subs.some((sb) => isOn(st(effective(sb, c)))) ? ' on' : ''), 'aria-label': label(c), onclick: () => {
          const ids = [...new Set(subs.map((sb) => effective(sb, c)))].filter(Boolean), anyOn = ids.some((i) => isOn(st(i)));
          for (const dmn of new Set(ids.map(domainOf))) app.conn.call(dmn, anyOn ? 'turn_off' : 'turn_on', {}, ids.filter((i) => domainOf(i) === dmn));
        } }, icon(iconOf(c))));
  const body = h('div', { class: 'ctl' }, head);
  if (!opts.editing) {
    body.append(...nativeControls(c, opts));
    // One slider for all of a group's dimmable sub-buttons.
    if (groupDim.length && c.features?.groupDim !== false && !featuresFor(c.entity).some((f) => f.key === 'brightness')) {
      const ents = [...new Set(groupDim.map((sb) => effective(sb, c)))];
      body.append(slider(Math.max(0, ...ents.map((e) => brightnessPct(st(e)))), (v, fin) => { for (const e of ents) opts.onPreview?.(e, v); t(() => setBrightness(ents, v), fin); }, `${label(c)} brightness for all`, opts.done));
    }
    if (open) for (const sb of subs) body.append(h('div', { class: 'lamp' }, controlRow({ ...sb, entity: effective(sb, c), subs: [] }, { ...opts, expanded: null })));
  }
  return body;
}

/** Everything a device can do, in a pop-up (what "hold" opens). */
export function details(c, opts = {}) {
  if (app.controlPage?.(c, label(c))) return; // a theme may show the device as a full page instead (#84)
  const body = h('div', { class: 'menu' });
  const close = modal(body);
  const draw = () => body.replaceChildren(...nodes(
    h('div', { class: 'panel-head' }, h('h2', {}, label(c)), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => { off(); close(); } }, icon('close'))),
    h('div', { class: 'row pad' }, h('div', { class: 'row-label' }, h('div', {}, stateText(c.entity) || 'Off'), h('div', { class: 'sub' }, c.entity || 'No entity connected')),
      h('button', { class: 'tog' + (isOn(st(c.entity)) ? ' on' : ''), 'aria-label': `${label(c)} on or off`, onclick: () => toggle(c.entity) }, icon(iconOf(c)))),
    h('div', { class: 'ctl pad' }, nativeControls({ ...c, features: {} }, opts))));
  const off = app.conn.on(() => { if (!sliding.active && body.isConnected) draw(); });
  draw();
}

/** The control editor: entity, name, icon, size, colour, opacity, which native controls show, and sub-buttons. */
export function editControl(c, { save, remove, move, sizes = true, title = c.kind ? `Edit ${(WIDGET_KINDS[c.kind] || 'widget').toLowerCase()} widget` : 'Edit widget' } = {}) {
  const body = h('div', { class: 'menu ctl-edit' });
  const close = modal(body);
  const set = (fn) => { save(fn); draw(); };
  function draw() {
    const feats = featuresFor(c.entity);
    body.replaceChildren(...nodes(
      h('div', { class: 'panel-head' }, h('h2', {}, title), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
      h('label', { class: 'field wide-field' }, h('span', {}, 'Name'), (() => { const i = h('input', { type: 'text', value: c.name || '', placeholder: entityName(c.entity) }); i.addEventListener('change', () => set((x) => (x.name = i.value.trim()))); return i; })()),
      ['clock', 'room', 'alloff'].includes(c.kind) ? null : h('button', { class: 'entity-field', onclick: async () => { const v = await pickEntity({ title: c.kind ? 'Which one?' : 'What does it control?', current: c.entity, domains: { weather: ['weather'], camera: ['camera'], sensor: ['sensor', 'binary_sensor'], thermostat: ['climate'], calendar: ['calendar'], music: ['media_player'], announce: ['media_player'] }[c.kind] || null }); if (v != null) set((x) => (x.entity = v)); } },
        icon('link'), h('span', { class: 'grow' }, 'Controls', h('span', { class: 'sub' }, c.entity || 'Nothing (a group of sub-buttons)')), icon('chevron')),
      h('div', { class: 'row' }, h('div', { class: 'row-label' }, 'Icon'),
        h('button', { class: 'round', 'aria-label': 'Choose icon', onclick: async () => { const ic = await pickIcon({ current: c.icon, suggested: iconOf({ entity: c.entity }) }); if (ic != null) set((x) => { if (ic) x.icon = ic; else delete x.icon; }); } }, icon(iconOf(c)))),
      sizes ? (() => {
        const { w, h: ht } = tileSize(c);
        const step = (key, d, max) => set((x) => { const cur = tileSize(x); x.w = cur.w; x.h = cur.h; x[key] = Math.max(1, Math.min(max, x[key] + d)); delete x.size; });
        return [h('p', { class: 'hint' }, 'Size in grid squares. Anything bigger than one square shows its controls on the button.'),
          h('div', { class: 'row' }, h('div', { class: 'row-label' }, h('div', {}, 'Width'), h('div', { class: 'sub' }, `${w} ${w === 1 ? 'square' : 'squares'}`)),
            h('button', { class: 'round small', 'aria-label': 'Narrower', disabled: w <= 1, onclick: () => step('w', -1, 30) }, '−'),
            h('button', { class: 'round small', 'aria-label': 'Wider', disabled: w >= 30, onclick: () => step('w', 1, 30) }, '+')),
          h('div', { class: 'row' }, h('div', { class: 'row-label' }, h('div', {}, 'Height'), h('div', { class: 'sub' }, `${ht} ${ht === 1 ? 'square' : 'squares'}`)),
            h('button', { class: 'round small', 'aria-label': 'Shorter', disabled: ht <= 1, onclick: () => step('h', -1, 8) }, '−'),
            h('button', { class: 'round small', 'aria-label': 'Taller', disabled: ht >= 8, onclick: () => step('h', 1, 8) }, '+'))];
      })() : null,
      sizes ? [h('div', { class: 'row' }, h('div', { class: 'row-label' }, 'Colour'),
        c.color ? h('button', { class: 'chip small', onclick: () => set((x) => delete x.color) }, 'Default') : null,
        h('span', { class: 'colbtn' }, (() => { const i = h('input', { type: 'color', value: c.color || '#ffb45a', 'aria-label': 'Button colour' }); i.addEventListener('change', () => set((x) => (x.color = i.value))); return i; })())),
        h('div', { class: 'nat' }, h('span', { class: 'nat-label' }, 'Opacity'), (() => { const i = h('input', { type: 'range', min: 20, max: 100, value: Math.round((c.opacity ?? 1) * 100), 'aria-label': 'Button opacity' }); i.addEventListener('change', () => set((x) => { if (+i.value >= 100) delete x.opacity; else x.opacity = +i.value / 100; })); return i; })())] : null,
      c.kind ? null : h('div', { class: 'row wraps' }, h('div', { class: 'row-label' }, 'A tap'), seg([['toggle', 'Switches it'], ['details', 'Opens its controls'], ['steps', 'Runs steps']], c.tap || 'toggle', (v) => set((x) => (x.tap = v)))),
      !c.kind && c.tap === 'steps' ? stepsEditor(c.steps || [], c.entity, (fn) => set((x) => { x.steps = [...(x.steps || [])]; fn(x.steps); })) : null,
      feats.length && !c.kind ? [h('h3', {}, 'Controls to show'),
        feats.map((f) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: c.features?.[f.key] !== false, onchange: (e) => set((x) => { x.features = { ...(x.features || {}) }; if (e.target.checked) delete x.features[f.key]; else x.features[f.key] = false; }) }), f.label))] : null,
      c.kind ? null : [
      h('h3', {}, 'Sub-buttons'),
      h('p', { class: 'hint' }, 'Small buttons carried by this one — each lamp of a group, or a room\'s fan and blind.'),
      (c.subs || []).map((sb, i) => h('div', { class: 'row' },
        h('div', { class: 'row-label' }, h('div', {}, label(sb)), h('div', { class: 'sub' }, sb.entity)),
        h('button', { class: 'round small', 'aria-label': `Icon for ${label(sb)}`, onclick: async () => { const ic = await pickIcon({ current: sb.icon, suggested: iconOf({ entity: sb.entity }) }); if (ic != null) set((x) => { if (ic) x.subs[i].icon = ic; else delete x.subs[i].icon; }); } }, icon(iconOf(sb))),
        h('button', { class: 'round small', 'aria-label': `Rename ${label(sb)}`, onclick: () => { const n = prompt('Name', sb.name || ''); if (n != null) set((x) => (x.subs[i].name = n.trim())); } }, icon('edit')),
        h('button', { class: 'round small', 'aria-label': `Move ${label(sb)} up`, onclick: () => set((x) => { if (i > 0) x.subs.splice(i - 1, 0, x.subs.splice(i, 1)[0]); }) }, icon('up')),
        h('button', { class: 'round small', 'aria-label': `Remove ${label(sb)}`, onclick: () => set((x) => x.subs.splice(i, 1)) }, icon('trash')))),
      h('button', { class: 'wide ghost', onclick: async () => { const v = await pickEntity({ title: 'Add a sub-button' }); if (v) set((x) => (x.subs ||= []).push({ id: uid('s'), entity: v, name: '' })); } }, icon('plus'), 'Add sub-button')],
      h('div', { class: 'msep' }),
      h('div', { class: 'btns' },
        move ? h('button', { class: 'wide ghost', 'aria-label': 'Move earlier', onclick: () => { move(-1); } }, icon('up'), 'Earlier') : null,
        move ? h('button', { class: 'wide ghost', 'aria-label': 'Move later', onclick: () => { move(1); } }, icon('down'), 'Later') : null,
        remove ? h('button', { class: 'wide danger', onclick: () => { remove(); close(); } }, icon('trash'), 'Remove') : null)));
  }
  draw();
  return { redraw: draw, close };
}
