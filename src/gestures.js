// Gestures on things on the floor plan (#41): what tap, hold, a sideways swipe and an up-and-down
// swipe each do, chosen per item. Every gesture names an entity (empty = the item's own) and an
// action. Items without settings get sensible defaults from their own entity.
//
//   gestures: { tap:    { entity?, action: toggle | on | off | details | none },
//               hold:   { entity?, action: … },      action 'steps' runs `steps: [...]` (see steps.js)
//               swipeX: { entity?, what: brightness | speed | temperature | position | volume | none },
//               swipeY: { … } }
import { st, isDimmable, brightnessPct, domainOf, app } from './ui.js';

export const TAP_ACTIONS = [['toggle', 'Switch'], ['on', 'Turn on'], ['off', 'Turn off'], ['details', 'Show controls'], ['steps', 'Run a list of steps'], ['none', 'Nothing']];
export const SWIPE_WHATS = [['brightness', 'Brightness'], ['speed', 'Fan speed'], ['temperature', 'Temperature'], ['position', 'Blind position'], ['volume', 'Volume'], ['none', 'Nothing']];

/** What a swipe naturally changes for an entity, or 'none'. */
export function naturalSwipe(entity) {
  const s = st(entity), d = domainOf(entity || '');
  if (d === 'light') return !s || isDimmable(s) ? 'brightness' : 'none';
  if (d === 'fan') return 'speed';
  if (d === 'climate') return 'temperature';
  if (d === 'cover') return 'position';
  if (d === 'media_player') return 'volume';
  return 'none';
}

/** The gesture as it applies: the item's setting, else the default; with the entity filled in. */
export function gestureFor(settings, kind, mainEntity) {
  const g = settings?.[kind];
  const entity = g?.entity || mainEntity || '';
  if (kind === 'tap') return { entity, action: g?.action || 'toggle', steps: g?.steps || [] };
  if (kind === 'hold') return { entity, action: g?.action || 'details', steps: g?.steps || [] };
  if (kind === 'swipeX') return { entity, what: g?.what || naturalSwipe(entity) };
  return { entity, what: g?.what || 'none' }; // swipeY: off unless chosen
}

/** Current value 0–100 of what a swipe changes, and how to set it. */
export function swipeValue(entity, what) {
  const s = st(entity), a = s?.attributes || {};
  if (what === 'brightness') return brightnessPct(s);
  if (what === 'speed') return s?.state === 'on' ? a.percentage ?? 100 : 0;
  if (what === 'position') return a.current_position ?? (s?.state === 'open' ? 100 : 0);
  if (what === 'volume') return Math.round((a.volume_level ?? 0) * 100);
  if (what === 'temperature') { const lo = a.min_temp ?? 5, hi = a.max_temp ?? 30; return (((a.temperature ?? 20) - lo) / (hi - lo)) * 100; }
  return 0;
}
/** Text shown while swiping. */
export function swipeLabel(entity, what, v) {
  if (what === 'temperature') { const a = st(entity)?.attributes || {}, lo = a.min_temp ?? 5, hi = a.max_temp ?? 30, step = a.target_temp_step || 0.5; return `${(Math.round((lo + (v / 100) * (hi - lo)) / step) * step).toFixed(1)}°`; }
  return `${Math.round(v)}%`;
}
export function applySwipe(entity, what, v) {
  const c = app.conn, a = st(entity)?.attributes || {}, d = domainOf(entity);
  if (what === 'brightness') return v <= 0 ? c.call('light', 'turn_off', {}, [entity]) : c.call(d === 'light' ? 'light' : d, 'turn_on', d === 'light' ? { brightness_pct: Math.round(v) } : {}, [entity]);
  if (what === 'speed') return v <= 0 ? c.call('fan', 'turn_off', {}, entity) : c.call('fan', 'set_percentage', { percentage: Math.round(v) }, entity);
  if (what === 'position') return c.call('cover', 'set_cover_position', { position: Math.round(v) }, entity);
  if (what === 'volume') return c.call('media_player', 'volume_set', { volume_level: +(v / 100).toFixed(2) }, entity);
  if (what === 'temperature') { const lo = a.min_temp ?? 5, hi = a.max_temp ?? 30, step = a.target_temp_step || 0.5; return c.call('climate', 'set_temperature', { temperature: Math.round((lo + (v / 100) * (hi - lo)) / step) * step }, entity); }
}
