// The user's own alerts (#79): "tell me when the garage door opens".
//
// Automations and notifications are best kept in the home system itself (Home Assistant): it is
// always running and it keeps everything in one place. So this is deliberately the second
// choice: a simple alert made here fires only while the app is running on this device, and every
// alert can be handed over to Home Assistant, as YAML to paste or created there directly.
import { h, nodes, icon, seg, modal, st, app, pickEntity, entityName, domainOf, toast } from './ui.js';
import { device, saveDevice } from './store.js';
import { uid } from './catalog.js';
import * as native from './native.js';

export const WHENS = [['on', 'Turns on / opens / unlocks / arrives'], ['off', 'Turns off / closes / locks / leaves'], ['above', 'Goes above a value'], ['below', 'Goes below a value'], ['any', 'Changes at all']];
/** The state that counts as "on" for a kind of device, and as "off". */
const ON_OFF = { cover: ['open', 'closed'], lock: ['unlocked', 'locked'], person: ['home', 'not_home'], device_tracker: ['home', 'not_home'], alarm_control_panel: ['triggered', 'disarmed'] };
const onState = (entity) => (ON_OFF[domainOf(entity)] || ['on', 'off'])[0];
const offState = (entity) => (ON_OFF[domainOf(entity)] || ['on', 'off'])[1];
const nameOf = (e) => st(e)?.attributes?.friendly_name || entityName(e) || e;
const alerts = () => (device.alerts ||= []);

/** An alert in words: "Garage door: turns on / opens". */
export const alertText = (a) => `${nameOf(a.entity)}: ${a.when === 'above' ? `goes above ${a.value}` : a.when === 'below' ? `goes below ${a.value}` : a.when === 'any' ? 'changes' : a.when === 'off' ? `becomes ${offState(a.entity)}` : `becomes ${onState(a.entity)}`}`;
const messageOf = (a) => a.message || alertText(a);

function fired(a, was, now) {
  if (was == null || was === now || now === 'unavailable' || now === 'unknown') return false;
  if (a.when === 'any') return true;
  if (a.when === 'on') return now === onState(a.entity);
  if (a.when === 'off') return now === offState(a.entity);
  const w = parseFloat(was), n = parseFloat(now), v = +a.value;
  if (!Number.isFinite(n) || !Number.isFinite(v)) return false;
  return a.when === 'above' ? n > v && !(w > v) : n < v && !(w < v);
}
function show(a) {
  if (native.isNative) return native.notifyAlert(a.name || 'Nidorama', messageOf(a), Math.abs([...a.id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) | 0, 7)) % 100000);
  try { if (window.Notification?.permission === 'granted') return void new Notification(a.name || 'Nidorama', { body: messageOf(a) }); } catch {}
  toast(`${a.name || 'Alert'}: ${messageOf(a)}`);
}
/** Watch the home's live state and raise the alerts that are switched on. Only while the app is running. */
export function startAlerts(conn) {
  const last = new Map(), quiet = new Map();
  conn.on((kind, id) => {
    if (kind === 'status' || !id) return;
    const now = st(id)?.state, was = last.get(id);
    last.set(id, now);
    for (const a of alerts()) {
      if (!a.on || a.inHA || a.entity !== id || !fired(a, was, now)) continue;
      if (Date.now() - (quiet.get(a.id) || 0) < (a.quiet || 0) * 60000) continue;
      quiet.set(a.id, Date.now());
      show(a);
    }
  });
}

