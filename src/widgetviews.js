// What opens when a widget is tapped (#73): not the bare entity, but a screen made for it —
// a forecast for weather, a big clock with alarms, a full thermostat, the calendar with what is
// coming up, a full music player. Data comes from the home system through `app.ask`.
import { h, nodes, icon, modal, st, app, slider, throttled, sliding, toast, entityName } from './ui.js';
import { device, saveDevice } from './store.js';
import { nativeControls, cameraImage } from './controls.js';
import { uid } from './catalog.js';

const WEATHER_ICON = { sunny: 'sun', 'clear-night': 'moon', rainy: 'rain', pouring: 'rain', lightning: 'rain', 'lightning-rainy': 'rain', snowy: 'snow', 'snowy-rainy': 'snow', hail: 'snow', windy: 'leaf', 'windy-variant': 'leaf' };
const nice = (t) => (t || '').replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const name = (c) => c.name || st(c.entity)?.attributes?.friendly_name || entityName(c.entity) || 'Widget';
/** Ask the home system to do something that answers back (a forecast, a list of events). Resolves null when it cannot. */
const ask = async (domain, service, data, entity) => {
  try { const r = await app.ask?.({ type: 'call_service', domain, service, service_data: data, target: { entity_id: entity }, return_response: true }); return r?.response?.[entity] || null; } catch { return null; }
};

/**
 * A full-screen page for a widget. It slides in over whatever was showing and redraws itself when
 * the home's state changes. Back (the button, a swipe in from the left edge, or Android's Back)
 * returns to where the user came from.
 */
function screen(cls, draw, { every = 0 } = {}) {
  const inner = h('div', { class: `wview ${cls}` });
  const page = h('div', { class: 'wpage', role: 'dialog', 'aria-modal': 'true' }, inner);
  let timer = 0, closed = false;
  const off = app.conn.on(() => { if (!sliding.active && page.isConnected) redraw(); });
  const close = () => {
    if (closed) return;
    closed = true;
    off(); clearInterval(timer);
    page.classList.add('leaving');
    setTimeout(() => page.remove(), 220);
  };
  page.goBack = close;
  const head = (title) => h('div', { class: 'wpage-head' }, h('button', { class: 'chip back', 'aria-label': 'Back', onclick: close }, icon('left'), 'Back'), h('h1', {}, title));
  const redraw = () => inner.replaceChildren(...nodes(draw(head, redraw)));
  // Swipe in from the left edge of the screen to go back.
  let sw = null;
  page.addEventListener('pointerdown', (e) => { sw = e.clientX < 36 ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null; });
  page.addEventListener('pointermove', (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    const dx = e.clientX - sw.x;
    if (dx > 0) page.style.transform = `translateX(${Math.min(dx, 160) * 0.6}px)`;
    if (dx > 80 && Math.abs(e.clientY - sw.y) < dx) { sw = null; page.style.transform = ''; close(); }
  });
  const end = () => { sw = null; if (!closed) page.style.transform = ''; };
  page.addEventListener('pointerup', end); page.addEventListener('pointercancel', end);
  if (every) timer = setInterval(() => (page.isConnected ? redraw() : clearInterval(timer)), every);
  document.getElementById('app').append(page);
  redraw();
  return redraw;
}

