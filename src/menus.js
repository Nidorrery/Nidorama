// User-defined controls: shortcuts in the More menu, the user's own drop-down menus, and (with the
// designer) buttons placed on or beside a plan. Nothing here is fixed by the app: every shortcut
// is something the user chose to add, and can remove.
//
// A control item is { id, name, entity, stateEntity?, type? }. `type: 'all-lights-off'` is the one
// built-in action; everything else acts on its Home Assistant entity (toggle, run, or climate).
import { h, nodes, icon, st, toggle, stateText, iconFor, iconOf, pickIcon, entityName, menuItem, modal, pickEntity, isOn, domainOf, app, climateTone, toneClass } from './ui.js';
import { mutate } from './store.js';
import { uid } from './catalog.js';

/** The user's own More-menu shortcuts. Nothing is there unless they (or the home file) put it there. */
export const moreItems = (home) => home.more || [];
const editable = (home) => (home.more ||= []);

/** One control as a menu row: a climate row with − / +, a run / toggle row, or the built-in action. */
export function controlRow(item, { allLightsOff, done }) {
  if (item.type === 'all-lights-off') return menuItem(iconOf(item), item.name, null, () => { allLightsOff(); done?.(); });
  const ent = item.entity, s = st(ent), d = domainOf(ent || '');
  if (d === 'climate') {
    const a = s?.attributes || {}, on = s && s.state !== 'off', step = a.target_temp_step || 0.5;
    const set = (dir) => app.conn.call('climate', 'set_temperature', { temperature: Math.min(a.max_temp ?? 30, Math.max(a.min_temp ?? 5, (a.temperature ?? 20) + dir * step)) }, ent);
    return h('div', { class: 'menu-row heat' }, icon(iconOf(item)),
      h('span', { class: 'grow' }, item.name, h('span', { class: 'sub' }, s ? `${a.current_temperature ?? '–'}° now · set ${a.temperature ?? '–'}°` : 'not found')),
      h('button', { class: 'round small', onclick: () => set(-1), disabled: !s, 'aria-label': `${item.name} cooler` }, '−'),
      h('button', { class: 'round small', onclick: () => set(1), disabled: !s, 'aria-label': `${item.name} warmer` }, '+'),
      h('button', { class: 'tog' + (on ? ' on' : '') + toneClass(ent), disabled: !s, 'aria-label': `${item.name} on/off`, onclick: () => toggle(ent) }, icon(climateTone(ent) === 'cool' ? 'snow' : 'flame')));
  }
  const shown = item.stateEntity || ent, ss = st(shown);
  const lit = item.stateEntity ? ss && !/^(off|manual|override|unavailable)$/i.test(ss.state) : isOn(ss);
  const sub = item.stateEntity ? ss?.state || '' : stateText(ent);
  return menuItem(item.icon || (d === 'script' || d === 'scene' || d === 'automation' ? 'auto' : iconFor(ent)), item.name, sub, () => toggle(ent), h('span', { class: 'lamp-dot' + (lit ? ' on' + (item.stateEntity ? ' green' : '') : '') }));
}

