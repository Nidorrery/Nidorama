// Tile dashboards: a dashboard without a floor plan, made of buttons the user arranges.
// Every tile is a control (see controls.js), so it can be resized, coloured and given sub-buttons.
import { h, nodes, icon, pickEntity, modal, menuItem, app } from './ui.js';
import { mutate } from './store.js';
import { uid } from './catalog.js';
import { controlTile, editControl, newControl, tileSize } from './controls.js';
import { FONTS } from './themes.js';

/** The controls a room starts with: its main light, its lamps as one group, then everything else connected to it. */
export function defaultRoomControls(L, roomId) {
  const rc = L.roomControls?.[roomId] || {}, out = [], seen = new Set();
  const add = (c) => { if (c.entity && seen.has(c.entity)) return; if (c.entity) seen.add(c.entity); out.push(c); };
  if (rc.mainLight) add({ id: `${roomId}-main`, entity: rc.mainLight, name: L.lights.find((l) => l.entity === rc.mainLight && l.kind === 'ceiling')?.name || 'Main light' });
  const lamps = L.lights.filter((l) => l.room === roomId && l.kind !== 'ceiling' && l.entity);
  const group = rc.lampGroup?.[0];
  if (group || lamps.length > 1) {
    if (group) seen.add(group.entity);
    out.push({ id: `${roomId}-lamps`, entity: group?.entity || '', name: group?.name || 'Lamps', subs: lamps.filter((l) => l.entity !== group?.entity).map((l) => ({ id: l.id, entity: l.entity, name: l.name })) });
    for (const l of lamps) seen.add(l.entity);
  } else for (const l of lamps) add({ id: l.id, entity: l.entity, name: l.name });
  for (const o of L.objects) if (o.room === roomId && o.entity) add({ id: o.id, entity: o.entity, name: o.name });
  for (const b of L.buttons || []) if (b.at && b.entity && inRoom(L, roomId, b.at)) add({ id: b.id, entity: b.entity, name: b.name, icon: b.icon });
  for (const x of rc.extras || []) add({ id: `${roomId}-x-${x.entity}`, entity: x.entity, name: x.name });
  for (const k of ['climate', 'fan', 'cover']) if (rc[k]) add({ id: `${roomId}-${k}`, entity: rc[k], name: k[0].toUpperCase() + k.slice(1) });
  return out;
}
function inRoom(L, roomId, p) {
  const poly = L.rooms.find((r) => r.id === roomId)?.polygon;
  if (!poly) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** A room's controls as the user arranged them, or the starting set. */
export const roomControlsOf = (L, roomId) => L.roomPanels?.[roomId]?.controls || defaultRoomControls(L, roomId);

/** Fill a dashboard from what the home's plans already know: one section per room. */
export function generateSections(home, levels = home.levels) {
  const sections = [];
  for (const L of levels) {
    for (const r of L.rooms) {
      const tiles = roomControlsOf(L, r.id).map((c) => ({ ...structuredClone(c), id: uid('t'), w: (c.subs || []).length ? 2 : 1, h: 1 }));
      if (tiles.length) sections.push({ id: uid('s'), title: home.levels.length > 1 ? `${r.name} · ${L.name}` : r.name, tiles });
    }
  }
  return sections;
}

/** A copy of a page's sections with ids of their own (and no tabs: they belonged to the other page). */
const copySections = (pg) => (pg.sections || []).filter((x) => (x.tiles || []).length).map((x) => ({ id: uid('s'), title: pg.tabs?.length || !x.title ? `${x.title || pg.name}` : x.title, ...(x.hideTitle ? { hideTitle: true } : {}),
  tiles: x.tiles.map((t) => ({ ...structuredClone(t), id: uid('t'), ...(t.subs ? { subs: t.subs.map((b) => ({ ...b, id: uid('c') })) } : {}) })) }));
/**
 * A new Widgets page. `from` (#93) lists the dashboards it starts from: `{ kind: 'level', id }`
 * gives the widgets of that plan's rooms, `{ kind: 'page', id }` a copy of that page's widgets.
 * `fill` (older callers) = every plan.
 */
export function newPage(home, name = 'Home', { fill = false, isPrivate = false, from = null } = {}) {
  const picked = from || (fill ? home.levels.map((L) => ({ kind: 'level', id: L.id })) : []);
  const sections = picked.flatMap((d) => (d.kind === 'level'
    ? generateSections(home, home.levels.filter((L) => L.id === d.id))
    : copySections((home.pages || []).find((x) => x.id === d.id) || {})));
  const page = { id: uid('page'), name, sections };
  if (isPrivate) page.private = true;
  if (!page.sections.length) page.sections.push({ id: uid('s'), title: 'Favourites', tiles: [] });
  mutate(home, (hm) => (hm.pages ||= []).push(page));
  return page;
}

const tabShown = new Map(); // page id → the tab being looked at
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * In edit mode a button can be picked up and moved (hold it, then drag it onto another button or
 * into another section) and resized by dragging its corner (#62).
 */
function arrange(el, tile, section, page, change) {
  el.classList.add('movable');
  el.dataset.tile = tile.id;
  let dragging = false, moved = false;
  el.addEventListener('click', (e) => { if (moved) { e.stopImmediatePropagation(); e.preventDefault(); moved = false; } }, true);
  el.addEventListener('touchmove', (e) => { if (dragging) e.preventDefault(); }, { passive: false });
  // --- resize from the corner
  const grip = h('span', { class: 'tile-grip', role: 'button', 'aria-label': `Resize ${tile.name || 'button'}`, title: 'Drag to resize' });
  el.append(grip);
  grip.addEventListener('click', (e) => e.stopPropagation());
  grip.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const cs = getComputedStyle(el.parentElement), tracks = cs.gridTemplateColumns.split(' ');
    const gap = parseFloat(cs.columnGap) || 10, colW = parseFloat(tracks[0]) || 150, cols = tracks.length;
    const r = el.getBoundingClientRect(), cur = tileSize(tile), rowH = (r.height - (cur.h - 1) * gap) / cur.h;
    let w = cur.w, ht = cur.h;
    dragging = true;
    el.classList.add('resizing');
    const move = (ev) => {
      w = clamp(Math.round((ev.clientX - r.left + gap) / (colW + gap)), 1, cols);
      ht = clamp(Math.round((ev.clientY - r.top + gap) / (rowH + gap)), 1, 8);
      el.style.gridColumn = `span ${w}`; el.style.gridRow = `span ${ht}`;
      grip.dataset.size = `${w} × ${ht}`;
    };
    const up = () => {
      grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
      dragging = false;
      el.classList.remove('resizing');
      if (w !== cur.w || ht !== cur.h) change(() => { tile.w = w; tile.h = ht; delete tile.size; });
    };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
  });
  // --- hold, then drag to move
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.tile-grip') || e.button > 0) return;
    const x0 = e.clientX, y0 = e.clientY;
    let timer = null, target = null;
    const early = (ev) => { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) stopWaiting(); };
    const stopWaiting = () => { clearTimeout(timer); el.removeEventListener('pointermove', early); el.removeEventListener('pointerup', stopWaiting); el.removeEventListener('pointercancel', stopWaiting); };
    const mark = (t) => { if (target !== t) { target?.classList.remove('drop'); target = t; target?.classList.add('drop'); } };
    const move = (ev) => {
      el.style.transform = `translate(${ev.clientX - x0}px, ${ev.clientY - y0}px) scale(1.04)`;
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 6) moved = true;
      const under = document.elementsFromPoint(ev.clientX, ev.clientY).find((n) => n !== el && !el.contains(n) && n.matches?.('.tile, .tiles'));
      mark(under || null);
    };
    const drop = (ev) => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', drop); el.removeEventListener('pointercancel', drop);
      dragging = false;
      el.classList.remove('dragging');
      el.style.transform = '';
      const t = target;
      mark(null);
      if (!t || ev.type === 'pointercancel') return;
      const toSection = page.sections.find((s) => s.id === (t.closest('.tiles') || t).dataset.section);
      if (!toSection) return;
      change(() => {
        section.tiles.splice(section.tiles.indexOf(tile), 1);
        const other = toSection.tiles.find((x) => x.id === t.dataset.tile);
        if (!other) return toSection.tiles.push(tile);
        const r = t.getBoundingClientRect(), after = ev.clientX > r.left + r.width / 2;
        toSection.tiles.splice(toSection.tiles.indexOf(other) + (after ? 1 : 0), 0, tile);
      });
    };
    timer = setTimeout(() => {
      stopWaiting();
      dragging = true;
      navigator.vibrate?.(12);
      try { el.setPointerCapture(e.pointerId); } catch {}
      el.classList.add('dragging');
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', drop); el.addEventListener('pointercancel', drop);
    }, 260);
    el.addEventListener('pointermove', early); el.addEventListener('pointerup', stopWaiting); el.addEventListener('pointercancel', stopWaiting);
  });
}