// ---------- weather: now, the next hours, the next days ----------
function weatherView(c) {
  let daily = null, hourly = null, asked = false;
  const redraw = screen('wv-weather', (head) => {
    const s = st(c.entity), a = s?.attributes || {}, unit = (a.temperature_unit || '°').replace(/[CF]/, '');
    const t = (v) => (v == null ? '–' : `${Math.round(v)}${unit}`);
    const today = daily?.[0];
    const facts = [['Feels like', a.apparent_temperature != null ? t(a.apparent_temperature) : null], ['Humidity', a.humidity != null ? `${a.humidity}%` : null],
      ['Wind', a.wind_speed != null ? `${Math.round(a.wind_speed)} ${a.wind_speed_unit || ''}` : null], ['Pressure', a.pressure != null ? `${Math.round(a.pressure)} ${a.pressure_unit || ''}` : null],
      ['UV', a.uv_index != null ? String(Math.round(a.uv_index)) : null], ['Cloud', a.cloud_coverage != null ? `${a.cloud_coverage}%` : null]].filter((f) => f[1]);
    const lo = daily ? Math.min(...daily.map((d) => d.templow ?? d.temperature)) : 0, hi = daily ? Math.max(...daily.map((d) => d.temperature)) : 1;
    return [head(name(c)),
      s ? h('div', { class: 'wv-now' }, icon(WEATHER_ICON[s.state] || 'cloud'), h('div', { class: 'wv-temp' }, t(a.temperature)),
        h('div', { class: 'wv-cond' }, h('b', {}, nice(s.state)), today ? h('span', {}, `High ${t(today.temperature)} · Low ${t(today.templow)}`) : null)) : h('p', { class: 'hint' }, 'This weather is not in your home system yet.'),
      facts.length ? h('div', { class: 'wv-facts' }, facts.map(([k, v]) => h('div', {}, h('b', {}, v), h('span', {}, k)))) : null,
      hourly?.length ? [h('h3', {}, 'Next hours'), h('div', { class: 'wv-hours' }, hourly.slice(0, 18).map((x) => h('div', {},
        h('span', {}, new Date(x.datetime).toLocaleTimeString(undefined, { hour: 'numeric' })), icon(WEATHER_ICON[x.condition] || 'cloud'), h('b', {}, t(x.temperature)),
        x.precipitation_probability ? h('span', { class: 'wv-rain' }, `${x.precipitation_probability}%`) : h('span', {}, ' '))))] : null,
      daily?.length ? [h('h3', {}, 'Next days'), h('div', { class: 'wv-days' }, daily.slice(0, 8).map((d, i) => {
        const a0 = (((d.templow ?? d.temperature) - lo) / (hi - lo || 1)) * 100, a1 = ((d.temperature - lo) / (hi - lo || 1)) * 100;
        return h('div', { class: 'wv-day' }, h('b', {}, i === 0 ? 'Today' : new Date(d.datetime).toLocaleDateString(undefined, { weekday: 'long' })), icon(WEATHER_ICON[d.condition] || 'cloud'),
          h('span', { class: 'wv-rain' }, d.precipitation_probability ? `${d.precipitation_probability}%` : ''), h('span', {}, t(d.templow)),
          h('span', { class: 'wv-bar' }, h('i', { style: `left:${a0}%;right:${100 - a1}%` })), h('span', {}, t(d.temperature)));
      }))] : null,
      s && asked && !daily && !hourly ? h('p', { class: 'hint' }, app.conn.demo ? 'Connect your home to see the forecast.' : 'This weather source gives no forecast.') : null,
      s && !asked ? h('p', { class: 'hint' }, 'Getting the forecast…') : null];
  });
  Promise.all([ask('weather', 'get_forecasts', { type: 'daily' }, c.entity), ask('weather', 'get_forecasts', { type: 'hourly' }, c.entity)]).then(([d, hr]) => { daily = d?.forecast?.length ? d.forecast : null; hourly = hr?.forecast?.length ? hr.forecast : null; asked = true; redraw(); });
}

// ---------- clock: the time, large, and alarms kept on this device ----------
let ringing = null;
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    let n = 0;
    const ping = () => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(0.25, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5); o.start(); o.stop(ctx.currentTime + 0.5); };
    ping();
    const timer = setInterval(() => { if (++n > 80 || !ringing) { clearInterval(timer); ctx.close(); } else ping(); }, 750);
  } catch {}
}
/** Check the alarms twice a minute while the app is open; an alarm rings here, on this device. */
export function startAlarms() {
  let last = '';
  setInterval(() => {
    const d = new Date(), now = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (now === last) return;
    last = now;
    const due = (device.alarms || []).find((a) => a.on && a.time === now);
    if (!due || ringing) return;
    ringing = due;
    beep();
    navigator.vibrate?.([400, 200, 400, 200, 400]);
    const close = modal(h('div', { class: 'menu wview wv-alarm' }, icon('bell'), h('div', { class: 'wv-time' }, due.time), h('p', {}, due.label || 'Alarm'),
      h('button', { class: 'wide primary', onclick: () => close() }, 'Stop')), { onclose: () => (ringing = null) });
  }, 20000);
}
function clockView(c) {
  const add = h('input', { type: 'time', 'aria-label': 'Time of the new alarm' });
  const save = (fn, redraw) => { fn((device.alarms ||= [])); saveDevice(); redraw(); };
  screen('wv-clock', (head, redraw) => {
    const d = new Date(), alarms = [...(device.alarms || [])].sort((x, y) => x.time.localeCompare(y.time));
    return [head(name(c)),
      h('div', { class: 'wv-time' }, d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }), h('span', {}, String(d.getSeconds()).padStart(2, '0'))),
      h('div', { class: 'wv-date' }, d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })),
      h('h3', {}, 'Alarms'),
      alarms.map((a) => h('div', { class: 'row' }, h('div', { class: 'row-label' }, h('div', { class: 'wv-alarm-time' }, a.time), a.label ? h('div', { class: 'sub' }, a.label) : null),
        h('button', { class: 'tog' + (a.on ? ' on' : ''), 'aria-label': `Alarm ${a.time} ${a.on ? 'on' : 'off'}`, 'aria-pressed': String(!!a.on), onclick: () => save((l) => { const x = l.find((q) => q.id === a.id); x.on = !x.on; }, redraw) }, icon('bell')),
        h('button', { class: 'round small', 'aria-label': `Delete alarm ${a.time}`, onclick: () => save((l) => l.splice(l.findIndex((q) => q.id === a.id), 1), redraw) }, icon('trash')))),
      !alarms.length ? h('p', { class: 'hint' }, 'No alarms yet.') : null,
      h('div', { class: 'row' }, add, h('button', { class: 'wide ghost', onclick: () => { if (!add.value) return toast('Choose a time first'); const label = prompt('A name for this alarm (optional)', '') || ''; save((l) => l.push({ id: uid('al'), time: add.value, label: label.trim(), on: true }), redraw); } }, icon('plus'), 'Add alarm')),
      h('p', { class: 'hint' }, 'Alarms are kept on this device and ring here while Nidorama is open, which suits a wall tablet. They do not ring if the app is closed.')];
  }, { every: 1000 });
}

