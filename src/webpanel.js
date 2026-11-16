// The widget panel beside a plan can show a web page instead of widgets (#118): any address, or one of
// Home Assistant's own dashboards. Home Assistant does not let itself be shown inside another app until
// one setting allows it, so choosing a dashboard comes with a short guide to that setting.
import { h, nodes, icon, modal, app } from './ui.js';
import { copyText } from './alerts.js';

/** Inside the Home Assistant add-on the app is a page of Home Assistant itself, so its dashboards can be shown as they are. */
export const insideHA = () => /\/api\/hassio_ingress\//.test(location.pathname);
const haBase = () => (insideHA() ? location.origin : (app.haUrl?.() || '').replace(/\/$/, ''));

/** The address a panel view opens. */
export function viewUrl(v) {
  if (!v) return '';
  if (v.kind === 'ha') return haBase() ? haBase() + (v.path || '/lovelace') : '';
  return v.url || '';
}
/** Home Assistant's dashboards, as [{ path, title }]; the default one first. */
export async function haDashboards() {
  const list = [{ path: '/lovelace', title: 'Overview (the default dashboard)' }];
  try {
    const more = await app.ask({ type: 'lovelace/dashboards/list' });
    for (const d of more || []) if (d.url_path) list.push({ path: `/${d.url_path}`, title: d.title || d.url_path });
  } catch { /* not connected, or not allowed: the default one still works */ }
  return list;
}

/** The page itself, filling the panel. */
export function webPanel(v) {
  const url = viewUrl(v);
  if (!url) return h('div', { class: 'panel-body' }, h('p', { class: 'hint pad' }, v?.kind === 'ha' ? 'Connect to Home Assistant to show its dashboard here.' : 'No web address set for this panel yet.'));
  return h('div', { class: 'panel-body panel-web' },
    h('iframe', { src: url, title: v.kind === 'ha' ? 'Home Assistant dashboard' : 'Web page', referrerpolicy: 'no-referrer', allow: 'fullscreen' }));
}

const YAML = 'http:\n  use_x_frame_options: false';

/** The guide (in the style of the sketch guide): what to change in Home Assistant, then a live check. */
export function frameGuide(v, onDone) {
  const url = viewUrl(v), base = haBase();
  let step = 0, seen = null;
  const body = h('div', { class: 'menu guide' }), close = modal(body, { onclose: () => onDone?.() });
  const open = (path) => base && window.open(base + path, '_blank', 'noopener');
  const steps = [
    () => [h('h3', {}, '1. Why this is needed'),
      h('p', {}, 'Home Assistant does not let itself be shown inside another app until one setting allows it. Changing it takes a couple of minutes.'),
      h('p', { class: 'hint' }, 'The trade-off, honestly: with this setting off, other web pages could also show your Home Assistant inside themselves. You still have to be signed in to see or do anything.')],
    () => [h('h3', {}, '2. Open the File editor'),
      h('p', {}, 'In Home Assistant, open the File editor add-on (or Studio Code Server). If you do not have one, install File editor from the add-on store.'),
      h('div', { class: 'btns' },
        h('button', { class: 'wide', disabled: !base, onclick: () => open('/hassio/addon/core_configurator/info') }, icon('ha'), 'File editor'),
        h('button', { class: 'wide ghost', disabled: !base, onclick: () => open('/hassio/store') }, icon('plus'), 'Add-on store'))],
    () => [h('h3', {}, '3. Add two lines to configuration.yaml'),
      h('p', {}, 'Open configuration.yaml and add these lines. If it already has an http: section, add only the second line inside it.'),
      h('pre', { class: 'code' }, YAML),
      h('button', { class: 'wide', onclick: () => copyText(YAML, 'The lines') }, icon('copy'), 'Copy the lines'),
      h('p', { class: 'hint' }, 'Save the file.')],
    () => [h('h3', {}, '4. Restart Home Assistant'),
      h('p', {}, 'Settings → System → Restart (the power button at the top right), then Restart Home Assistant.'),
      h('button', { class: 'wide', disabled: !base, onclick: () => open('/config/system') }, icon('power'), 'Open System settings')],
    () => [h('h3', {}, '5. Check it'),
      h('p', {}, 'Can you see your dashboard below? The first time, it may ask you to sign in to Home Assistant inside the box.'),
      url ? h('div', { class: 'frame-check' }, h('iframe', { src: url, title: 'Your Home Assistant dashboard' })) : h('p', { class: 'hint' }, 'Connect to Home Assistant first (Settings → Integrations).'),
      h('div', { class: 'btns' },
        h('button', { class: 'wide primary', onclick: () => { seen = true; close(); } }, icon('check'), 'Yes, I can see it'),
        h('button', { class: 'wide ghost', onclick: () => { seen = false; draw(); } }, 'No')),
      seen === false ? h('div', { class: 'stack' },
        h('p', {}, 'Most often it is one of these:'),
        h('ul', {},
          h('li', {}, 'The lines were not saved, or are not under http: (check the spaces at the start of the second line).'),
          h('li', {}, 'Home Assistant has not restarted since.'),
          h('li', {}, 'This app is opened over https and Home Assistant over http, or the other way round: use the same for both.'),
          h('li', {}, 'An empty box with a sign-in page means it works: sign in inside it.')),
        h('button', { class: 'wide', onclick: () => draw() }, icon('rotate'), 'Check again')) : null],
  ];
  const draw = () => body.replaceChildren(...nodes(
    h('div', { class: 'panel-head' }, h('h2', {}, 'Show a Home Assistant dashboard'), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
    h('div', { class: 'stack' }, steps[step]()),
    h('div', { class: 'btns' },
      step ? h('button', { class: 'wide ghost', onclick: () => { step--; seen = null; draw(); } }, 'Back') : null,
      step < steps.length - 1 ? h('button', { class: 'wide primary', onclick: () => { step++; draw(); } }, 'Next') : null)));
  draw();
}