/** Render a tile dashboard. `rerender(gone)` is called after the user changes it. */
/** "Add widget": choose what kind, then what it shows. Resolves with a new tile, or null. */
function chooseWidget(title, rooms) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; close(); resolve(v); };
    const ent = (kind, domains, size, what) => async () => { const e = await pickEntity({ title: what, domains }); finish(e ? { ...newControl(e), ...(kind ? { kind } : {}), ...size } : null); };
    const body = h('div', { class: 'menu' });
    const close = modal(body, { onclose: () => finish(null) });
    const main = () => body.replaceChildren(...nodes(
      h('div', { class: 'panel-head' }, h('h2', {}, title), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => finish(null) }, icon('close'))),
      menuItem('bulb', 'Device, scene or script', 'a light, switch, fan, blind, heating, speaker…', ent('', null, {}, 'What does it control?'), icon('chevron')),
      menuItem('cloud', 'Weather', 'now: temperature, conditions, humidity, wind', ent('weather', ['weather'], { w: 2, h: 1 }, 'Which weather?'), icon('chevron')),
      menuItem('camera', 'Camera', 'a live picture from a camera in your home system', ent('camera', ['camera'], { w: 2, h: 2 }, 'Which camera?'), icon('chevron')),
      menuItem('thermo', 'Reading', 'a temperature, humidity, power or any sensor, shown large', ent('sensor', ['sensor', 'binary_sensor'], {}, 'Which sensor?'), icon('chevron')),
      menuItem('flame', 'Thermostat', 'the set temperature, large, with down and up', ent('thermostat', ['climate'], { w: 2, h: 2 }, 'Which heating or cooling?'), icon('chevron')),
      menuItem('music', 'Music', 'what a speaker is playing, with play, pause and skip', ent('music', ['media_player'], { w: 2, h: 2 }, 'Which speaker or player?'), icon('chevron')),
      menuItem('clock', 'Clock', 'the time and date', () => finish({ id: uid('c'), kind: 'clock', name: 'Clock', w: 2, h: 1 })),
      menuItem('clock', 'Clock with hands', 'a clock face', () => finish({ id: uid('c'), kind: 'clock', face: 'analog', name: 'Clock', w: 1, h: 1 })),
      menuItem('grid', 'Calendar', 'this month; add a calendar from your home system for the next event', async () => {
        const has = [...(app.conn?.states.values() || [])].some((x) => x.entity_id.startsWith('calendar.'));
        const e = has ? await pickEntity({ title: 'Which calendar? (close this for none)', domains: ['calendar'] }) : '';
        finish({ id: uid('c'), kind: 'calendar', name: 'Calendar', entity: e || '', w: 2, h: 2 });
      }),
      menuItem('bell', 'Announce', 'type a message and a speaker says it', ent('announce', ['media_player'], {}, 'Which speaker?'), icon('chevron')),
      rooms?.length ? menuItem('room', 'Room', 'opens that room\'s controls', () => body.replaceChildren(...nodes(
        h('div', { class: 'panel-head' }, h('button', { class: 'round small', 'aria-label': 'Back', onclick: main }, icon('left')), h('h2', {}, 'Which room?')),
        rooms.map((r) => menuItem('room', r.name, null, () => finish({ id: uid('c'), kind: 'room', room: r.id, name: r.name }))))), icon('chevron')) : null,
      rooms ? menuItem('power', 'All lights off', 'switches off every light on the plans', () => finish({ id: uid('c'), kind: 'alloff', name: 'All lights off', w: 2, h: 1 })) : null));
    main();
  });
}