// ---------- thermostat: the temperature, and everything else it can do ----------
function thermostatView(c, opts) {
  const call = (service, data) => app.conn.call('climate', service, data, c.entity);
  screen('wv-thermo', (head) => {
    const s = st(c.entity), a = s?.attributes || {}, step = a.target_temp_step || 0.5;
    const set = (dir) => () => s && call('set_temperature', { temperature: Math.min(a.max_temp ?? 30, Math.max(a.min_temp ?? 5, (a.temperature ?? 20) + dir * step)) });
    const doing = { heating: 'Heating', cooling: 'Cooling', idle: 'Idle', drying: 'Drying', fan: 'Fan' }[a.hvac_action] || (s ? nice(s.state) : 'Not found');
    return [head(name(c)),
      h('div', { class: 'wv-dial' }, h('button', { class: 'round big', 'aria-label': 'Cooler', disabled: !s, onclick: set(-1) }, '−'),
        h('div', { class: 'wv-set' }, h('b', {}, a.temperature != null ? String(a.temperature) : '–', h('sup', {}, '°')), h('span', {}, doing)),
        h('button', { class: 'round big', 'aria-label': 'Warmer', disabled: !s, onclick: set(1) }, '+')),
      h('div', { class: 'wv-facts' }, [['Now', a.current_temperature != null ? `${a.current_temperature}°` : null], ['Humidity', a.current_humidity != null ? `${a.current_humidity}%` : null], ['Range', a.min_temp != null ? `${a.min_temp}° to ${a.max_temp}°` : null]]
        .filter((f) => f[1]).map(([k, v]) => h('div', {}, h('b', {}, v), h('span', {}, k)))),
      s ? [h('h3', {}, 'Mode'), h('div', { class: 'ctl' }, nativeControls({ entity: c.entity, name: name(c), features: { temperature: false } }, opts))] : null,
      (a.preset_modes || []).length ? [h('h3', {}, 'Preset'), h('div', { class: 'chips' }, a.preset_modes.map((m) => h('button', { class: 'chip small' + (m === a.preset_mode ? ' on' : ''), onclick: () => call('set_preset_mode', { preset_mode: m }) }, nice(m))))] : null,
      (a.swing_modes || []).length ? [h('h3', {}, 'Swing'), h('div', { class: 'chips' }, a.swing_modes.map((m) => h('button', { class: 'chip small' + (m === a.swing_mode ? ' on' : ''), onclick: () => call('set_swing_mode', { swing_mode: m }) }, nice(m))))] : null];
  });
}

