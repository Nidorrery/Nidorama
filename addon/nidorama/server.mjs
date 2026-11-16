// Nidorama add-on server.
//  1. Serves the web app, and proxies Home Assistant's WebSocket API (so ingress needs no token).
//  2. Keeps shared files in a plain folder on the Home Assistant machine (default /share/nidorama):
//       photos/   the user's photos            models/   imported 3D models
//       renders/  finished photo renders       library/  .glb files the user drops in (their own model library)
//       homes/    homes and dashboards shared with everyone in the household
//  3. Makes photo renders: a headless browser on this machine runs the same renderer as the app,
//     for phones and tablets too slow to do it themselves.
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readFile, stat, mkdir, writeFile, unlink, readdir, rm } from 'node:fs/promises';
import { readFileSync, existsSync, renameSync } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';

const ROOT = path.resolve(process.env.NIDORAMA_WWW || '/app/www');
const ASSETS = path.resolve(process.env.NIDORAMA_ASSETS || '/share/nidorama');
// The add-on's earlier name kept its files in another folder: bring that across once, if this one does not exist yet.
try { const was = ASSETS.replace(/nidorama$/, 'diorama'); if (was !== ASSETS && existsSync(was) && !existsSync(ASSETS)) renameSync(was, ASSETS); } catch {}
const PORT = +(process.env.PORT || 8099);
const TOKEN = process.env.SUPERVISOR_TOKEN;
const CORE_WS = process.env.CORE_WS || 'ws://supervisor/core/websocket';
const CORE_URL = process.env.CORE_URL || 'http://homeassistant:8123';
const CHROMIUM = process.env.CHROMIUM || ['/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => existsSync(p)) || '';
const INGRESS_IP = '172.30.32.2';
const KINDS = ['photos', 'models', 'renders', 'library', 'homes']; // homes/ = dashboards shared with the whole household
const MAX_UPLOAD = 80 * 1024 * 1024;
let options = {};
try { options = JSON.parse(readFileSync(process.env.NIDORAMA_OPTIONS || '/data/options.json', 'utf8')); } catch {}
let version = 'dev';
try { version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url))).version || version; } catch {}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, PUT, POST, DELETE, OPTIONS' };

// ---------- who may use the API ----------
const ip = (req) => req.socket.remoteAddress?.replace('::ffff:', '') || '';
const isLocal = (req) => ['127.0.0.1', '::1'].includes(ip(req));
const viaIngress = (req) => ip(req) === INGRESS_IP && !!req.headers['x-ingress-path'];
const proxyAllowed = (req) => !!TOKEN && (viaIngress(req) || options.lan_without_login === true);
const goodTokens = new Map(); // token → time verified
/** Ingress and this machine are trusted; anyone else must present a valid Home Assistant access token. */
async function allowed(req) {
  if (viaIngress(req) || isLocal(req) || options.lan_without_login === true) return true;
  const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
  if (!token) return false;
  if (Date.now() - (goodTokens.get(token) || 0) < 600000) return true;
  try {
    const r = await fetch(`${CORE_URL}/api/`, { headers: { authorization: `Bearer ${token}` } });
    if (r.ok) { goodTokens.set(token, Date.now()); return true; }
  } catch {}
  return false;
}

// ---------- helpers ----------
const send = (res, status, body, headers = {}) => { res.writeHead(status, { ...CORS, ...headers }); res.end(body); };
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'content-type': 'application/json', 'cache-control': 'no-store' });
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_UPLOAD) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
/** A safe path inside the assets folder, or null. One sub-folder is allowed (library/<category>/file.glb). */
function assetPath(kind, name) {
  if (!KINDS.includes(kind)) return null;
  const parts = name.split('/').map(decodeURIComponent);
  if (!parts.length || parts.length > 2 || parts.some((p) => !/^[\w][\w .-]*$/.test(p) || p.includes('..'))) return null;
  return path.join(ASSETS, kind, ...parts);
}

