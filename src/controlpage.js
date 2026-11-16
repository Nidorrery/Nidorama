// A device as a full page (#84): its name small at the top, its value large, one tall slab to
// drag, an on / off pill, and for lights a field to drag in for warmth or colour. A theme asks
// for it with `pages: 'slab'`; other themes keep the pop-up with rows of controls.
import { h, nodes, icon, app, st, toggle, sliding, domainOf, entityName } from './ui.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const call = (domain, service, data, entity) => app.conn.call(domain, service, data, [entity]);

/** What the slab means for each kind of device. Returns null when a device has nothing to slide. */
function specOf(entity) {
  const d = domainOf(entity || ''), s = () => st(entity), a = () => s()?.attributes || {};
  const on = () => !['off', 'closed', 'unavailable', 'unknown', 'idle', 'paused', 'standby', undefined].includes(s()?.state);
  if (d === 'light') {
    const modes = a().supported_color_modes || [];
    return { on, pct: () => (on() ? Math.round(((a().brightness ?? 255) / 255) * 100) : 0), text: (p) => `${Math.round(p)}%`,
      set: (p) => (p <= 0 ? call('light', 'turn_off', {}, entity) : call('light', 'turn_on', { brightness_pct: Math.max(1, Math.round(p)) }, entity)),
      slide: !modes.length || modes.some((m) => m !== 'onoff'), pill: () => (on() ? 'On' : 'Off'), press: () => toggle(entity),
      warmth: modes.includes('color_temp'), colour: modes.some((m) => ['hs', 'rgb', 'xy', 'rgbw', 'rgbww'].includes(m)) };
  }
  if (d === 'cover') return { on, pct: () => a().current_position ?? (on() ? 100 : 0), text: (p) => `${Math.round(p)}%`, slide: true,
    set: (p) => call('cover', 'set_cover_position', { position: Math.round(p) }, entity), pill: () => (on() ? 'Open' : 'Closed'), press: () => call('cover', 'toggle', {}, entity) };
  if (d === 'fan') return { on, pct: () => (on() ? a().percentage ?? 100 : 0), text: (p) => `${Math.round(p)}%`, slide: true,
    set: (p) => call('fan', 'set_percentage', { percentage: Math.round(p) }, entity), pill: () => (on() ? 'On' : 'Off'), press: () => toggle(entity) };
  if (d === 'media_player') return { on: () => s()?.state === 'playing', pct: () => Math.round((a().volume_level ?? 0) * 100), text: (p) => `${Math.round(p)}%`, slide: true,
    set: (p) => call('media_player', 'volume_set', { volume_level: +(p / 100).toFixed(2) }, entity), pill: () => (s()?.state === 'playing' ? 'Playing' : 'Paused'), press: () => call('media_player', 'media_play_pause', {}, entity),
    sub: () => [a().media_title, a().media_artist].filter(Boolean).join(' · ') };
  if (d === 'climate') {
    const lo = () => a().min_temp ?? 7, hi = () => a().max_temp ?? 30, step = () => a().target_temp_step || 0.5;
    const temp = (p) => Math.round((lo() + (p / 100) * (hi() - lo())) / step()) * step();
    return { on: () => s()?.state !== 'off' && s()?.state != null, pct: () => clamp((((a().temperature ?? lo()) - lo()) / (hi() - lo())) * 100, 0, 100), text: (p) => `${temp(p).toFixed(step() < 1 ? 1 : 0)}°`, slide: true,
      set: (p) => call('climate', 'set_temperature', { temperature: temp(p) }, entity), pill: () => (s()?.state || 'off').replace(/_/g, ' '),
      press: () => { const modes = (a().hvac_modes || ['off', 'heat']), i = modes.indexOf(s()?.state); call('climate', 'set_hvac_mode', { hvac_mode: modes[(i + 1) % modes.length] }, entity); },
      sub: () => (a().current_temperature != null ? `Now ${a().current_temperature}°` : '') };
  }
  return null;
}
/** Can this device be shown as a slab page? */
export const hasControlPage = (entity) => !!specOf(entity);

