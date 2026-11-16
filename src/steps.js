// Step lists (#70): one tap (or hold) can do several things in order — switch things, set a
// brightness or temperature, wait a few seconds. The list is built in edit mode and runs in the
// app on the device that was touched, so it works the same with every integration.
//
//   steps: [{ id, type: 'do',   entity?, action: on | off | toggle },
//           { id, type: 'set',  entity?, what: brightness | speed | position | volume | temperature, value },
//           { id, type: 'wait', seconds }]
// A step without an entity uses the item's own.
import { h, nodes, icon, seg, modal, st, entityName, pickEntity, domainOf, app, toast } from './ui.js';
import { uid } from './catalog.js';
import { applySwipe, naturalSwipe } from './gestures.js';
import { copyText, scriptFor } from './alerts.js';

const DO = [['on', 'Turn on / run'], ['off', 'Turn off'], ['toggle', 'Switch']];
const WHATS = [['brightness', 'Brightness', '%'], ['temperature', 'Temperature', '°'], ['position', 'Blind position', '%'], ['speed', 'Fan speed', '%'], ['volume', 'Volume', '%']];
const MAX_WAIT = 120, MAX_STEPS = 30;
const nameOf = (e) => st(e)?.attributes?.friendly_name || entityName(e) || e || 'nothing chosen';

/** One step in words: "Turn off Lamp 1", "Set Lamp 2 brightness to 10%", "Wait 2 seconds". */
export function stepText(s, main) {
  const e = s.entity || main;
  if (s.type === 'wait') return `Wait ${s.seconds} second${s.seconds === 1 ? '' : 's'}`;
  if (s.type === 'set') { const w = WHATS.find((x) => x[0] === s.what) || WHATS[0]; return `Set ${nameOf(e)} ${w[1].toLowerCase()} to ${s.value}${w[2]}`; }
  return `${{ on: 'Turn on', off: 'Turn off', toggle: 'Switch' }[s.action] || 'Switch'} ${nameOf(e)}`;
}

function doStep(s, main) {
  const e = s.entity || main;
  if (!e) return;
  if (s.type === 'set') {
    if (s.what === 'temperature') return app.conn.call('climate', 'set_temperature', { temperature: +s.value }, e);
    return applySwipe(e, s.what, Math.max(0, Math.min(100, +s.value)));
  }
  const d = domainOf(e), known = ['light', 'switch', 'fan', 'input_boolean', 'cover', 'media_player', 'script', 'scene', 'automation', 'climate'].includes(d);
  const service = d === 'scene' || d === 'script' ? (s.action === 'off' && d === 'script' ? 'turn_off' : 'turn_on') : { on: 'turn_on', off: 'turn_off', toggle: 'toggle' }[s.action] || 'toggle';
  return app.conn.call(known ? d : 'homeassistant', service, {}, e);
}

const running = new Map(); // key (the item) → { stop }
/** Run a list. Touching the same item again while it runs stops it. */
export async function runSteps(key, steps, main) {
  const list = (steps || []).slice(0, MAX_STEPS);
  if (running.has(key)) { running.get(key).stop = true; running.get(key).wake?.(); return; }
  if (!list.length) return toast('This has no steps yet. Add them in edit mode.');
  const run = { stop: false };
  running.set(key, run);
  const waits = list.some((s) => s.type === 'wait');
  if (waits) toast(`Running ${list.length} steps… touch it again to stop`);
  let done = 0;
  try {
    for (const s of list) {
      if (run.stop) break;
      if (s.type === 'wait') await new Promise((res) => { run.wake = res; setTimeout(res, Math.max(0, Math.min(MAX_WAIT, +s.seconds || 0)) * 1000); });
      else { try { await doStep(s, main); } catch (e) { console.warn('step failed', s, e); } }
      if (!run.stop) done++;
    }
  } finally { running.delete(key); }
  if (run.stop) toast(`Stopped after step ${done} of ${list.length}`);
  else if (waits) toast('Done');
}