// ---------- render jobs ----------
const jobs = new Map(); // id → { job, state, progress, error, proc, key }
const queue = [];
let running = null;
function startNext() {
  if (running || !queue.length) return;
  const id = queue.shift(), j = jobs.get(id);
  if (!j || j.state !== 'queued') return startNext();
  running = id;
  j.state = 'running';
  j.started = Date.now();
  const { width = 1280, height = 800 } = j.job;
  const dir = path.join(os.tmpdir(), `nidorama-render-${id}`);
  // No graphics card is assumed: the browser draws in software, which is why this is slow but works anywhere.
  j.proc = spawn(CHROMIUM, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--mute-audio',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    `--window-size=${Math.round(width) + 40},${Math.round(height) + 240}`, `--user-data-dir=${dir}`,
    `http://127.0.0.1:${PORT}/?render=${id}`,
  ], { stdio: 'ignore' });
  const finish = (state, error) => {
    if (running !== id) return;
    running = null;
    clearTimeout(j.timer);
    if (j.state === 'running') { j.state = state; j.error = error; }
    try { j.proc.kill('SIGKILL'); } catch {}
    rm(dir, { recursive: true, force: true }).catch(() => {});
    setTimeout(() => jobs.delete(id), 3600000);
    startNext();
  };
  j.finish = finish;
  j.timer = setTimeout(() => finish('error', 'The render took longer than 3 hours and was stopped.'), 3 * 3600000);
  j.proc.on('error', (e) => finish('error', `The render engine could not start: ${e.message}`));
  j.proc.on('exit', () => finish('error', 'The render engine stopped before finishing (it may have run out of memory).'));
}

async function api(req, res, route) {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (!(await allowed(req))) return json(res, 401, { error: 'A Home Assistant access token is needed.' });
  const [head, ...rest] = route.split('/');

  if (head === 'info') {
    return json(res, 200, {
      version, folder: ASSETS,
      machine: { cores: os.cpus().length, memoryGB: +(os.totalmem() / 2 ** 30).toFixed(1), arch: os.arch() },
      render: { available: !!CHROMIUM, busy: !!running, queued: queue.length, suggestedMinimum: { cores: 4, memoryGB: 4, arch: 'x64' } },
    });
  }

  if (head === 'library' && req.method === 'GET') {
    // Every .glb in library/ (optionally one folder deep; the folder name is the category).
    const models = [];
    const dir = path.join(ASSETS, 'library');
    const scan = async (sub) => {
      for (const e of await readdir(path.join(dir, sub), { withFileTypes: true }).catch(() => [])) {
        if (e.isDirectory() && !sub) await scan(e.name);
        else if (/\.glb$/i.test(e.name)) {
          const file = sub ? `${sub}/${e.name}` : e.name, base = e.name.replace(/\.glb$/i, '');
          const thumb = ['.jpg', '.png', '.webp'].map((x) => base + x).find((t) => existsSync(path.join(dir, sub, t)));
          models.push({ name: base.replace(/[_-]+/g, ' '), category: sub || 'My models', file: `assets/library/${file.split('/').map(encodeURIComponent).join('/')}`, thumb: thumb ? `assets/library/${sub ? sub + '/' : ''}${encodeURIComponent(thumb)}` : undefined });
        }
      }
    };
    await scan('');
    return json(res, 200, { name: 'Your Home Assistant library', license: `files in ${dir}`, models });
  }

  if (head === 'list' && req.method === 'GET' && KINDS.includes(rest[0])) {
    const files = [];
    for (const e of await readdir(path.join(ASSETS, rest[0]), { withFileTypes: true }).catch(() => [])) {
      if (e.isFile()) files.push({ name: e.name, modified: (await stat(path.join(ASSETS, rest[0], e.name))).mtimeMs });
    }
    return json(res, 200, { files });
  }

  if (head === 'assets') {
    const file = assetPath(rest[0], rest.slice(1).join('/'));
    if (!file) return json(res, 400, { error: 'Bad asset name.' });
    if (req.method === 'GET') {
      try {
        const body = await readFile(file);
        return send(res, 200, body, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
      } catch { return json(res, 404, { error: 'Not found.' }); }
    }
    if (req.method === 'PUT') {
      const body = await readBody(req);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
      return json(res, 200, { ok: true, bytes: body.length });
    }
    if (req.method === 'DELETE') { await unlink(file).catch(() => {}); return json(res, 200, { ok: true }); }
  }

  if (head === 'render') {
    if (!rest.length && req.method === 'POST') {
      if (!CHROMIUM) return json(res, 503, { error: 'The render engine is not installed in this add-on.' });
      const job = JSON.parse((await readBody(req)).toString());
      if (!job?.home?.levels || !/^[\w-]+$/.test(job.key || '')) return json(res, 400, { error: 'Bad render job.' });
      const id = Math.random().toString(36).slice(2, 10);
      jobs.set(id, { job, state: 'queued', progress: 0, key: job.key });
      queue.push(id);
      startNext();
      return json(res, 200, { id, position: queue.length });
    }
    const j = jobs.get(rest[0]);
    if (!j) return json(res, 404, { error: 'No such render.' });
    if (rest.length === 1 && req.method === 'GET') return json(res, 200, { state: j.state, progress: j.progress, error: j.error, seconds: j.started ? Math.round((Date.now() - j.started) / 1000) : 0, queuedAhead: Math.max(0, queue.indexOf(rest[0])) });
    if (rest.length === 1 && req.method === 'DELETE') {
      if (j.state === 'queued') j.state = 'cancelled';
      else if (j.state === 'running') { j.state = 'cancelled'; j.finish?.('cancelled'); }
      return json(res, 200, { ok: true });
    }
    // The three calls below come from the render page itself, on this machine only.
    if (!isLocal(req)) return json(res, 403, { error: 'Local only.' });
    if (rest[1] === 'job') return json(res, 200, j.job);
    if (rest[1] === 'progress' && req.method === 'POST') { j.progress = +JSON.parse((await readBody(req)).toString()).progress || 0; return json(res, 200, { stop: j.state !== 'running' }); }
    if (rest[1] === 'error' && req.method === 'POST') { const msg = (await readBody(req)).toString().slice(0, 500); j.finish?.('error', msg); return json(res, 200, {}); }
    if (rest[1] === 'result' && req.method === 'POST') {
      const body = await readBody(req);
      const dir = path.join(ASSETS, 'renders');
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `${j.key}.jpg`), body);
      await writeFile(path.join(dir, `${j.key}.json`), JSON.stringify({ cam: j.job.cam, aspect: j.job.width / j.job.height, at: Date.now(), homeUpdatedAt: j.job.home.updatedAt || 0, by: 'home-assistant' }));
      j.progress = 1;
      j.finish?.('done');
      return json(res, 200, {});
    }
  }
  return json(res, 404, { error: 'Unknown request.' });
}

