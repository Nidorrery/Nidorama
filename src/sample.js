// The sample cottage: a small made-up home that shows what the app can do (#81). It is built
// here, not loaded from a file, and nothing in it comes from a real home. Every device in it is
// a pretend one (`*.sample_*`) that the demo mode plays along with.
import { CATALOG, makeObject, uid } from './catalog.js';
import { outlineBox, newPiece, roofLevel } from './site.js';

export function buildSample() {
  const L = { id: uid('level'), name: 'Ground floor', elevation: 0, ceilingHeight: 2.4, walls: [], rooms: [], floors: [], voids: [], stairs: [], objects: [], lights: [], roomControls: {}, buttons: [] };
  const home = { schema: 'nidorama.home/1', id: uid('home'), name: 'Sample cottage', units: 'metres', axes: 'x east, y south, z up from finished floor', homeAssistant: { heating: 'climate.sample_heating' }, levels: [L], pages: [], updatedAt: Date.now() };

  // ----- walls, doors and windows (each window and door in a different style) -----
  const wall = (a, b, exterior, openings = [], extra = {}) => L.walls.push({ id: uid('w'), a, b, thickness: exterior ? 0.2 : 0.1, height: 2.4, exterior, openings: openings.map((o) => ({ id: uid('o'), ...o })), ...extra });
  const win = (offset, width, style) => ({ type: 'window', offset, width, sill: 0.9, head: 2.1, style });
  const door = (offset, width = 0.82, extra = {}) => ({ type: 'door', offset, width, sill: 0, head: 2.04, style: 'hinged', ...extra });
  // The layout is the one in the "plan from a sketch" guide: 9.2 m x 6.5 m, a lounge down the
  // west side, a bedroom, and a short hall that passes the bathroom and ends at the kitchen door.
  wall([0, 0], [9.2, 0], true, [win(1.5, 1.8, 'grid'), win(6.1, 1.5, 'double-hung')]);
  wall([9.2, 0], [9.2, 6.5], true, [win(0.7, 1.4, 'sliding'), win(4.3, 1.2, 'fixed')]);
  wall([9.2, 6.5], [0, 6.5], true, [{ type: 'window', offset: 3.3, width: 0.6, sill: 1.4, head: 2.1, style: 'fixed' }, { type: 'slider', offset: 5.6, width: 2.4, sill: 0, head: 2.1 }]);
  wall([0, 6.5], [0, 0], true, [door(3.6, 0.9, { color: '#2f5d50' })]);
  wall([4.7, 0], [4.7, 2.9], false, [door(1.3)]);
  wall([4.7, 3.7], [4.7, 6.5], false);
  wall([4.7, 2.9], [6.9, 2.9], false);
  wall([4.7, 3.7], [6.9, 3.7], false, [door(0.55, 0.75)]);
  wall([6.9, 3.7], [6.9, 6.5], false);
  wall([6.9, 2.9], [6.9, 3.7], false, [door(0.02, 0.76, { style: 'sliding' })]);
  // the wall between the bedroom and the kitchen is gently curved
  const BOW = 0.3, HALF = 1.15, MID = 8.05;
  wall([6.9, 2.9], [9.2, 2.9], false, [], { bulge: BOW });
  // the same curve as corner points, so the two floors meet under the wall
  const R = (HALF * HALF + BOW * BOW) / (2 * BOW), cy = 2.9 + BOW - R;
  const curve = Array.from({ length: 9 }, (_, i) => { const x = 6.9 + (2 * HALF * i) / 8; return [+x.toFixed(3), +(cy + Math.sqrt(Math.max(0, R * R - (x - MID) ** 2))).toFixed(3)]; });

  // ----- rooms -----
  const room = (id, name, polygon, floor, labelAt, extra = {}) => L.rooms.push({ id, name, polygon, floor, labelAt, ...extra });
  const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  room('living', 'Lounge', box(0, 0, 4.7, 6.5), 'timber-oak', [2.35, 3.9]);
  room('bedroom', 'Bedroom', [[4.7, 0], [9.2, 0], ...[...curve].reverse(), [4.7, 2.9]], 'carpet-cream', [6.95, 1.6]);
  room('hall', 'Hall', box(4.7, 2.9, 6.9, 3.7), 'timber-oak', [5.8, 3.3]);
  room('bathroom', 'Bathroom', box(4.7, 3.7, 6.9, 6.5), 'mosaic-tile', [5.8, 5]);
  room('kitchen', 'Kitchen', [...curve, [9.2, 6.5], [6.9, 6.5]], 'marble-tile', [7.9, 4.3]);
  room('garden', 'Garden', box(0, 6.5, 9.2, 9), 'grass', [4.6, 7.8], { outdoor: true });

  // ----- furniture; lamps and other things are connected to pretend devices -----
  const put = (kind, x, y, roomId, rot = 0, entity = '') => {
    const item = CATALOG.find((c) => c.id === kind);
    if (!item) return null;
    const { object, light } = makeObject(item, x, y, roomId);
    object.rotation = rot;
    L.objects.push(object);
    if (light) { light.entity = entity; L.lights.push(light); } else if (entity) object.entity = entity;
    return object;
  };
  put('rug', 2.35, 2.7, 'living'); put('sofa', 2.35, 1.2, 'living'); put('coffee-table', 2.35, 2.7, 'living');
  put('armchair', 0.9, 4.6, 'living', 90); put('plant', 4.25, 0.5, 'living');
  put('tv-unit', 4.4, 5.1, 'living', 270); put('tv', 4.45, 5.1, 'living', 270, 'media_player.sample_tv');
  put('floor-lamp', 0.5, 0.5, 'living', 0, 'light.sample_floor_lamp'); put('side-table', 3.9, 1.2, 'living');
  put('table-lamp', 3.9, 1.2, 'living', 0, 'light.sample_colour_lamp');
  put('ceiling-fan', 2.35, 3.5, 'living', 0, 'fan.sample_living_fan');
  put('speaker', 4.4, 6.2, 'living', 0, 'media_player.sample_speaker');
  put('camera', 0.25, 3.3, 'living', 0, 'camera.sample_front_door');
  put('bed-queen', 6.95, 1.25, 'bedroom'); put('bedside', 5.85, 0.4, 'bedroom'); put('bedside', 8.05, 0.4, 'bedroom');
  put('table-lamp', 5.85, 0.4, 'bedroom', 0, 'light.sample_bedside');
  put('blind', 9.05, 1.4, 'bedroom', 90, 'cover.sample_bedroom_blind');
  put('kitchen-bench', 8.85, 5.25, 'kitchen', 90); put('fridge', 7.4, 6.1, 'kitchen', 180);
  put('stool', 8.3, 4.7, 'kitchen'); put('stool', 8.3, 5.6, 'kitchen');
  put('pendant', 8.1, 5.15, 'kitchen', 0, 'light.sample_pendant');
  put('bath', 5.8, 6.06, 'bathroom'); put('vanity', 5, 4.6, 'bathroom', 90); put('toilet', 6.5, 4.5, 'bathroom', 270);
  for (const r of ['living', 'bedroom', 'kitchen', 'bathroom']) {
    L.lights.push({ id: uid('light'), name: 'Ceiling light', room: r, kind: 'ceiling', entity: `light.sample_${r}_ceiling` });
    L.roomControls[r] = { mainLight: `light.sample_${r}_ceiling` };
  }
  Object.assign(L.roomControls.living, { fan: 'fan.sample_living_fan', climate: 'climate.sample_heating', temperature: 'sensor.sample_living_temperature' });
  Object.assign(L.roomControls.bedroom, { cover: 'cover.sample_bedroom_blind', temperature: 'sensor.sample_bedroom_temperature' });

  // ----- buttons: on the plan (one of each size) and beside it -----
  const c = (o) => ({ id: uid('c'), ...o });
  const movie = [
    { id: uid('st'), type: 'do', entity: 'light.sample_living_ceiling', action: 'off' },
    { id: uid('st'), type: 'set', entity: 'light.sample_floor_lamp', what: 'brightness', value: 25 },
    { id: uid('st'), type: 'wait', seconds: 1 },
    { id: uid('st'), type: 'do', entity: 'media_player.sample_tv', action: 'on' }];
  L.buttons.push(
    { id: uid('b'), name: 'Front door', entity: 'lock.sample_front_door', icon: 'lock', size: 'small', at: [0.45, 2.3] },
    { id: uid('b'), name: 'Heating', entity: 'climate.sample_heating', icon: 'flame', size: 'expand', at: [3.6, 4.2] },
    { id: uid('b'), name: 'Bedroom blind', entity: 'cover.sample_bedroom_blind', icon: 'blind', size: 'large', at: [8.2, 1.75] },
    { id: uid('b'), name: 'Movie time', entity: 'light.sample_floor_lamp', icon: 'tv', size: 'small', dock: true, gestures: { tap: { action: 'steps', steps: movie } } },
    { id: uid('b'), name: 'Turn left', view: 'left', dock: true }, { id: uid('b'), name: 'Home view', view: 'home', dock: true }, { id: uid('b'), name: 'Turn right', view: 'right', dock: true });
  L.viewButtonsAdded = true;

  // ----- the panel beside the plan when no room is selected -----
  L.panelPage = { id: uid('page'), name: 'Panel', sections: [
    { id: uid('s'), title: 'Today', hideTitle: true, tiles: [
      c({ kind: 'clock', name: 'Clock', w: 2, h: 1 }), c({ kind: 'weather', entity: 'weather.sample_home', name: 'Weather', w: 2, h: 1 })] },
    { id: uid('s'), title: 'Rooms', tiles: [
      c({ kind: 'room', room: 'living', name: 'Lounge' }), c({ kind: 'room', room: 'bedroom', name: 'Bedroom' }), c({ kind: 'room', room: 'kitchen', name: 'Kitchen' }), c({ kind: 'room', room: 'bathroom', name: 'Bathroom' }),
      c({ kind: 'alloff', name: 'All lights off', w: 2, h: 1 })] }] };

  // ----- a Widgets dashboard with one of everything, on two tabs -----
  const t1 = uid('tab'), t2 = uid('tab');
  home.pages.push({ id: uid('page'), name: 'Widgets', tabs: [{ id: t1, name: 'Home' }, { id: t2, name: 'Music and more' }], sections: [
    { id: uid('s'), tab: t1, title: 'At a glance', tiles: [
      c({ kind: 'weather', entity: 'weather.sample_home', name: 'Weather', w: 2, h: 1 }),
      c({ kind: 'clock', name: 'Clock', w: 2, h: 1 }),
      c({ kind: 'clock', face: 'analog', name: 'Clock', w: 1, h: 1 }),
      c({ kind: 'sensor', entity: 'sensor.sample_living_temperature', name: 'Lounge' }),
      c({ kind: 'sensor', entity: 'sensor.sample_humidity', name: 'Humidity' }),
      c({ kind: 'alloff', name: 'All lights off', w: 2, h: 1 })] },
    { id: uid('s'), tab: t1, title: 'Lights', tiles: [
      c({ entity: 'light.sample_living_ceiling', name: 'Lounge', w: 2, h: 1 }),
      c({ entity: 'light.sample_floor_lamp', name: 'Floor lamp' }),
      c({ entity: 'light.sample_colour_lamp', name: 'Colour lamp' }),
      c({ entity: 'light.sample_pendant', name: 'Kitchen pendant', color: '#e9a23b' }),
      c({ name: 'Bedroom', icon: 'moon', entity: 'light.sample_bedroom_ceiling', w: 2, h: 1, subs: [{ id: uid('c'), entity: 'light.sample_bedside', name: 'Bedside', icon: 'bulb' }, { id: uid('c'), entity: 'cover.sample_bedroom_blind', name: 'Blind', icon: 'blind' }] }),
      c({ name: 'Movie time', icon: 'tv', entity: 'light.sample_floor_lamp', tap: 'steps', steps: movie.map((s) => ({ ...s, id: uid('st') })) })] },
    { id: uid('s'), tab: t1, title: 'Comfort and doors', tiles: [
      c({ kind: 'thermostat', entity: 'climate.sample_heating', name: 'Heating', w: 2, h: 2 }),
      c({ entity: 'fan.sample_living_fan', name: 'Ceiling fan', w: 2, h: 1 }),
      c({ entity: 'cover.sample_bedroom_blind', name: 'Bedroom blind', w: 2, h: 1 }),
      c({ entity: 'lock.sample_front_door', name: 'Front door' }),
      c({ kind: 'room', room: 'living', name: 'Lounge' }), c({ kind: 'room', room: 'kitchen', name: 'Kitchen' })] },
    { id: uid('s'), tab: t2, title: 'Music', tiles: [
      c({ kind: 'music', entity: 'media_player.sample_speaker', name: 'Speaker', w: 2, h: 2 }),
      c({ entity: 'media_player.sample_tv', name: 'TV', w: 2, h: 1 }),
      c({ kind: 'announce', entity: 'media_player.sample_speaker', name: 'Announce' })] },
    { id: uid('s'), tab: t2, title: 'Camera and calendar', tiles: [
      c({ kind: 'camera', entity: 'camera.sample_front_door', name: 'Front door', w: 2, h: 2 }),
      c({ kind: 'calendar', entity: '', name: 'Calendar', w: 2, h: 2 })] }] });

  // ----- shortcuts at the top of More -----
  home.more = [{ id: uid('m'), type: 'all-lights-off', name: 'All lights off', icon: 'power' }, { id: uid('m'), name: 'Heating', entity: 'climate.sample_heating', icon: 'flame' }, { id: uid('m'), name: 'Front door', entity: 'lock.sample_front_door', icon: 'lock' }];
  // ----- the whole site (#111, #112): the cottage with a roof, a shed beside it, and the yard -----
  // Every plan dashboard stands on a floor and has its own place in the yard (#115); roofs are dashboards too (#114).
  home.siteV = 2;
  for (const L of home.levels) { L.floor = 0; L.place = { x: 0, y: 0, rot: 0 }; }
  const shed = { id: uid('level'), name: 'Shed', floor: 0, place: { x: 11.5, y: 5.2, rot: 0 }, elevation: 0, ceilingHeight: 2.4, walls: [], rooms: [], floors: [], voids: [], stairs: [], objects: [], lights: [], roomControls: {}, buttons: [], viewButtonsAdded: true, dragButtonAdded: true, navFixed: true };
  const sw = (a, b, openings = []) => shed.walls.push({ id: uid('w'), a, b, thickness: 0.12, height: 2.4, exterior: true, openings: openings.map((o) => ({ id: uid('o'), ...o })) });
  sw([0, 0], [3.2, 0]); sw([3.2, 0], [3.2, 2.6]); sw([3.2, 2.6], [0, 2.6], [{ type: 'door', offset: 1.1, width: 0.9, sill: 0, head: 2.04, style: 'hinged' }]); sw([0, 2.6], [0, 0]);
  shed.rooms.push({ id: uid('r'), name: 'Shed', polygon: [[0, 0], [3.2, 0], [3.2, 2.6], [0, 2.6]], floor: 'concrete', labelAt: [1.6, 1.3] });
  shed.lights.push({ id: uid('light'), name: 'Shed light', room: shed.rooms[0].id, kind: 'ceiling', entity: 'light.sample_shed' });
  shed.roomControls[shed.rooms[0].id] = { mainLight: 'light.sample_shed' };
  home.levels.push(shed);
  const cottage = home.levels[0], cb = outlineBox(cottage);
  home.levels.push(roofLevel('Roof', 1, { x: 0, y: 0, rot: 0 }, [newPiece([(cb.x0 + cb.x1) / 2, (cb.y0 + cb.y1) / 2], cb.x1 - cb.x0, cb.y1 - cb.y0, { pitch: 28, material: 'charcoal' })]));
  home.levels.push(roofLevel('Shed roof', 1, { x: 11.5, y: 5.2, rot: 0 }, [newPiece([1.6, 1.3], 3.2, 2.6, { type: 'skillion', pitch: 10, overhang: 0.3, material: 'light' })]));
  const site = { id: uid('level'), name: 'Whole site', site: true, elevation: 0, ceilingHeight: 2.4, walls: [], floors: [], voids: [], stairs: [], objects: [], lights: [], roomControls: {}, buttons: [], viewButtonsAdded: true, dragButtonAdded: true, navFixed: true,
    rooms: [
      { id: uid('yard'), name: 'Driveway', outdoor: true, floor: 'paving', polygon: [[-4, 6.5], [-0.5, 6.5], [-0.5, 14], [-4, 14]], labelAt: [-2.2, 12] },
      { id: uid('yard'), name: 'Back lawn', outdoor: true, floor: 'grass', polygon: [[9.2, -2], [17, -2], [17, 4.6], [9.2, 4.6]], labelAt: [13, 1] }] };
  const yard = (kind, x, y, rot = 0, entity = '') => { const { object } = makeObject(CATALOG.find((c) => c.id === kind), x, y, null); object.rotation = rot; if (entity) object.entity = entity; site.objects.push(object); };
  yard('tree', 15, 0.5); yard('tree', -2.5, -1.5); yard('pool', 13, 1.2, 0); yard('water-tank', 15.8, 6.4); yard('ac-unit', 9.6, 2.2, 90);
  site.buttons.push({ id: uid('b'), name: 'Garden lights', entity: 'light.sample_garden', icon: 'leaf', size: 'small', at: [12, 4.2] });
  site.panelPage = { id: uid('page'), name: 'Panel', sections: [{ id: uid('s'), title: 'Outside', hideTitle: true, tiles: [
    { id: uid('c'), kind: 'weather', entity: 'weather.sample_home', name: 'Weather', w: 2, h: 1 },
    { id: uid('c'), kind: 'sensor', entity: 'sensor.sample_solar_power', name: 'Solar now', w: 1, h: 1 },
    { id: uid('c'), entity: 'light.sample_garden', name: 'Garden lights', w: 1, h: 1 },
    { id: uid('c'), entity: 'light.sample_shed', name: 'Shed', w: 1, h: 1 },
    { id: uid('c'), entity: 'lock.sample_front_door', name: 'Front door', w: 1, h: 1 }] }] };
  site.homeView = { cx: 6.5, cy: 6, zoom: 1.05, az: 30 };
  home.levels.push(site);
  return home;
}