function editStep(step, main, onsave) {
  const s = structuredClone(step);
  const body = h('div', { class: 'menu' });
  const close = modal(body);
  const num = (value, on, attrs) => { const i = h('input', { type: 'number', value, inputmode: 'decimal', ...attrs }); i.addEventListener('input', () => { const v = parseFloat(i.value); if (Number.isFinite(v)) on(v); }); return i; };
  const draw = () => {
    const e = s.entity || main, w = WHATS.find((x) => x[0] === s.what);
    body.replaceChildren(...nodes(
      h('div', { class: 'panel-head' }, h('h2', {}, 'Step'), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
      seg([['do', 'Switch something'], ['set', 'Set a value'], ['wait', 'Wait']], s.type, (v) => { s.type = v; if (v === 'do') s.action ||= 'on'; if (v === 'set') { s.what ||= naturalSwipe(e) !== 'none' ? naturalSwipe(e) : 'brightness'; s.value ??= 50; } if (v === 'wait') s.seconds ||= 2; draw(); }),
      s.type !== 'wait' ? h('button', { class: 'entity-field', onclick: async () => { const v = await pickEntity({ title: 'Which device, scene or script?', current: s.entity || '' }); if (v != null) { if (v) s.entity = v; else delete s.entity; if (s.type === 'set' && naturalSwipe(v) !== 'none') s.what = naturalSwipe(v); draw(); } } },
        icon('link'), h('span', { class: 'grow' }, s.entity ? nameOf(s.entity) : main ? `This item (${nameOf(main)})` : 'Choose a device', h('span', { class: 'sub' }, e || 'nothing chosen yet')), icon('chevron')) : null,
      s.type === 'do' ? h('div', { class: 'seg wrap' }, DO.map(([v, l]) => h('button', { class: v === s.action ? 'on' : '', onclick: () => { s.action = v; draw(); } }, l))) : null,
      s.type === 'set' ? [
        h('label', { class: 'field wide-field' }, h('span', {}, 'What to set'), h('select', { onchange: (ev) => { s.what = ev.target.value; if (s.what === 'temperature' && s.value > 35) s.value = 21; draw(); } }, WHATS.map(([v, l]) => h('option', { value: v, selected: v === s.what }, l)))),
        h('label', { class: 'field wide-field' }, h('span', {}, s.what === 'temperature' ? 'Temperature (degrees)' : `${w?.[1] || 'Value'} (0 to 100%)`), num(s.value, (v) => (s.value = v), s.what === 'temperature' ? { min: 5, max: 35, step: 0.5 } : { min: 0, max: 100, step: 1 }))] : null,
      s.type === 'wait' ? [h('label', { class: 'field wide-field' }, h('span', {}, `Seconds to wait (up to ${MAX_WAIT})`), num(s.seconds, (v) => (s.seconds = Math.max(0.1, Math.min(MAX_WAIT, v))), { min: 0.1, max: MAX_WAIT, step: 0.5 })),
        h('p', { class: 'hint' }, 'The steps run in the app on this device. If the app is closed or the screen sleeps during a wait, the rest do not run; for long waits use a script in your home system.')] : null,
      h('button', { class: 'wide primary', disabled: s.type !== 'wait' && !e, onclick: () => { close(); onsave(s); } }, icon('check'), 'Save step')));
  };
  draw();
}

/**
 * The list of steps, editable: + adds one, the pencil edits, the bin removes, and a step is
 * dragged by its handle to change the order. `save(fn)` applies fn(steps) to the stored list.
 */
export function stepsEditor(steps, main, save) {
  const list = h('div', { class: 'steps' });
  const rows = (steps || []).map((s, i) => {
    const handle = h('span', { class: 'step-handle', role: 'button', 'aria-label': `Drag step ${i + 1} to move it`, title: 'Drag to move' }, icon('swipe'));
    const row = h('div', { class: 'step-row' }, handle, h('span', { class: 'step-n' }, String(i + 1)), h('span', { class: 'grow' }, stepText(s, main)),
      h('button', { class: 'round small', 'aria-label': `Edit step ${i + 1}`, onclick: () => editStep(s, main, (n) => save((l) => (l[i] = n))) }, icon('edit')),
      h('button', { class: 'round small', 'aria-label': `Remove step ${i + 1}`, onclick: () => save((l) => l.splice(i, 1)) }, icon('trash')));
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const y0 = e.clientY, mids = rows.map((r) => { const b = r.getBoundingClientRect(); return b.top + b.height / 2; });
      let to = i;
      row.classList.add('dragging');
      const move = (ev) => {
        row.style.transform = `translateY(${ev.clientY - y0}px)`;
        to = mids.filter((m, j) => j !== i && m < ev.clientY).length;
        rows.forEach((r, j) => r.classList.toggle('drop', j !== i && j === (to > i ? to : to) && to !== i));
      };
      const up = () => {
        handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up);
        row.classList.remove('dragging'); row.style.transform = '';
        rows.forEach((r) => r.classList.remove('drop'));
        if (to !== i) save((l) => l.splice(to, 0, l.splice(i, 1)[0]));
      };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
    });
    return row;
  });
  list.append(...rows);
  return [
    list,
    !rows.length ? h('p', { class: 'hint' }, 'No steps yet. Add the first thing it should do.') : null,
    rows.length < MAX_STEPS ? h('button', { class: 'wide ghost', onclick: () => editStep({ id: uid('st'), type: 'do', action: 'on' }, main, (n) => save((l) => l.push(n))) }, icon('plus'), 'Add step') : null,
    // The same list as a script for the home system, so it can live there instead (#79).
    rows.length ? h('button', { class: 'wide ghost', onclick: () => copyText(scriptFor(steps, main), 'Script') }, icon('copy'), 'Copy as a Home Assistant script') : null,
  ];
}
