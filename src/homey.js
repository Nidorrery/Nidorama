// Homey integration (Homey Pro 2023 and newer, which have a local API with API keys).
// Talks straight to the Homey on the home network: devices become entities, Flows become things
// you can run. Routes are those of Homey's Web API v3 (ManagerDevices / ManagerFlow).
//
// A Homey device becomes one entity shaped like a Home Assistant state, so the rest of the app
// needs no special cases: { entity_id: "homey:light.<id>", state: "on", attributes: {…} }.
const POLL_MS = 2500;

const DOMAIN = (d) => {
  const caps = d.capabilities || [];
  if (d.class === 'light') return 'light';
  if (caps.includes('target_temperature')) return 'climate';
  if (['blinds', 'curtain', 'sunshade', 'windowcoverings'].includes(d.class) || caps.includes('windowcoverings_set') || caps.includes('windowcoverings_state')) return 'cover';
  if (d.class === 'fan') return 'fan';
  if (d.class === 'lock' || caps.includes('locked')) return 'lock';
  if (caps.includes('onoff')) return 'switch';
  return 'sensor';
};

export class HomeyConnection {
  constructor({ address, key }) {
    this.prefix = 'homey';
    this.base = (/^https?:\/\//.test(address) ? address : `http://${address}`).replace(/\/$/, '');
    this.key = key;
    this.states = new Map();
    this.devices = new Map(); // entity id → Homey device
    this.status = 'connecting';
    this.error = '';
    this.latency = null; // ms for the last command, shown in Settings
    this._listeners = new Set();
    this._closed = false;
    this._poll();
  }
  on(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _emit(kind, id) { for (const fn of this._listeners) fn(kind, id); }
  _status(s, err = '') { if (s !== this.status || err !== this.error) { this.status = s; this.error = err; this._emit('status'); } }

  async _api(path, opts = {}) {
    const r = await fetch(`${this.base}/api/manager/${path}`, {
      ...opts, signal: AbortSignal.timeout(8000),
      headers: { authorization: `Bearer ${this.key}`, ...(opts.body ? { 'content-type': 'application/json' } : {}) },
    });
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error('Homey rejected the API key'), { auth: true });
    if (!r.ok) throw new Error(`Homey answered ${r.status}`);
    return r.status === 204 ? null : r.json();
  }

  _entity(d) {
    const caps = d.capabilitiesObj || {}, v = (c) => caps[c]?.value;
    const domain = DOMAIN(d), id = `homey:${domain}.${d.id}`;
    const attributes = { friendly_name: d.name, homey_class: d.class };
    let state = 'off';
    if (domain === 'light' || domain === 'switch' || domain === 'fan') {
      state = v('onoff') ? 'on' : 'off';
      if (caps.dim) { attributes.supported_color_modes = ['brightness']; attributes.brightness = state === 'on' ? Math.round((v('dim') ?? 1) * 255) : null; }
    } else if (domain === 'climate') {
      state = caps.onoff && v('onoff') === false ? 'off' : 'heat';
      Object.assign(attributes, { temperature: v('target_temperature'), current_temperature: v('measure_temperature'), min_temp: caps.target_temperature?.min ?? 5, max_temp: caps.target_temperature?.max ?? 30, target_temp_step: caps.target_temperature?.step || 0.5 });
    } else if (domain === 'cover') {
      state = caps.windowcoverings_set ? (v('windowcoverings_set') > 0.02 ? 'open' : 'closed') : v('windowcoverings_state') === 'down' ? 'closed' : 'open';
    } else if (domain === 'lock') state = v('locked') ? 'locked' : 'unlocked';
    else {
      const c = ['measure_temperature', 'measure_humidity', 'measure_power', 'measure_luminance', 'alarm_motion', 'alarm_contact'].find((k) => caps[k]) || Object.keys(caps)[0];
      state = c ? String(v(c)) : 'unknown';
      if (c && caps[c].units) attributes.unit_of_measurement = caps[c].units;
    }
    return { entity_id: id, state, attributes };
  }

  async _poll() {
    if (this._closed) return;
    try {
      const devices = await this._api('devices/device');
      if (!this._flows || Date.now() - this._flowsAt > 60000) {
        const [flows, adv] = await Promise.all([this._api('flow/flow').catch(() => ({})), this._api('flow/advancedflow').catch(() => ({}))]);
        this._flows = [...Object.values(flows || {}).map((f) => ({ ...f, kind: 'flow' })), ...Object.values(adv || {}).map((f) => ({ ...f, kind: 'advancedflow' }))];
        this._flowsAt = Date.now();
      }
      const next = new Map();
      this.devices.clear();
      for (const d of Object.values(devices || {})) { const e = this._entity(d); next.set(e.entity_id, e); this.devices.set(e.entity_id, d); }
      for (const f of this._flows) next.set(`homey:script.${f.kind}_${f.id}`, { entity_id: `homey:script.${f.kind}_${f.id}`, state: 'off', attributes: { friendly_name: `${f.name} (Flow)` } });
      const changed = next.size !== this.states.size || [...next].some(([id, e]) => JSON.stringify(e) !== JSON.stringify(this.states.get(id)));
      this.states = next;
      this._status('connected');
      if (changed) this._emit('states', null);
    } catch (e) {
      this._status(e.auth ? 'auth_invalid' : 'disconnected', e.auth ? e.message : 'Cannot reach the Homey on this network');
    }
    this._timer = setTimeout(() => this._poll(), this.status === 'connected' ? POLL_MS : 6000);
  }

  async _set(id, capability, value) {
    const d = this.devices.get(id);
    if (!d || !(d.capabilities || []).includes(capability)) return;
    const t0 = performance.now();
    // Show the change at once; the next poll confirms it.
    if (d.capabilitiesObj?.[capability]) { d.capabilitiesObj[capability].value = value; this.states.set(id, this._entity(d)); this._emit('states', id); }
    await this._api(`devices/device/${d.id}/capability/${capability}`, { method: 'PUT', body: JSON.stringify({ value }) });
    this.latency = Math.round(performance.now() - t0);
  }

  async call(domain, service, data = {}, entityIds = []) {
    for (const id of [].concat(entityIds)) {
      try {
        const s = this.states.get(id), d = this.devices.get(id);
        if (domain === 'script') { const [, kind, fid] = /^homey:script\.(flow|advancedflow)_(.+)$/.exec(id) || []; if (fid) await this._api(`flow/${kind}/${fid}/trigger`, { method: 'POST', body: '{}' }); continue; }
        if (!d) continue;
        const caps = d.capabilities || [];
        if (service === 'set_temperature') { await this._set(id, 'target_temperature', data.temperature); continue; }
        if (domain === 'cover') {
          const open = service === 'toggle' ? s.state !== 'open' : service === 'open_cover';
          if (caps.includes('windowcoverings_set')) await this._set(id, 'windowcoverings_set', open ? 1 : 0); else await this._set(id, 'windowcoverings_state', open ? 'up' : 'down');
          continue;
        }
        if (domain === 'lock') { await this._set(id, 'locked', service === 'toggle' ? s.state !== 'locked' : service === 'lock'); continue; }
        const on = service === 'set_hvac_mode' ? data.hvac_mode !== 'off' : service === 'toggle' ? s.state !== 'on' && s.state !== 'heat' : service === 'turn_on';
        if (on && data.brightness_pct != null && caps.includes('dim')) await this._set(id, 'dim', Math.max(0.01, data.brightness_pct / 100));
        await this._set(id, 'onoff', on);
      } catch (e) { console.warn('Homey command failed', id, e); }
    }
  }
  close() { this._closed = true; clearTimeout(this._timer); }
}