/** Open the page. `title` is the name to show. Returns false when the device has none. */
export function openControlPage(entity, title) {
  const spec = specOf(entity);
  if (!spec) return false;
  let drag = null, field = spec.warmth ? 'warmth' : spec.colour ? 'colour' : '', sent = 0, closed = false;
  const inner = h('div', { class: 'cpage-in' });
  const page = h('div', { class: 'wpage cpage', role: 'dialog', 'aria-modal': 'true' }, inner);
  const close = () => { if (closed) return; closed = true; off(); page.classList.add('leaving'); setTimeout(() => page.remove(), 220); };
  page.goBack = close;
  const send = (fn, final) => { const n = performance.now(); if (final || n - sent > 220) { sent = n; fn(); } };

  const draw = () => {
    const a = st(entity)?.attributes || {}, p = drag ?? spec.pct(), lit = spec.on();
    // the slab: drag up and down
    const slab = h('div', { class: 'slab' + (lit ? ' on' : ''), role: 'slider', tabindex: 0, 'aria-label': title, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(p), 'aria-valuetext': spec.text(p) },
      h('div', { class: 'slab-fill', style: `height:${p}%` }));
    const at = (e) => { const r = slab.getBoundingClientRect(); return clamp((1 - (e.clientY - r.top) / r.height) * 100, 0, 100); };
    if (spec.slide) {
      slab.addEventListener('pointerdown', (e) => { slab.setPointerCapture(e.pointerId); sliding.active = true; drag = at(e); paint(); });
      slab.addEventListener('pointermove', (e) => { if (drag == null) return; drag = at(e); paint(); send(() => spec.set(drag)); });
      const end = (e) => { if (drag == null) return; const v = at(e); send(() => spec.set(v), true); sliding.active = false; setTimeout(() => { drag = null; if (!closed) draw(); }, 600); };
      slab.addEventListener('pointerup', end); slab.addEventListener('pointercancel', end);
      slab.addEventListener('keydown', (e) => { const d = { ArrowUp: 5, ArrowRight: 5, ArrowDown: -5, ArrowLeft: -5 }[e.key]; if (d) { e.preventDefault(); spec.set(clamp(spec.pct() + d, 0, 100)); } });
    }
    const big = h('div', { class: 'cpage-value' }, spec.text(p));
    const paint = () => { slab.firstChild.style.height = `${drag}%`; big.textContent = spec.text(drag); slab.classList.toggle('on', drag > 0); };

    // warmth or colour: a field to drag in
    let panel = null;
    if (field) {
      const warm = field === 'warmth', lo = a.min_color_temp_kelvin || 2000, hi = a.max_color_temp_kelvin || 6500;
      const hs = a.hs_color || [30, 0], k = a.color_temp_kelvin || 2700;
      const dot = h('div', { class: 'cfield-dot', style: warm ? `left:${clamp(((k - lo) / (hi - lo)) * 100, 0, 100)}%;top:50%` : `left:${(hs[0] / 360) * 100}%;top:${100 - hs[1]}%` });
      const box = h('div', { class: 'cfield ' + field, 'aria-label': warm ? 'Warmth' : 'Colour' }, dot);
      const pick = (e, final) => {
        const r = box.getBoundingClientRect(), x = clamp((e.clientX - r.left) / r.width, 0, 1), y = clamp((e.clientY - r.top) / r.height, 0, 1);
        dot.style.left = `${x * 100}%`; if (!warm) dot.style.top = `${y * 100}%`;
        send(() => call('light', 'turn_on', warm ? { color_temp_kelvin: Math.round(lo + x * (hi - lo)) } : { hs_color: [Math.round(x * 360), Math.round((1 - y) * 100)] }, entity), final);
      };
      let down = false;
      box.addEventListener('pointerdown', (e) => { down = true; box.setPointerCapture(e.pointerId); sliding.active = true; pick(e); });
      box.addEventListener('pointermove', (e) => { if (down) pick(e); });
      const up = (e) => { if (!down) return; down = false; pick(e, true); sliding.active = false; };
      box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
      panel = h('div', { class: 'cpage-panel' }, box,
        h('div', { class: 'cfield-note' }, warm ? `Warmth ${k} K` : `Colour ${Math.round(hs[0])}° · ${Math.round(hs[1])}%`),
        spec.warmth && spec.colour ? h('div', { class: 'cpage-chips' },
          h('button', { class: 'chip small' + (warm ? ' on' : ''), onclick: () => { field = 'warmth'; draw(); } }, h('span', { class: 'swatch warm' }), 'Warmth'),
          h('button', { class: 'chip small' + (!warm ? ' on' : ''), onclick: () => { field = 'colour'; draw(); } }, h('span', { class: 'swatch hue' }), 'Colour')) : null);
    }
    const art = domainOf(entity) === 'media_player' ? app.artUrl?.(entity) : '';
    inner.replaceChildren(...nodes(
      h('div', { class: 'cpage-head' },
        h('button', { class: 'round', 'aria-label': 'Back', onclick: close }, icon('left')),
        h('div', { class: 'cpage-title' }, h('h1', {}, title), spec.sub?.() ? h('div', { class: 'sub' }, spec.sub()) : null),
        h('span', { class: 'round ghost-spacer', 'aria-hidden': 'true' })),
      h('div', { class: 'cpage-body' + (panel ? ' two' : '') },
        art ? h('img', { class: 'cpage-art', src: art, alt: '' }) : null,
        h('div', { class: 'cpage-main' }, big, slab,
          h('button', { class: 'pill' + (lit ? ' on' : ''), 'aria-pressed': String(lit), onclick: spec.press }, spec.pill())),
        panel)));
  };
  const off = app.conn.on(() => { if (!sliding.active && drag == null && page.isConnected) draw(); });
  // Swipe in from the left edge to go back, as on the other full pages.
  let sw = null;
  page.addEventListener('pointerdown', (e) => { sw = e.clientX < 36 ? { x: e.clientX, y: e.clientY } : null; });
  page.addEventListener('pointermove', (e) => { if (sw && e.clientX - sw.x > 80 && Math.abs(e.clientY - sw.y) < e.clientX - sw.x) { sw = null; close(); } });
  document.getElementById('app').append(page);
  draw();
  return true;
}
/** Used by the pop-up of controls: in a theme with slab pages, open the page instead. */
app.controlPage = (c, label) => document.documentElement.dataset.pages === 'slab' && openControlPage(c.entity, label || entityName(c.entity));