// ---------- web server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const apiAt = url.pathname.indexOf('/api/nidorama/');
  if (apiAt >= 0) {
    try { return await api(req, res, url.pathname.slice(apiAt + '/api/nidorama/'.length).replace(/\/$/, '')); } catch (e) { return json(res, 500, { error: String(e.message || e) }); }
  }
  const cam = url.pathname.match(/\/ha-(?:camera|picture)\/((?:camera|media_player)\.[a-z0-9_]+)$/);
  if (cam) { // a camera's current picture, for widgets (the app has no Home Assistant address of its own in here)
    if (!proxyAllowed(req)) return send(res, 404, '');
    try {
      const r = await fetch(`http://supervisor/core/api/${cam[1].startsWith('camera.') ? 'camera_proxy' : 'media_player_proxy'}/${cam[1]}`, { headers: { authorization: `Bearer ${TOKEN}` } });
      if (!r.ok) return send(res, r.status, '');
      res.writeHead(200, { 'content-type': r.headers.get('content-type') || 'image/jpeg', 'cache-control': 'no-store' });
      return res.end(Buffer.from(await r.arrayBuffer()));
    } catch { return send(res, 502, ''); }
  }
  if (url.pathname.endsWith('/nidorama-config.json')) {
    if (!proxyAllowed(req)) return send(res, 404, '');
    return json(res, 200, { addon: true });
  }
  let file = path.join(ROOT, path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) return send(res, 403, '');
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
  } catch { file = path.join(ROOT, 'index.html'); }
  try {
    const body = await readFile(file);
    const ext = path.extname(file);
    res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (!req.url.split('?')[0].endsWith('/api/websocket') || !proxyAllowed(req)) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (client) => {
    const core = new WebSocket(CORE_WS);
    const pending = [];
    core.on('open', () => { for (const m of pending) core.send(m); pending.length = 0; });
    core.on('message', (data) => client.readyState === 1 && client.send(data.toString()));
    client.on('message', (data) => {
      let msg = data.toString();
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'auth') msg = JSON.stringify({ type: 'auth', access_token: TOKEN });
      } catch {}
      core.readyState === 1 ? core.send(msg) : pending.push(msg);
    });
    const close = () => { try { client.close(); } catch {} try { core.close(); } catch {} };
    core.on('close', close); core.on('error', close);
    client.on('close', close); client.on('error', close);
  });
});

for (const k of KINDS) mkdir(path.join(ASSETS, k), { recursive: true }).catch(() => {});
server.listen(PORT, () => console.log(`Nidorama ${version} on :${PORT} · files in ${ASSETS} · render engine ${CHROMIUM ? 'ready' : 'not installed'} · ${os.cpus().length} cores, ${(os.totalmem() / 2 ** 30).toFixed(1)} GB`));
