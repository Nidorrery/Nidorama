// Writes addon/nidorama/test/job.json: a small render job for the sample home, used to smoke-test
// the add-on's render engine in CI.   node tools/make_render_test_job.mjs
import { writeFileSync } from 'node:fs';
import { sampleHome } from '../src/store.js';
const home = sampleHome();
const level = home.levels[0];
const job = {
  key: 'test__ground__day', home, levelId: level.id, night: false, samples: 6, width: 480, height: 300,
  cam: { cx: 4, cy: 4.1, zoom: 1, az: 0, off: [0, 0] },
  lights: level.lights.slice(0, 2).map((l) => [l.id, true, 1]),
};
writeFileSync(new URL('../addon/nidorama/test/job.json', import.meta.url), JSON.stringify(job));
console.log('job written:', level.objects.length, 'objects');
