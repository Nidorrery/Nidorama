// Smoke test, run inside the add-on container: ask the render engine for a small picture of the
// sample home and check that one comes back.   node test/smoke.mjs
import { readFile, stat } from 'node:fs/promises';
const base = `http://127.0.0.1:${process.env.PORT || 8099}/api/nidorama/`;
const call = async (p, opts) => (await fetch(base + p, opts)).json();
const info = await call('info');
console.log('add-on', info.version, JSON.stringify(info.machine), 'render engine:', info.render.available);
if (!info.render.available) { console.error('FAIL: no render engine'); process.exit(1); }
const { id } = await call('render', { method: 'POST', body: await readFile(new URL('./job.json', import.meta.url)) });
const t0 = Date.now();
for (;;) {
  await new Promise((r) => setTimeout(r, 5000));
  const s = await call(`render/${id}`);
  console.log(Math.round((Date.now() - t0) / 1000) + 's', s.state, Math.round((s.progress || 0) * 100) + '%');
  if (s.state === 'done') break;
  if (s.state !== 'running' && s.state !== 'queued') { console.error('FAIL:', s.error || s.state); process.exit(1); }
  if (Date.now() - t0 > 12 * 60000) { console.error('FAIL: no picture after 12 minutes'); process.exit(1); }
}
const { size } = await stat(`${info.folder}/renders/test__ground__day.jpg`);
console.log('picture written:', size, 'bytes');
if (size < 4000) { console.error('FAIL: the picture is empty'); process.exit(1); }
console.log('OK');