/** Add one shortcut: choose what it runs or switches, then its name and icon, in one go. */
export async function addShortcut(home, done) {
  const entity = await pickEntity({ title: 'What should the shortcut run or switch?' });
  if (!entity) return;
  const item = { id: uid('c'), name: entityName(entity), entity };
  const nameIn = h('input', { type: 'text', value: item.name });
  const body = h('div', { class: 'menu' });
  const close = modal(body);
  const draw = () => body.replaceChildren(...nodes(
    h('div', { class: 'panel-head' }, h('h2', {}, 'New shortcut'), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
    h('label', { class: 'field wide-field' }, h('span', {}, 'Name'), nameIn),
    h('div', { class: 'row pad' }, h('div', { class: 'row-label' }, h('div', {}, 'Icon'), h('div', { class: 'sub' }, entity)),
      h('button', { class: 'round', 'aria-label': 'Choose icon', onclick: async () => { item.name = nameIn.value; const ic = await pickIcon({ current: item.icon, suggested: iconOf({ entity }) }); if (ic != null) { if (ic) item.icon = ic; else delete item.icon; } draw(); } }, icon(iconOf(item)))),
    h('button', { class: 'wide primary', onclick: () => { item.name = nameIn.value.trim() || entityName(entity); mutate(home, (hm) => (hm.more ||= []).push(item), { undoable: false }); close(); done?.(); } }, icon('plus'), 'Add to More')));
  draw();
}

/** The "Customise menus" screen. `changed` is called after every edit. */
/** The shortcut and menu editor. Shown inside More while editing; `draw` is called after each change. */
export function menuEditor(getHome, { changed, draw }) {
  const edit = (fn) => { const hm = getHome(); mutate(hm, fn, { undoable: false }); changed(); draw(); };
  const addEntity = async (title, push) => {
    const entity = await pickEntity({ title });
    if (!entity) return;
    const name = prompt('Name shown on the button', entityName(entity));
    if (name != null) edit((hm) => push(hm, { id: uid('c'), name: name.trim() || entityName(entity), entity }));
  };
  // One row per shortcut: its name, then only Edit and Delete (#64). Icon, name and order are in Edit.
  const editItem = (item, list, label) => {
    const body = h('div', { class: 'menu' });
    const close = modal(body);
    const find = (hm) => list(hm).find((q) => q.id === item.id);
    const nameIn = h('input', { type: 'text', value: item.name });
    nameIn.addEventListener('change', () => { const n = nameIn.value.trim(); if (n) edit((hm) => (find(hm).name = n)); });
    const move = (dir) => edit((hm) => { const l = list(hm), i = l.findIndex((x) => x.id === item.id), j = i + dir; if (j >= 0 && j < l.length) l.splice(j, 0, l.splice(i, 1)[0]); });
    const redraw = () => {
      const now = find(getHome()) || item;
      body.replaceChildren(...nodes(
        h('div', { class: 'panel-head' }, h('h2', {}, 'Edit shortcut'), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
        h('p', { class: 'hint' }, now.type === 'all-lights-off' ? 'Turns off every light on the plans.' : now.entity),
        h('label', { class: 'field wide-field' }, h('span', {}, 'Name'), nameIn),
        h('div', { class: 'row pad' }, h('div', { class: 'row-label' }, 'Icon'),
          h('button', { class: 'round', 'aria-label': 'Choose icon', onclick: async () => { const ic = await pickIcon({ current: now.icon, suggested: iconOf({ ...now, icon: '' }) }); if (ic != null) { edit((hm) => { const x = find(hm); if (ic) x.icon = ic; else delete x.icon; }); redraw(); } } }, icon(iconOf(now)))),
        h('div', { class: 'row pad' }, h('div', { class: 'row-label' }, `Place in ${label}`),
          h('button', { class: 'round small', 'aria-label': 'Move up', onclick: () => move(-1) }, icon('up')),
          h('button', { class: 'round small', 'aria-label': 'Move down', onclick: () => move(1) }, icon('down'))),
        h('button', { class: 'wide primary', onclick: () => { const n = nameIn.value.trim(); if (n && n !== now.name) edit((hm) => (find(hm).name = n)); close(); } }, icon('check'), 'Done')));
    };
    redraw();
  };
  const itemRow = (item, list, label) => h('div', { class: 'row pad short-row' },
    icon(iconOf(item)),
    h('div', { class: 'row-label' }, h('div', { class: 'clip' }, item.name), h('div', { class: 'sub clip' }, item.type === 'all-lights-off' ? 'turns off every light on the plans' : item.entity)),
    h('button', { class: 'round small', 'aria-label': `Edit ${item.name}`, onclick: () => editItem(item, list, label) }, icon('edit')),
    h('button', { class: 'round small', 'aria-label': `Remove ${item.name} from ${label}`, onclick: () => edit((hm) => { const l = list(hm); l.splice(l.findIndex((x) => x.id === item.id), 1); }) }, icon('trash')));
  {
    const hm = getHome(), more = moreItems(hm);
    return nodes(
      h('p', { class: 'hint' }, 'Shown at the top of the More menu on every dashboard of this home. Any light, switch, scene, script, automation or heating. Tap the pencil on a row to change its name, icon or place.'),
      more.map((i) => itemRow(i, editable, 'the More menu')),
      !more.length ? h('p', { class: 'hint' }, 'No shortcuts.') : null,
      h('div', { class: 'btns pad' },
        h('button', { class: 'wide ghost', onclick: () => addShortcut(getHome(), () => { changed(); draw(); }) }, icon('plus'), 'Add a shortcut'),
        !more.some((i) => i.type === 'all-lights-off') ? h('button', { class: 'wide ghost', onclick: () => edit((x) => editable(x).push({ id: 'all-lights-off', name: 'All lights off', type: 'all-lights-off' })) }, icon('power'), 'All lights off') : null),
      h('div', { class: 'msep' }),
      h('h3', { class: 'pad' }, 'Your own menus'),
      h('p', { class: 'hint' }, 'Each menu is a button beside the plan that opens its own list, like More.'),
      (hm.menus || []).map((m) => [
        h('div', { class: 'home-head' }, h('h3', {}, m.name),
          h('button', { class: 'round small', 'aria-label': `Rename menu ${m.name}`, onclick: () => { const n = prompt('Menu name', m.name); if (n) edit((x) => (x.menus.find((q) => q.id === m.id).name = n.trim())); } }, icon('edit')),
          h('button', { class: 'round small', 'aria-label': `Delete menu ${m.name}`, onclick: () => { if (confirm(`Delete the menu "${m.name}"?`)) edit((x) => (x.menus = x.menus.filter((q) => q.id !== m.id))); } }, icon('trash'))),
        m.items.map((i) => itemRow(i, (x) => x.menus.find((q) => q.id === m.id).items, m.name)),
        h('div', { class: 'btns pad' }, h('button', { class: 'wide ghost', onclick: () => addEntity(`Add to ${m.name}`, (x, item) => x.menus.find((q) => q.id === m.id).items.push(item)) }, icon('plus'), `Add to ${m.name}`))]),
      h('div', { class: 'btns pad' }, h('button', { class: 'wide', onclick: () => { const n = prompt('Name of the new menu', 'Scenes'); if (n) edit((x) => (x.menus ||= []).push({ id: uid('menu'), name: n.trim(), items: [] })); } }, icon('plus'), 'New menu')),
      h('p', { class: 'hint' }, 'Buttons for a room, or beside the plan for a whole floor, are added with the Button tool on a floor plan.'));
  }
}