export function renderPage(home, page, { editing, rerender, embedded = false, actions = null, rooms = null }) {
  // Lettering of the widgets on this page (#72): a font, and a size.
  const root = h('div', { class: 'page' + (page.fontSize ? ` fs-${page.fontSize}` : ''), style: FONTS[page.font] ? `font-family:${FONTS[page.font][1]}` : null });
  const change = (fn) => { mutate(home, fn, { undoable: false }); rerender(); };
  // Tabs (#62): a page can be split into tabs, each with its own sections. With no tabs, everything shows.
  const tabs = page.tabs || [];
  const tab = tabs.length ? tabs.find((t) => t.id === tabShown.get(page.id)) || tabs[0] : null;
  const inTab = (s) => !tab || (s.tab || tabs[0].id) === tab.id;
  const cols = page.columns ? clamp(Math.round(page.columns), 2, 30) : 0;
  const addTab = () => {
    const n = prompt('Name of the new tab', tabs.length ? `Tab ${tabs.length + 1}` : 'More');
    if (!n || !n.trim()) return;
    const id = uid('tab');
    tabShown.set(page.id, id);
    change(() => { if (!page.tabs?.length) page.tabs = [{ id: uid('tab'), name: 'Main' }]; page.tabs.push({ id, name: n.trim() }); page.sections.push({ id: uid('s'), title: 'New section', tiles: [], tab: id }); });
  };
  if (editing) {
    const colLabel = h('span', { class: 'sub' }, cols ? `${cols} columns` : 'automatic');
    const range = h('input', { type: 'range', min: 2, max: 30, step: 1, value: cols || 6, 'aria-label': 'Columns in the grid' });
    range.addEventListener('input', () => { colLabel.textContent = `${range.value} columns`; for (const g of root.querySelectorAll('.tiles')) { g.classList.add('fixed'); g.style.setProperty('--cols', range.value); } });
    range.addEventListener('change', () => change(() => (page.columns = +range.value)));
    root.append(h('div', { class: 'page-tools' },
      embedded ? null : h('button', { class: 'chip', onclick: () => { const n = prompt('Dashboard name', page.name); if (n) change(() => (page.name = n.trim())); } }, icon('edit'), 'Rename'),
      h('button', { class: 'chip', onclick: () => change(() => page.sections.push({ id: uid('s'), title: 'New section', tiles: [], ...(tab && tab !== tabs[0] ? { tab: tab.id } : {}) })) }, icon('plus'), 'Section'),
      h('button', { class: 'chip', onclick: addTab }, icon('plus'), 'Tab'),
      embedded ? null : h('button', { class: 'chip' + (page.private ? ' on' : ''), 'aria-pressed': String(!!page.private), onclick: () => change(() => { if (page.private) delete page.private; else page.private = true; }) }, icon(page.private ? 'lock' : 'home'), page.private ? 'Only me' : 'Shared with the home'),
      embedded ? null : h('button', { class: 'chip', onclick: () => { if (confirm('Replace this dashboard with widgets for every room on the plans?')) change(() => { page.sections = generateSections(home); delete page.tabs; }); } }, icon('plan'), 'Fill from plans'),
      embedded ? null : h('button', { class: 'chip danger', onclick: () => { if (confirm(`Delete the dashboard "${page.name}"?`)) { mutate(home, () => (home.pages = home.pages.filter((p) => p !== page)), { undoable: false }); rerender(true); } } }, icon('trash'), 'Delete')),
      h('div', { class: 'grid-tool' }, h('div', { class: 'row-label' }, h('div', {}, 'Grid'), colLabel), range,
        cols ? h('button', { class: 'chip small', onclick: () => change(() => delete page.columns) }, 'Automatic') : null),
      h('div', { class: 'grid-tool' }, h('div', { class: 'row-label' }, 'Lettering'),
        h('select', { 'aria-label': 'Font of the widgets', onchange: (e) => change(() => { if (e.target.value) page.font = e.target.value; else delete page.font; }) },
          [h('option', { value: '', selected: !page.font }, 'As the theme'), ...Object.entries(FONTS).map(([k, f]) => h('option', { value: k, selected: k === page.font }, f[0]))]),
        h('select', { 'aria-label': 'Size of the lettering', onchange: (e) => change(() => { if (e.target.value) page.fontSize = e.target.value; else delete page.fontSize; }) },
          [['s', 'Small'], ['', 'Normal'], ['l', 'Large'], ['xl', 'Extra large']].map(([k, l]) => h('option', { value: k, selected: k === (page.fontSize || '') }, l)))),
      h('p', { class: 'hint' }, 'Tap a widget to change it. Hold a widget, then drag it to move it. Drag its corner to resize it. The grid slider sets how many squares fit across.'));
  }
  if (tabs.length) {
    root.append(h('div', { class: 'tabs', role: 'tablist' }, tabs.map((t) => h('button', { class: 'tab' + (t === tab ? ' on' : ''), role: 'tab', 'aria-selected': String(t === tab), onclick: () => { tabShown.set(page.id, t.id); rerender(); } }, t.name)),
      editing ? [
        h('button', { class: 'round small', 'aria-label': `Rename the tab ${tab.name}`, onclick: () => { const n = prompt('Tab name', tab.name); if (n && n.trim()) change(() => (tab.name = n.trim())); } }, icon('edit')),
        h('button', { class: 'round small', 'aria-label': `Move the tab ${tab.name} left`, disabled: tabs[0] === tab, onclick: () => change(() => { const i = tabs.indexOf(tab), first = tabs[0].id; for (const s of page.sections) s.tab ||= first; tabs.splice(i - 1, 0, tabs.splice(i, 1)[0]); }) }, icon('left')),
        h('button', { class: 'round small', 'aria-label': `Delete the tab ${tab.name}`, onclick: () => {
          if (!confirm(`Delete the tab "${tab.name}"? Its sections move to ${tabs.find((t) => t !== tab).name}.`)) return;
          tabShown.delete(page.id);
          change(() => {
            const first = tabs[0].id, keep = tabs.find((t) => t !== tab).id;
            for (const s of page.sections) { s.tab ||= first; if (s.tab === tab.id) s.tab = keep; }
            page.tabs = tabs.filter((t) => t !== tab);
            if (page.tabs.length < 2) { delete page.tabs; for (const s of page.sections) delete s.tab; }
          });
        } }, icon('trash'))] : null));
  }
  for (const section of page.sections.filter(inTab)) {
    const head = h('div', { class: 'section-head' + (section.hideTitle ? ' name-hidden' : '') }, h('h3', {}, section.title));
    if (editing) {
      head.append(
        h('button', { class: 'chip small' + (section.hideTitle ? ' on' : ''), 'aria-pressed': String(!!section.hideTitle), title: 'Show or hide this section\'s name outside edit mode', onclick: () => change(() => { if (section.hideTitle) delete section.hideTitle; else section.hideTitle = true; }) }, section.hideTitle ? 'Name hidden' : 'Hide name'),
        h('button', { class: 'round small', 'aria-label': `Rename section ${section.title}`, onclick: () => { const n = prompt('Section title', section.title); if (n != null) change(() => (section.title = n.trim())); } }, icon('edit')),
        h('button', { class: 'round small', 'aria-label': `Move section ${section.title} up`, onclick: () => change(() => { const i = page.sections.indexOf(section); if (i > 0) page.sections.splice(i - 1, 0, page.sections.splice(i, 1)[0]); }) }, icon('up')),
        h('button', { class: 'round small', 'aria-label': `Delete section ${section.title}`, onclick: () => { if (!section.tiles.length || confirm(`Delete the section "${section.title}"?`)) change(() => page.sections.splice(page.sections.indexOf(section), 1)); } }, icon('trash')));
    }
    const edit = (tile) => {
      const ed = editControl(tile, {
        save: (fn) => change(() => fn(tile)),
        remove: () => change(() => section.tiles.splice(section.tiles.indexOf(tile), 1)),
        move: (dir) => { change(() => { const i = section.tiles.indexOf(tile), j = i + dir; if (j >= 0 && j < section.tiles.length) { section.tiles.splice(i, 1); section.tiles.splice(j, 0, tile); } }); ed.redraw(); },
      });
    };
    const grid = h('div', { class: 'tiles' + (cols ? ' fixed' : ''), style: cols ? `--cols:${cols}` : null, 'data-section': section.id }, section.tiles.map((t) => {
      const el = controlTile(t, { editing, edit, actions });
      if (cols) el.style.gridColumn = `span ${Math.min(tileSize(t).w, cols)}`;
      if (editing) arrange(el, t, section, page, change);
      return el;
    }));
    if (editing) {
      grid.append(h('button', { class: 'tile add', onclick: async () => {
        const t = await chooseWidget(`Add a widget to ${section.title || 'this section'}`, rooms || (embedded ? [] : null));
        if (t) { change(() => section.tiles.push(t)); if (!t.kind) edit(t); }
      } }, icon('plus'), h('div', { class: 'tile-name' }, 'Add widget')));
    }
    root.append(h('section', {}, editing || !section.hideTitle ? head : null, grid));
  }
  if (!page.sections.some((s) => s.tiles.length) && !editing) root.append(h('p', { class: 'hint' }, 'Nothing here yet. Open More → Edit to add widgets.'));
  return root;
}
