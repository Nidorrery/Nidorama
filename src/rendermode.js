// The render engine page. The Nidorama add-on opens this in a headless browser on the Home Assistant
// machine: it fetches one job, builds the same scene the app shows, path-traces it and hands the
// picture back. No interface, no Home Assistant connection.
import './style.css';
import { NidoramaScene } from './scene.js';
import { setRemoteFetcher } from './blobs.js';

const id = new URLSearchParams(location.search).get('render');
const api = (p, opts) => fetch(`api/nidorama/${p}`, opts);
const fail = (msg) => api(`render/${id}/error`, { method: 'POST', body: String(msg) }).catch(() => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  try {
    const job = await (await api(`render/${id}/job`)).json();
    const level = job.home.levels.find((l) => l.id === job.levelId);
    if (!level) throw new Error('The plan to render was not in the job.');
    // Photos and models come from the shared folder on this machine.
    const files = { photo: ['photos', '.jpg'], model: ['models', '.glb'] };
    setRemoteFetcher(async (key) => { const [type, name] = key.split('/'); const r = await api(`assets/${files[type][0]}/${name}${files[type][1]}`); return r.ok ? r.blob() : null; });

    document.body.style.cssText = 'margin:0;overflow:hidden;background:#000';
    const canvas = document.createElement('canvas');
    // Exactly the size asked for, whatever the browser window turns out to be, so the picture lines up in the app.
    canvas.style.cssText = `position:fixed;left:0;top:0;width:${Math.round(job.width)}px;height:${Math.round(job.height)}px;display:block`;
    document.getElementById('app').replaceWith(canvas);
    const view = new NidoramaScene(canvas);
    view.renderer.setPixelRatio(1);
    view.refineEnabled = false;
    view.night = !!job.night;
    if (job.sun) view.sunAngles = job.sun;
    const load = () => {
      view.load(job.home, level, { style: 'realistic', keepView: !!view.baseExt });
      for (const [lid, on, lvl] of job.lights || []) view.setLight(lid, on, lvl, true);
      view._assignLights();
      Object.assign(view.cam, job.cam, { off: [...job.cam.off] });
      view.resize();
    };
    load();
    // Wait for photos and 3D models (each arrival rebuilds the scene), then make sure the last rebuild is in.
    for (let i = 0; i < 240 && (view.assetsLoading || i < 4); i++) await sleep(500);
    clearTimeout(view._reloadTimer);
    load();
    await sleep(300);

    let stop = false, last = 0;
    const blob = await view.trace({
      samples: job.samples || 160, cancelled: () => stop,
      onProgress: (s) => {
        if (performance.now() - last < 2500) return;
        last = performance.now();
        api(`render/${id}/progress`, { method: 'POST', body: JSON.stringify({ progress: Math.min(0.99, s / (job.samples || 160)) }) })
          .then((r) => r.json()).then((r) => { if (r.stop) stop = true; }).catch(() => {});
      },
    });
    if (!blob) return fail('The render was cancelled.');
    await api(`render/${id}/result`, { method: 'POST', body: blob });
  } catch (e) {
    fail(e?.message || e);
  }
})();