// ---------- handing an alert over to Home Assistant ----------
const q = (text) => JSON.stringify(String(text));
/** The alert as a Home Assistant automation, as an object (for creating it) and as YAML (for pasting). */
export function automationFor(a, service) {
  const trigger = a.when === 'above' || a.when === 'below'
    ? { platform: 'numeric_state', entity_id: a.entity, [a.when]: +a.value }
    : { platform: 'state', entity_id: a.entity, ...(a.when === 'any' ? {} : { to: a.when === 'off' ? offState(a.entity) : onState(a.entity) }) };
  const [domain, name] = (service || 'notify.notify').split('.');
  const action = [{ service: `${domain}.${name}`, data: { title: a.name || 'Home', message: messageOf(a) } }];
  if (a.quiet) action.push({ delay: { minutes: +a.quiet } }); // with mode: single, this is the quiet period
  const config = { alias: a.name || alertText(a), description: 'Made in Nidorama. Edit it freely here.', trigger: [trigger], condition: [], action, mode: 'single' };
  const t = trigger;
  const yaml = [
    `alias: ${q(config.alias)}`,
    `description: ${q(config.description)}`,
    'trigger:',
    `  - platform: ${t.platform}`,
    `    entity_id: ${t.entity_id}`,
    ...(t.to ? [`    to: ${q(t.to)}`] : []), ...(t.above != null ? [`    above: ${t.above}`] : []), ...(t.below != null ? [`    below: ${t.below}`] : []),
    'condition: []',
    'action:',
    `  - service: ${domain}.${name}   # where the notification goes; change it to your phone if needed`,
    '    data:',
    `      title: ${q(action[0].data.title)}`,
    `      message: ${q(action[0].data.message)}`,
    ...(a.quiet ? ['  # quiet period: while this wait runs, the automation will not fire again', '  - delay:', `      minutes: ${+a.quiet}`] : []),
    'mode: single',
  ].join('\n');
  return { config, yaml };
}
/** Put text on the clipboard; where that is not allowed, show it to be copied by hand. */
export async function copyText(text, what) {
  try { await navigator.clipboard.writeText(text); toast(`${what} copied`); }
  catch {
    const c = modal(h('div', { class: 'menu' }, h('div', { class: 'panel-head' }, h('h2', {}, what), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => c() }, icon('close'))),
      h('p', { class: 'hint' }, 'Select all of this and copy it.'), h('textarea', { class: 'yaml', rows: 14, readonly: true }, text)));
  }
}
/** The notify services Home Assistant has (one per phone with its app, among others). */
async function notifyServices() {
  try { const all = await app.ask({ type: 'get_services' }); return Object.keys(all?.notify || {}).map((n) => `notify.${n}`).sort((a, b) => (b.includes('mobile_app') ? 1 : 0) - (a.includes('mobile_app') ? 1 : 0) || a.localeCompare(b)); } catch { return []; }
}
/** Create the automation in Home Assistant itself. Needs an administrator sign-in, and Home Assistant must accept the request from this app. */
async function createInHA(a, service) {
  const base = (device.haUrl || '').replace(/\/$/, ''), token = device.token || device.haAuth?.access_token;
  if (!base || !token) throw new Error('this device is not signed in to Home Assistant directly');
  const id = `nidorama_${a.id.replace(/[^a-z0-9]/gi, '')}`;
  const res = await fetch(`${base}/api/config/automation/config/${id}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ id, ...automationFor(a, service).config }) });
  if (res.status === 401 || res.status === 403) throw new Error('that sign-in is not an administrator');
  if (!res.ok) throw new Error(`Home Assistant answered ${res.status}`);
}
function handOver(a, redraw) {
  const body = h('div', { class: 'menu' });
  const close = modal(body);
  let services = null, service = a.service || '', note = '';
  const draw = () => {
    const { yaml } = automationFor(a, service || 'notify.notify');
    body.replaceChildren(...nodes(
      h('div', { class: 'panel-head' }, h('h2', {}, 'Move to Home Assistant'), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
      h('p', { class: 'hint' }, 'This is the same alert as a Home Assistant automation. There it works all the time, whether or not this app is open.'),
      h('label', { class: 'field wide-field' }, h('span', {}, 'Send the notification to'),
        services?.length ? h('select', { onchange: (e) => { service = e.target.value; a.service = service; saveDevice(); draw(); } }, [h('option', { value: '', selected: !service }, 'notify.notify (Home Assistant\'s default)'), ...services.map((s) => h('option', { value: s, selected: s === service }, s))])
          : h('span', { class: 'hint' }, services ? 'No notify services were found; the default is used. You can change it in Home Assistant.' : 'Looking for your phones…')),
      h('textarea', { class: 'yaml', rows: 12, readonly: true, 'aria-label': 'The automation as YAML' }, yaml),
      h('div', { class: 'btns' },
        h('button', { class: 'wide primary', onclick: () => copyText(yaml, 'Automation') }, icon('copy'), 'Copy for Home Assistant'),
        h('button', { class: 'wide', onclick: async () => {
          note = 'Creating it in Home Assistant…'; draw();
          try { await createInHA(a, service || 'notify.notify'); a.inHA = true; a.on = false; saveDevice(); note = 'Done. It now runs in Home Assistant, and the copy here is switched off.'; redraw(); }
          catch (e) { note = `Could not create it from here (${e.message || 'Home Assistant did not accept the request'}). Use Copy instead: in Home Assistant go to Settings → Automations → Create → the ⋮ menu → Edit in YAML, and paste.`; }
          draw();
        } }, icon('up'), 'Create it there now')),
      note ? h('p', { class: 'hint' }, note) : h('p', { class: 'hint' }, 'To paste it: in Home Assistant go to Settings → Automations → Create automation → the ⋮ menu → Edit in YAML.')));
    const ta = body.querySelector('textarea'); if (ta) ta.value = yaml;
  };
  draw();
  notifyServices().then((s) => { services = s; if (body.isConnected) draw(); });
}

function editAlert(alert, done) {
  const a = structuredClone(alert);
  const body = h('div', { class: 'menu' });
  const close = modal(body);
  const text = (value, on, attrs = {}) => { const i = h('input', { type: 'text', value: value || '', ...attrs }); i.addEventListener('input', () => on(i.value)); return i; };
  const draw = () => body.replaceChildren(...nodes(
    h('div', { class: 'panel-head' }, h('h2', {}, alert.entity ? 'Edit alert' : 'New alert'), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
    h('button', { class: 'entity-field', onclick: async () => { const v = await pickEntity({ title: 'Which device or sensor?', current: a.entity || '' }); if (v) { a.entity = v; draw(); } } },
      icon('link'), h('span', { class: 'grow' }, a.entity ? nameOf(a.entity) : 'Choose a device or sensor', h('span', { class: 'sub' }, a.entity || 'a door, a sensor, a lock, a person…')), icon('chevron')),
    h('label', { class: 'field wide-field' }, h('span', {}, 'Tell me when it'), h('select', { onchange: (e) => { a.when = e.target.value; draw(); } }, WHENS.map(([v, l]) => h('option', { value: v, selected: v === a.when }, l)))),
    a.when === 'above' || a.when === 'below' ? h('label', { class: 'field wide-field' }, h('span', {}, 'Value'), (() => { const i = h('input', { type: 'number', value: a.value ?? '', inputmode: 'decimal' }); i.addEventListener('input', () => (a.value = parseFloat(i.value))); return i; })()) : null,
    h('label', { class: 'field wide-field' }, h('span', {}, 'Title'), text(a.name, (v) => (a.name = v), { placeholder: 'e.g. Garage' })),
    h('label', { class: 'field wide-field' }, h('span', {}, 'Message'), text(a.message, (v) => (a.message = v), { placeholder: a.entity ? alertText(a) : 'what the notification says' })),
    h('label', { class: 'field wide-field' }, h('span', {}, 'Not again for (minutes)'), (() => { const i = h('input', { type: 'number', min: 0, max: 1440, value: a.quiet || 0 }); i.addEventListener('input', () => (a.quiet = Math.max(0, +i.value || 0))); return i; })()),
    h('button', { class: 'wide primary', disabled: !a.entity, onclick: () => { close(); done(a); } }, icon('check'), 'Save alert')));
  draw();
}

/** Settings → Alerts. `head` is the sub-page header; `redraw` redraws the sheet. */
export function alertsSettings(head, redraw) {
  const list = alerts();
  const save = (fn) => { fn(); saveDevice(); redraw(); };
  return h('div', { class: 'menu settings' }, head,
    h('p', { class: 'hint' }, 'The best place for automations and notifications is your home system itself. In Home Assistant they run all the time and everything stays in one place, with nothing depending on this app.'),
    app.conn?.demo ? null : h('div', { class: 'btns pad' }, h('button', { class: 'wide', onclick: () => native.openHomeAssistantApp(device.haUrl ? `${device.haUrl.replace(/\/$/, '')}/config/automation/dashboard` : '') }, icon('ha'), 'Open automations in Home Assistant')),
    h('div', { class: 'msep' }),
    h('h3', { class: 'pad' }, 'Alerts on this device'),
    h('p', { class: 'hint' }, 'If you would rather make a simple alert here, you can. It fires only while this app is running on this device, which suits a wall tablet. Any alert can be moved to Home Assistant later, ready-made.'),
    list.map((a) => h('div', { class: 'alert-row' },
      h('div', { class: 'row' },
        h('div', { class: 'row-label' }, h('div', { class: 'clip' }, a.name || nameOf(a.entity)), h('div', { class: 'sub clip' }, a.inHA ? 'now runs in Home Assistant' : alertText(a))),
        h('button', { class: 'tog' + (a.on ? ' on' : ''), 'aria-label': `${a.name || 'Alert'} ${a.on ? 'on' : 'off'}`, 'aria-pressed': String(!!a.on), onclick: () => save(() => { a.on = !a.on; if (a.on) { a.inHA = false; native.askNotifications(); } }) }, icon('bell'))),
      h('div', { class: 'btns' },
        h('button', { class: 'chip small', onclick: () => editAlert(a, (n) => save(() => Object.assign(a, n))) }, icon('edit'), 'Edit'),
        h('button', { class: 'chip small', onclick: () => handOver(a, redraw) }, icon('up'), 'Move to Home Assistant'),
        h('button', { class: 'chip small', onclick: () => show(a) }, icon('play'), 'Try it'),
        h('button', { class: 'chip small danger', 'aria-label': `Delete the alert ${a.name || ''}`, onclick: () => save(() => list.splice(list.indexOf(a), 1)) }, icon('trash'))))),
    !list.length ? h('p', { class: 'hint' }, 'No alerts on this device.') : null,
    h('div', { class: 'btns pad' }, h('button', { class: 'wide ghost', onclick: () => editAlert({ id: uid('al'), when: 'on', on: true, quiet: 0 }, (n) => { native.askNotifications(); try { if (!native.isNative && window.Notification?.permission === 'default') Notification.requestPermission(); } catch {} save(() => list.push(n)); }) }, icon('plus'), 'New alert')));
}

// ---------- a step list as a Home Assistant script ----------
/** The steps of a tap (#70) as a Home Assistant script in YAML. */
export function scriptFor(steps, main, name = 'Steps from Nidorama') {
  const lines = [`alias: ${q(name)}`, 'sequence:'];
  for (const s of steps || []) {
    const e = s.entity || main, d = domainOf(e || '');
    if (s.type === 'wait') { lines.push('  - delay:', `      seconds: ${+s.seconds || 0}`); continue; }
    if (!e) continue;
    if (s.type === 'set') {
      const [service, key, value] = { brightness: ['light.turn_on', 'brightness_pct', Math.round(+s.value)], temperature: ['climate.set_temperature', 'temperature', +s.value], position: ['cover.set_cover_position', 'position', Math.round(+s.value)],
        speed: ['fan.set_percentage', 'percentage', Math.round(+s.value)], volume: ['media_player.volume_set', 'volume_level', +(+s.value / 100).toFixed(2)] }[s.what] || ['light.turn_on', 'brightness_pct', Math.round(+s.value)];
      lines.push(`  - service: ${service}`, '    target:', `      entity_id: ${e}`, '    data:', `      ${key}: ${value}`);
    } else {
      const known = ['light', 'switch', 'fan', 'input_boolean', 'cover', 'media_player', 'script', 'scene', 'automation', 'climate'].includes(d);
      const act = d === 'scene' ? 'turn_on' : { on: 'turn_on', off: 'turn_off', toggle: 'toggle' }[s.action] || 'toggle';
      lines.push(`  - service: ${known ? d : 'homeassistant'}.${act}`, '    target:', `      entity_id: ${e}`);
    }
  }
  lines.push('mode: single');
  return lines.join('\n');
}
