// Furniture library and floor materials. Everything is parametric: an item is a list of boxes /
// cylinders in fractions of its width (x), depth (y) and height (z), so it can be resized freely.
// Local convention: the back of an item (sofa back, bed head, wall side) faces north (−y).
import { round } from './geom.js';

export const FLOOR_MATERIALS = {
  'timber-dark': { label: 'Timber, dark', color: '#7b5a43', kind: 'wood' },
  'timber-oak': { label: 'Timber, oak', color: '#c19a6b', kind: 'wood' },
  'timber-light': { label: 'Timber, pale', color: '#dcc7a6', kind: 'wood' },
  'marble-tile': { label: 'Tile, marble', color: '#ecebe7', kind: 'tile' },
  'mosaic-tile': { label: 'Tile, mosaic', color: '#e1e2de', kind: 'mosaic' },
  'slate-tile': { label: 'Tile, slate', color: '#6f7479', kind: 'tile' },
  terracotta: { label: 'Tile, terracotta', color: '#b9714f', kind: 'tile' },
  concrete: { label: 'Concrete', color: '#b4b2ad', kind: 'concrete' },
  'carpet-grey': { label: 'Carpet, grey', color: '#a7a5a1', kind: 'carpet' },
  'carpet-cream': { label: 'Carpet, cream', color: '#d9d0c0', kind: 'carpet' },
  decking: { label: 'Decking', color: '#a98461', kind: 'wood' },
  grass: { label: 'Grass', color: '#7c9a5a', kind: 'grass' },
  paving: { label: 'Paving', color: '#c7c2b8', kind: 'tile' },
  'stair-void': { label: 'Void (open to below)', color: '#2a221d', kind: 'void' },
};

const C = {
  oak: '#c49a6c', walnut: '#6b4a34', dark: '#4a3022', white: '#f6f5f2', linen: '#efe9e0', stone: '#ece9e2',
  black: '#24262a', steel: '#c7ccd1', fabric: '#8f857b', charcoal: '#3a3735', green: '#56634f', leaf: '#4f7f4a',
  pot: '#d9cdb8', basin: '#cfd8de', shade: '#f3ead6', glass: '#bfe0f2', rug: '#b9a07c', blue: '#5d6f86', duvet: '#f2efe9',
};
// part: [x0, y0, z0, x1, y1, z1, colour, options]   (fractions of width / depth / height)
const legs = (c, t = 0.08, top = 0.92) => [[0, 0, 0, t, t, top, c], [1 - t, 0, 0, 1, t, top, c], [0, 1 - t, 0, t, 1, top, c], [1 - t, 1 - t, 0, 1, 1, top, c]];
const seat = (c, c2) => [
  [0, 0.22, 0, 1, 1, 0.5, c, { radius: 0.06 }], [0, 0, 0, 1, 0.26, 1, c2, { radius: 0.06 }],
  [0, 0.1, 0, 0.12, 1, 0.72, c2, { radius: 0.05 }], [0.88, 0.1, 0, 1, 1, 0.72, c2, { radius: 0.05 }],
];
// An L-shaped sofa: the long seat runs out to the front on the right (seen from above, back at the top).
const chaise = (c, c2) => [
  [0, 0.12, 0, 1, 0.58, 0.5, c, { radius: 0.06 }], [0.62, 0.12, 0, 1, 1, 0.5, c, { radius: 0.06 }],
  [0, 0, 0, 1, 0.15, 1, c2, { radius: 0.06 }],
  [0, 0.06, 0, 0.07, 0.58, 0.72, c2, { radius: 0.05 }], [0.94, 0.06, 0, 1, 0.6, 0.72, c2, { radius: 0.05 }],
];
const bed = () => [
  [0, 0, 0, 1, 0.03, 1, C.walnut, { radius: 0.02 }], [0, 0.03, 0, 1, 1, 0.3, C.walnut],
  [0.02, 0.03, 0.3, 0.98, 1, 0.52, C.white, { radius: 0.05 }], [0.02, 0.38, 0.5, 0.98, 1, 0.58, C.duvet, { radius: 0.04 }],
  [0.08, 0.07, 0.52, 0.46, 0.27, 0.66, C.white, { radius: 0.05 }], [0.54, 0.07, 0.52, 0.92, 0.27, 0.66, C.white, { radius: 0.05 }],
];
const cab = (c, top) => [[0, 0, 0, 1, 1, 0.96, c], [0, 0, 0.96, 1, 1, 1, top]];