// ---------- calendar: a month to page through, and what is coming up ----------
function calendarView(c) {
  let shown = new Date(), events = null, asked = !c.entity;
  shown.setDate(1);
  const redraw = screen('wv-cal', (head, again) => {
    const now = new Date(), y = shown.getFullYear(), m = shown.getMonth(), first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
    const key = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`, busy = new Set((events || []).map((e) => key(new Date(e.start))));
    const go = (n) => () => { shown = new Date(y, m + n, 1); again(); };
    const byDay = new Map();
    for (const e of events || []) { const d = new Date(e.start), k = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }); (byDay.get(k) || byDay.set(k, []).get(k)).push(e); }
    return [head(name(c)),
      h('div', { class: 'wv-month' }, h('button', { class: 'round small', 'aria-label': 'Month before', onclick: go(-1) }, icon('left')), h('b', {}, shown.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })), h('button', { class: 'round small', 'aria-label': 'Month after', onclick: go(1) }, icon('chevron'))),
      h('div', { class: 'cal-grid big' }, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => h('span', { class: 'cal-dow' }, d)), Array.from({ length: first }, () => h('span', {})),
        Array.from({ length: days }, (_, i) => { const d = new Date(y, m, i + 1); return h('span', { class: (key(d) === key(now) ? 'today' : '') + (busy.has(key(d)) ? ' busy' : '') }, String(i + 1)); })),
      h('h3', {}, 'Coming up'),
      [...byDay].map(([day, list]) => [h('div', { class: 'wv-dayname' }, day), list.map((e) => h('div', { class: 'wv-event' },
        h('span', { class: 'wv-when' }, /T/.test(e.start) ? new Date(e.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : 'All day'),
        h('div', {}, h('b', {}, e.summary || 'Busy'), e.location ? h('span', { class: 'sub' }, e.location) : null)))]),
      !c.entity ? h('p', { class: 'hint' }, 'To see your events here: add a calendar to your home system (most calendar services can be added to Home Assistant), then choose it for this widget in edit mode.') : null,
      c.entity && asked && !events?.length ? h('p', { class: 'hint' }, st(c.entity) ? 'Nothing in the next four weeks.' : 'This calendar is not in your home system.') : null,
      c.entity && !asked ? h('p', { class: 'hint' }, 'Getting your events…') : null];
  });
  if (c.entity) ask('calendar', 'get_events', { duration: { days: 28 } }, c.entity).then((r) => { events = (r?.events || []).sort((x, y) => String(x.start).localeCompare(String(y.start))); asked = true; redraw(); });
}

// ---------- music: a full player ----------
function musicView(c, opts) {
  const call = (service, data = {}) => app.conn.call('media_player', service, data, c.entity), t = throttled();
  screen('wv-music', (head) => {
    const s = st(c.entity), a = s?.attributes || {}, art = app.artUrl?.(c.entity), playing = s?.state === 'playing';
    const btn = (ic, text, service, big) => h('button', { class: 'round' + (big ? ' big' : ''), 'aria-label': text, disabled: !s, onclick: () => call(service) }, icon(ic));
    return [head(name(c)),
      art ? h('img', { class: 'wv-art', src: art, alt: '' }) : h('div', { class: 'wv-art none' }, icon('music')),
      h('div', { class: 'wv-track' }, h('b', {}, a.media_title || (s ? (playing ? 'Playing' : 'Nothing playing') : 'Player not found')), h('span', {}, [a.media_artist, a.media_album_name].filter(Boolean).join(' · '))),
      h('div', { class: 'wv-transport' }, btn('left', 'Previous', 'media_previous_track'), btn(playing ? 'pause' : 'play', playing ? 'Pause' : 'Play', 'media_play_pause', true), btn('chevron', 'Next', 'media_next_track')),
      a.volume_level != null ? h('div', { class: 'nat' }, h('span', { class: 'nat-label' }, 'Volume'), slider(a.volume_level * 100, (v, fin) => t(() => call('volume_set', { volume_level: +(v / 100).toFixed(2) }), fin), 'Volume')) : null,
      (a.source_list || []).length ? h('label', { class: 'field wide-field' }, h('span', {}, 'Playing from'), h('select', { onchange: (e) => call('select_source', { source: e.target.value }) }, a.source_list.map((m) => h('option', { value: m, selected: m === a.source }, m)))) : null,
      s ? h('div', { class: 'btns' }, h('button', { class: 'wide ghost', onclick: () => call(s.state === 'off' ? 'turn_on' : 'turn_off') }, icon('power'), s.state === 'off' ? 'Turn on' : 'Turn off')) : null];
  });
}

// ---------- camera: the picture, large and refreshed every second ----------
function cameraView(c) {
  const img = cameraImage(`${c.id}:big`, c.entity, 1000);
  screen('wv-camera', (head) => [head(name(c)), img, st(c.entity) ? null : h('p', { class: 'hint' }, 'This camera is not in your home system.')]);
}

/** Open the screen that belongs to a widget. Returns false when it has none of its own. */
export function openWidget(c, opts = {}) {
  const view = { weather: weatherView, clock: clockView, thermostat: thermostatView, calendar: calendarView, music: musicView, camera: cameraView }[c.kind];
  if (!view) return false;
  view(c, opts);
  return true;
}
