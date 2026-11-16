// "Make your plan from a sketch" (#82): a friendly way to a first plan for people who would
// rather not draw it in the designer. They sketch their home on paper, hand the sketch and the
// sample home file to a chat assistant of their own choosing, and bring back the file it writes.
// The app contacts nothing: everything outside these screens happens in whatever the person uses.
import { h, nodes, icon, modal, toast } from './ui.js';

/** A deliberately rough drawing of a made-up home, to show how little is needed. Drawn here; not a photo of anything. */
function sketch() {
  const ink = '#2b3a67', red = '#b5413a';
  // Untidy handwriting: every letter sits a little high or low and leans its own way (the same every time).
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const t = (x, y, text, o = {}) => {
    const size = o.size || 15, chars = [...text];
    const lean = chars.map(() => (rnd() * 26).toFixed(0)).join(' ');
    const dy = chars.map(() => (rnd() * size * 0.28).toFixed(1)).join(' ');
    const dx = chars.map((c, i) => (i ? ((rnd() + 0.45) * size * 0.14).toFixed(1) : 0)).join(' ');
    return `<text x="${x}" y="${y}" dx="${dx}" dy="${dy}" rotate="${lean}" fill="${o.fill || ink}" font-size="${(size * (1 + rnd() * 0.16)).toFixed(1)}" transform="rotate(${(o.rot || 0) + rnd() * 7} ${x} ${y})">${text}</text>`;
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 330" font-family="'Segoe Print','Bradley Hand','Comic Sans MS','Chalkboard SE',cursive" role="img" aria-label="A rough hand-drawn plan of a small home with measurements written on it">
  <defs>
    <filter id="wob" filterUnits="userSpaceOnUse" x="0" y="0" width="420" height="330" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="7" xChannelSelector="R" yChannelSelector="G"/></filter>
    <filter id="wob2" filterUnits="userSpaceOnUse" x="0" y="0" width="420" height="330" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="1" seed="9" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" xChannelSelector="R" yChannelSelector="G"/></filter>
  </defs>
  <rect width="420" height="330" fill="#fbf8ef"/>
  <g fill="#c9d6ea">${Array.from({ length: 12 }, (_, i) => `<rect x="0" y="${28 + i * 26}" width="420" height="1"/>`).join('')}</g>
  <path d="M52 0V330" stroke="#e7b3ae" stroke-width="1.2"/>
  <g fill="none" stroke="${ink}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" transform="rotate(-1.6 210 165)" filter="url(#wob)">
    <path d="M84 62 C140 58 230 66 352 60 C356 110 350 180 355 262 C270 268 170 258 86 264 C82 200 88 130 84 62Z"/>
    <path d="M86 60 C150 64 250 56 350 63 M353 64 C351 120 357 200 352 258" stroke-width="1.3" opacity=".5"/>
    <path d="M222 61 C224 75 220 88 222 100 M222 128 C223 136 221 144 222 151"/>
    <path d="M222 100 C236 102 246 114 248 128" stroke-width="1.6"/>
    <path d="M223 151 C270 147 310 154 354 150"/>
    <path d="M222 176 C224 205 220 235 223 262"/>
    <path d="M222 176 L238 176 M260 176 C270 174 278 177 286 176"/>
    <path d="M260 176 C260 188 252 196 238 197" stroke-width="1.6"/>
    <path d="M286 176 C288 205 284 235 287 263"/>
    <path d="M286 151 C298 153 306 164 307 176" stroke-width="1.6"/>
    <path d="M84 150 C96 147 104 139 103 126" stroke-width="1.6"/>
    <path d="M306 246 q6 -9 12 0 q6 9 12 0 q6 -9 12 0" stroke-width="1.3" opacity=".6"/>
    <path d="M140 226 l34 5 M144 231 l28 -7" stroke-width="1.2" opacity=".55"/>
    <path d="M268 300 l3 -9 l3 9 l3 -10 l3 10 M236 320 l3 -9 l3 9 l3 -10 l3 10 M170 324 l3 -9 l3 9 l3 -10 l3 10" stroke-width="1.2" stroke="#4d7a45"/>
  </g>
  <g fill="none" stroke="${ink}" stroke-linecap="round" transform="rotate(-1.6 210 165)">
    <path d="M130 60 L176 60 M132 56 L174 57" stroke="#fbf8ef" stroke-width="7"/><path d="M130 57 L176 58 M130 64 L176 63" stroke-width="1.5"/>
    <path d="M262 60 L312 60" stroke="#fbf8ef" stroke-width="7"/><path d="M262 57 L312 58 M262 64 L312 63" stroke-width="1.5"/>
    <path d="M120 262 L190 262" stroke="#fbf8ef" stroke-width="7"/><path d="M120 259 L190 260 M120 266 L190 265" stroke-width="1.5"/>
  </g>
  <g transform="rotate(-1.6 210 165)" filter="url(#wob2)">
    ${t(124, 150, 'Lounge', { size: 20 })}${t(272, 116, 'Bedroom', { size: 17 })}${t(234, 226, 'bath', { size: 14 })}${t(296, 208, 'Kitchn', { size: 14, rot: -4 })}${t(228, 169, 'hall', { size: 12 })}
    ${t(186, 44, '9.2 m', { fill: red, size: 18 })}<path d="M88 48 C150 43 290 51 350 46" stroke="${red}" stroke-width="1.3" fill="none"/><path d="M88 43 v10 M350 41 v10" stroke="${red}" stroke-width="1.3"/>
    ${t(378, 168, '6.5', { fill: red, size: 18, rot: 88 })}<path d="M366 64 C370 130 363 200 368 260" stroke="${red}" stroke-width="1.3" fill="none"/>
    ${t(110, 206, '4.7 wide', { fill: red, size: 14 })}${t(258, 140, '4.5 x 2.9', { fill: red, size: 13 })}${t(226, 256, '2.2x2.8', { fill: red, size: 12 })}${t(294, 258, '2.3 x 3.6', { fill: red, size: 12 })}${t(252, 168, '0.8', { fill: red, size: 11 })}
    ${t(134, 84, 'window 1.8', { size: 12 })}${t(264, 84, 'win 1.5 ?', { size: 12 })}${t(104, 284, 'big sliding door ~2.4', { size: 13 })}${t(112, 306, 'grass / garden here', { size: 13, fill: '#4d7a45' })}${t(60, 142, 'front', { size: 12, rot: -90 })}${t(74, 158, 'door', { size: 12, rot: -90 })}
    ${t(318, 302, 'N ↑', { size: 15 })}${t(56, 324, '(not to scale!!)', { size: 11, rot: -3 })}
    
  </g></svg>`;
  return h('div', { class: 'sketch', html: svg });
}

/** What to say to the chat assistant. The first answer must already be a usable file; questions come after it. */
export const SKETCH_PROMPT = `I am attaching two things:
1. A sample home file for a floor-plan app (JSON, "schema": "nidorama.home/1").
2. A photo of my rough sketch of my own home, with measurements.
3. (Perhaps) a list of the devices in my home, each with its id, name, kind and room.
4. (Perhaps) photos of my rooms, taken from the corners.

Please write a home file for MY home, in exactly the same format as the sample.

How the format works:
- All sizes are in metres. x runs east (to the right), y runs south (down the page). Put the top-left outside corner of the home at [0, 0].
- "walls": each wall is a straight centre line from "a" to "b". Outside walls: "exterior": true, "thickness": 0.2. Inside walls: "exterior": false, "thickness": 0.1. "height": 2.4 unless I say otherwise.
- "openings" belong to their wall: "type" is "door", "window" or "slider"; "offset" is the distance in metres from the wall's "a" end to where the opening starts; then "width", "sill" and "head" as in the sample.
- "rooms": one entry per room with a "name", a "polygon" of its corners, a "floor" material taken from the sample, and "labelAt" in the middle of the room.
- Use the sample to see how everything else is written, but only include what I have given you. Leave out the sample's own furniture, lights, buttons, "pages", "panelPage" and "more". Never invent device names: where the sample has an "entity" and I gave you no device for it, leave it out or use "".
- If I attached a device list: connect things to it. Put each light, blind, fan, speaker and so on in the room the list gives, as the sample does (a lamp or fitting from the sample's furniture with its "entity", and the room's main light in "roomControls"). Use only ids that are in my list, exactly as written, and never make one up. If you cannot tell where a device belongs, leave it out and tell me.
- If I attached room photos: use them to place furniture. Choose each piece from the furniture kinds used in the sample ("kind"), put it roughly where the photo shows it, and keep it inside its room. Without photos, add no furniture.
- Give every wall, opening and room its own "id". Keep the "schema" line. The result must be plain valid JSON with no comments.

IMPORTANT, how to answer:
- In your FIRST reply, give me the complete file, ready to save as my-home.nidorama.json. If something in my drawing is hard to read, or the measurements do not quite add up, make your best sensible guess and carry on. Do not stop to ask first.
- After the file, list the assumptions you made, and ask me about anything you would like to confirm (a wall you could not read, a measurement that seems off, where a door is).
- If I answer, send the whole corrected file again, not just the changed part.`;

/** For people whose app is not connected: paste this in Home Assistant (Developer tools → Template) and copy what it prints. */
export const DEVICE_TEMPLATE = `{% for s in states if s.domain in ['light','switch','fan','cover','climate','lock','media_player','camera','scene','script'] -%}
{{ s.entity_id }} | {{ s.name }} | {{ area_name(s.entity_id) or '' }}
{% endfor %}`;

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); return true; } catch { toast('Could not copy. Select the text and copy it by hand.'); return false; }
}

/**
 * Open the guide. `actions`: saveSample() saves the sample home file to the device,
 * pickFile() opens the file chooser for the finished file, importText(text) loads pasted text
 * (resolves to an error message, or '' when it worked).
 */
export function openSketchGuide(actions) {
  const page = h('div', { class: 'menu guide' });
  const close = modal(page);
  let pasted = false, problem = '';
  const step = (n, title, ...body) => h('section', { class: 'guide-step' }, h('div', { class: 'guide-n' }, String(n)), h('div', { class: 'grow' }, h('h3', {}, title), ...nodes(body)));
  const draw = () => {
    const box = pasted ? h('textarea', { class: 'yaml', rows: 6, placeholder: 'Paste everything the chat assistant sent. Extra words around the file do not matter.' }) : null;
    page.replaceChildren(...nodes(
      h('div', { class: 'panel-head' }, h('h2', {}, 'Make your plan from a sketch'), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
      h('p', { class: 'hint' }, 'You do not have to draw your home in the app. Sketch it on paper, let your favourite chat assistant turn the sketch into a home file, and load that here. It takes about ten minutes.'),
      step(1, 'Sketch your home',
        h('p', { class: 'hint' }, 'A rough drawing is enough. It does not need to be neat or to scale. What matters is that the measurements are written on it: the outside size, each room, and roughly where the doors and windows are.'),
        sketch(),
        h('p', { class: 'hint' }, 'This scribble is all it takes. Take a photo of yours.')),
      step(2, 'Save the sample file',
        h('p', { class: 'hint' }, 'The sample cottage is a complete home file. It shows the chat assistant exactly how a home is written down.'),
        h('button', { class: 'wide', onclick: () => actions.saveSample() }, icon('file'), 'Save the sample home file'),
        h('details', { class: 'guide-more' }, h('summary', {}, 'Optional: get more back'),
          h('h4', {}, 'A list of your devices'),
          h('p', { class: 'hint' }, 'With a list of your lights, blinds, fans and so on, the chat assistant can connect them in the plan for you.'),
          actions.canListDevices?.()
            ? h('button', { class: 'wide', onclick: () => actions.saveDevices() }, icon('link'), 'Save a list of my devices')
            : h('div', { class: 'grow' },
              h('p', { class: 'hint' }, 'This app is not connected to Home Assistant yet. Connect it in Settings and come back, or get the list by hand: in Home Assistant open Developer tools → Template, paste this, and copy what it prints into a text file.'),
              h('button', { class: 'wide', onclick: () => copy(DEVICE_TEMPLATE) }, icon('copy'), 'Copy the Home Assistant template')),
          h('p', { class: 'hint' }, 'The list holds only each device\'s id, name, kind and room. It still names what is in your home, so give it only to a chat assistant you are happy to share that with.'),
          h('h4', {}, 'Photos of your rooms'),
          h('p', { class: 'hint' }, 'A photo from each corner of each room lets the chat assistant place furniture far more accurately. They are photos of the inside of your home, so the same care applies.'))),
      step(3, 'Ask your favourite chat assistant',
        h('p', { class: 'hint' }, 'Open the chat assistant you like to use. Give it the sample file and the photo of your sketch (and the device list and room photos, if you made them), and paste this request. It asks for a finished file straight away, and invites questions afterwards if anything in your drawing was unclear.'),
        h('textarea', { class: 'yaml', rows: 7, readonly: true, 'aria-label': 'The request to paste' }, SKETCH_PROMPT),
        h('button', { class: 'wide', onclick: () => copy(SKETCH_PROMPT) }, icon('copy'), 'Copy the request')),
      step(4, 'Bring the file back',
        h('p', { class: 'hint' }, 'Save the file it gives you and open it here. If it only showed the file as text, copy all of it and paste it in.'),
        h('div', { class: 'btns' },
          h('button', { class: 'wide primary', onclick: () => { close(); actions.pickFile(); } }, icon('file'), 'Open the file'),
          h('button', { class: 'wide', onclick: () => { pasted = !pasted; problem = ''; draw(); } }, icon('edit'), 'Paste the text')),
        box,
        pasted ? h('button', { class: 'wide primary', onclick: async () => { problem = await actions.importText(box.value); if (problem) draw(); else close(); } }, icon('check'), 'Load it') : null,
        problem ? h('p', { class: 'hint warn' }, problem) : null),
      step(5, 'Make it yours',
        h('p', { class: 'hint' }, 'Your plan opens ready to edit. A first attempt is rarely perfect: if a wall or a door is in the wrong place, drag it in the designer, or tell the chat assistant what is wrong and load its corrected file. Then add furniture, lights, buttons and widgets, and connect them to your home.'))));
    const ta = page.querySelector('textarea[readonly]'); if (ta) ta.value = SKETCH_PROMPT;
  };
  draw();
}