export const CATEGORIES = ['Seating', 'Tables', 'Bedroom', 'Kitchen', 'Bathroom', 'Living', 'Lighting', 'Appliances', 'Structure', 'Outdoor'];

// size: [width, depth, height] in metres. z: mounting height. light: adds a controllable light.
export const CATALOG = [
  { id: 'sofa', name: 'Sofa', cat: 'Seating', size: [2.2, 0.95, 0.8], parts: seat(C.fabric, '#7d746b') },
  { id: 'sofa-chaise-r', name: 'L sofa, chaise on the right', cat: 'Seating', size: [2.8, 1.65, 0.8], parts: chaise(C.fabric, '#7d746b') },
  { id: 'sofa-chaise-l', name: 'L sofa, chaise on the left', cat: 'Seating', size: [2.8, 1.65, 0.8], parts: chaise(C.fabric, '#7d746b').map(([a, b, c, e, f, g, ...rest]) => [1 - e, b, c, 1 - a, f, g, ...rest]) },
  { id: 'sofa-2', name: 'Loveseat', cat: 'Seating', size: [1.6, 0.9, 0.8], parts: seat(C.charcoal, '#2c2a29') },
  { id: 'armchair', name: 'Armchair', cat: 'Seating', size: [0.9, 0.9, 0.8], parts: seat(C.green, '#46523f') },
  { id: 'chair', name: 'Dining chair', cat: 'Seating', size: [0.45, 0.48, 0.9], parts: [[0, 0, 0, 1, 1, 0.5, C.oak, { radius: 0.03 }], [0, 0, 0.5, 1, 0.14, 1, C.oak, { radius: 0.03 }]] },
  { id: 'stool', name: 'Stool', cat: 'Seating', size: [0.4, 0.4, 0.65], parts: [[0.35, 0.35, 0, 0.65, 0.65, 0.9, C.black, { shape: 'cylinder' }], [0, 0, 0.9, 1, 1, 1, C.oak, { shape: 'cylinder' }]] },
  { id: 'bench-seat', name: 'Bench seat', cat: 'Seating', size: [1.4, 0.4, 0.45], parts: [[0, 0, 0.85, 1, 1, 1, C.oak], ...legs(C.oak, 0.06, 0.85)] },
  { id: 'ottoman', name: 'Ottoman', cat: 'Seating', size: [0.7, 0.7, 0.4], parts: [[0, 0, 0, 1, 1, 1, C.fabric, { radius: 0.08 }]] },

  { id: 'table-rect', name: 'Dining table', cat: 'Tables', size: [1.8, 0.95, 0.75], parts: [[0, 0, 0.93, 1, 1, 1, C.walnut, { radius: 0.02 }], ...legs(C.walnut, 0.05, 0.93)] },
  { id: 'table-round', name: 'Round table', cat: 'Tables', size: [1.2, 1.2, 0.75], parts: [[0, 0, 0.94, 1, 1, 1, C.walnut, { shape: 'cylinder' }], [0.4, 0.4, 0, 0.6, 0.6, 0.94, C.walnut, { shape: 'cylinder' }]] },
  { id: 'coffee-table', name: 'Coffee table', cat: 'Tables', size: [1.1, 0.6, 0.4], parts: [[0, 0, 0.85, 1, 1, 1, C.black, { radius: 0.02 }], ...legs(C.black, 0.05, 0.85)] },
  { id: 'side-table', name: 'Side table', cat: 'Tables', size: [0.5, 0.5, 0.5], parts: [[0, 0, 0.9, 1, 1, 1, C.oak, { shape: 'cylinder' }], [0.4, 0.4, 0, 0.6, 0.6, 0.9, C.oak, { shape: 'cylinder' }]] },
  { id: 'desk', name: 'Desk', cat: 'Tables', size: [1.4, 0.7, 0.75], parts: [[0, 0, 0.94, 1, 1, 1, C.oak], ...legs(C.black, 0.04, 0.94)] },
  { id: 'console', name: 'Console', cat: 'Tables', size: [1.4, 0.35, 0.8], parts: cab(C.walnut, C.walnut) },

  { id: 'bed-single', name: 'Single bed', cat: 'Bedroom', size: [0.95, 1.95, 1.0], parts: bed() },
  { id: 'bed-queen', name: 'Queen bed', cat: 'Bedroom', size: [1.55, 2.08, 1.0], parts: bed() },
  { id: 'bed-king', name: 'King bed', cat: 'Bedroom', size: [1.85, 2.08, 1.0], parts: bed() },
  { id: 'bedside', name: 'Bedside table', cat: 'Bedroom', size: [0.45, 0.4, 0.5], parts: cab(C.oak, C.oak) },
  { id: 'wardrobe', name: 'Wardrobe', cat: 'Bedroom', size: [1.8, 0.6, 2.1], parts: [[0, 0, 0, 1, 1, 1, C.white], [0.495, 0.98, 0.02, 0.505, 1, 0.98, C.steel]] },
  { id: 'dresser', name: 'Dresser', cat: 'Bedroom', size: [1.2, 0.5, 0.8], parts: cab('#b8b2a3', '#b8b2a3') },
  { id: 'cot', name: 'Cot', cat: 'Bedroom', size: [0.7, 1.3, 0.9], parts: [[0, 0, 0.3, 1, 1, 0.45, C.white], ...legs(C.oak, 0.06, 1)] },

  { id: 'kitchen-bench', name: 'Kitchen bench', cat: 'Kitchen', size: [2.4, 0.6, 0.9], parts: cab(C.white, C.stone) },
  { id: 'island', name: 'Island bench', cat: 'Kitchen', size: [2.2, 0.95, 0.9], parts: cab(C.linen, C.stone) },
  { id: 'fridge', name: 'Fridge', cat: 'Kitchen', size: [0.9, 0.72, 1.8], parts: [[0, 0, 0, 1, 1, 1, C.steel, { radius: 0.02 }]] },
  { id: 'tall-cabinet', name: 'Tall cabinet / oven', cat: 'Kitchen', size: [0.6, 0.6, 2.2], parts: [[0, 0, 0, 1, 1, 1, C.white], [0.1, 0.97, 0.38, 0.9, 1, 0.62, C.black]] },
  { id: 'cooktop', name: 'Cooktop', cat: 'Kitchen', size: [0.6, 0.52, 0.02], z: 0.9, parts: [[0, 0, 0, 1, 1, 1, C.black]] },
  { id: 'sink', name: 'Sink', cat: 'Kitchen', size: [0.8, 0.45, 0.03], z: 0.9, parts: [[0, 0, 0, 1, 1, 1, C.steel, { radius: 0.01 }]] },

  { id: 'bath', name: 'Bath', cat: 'Bathroom', size: [1.7, 0.78, 0.56], parts: [[0, 0, 0, 1, 1, 1, C.white, { radius: 0.12 }], [0.07, 0.12, 0.9, 0.93, 0.88, 1.005, C.basin, { radius: 0.02 }]] },
  { id: 'shower', name: 'Shower', cat: 'Bathroom', size: [0.95, 0.95, 2.0], parts: [[0, 0, 0, 1, 1, 0.02, C.stone], [0, 0.98, 0, 1, 1, 1, C.glass, { opacity: 0.4 }], [0.98, 0, 0, 1, 1, 1, C.glass, { opacity: 0.4 }]] },
  { id: 'toilet', name: 'Toilet', cat: 'Bathroom', size: [0.4, 0.68, 0.8], parts: [[0, 0, 0, 1, 0.28, 1, C.white, { radius: 0.04 }], [0.05, 0.25, 0, 0.95, 1, 0.52, C.white, { shape: 'cylinder' }]] },
  { id: 'vanity', name: 'Vanity', cat: 'Bathroom', size: [0.9, 0.5, 0.85], parts: [...cab(C.oak, C.stone), [0.25, 0.2, 1, 0.75, 0.8, 1.06, C.basin, { radius: 0.02 }]] },
  { id: 'washer', name: 'Washing machine', cat: 'Appliances', size: [0.6, 0.6, 0.85], parts: [[0, 0, 0, 1, 1, 1, C.white, { radius: 0.02 }], [0.25, 0.97, 0.3, 0.75, 1.01, 0.8, C.black, { radius: 0.01 }]] },

  { id: 'tv', name: 'TV (wall)', cat: 'Living', size: [1.45, 0.05, 0.82], z: 1.0, parts: [[0, 0, 0, 1, 1, 1, C.black, { radius: 0.01 }]] },
  { id: 'artwork', name: 'Picture / artwork', cat: 'Living', size: [0.9, 0.03, 0.6], z: 1.3, parts: [[0, 0, 0, 1, 1, 1, '#e8e2d6']] },
  { id: 'tv-unit', name: 'TV unit', cat: 'Living', size: [1.8, 0.42, 0.45], parts: cab(C.walnut, C.walnut) },
  { id: 'bookshelf', name: 'Bookshelf', cat: 'Living', size: [0.9, 0.32, 1.9], parts: [[0, 0, 0, 1, 1, 1, C.oak], [0.06, 0.9, 0.05, 0.94, 1.005, 0.95, C.blue]] },
  { id: 'rug', name: 'Rug', cat: 'Living', size: [2.4, 1.7, 0.015], parts: [[0, 0, 0, 1, 1, 1, C.rug]] },
  { id: 'rug-round', name: 'Round rug', cat: 'Living', size: [2.0, 2.0, 0.015], parts: [[0, 0, 0, 1, 1, 1, C.rug, { shape: 'cylinder' }]] },
  { id: 'plant', name: 'Plant', cat: 'Living', size: [0.5, 0.5, 1.3], parts: [[0.25, 0.25, 0, 0.75, 0.75, 0.3, C.pot, { shape: 'cylinder' }], [0, 0, 0.3, 1, 1, 1, C.leaf, { shape: 'cylinder' }]] },
  { id: 'fireplace', name: 'Fireplace', cat: 'Living', size: [1.3, 0.35, 1.1], parts: [[0, 0, 0, 1, 1, 1, '#e3ddd0'], [0.2, 0.9, 0.1, 0.8, 1.01, 0.6, C.black]] },

  { id: 'floor-lamp', name: 'Floor lamp', cat: 'Lighting', size: [0.3, 0.3, 1.5], light: { z: 1.35 }, parts: [[0.25, 0.25, 0, 0.75, 0.75, 0.03, C.dark, { shape: 'cylinder' }], [0.44, 0.44, 0.03, 0.56, 0.56, 0.84, C.dark, { shape: 'cylinder' }], [0, 0, 0.84, 1, 1, 1, C.shade, { shape: 'cylinder' }]] },
  { id: 'table-lamp', name: 'Table lamp', cat: 'Lighting', size: [0.22, 0.22, 0.36], z: 0.5, light: { z: 0.25 }, parts: [[0.3, 0.3, 0, 0.7, 0.7, 0.45, C.dark, { shape: 'cylinder' }], [0, 0, 0.45, 1, 1, 1, C.shade, { shape: 'cylinder' }]] },
  { id: 'pendant', name: 'Pendant light', cat: 'Lighting', size: [0.3, 0.3, 0.22], z: 1.85, light: { z: 0 }, parts: [[0, 0, 0, 1, 1, 1, '#e9f1f3', { shape: 'cylinder' }]] },
  { id: 'downlight', name: 'Downlight', cat: 'Lighting', size: [0.12, 0.12, 0.03], z: 2.37, light: { z: 0 }, parts: [[0, 0, 0, 1, 1, 1, C.white, { shape: 'cylinder' }]] },
  { id: 'wall-light', name: 'Wall light', cat: 'Lighting', size: [0.1, 0.07, 0.2], z: 1.7, light: { z: 0.1 }, parts: [[0, 0, 0, 1, 1, 1, C.shade, { radius: 0.03 }]] },
  { id: 'chandelier', name: 'Chandelier', cat: 'Lighting', size: [0.7, 0.7, 0.6], z: 1.7, light: { z: 0.1 }, parts: [[0.46, 0.46, 0.5, 0.54, 0.54, 1, C.dark, { shape: 'cylinder' }], [0, 0, 0, 1, 1, 0.5, C.shade, { shape: 'cylinder' }]] },
  { id: 'strip-light', name: 'LED strip', cat: 'Lighting', size: [1.5, 0.03, 0.02], z: 0.88, light: { z: 0 }, parts: [[0, 0, 0, 1, 1, 1, C.shade]] },

  { id: 'ceiling-fan', name: 'Ceiling fan', cat: 'Appliances', size: [1.3, 1.3, 0.12], z: 2.25, parts: [[0, 0.47, 0.4, 1, 0.53, 0.6, C.oak, { radius: 0.02 }], [0.47, 0, 0.4, 0.53, 1, 0.6, C.oak, { radius: 0.02 }], [0.42, 0.42, 0, 0.58, 0.58, 1, C.steel, { shape: 'cylinder' }]] },
  { id: 'aircon', name: 'Air conditioner', cat: 'Appliances', size: [0.85, 0.2, 0.28], z: 2.0, parts: [[0, 0, 0, 1, 1, 1, C.white, { radius: 0.04 }]] },
  { id: 'heater', name: 'Heater / radiator', cat: 'Appliances', size: [0.9, 0.1, 0.6], z: 0.12, parts: [[0, 0, 0, 1, 1, 1, C.white, { radius: 0.02 }]] },
  { id: 'speaker', name: 'Speaker', cat: 'Appliances', size: [0.18, 0.18, 0.28], z: 0.8, parts: [[0, 0, 0, 1, 1, 1, C.charcoal, { radius: 0.04 }]] },
  { id: 'blind', name: 'Blind / curtain', cat: 'Appliances', size: [1.6, 0.06, 1.4], z: 0.8, parts: [[0, 0, 0, 1, 1, 1, C.linen]] },
  { id: 'camera', name: 'Camera / sensor', cat: 'Appliances', size: [0.1, 0.1, 0.1], z: 2.2, parts: [[0, 0, 0, 1, 1, 1, C.white, { shape: 'cylinder' }]] },

  { id: 'stairs', name: 'Stairs', cat: 'Structure', size: [1.0, 3.2, 2.6], parts: Array.from({ length: 13 }, (_, i) => [0, 1 - (i + 1) / 13, 0, 1, 1 - i / 13, (i + 1) / 13, C.oak]) },
  { id: 'column', name: 'Column', cat: 'Structure', size: [0.3, 0.3, 2.4], parts: [[0, 0, 0, 1, 1, 1, C.white]] },
  { id: 'box', name: 'Box', cat: 'Structure', size: [1, 1, 1], parts: [[0, 0, 0, 1, 1, 1, '#cfc8bd']] },
  { id: 'cylinder', name: 'Cylinder', cat: 'Structure', size: [0.6, 0.6, 1], parts: [[0, 0, 0, 1, 1, 1, '#cfc8bd', { shape: 'cylinder' }]] },
  { id: 'glass-panel', name: 'Glass panel', cat: 'Structure', size: [1.2, 0.03, 1.0], parts: [[0, 0, 0, 1, 1, 1, C.glass, { opacity: 0.45 }]] },

  { id: 'outdoor-table', name: 'Outdoor table', cat: 'Outdoor', size: [1.6, 0.9, 0.74], parts: [[0, 0, 0.93, 1, 1, 1, C.charcoal], ...legs(C.charcoal, 0.05, 0.93)] },
  { id: 'lounger', name: 'Sun lounger', cat: 'Outdoor', size: [0.7, 1.9, 0.35], parts: [[0, 0, 0.6, 1, 1, 1, C.linen, { radius: 0.03 }], ...legs(C.oak, 0.08, 0.6)] },
  { id: 'bbq', name: 'Barbecue', cat: 'Outdoor', size: [1.3, 0.6, 0.95], parts: cab(C.charcoal, C.steel) },
  { id: 'solar-panel', name: 'Solar panel', cat: 'Outdoor', size: [1.75, 1.05, 0.05], parts: [[0, 0, 0, 1, 1, 1, '#1d2a44', { radius: 0.01 }], [0.02, 0.03, 0.9, 0.98, 0.97, 1, '#2d4a7a']] },
  { id: 'water-tank', name: 'Water tank', cat: 'Outdoor', size: [1.4, 1.4, 1.9], parts: [[0, 0, 0, 1, 1, 1, '#7f8c80', { shape: 'cylinder' }]] },
  { id: 'ac-unit', name: 'Air-conditioner (outside)', cat: 'Outdoor', size: [0.85, 0.32, 0.6], parts: [[0, 0, 0, 1, 1, 1, '#e8e8e6', { radius: 0.03 }], [0.08, -0.01, 0.15, 0.62, 0.05, 0.85, '#9aa0a3', { shape: 'cylinder' }]] },
  { id: 'pool', name: 'Pool', cat: 'Outdoor', size: [8, 4, 0.12], parts: [[0, 0, 0, 1, 1, 0.6, '#d8d2c6'], [0.04, 0.08, 0.6, 0.96, 0.92, 1, '#4fb3d9', { opacity: 0.85 }]] },
  { id: 'tree', name: 'Tree', cat: 'Outdoor', size: [3, 3, 5], parts: [[0.44, 0.44, 0, 0.56, 0.56, 0.45, '#6b4a33', { shape: 'cylinder' }], [0, 0, 0.35, 1, 1, 1, '#4f7f46', { shape: 'cylinder', radius: 0.5 }]] },
  { id: 'gate', name: 'Gate', cat: 'Outdoor', size: [3.6, 0.08, 1.6], parts: [[0, 0, 0, 1, 1, 1, '#3a3d42']] },
  { id: 'planter', name: 'Planter', cat: 'Outdoor', size: [1.2, 0.4, 0.8], parts: [[0, 0, 0, 1, 1, 0.5, C.charcoal], [0.04, 0.1, 0.5, 0.96, 0.9, 1, C.leaf, { radius: 0.1 }]] },
  { id: 'car', name: 'Car', cat: 'Outdoor', size: [1.85, 4.6, 1.45], parts: [[0, 0, 0.12, 1, 1, 0.62, C.blue, { radius: 0.25 }], [0.06, 0.22, 0.6, 0.94, 0.8, 1, '#3d4b5c', { radius: 0.2 }]] },
];

let counter = 0;
export const uid = (prefix) => `${prefix}-${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Build a home-file object (and its light, if any) from a catalogue item, centred at [x, y]. */
export function makeObject(item, x, y, roomId = null) {
  const [w, d, h] = item.size, z0 = item.z || 0;
  const x0 = x - w / 2, y0 = y - d / 2;
  const parts = item.parts.map(([a, b, c, e, f, g, color, opts = {}]) => {
    const p = { min: [round(x0 + a * w), round(y0 + b * d), round(z0 + c * h)], max: [round(x0 + e * w), round(y0 + f * d), round(z0 + g * h)], color };
    if (opts.shape) p.shape = opts.shape;
    if (opts.radius) p.radius = opts.radius;
    if (opts.opacity != null) p.opacity = opts.opacity;
    return p;
  });
  const object = { id: uid(item.id), name: item.name, kind: item.id, room: roomId, bounds: { min: [round(x0), round(y0), z0], max: [round(x0 + w), round(y0 + d), round(z0 + h)] }, rotation: 0, parts };
  let light = null;
  if (item.light) light = { id: uid('light'), name: item.name, room: roomId, fixture: object.id, position: [round(x), round(y), round(z0 + item.light.z)], entity: '', dimmable: true };
  return { object, light };
}
