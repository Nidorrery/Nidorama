// Minimal Home Assistant WebSocket client (LAN only, no cloud).
// Also provides a demo store so the UI is usable before a connection is configured.

// Entities from integrations other than Home Assistant carry a prefix: "homey:light.abc".
export const domainOf = (id) => id.slice(id.indexOf(':') + 1).split('.')[0];

export function isOn(st) {
  if (!st) return false;
  return ['on', 'open', 'heat', 'cool', 'auto', 'heat_cool', 'playing', 'home', 'unlocked'].includes(st.state);
}

export function brightnessPct(st) {
  if (!st || st.state !== 'on') return 0;
  const b = st.attributes?.brightness;
  return b == null ? 100 : Math.round((b / 255) * 100);
}

export function isDimmable(st) {
  if (!st || domainOf(st.entity_id) !== 'light') return false;
  const modes = st.attributes?.supported_color_modes;
  if (!modes) return st.attributes?.brightness != null;
  return !(modes.length === 1 && modes[0] === 'onoff');
}

class Emitter {
  constructor() { this._l = new Set(); }
  on(fn) { this._l.add(fn); return () => this._l.delete(fn); }
  emit(...a) { for (const fn of this._l) fn(...a); }
}

/** Shared interface: states (Map), status, onChange(fn), call(domain, service, data, target). */
export class HAConnection extends Emitter {
  /**
   * urls: the address to use, or [local, remote] — the local one is tried first and the remote one
   * is the fallback (away from home). token: a long-lived access token; or auth: what "Sign in to
   * Home Assistant" returned ({ access_token, refresh_token, expires, clientId }).
   */
  constructor({ url, urls, token, auth, onAuth, viaProxy = false }) {
    super();
    this.prefix = ''; // Home Assistant entities are not prefixed
    this.urls = (urls || [url]).filter(Boolean);
    this.route = 0; // index into urls currently in use
    this.url = this.urls[0];
    this.token = token;
    this.auth = auth || null;
    this.onAuth = onAuth;
    this.viaProxy = viaProxy;
    this.states = new Map();
    this.status = 'connecting';
    this.error = '';
    this._id = 1;
    this._pending = new Map();
    this._retry = 1000;
    this._closed = false;
    this._connect();
  }

  _wsUrl() {
    if (this.viaProxy) {
      const u = new URL('api/websocket', location.href);
      u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
      return u.href;
    }
    const u = new URL(this.url);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = u.pathname.replace(/\/$/, '') + '/api/websocket';
    return u.href;
  }

  _setStatus(s, err = '') {
    this.status = s;
    this.error = err;
    this.emit('status');
  }

  _connect() {
    if (this._closed) return;
    let ws;
    try {
      this.url = this.urls[this.route] || this.url;
      this._opened = false;
      ws = new WebSocket(this._wsUrl());
    } catch (e) {
      this._setStatus('error', String(e.message || e));
      return;
    }
    this.ws = ws;
    this._setStatus('connecting');
    ws.onmessage = (ev) => this._onMessage(JSON.parse(ev.data));
    ws.onclose = () => {
      clearInterval(this._ping);
      for (const [, p] of this._pending) p.reject(new Error('disconnected'));
      this._pending.clear();
      if (this._closed) return;
      if (this.status !== 'auth_invalid') this._setStatus('disconnected', this.error);
      if (this.status === 'auth_invalid') return;
      // Could not even open this address: try the other one (local ↔ remote) straight away.
      if (!this._opened && this.urls.length > 1) { this.route = (this.route + 1) % this.urls.length; this._retry = this.route === 0 ? this._retry : 300; }
      setTimeout(() => this._connect(), this._retry);
      this._retry = Math.min(this._retry * 2, 30000);
    };
    ws.onerror = () => { this.error = 'Cannot reach Home Assistant'; };
  }

  /** The access token to present: the pasted one, or the signed-in one (renewed when it is about to expire). */
  async _accessToken() {
    if (this.viaProxy) return 'proxy';
    const a = this.auth;
    if (!a) return this.token;
    if (a.expires - Date.now() > 60000) return a.access_token;
    const r = await fetch(`${this.url.replace(/\/$/, '')}/auth/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: a.refresh_token, client_id: a.clientId }) });
    if (!r.ok) throw new Error('Home Assistant sign-in has expired');
    const t = await r.json();
    Object.assign(a, { access_token: t.access_token, expires: Date.now() + t.expires_in * 1000 });
    this.onAuth?.(a);
    return a.access_token;
  }

  _send(msg) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  _request(msg) {
    const id = this._id++;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this._send({ ...msg, id });
    });
  }

  async _onMessage(m) {
    if (m.type === 'auth_required') {
      this._opened = true;
      try { this._send({ type: 'auth', access_token: await this._accessToken() }); } catch (e) { this._setStatus('auth_invalid', String(e.message || e)); this.ws.close(); }
    } else if (m.type === 'auth_invalid') {
      this._setStatus('auth_invalid', m.message || 'Token rejected');
    } else if (m.type === 'auth_ok') {
      this._retry = 1000;
      try {
        const states = await this._request({ type: 'get_states' });
        this.states = new Map(states.map((s) => [s.entity_id, s]));
        await this._request({ type: 'subscribe_events', event_type: 'state_changed' });
        this._setStatus('connected');
        this.emit('states', null);
        this._ping = setInterval(() => this._request({ type: 'ping' }).catch(() => {}), 30000);
      } catch (e) {
        this._setStatus('error', String(e.message || e));
      }
    } else if (m.type === 'result' || m.type === 'pong') {
      const p = this._pending.get(m.id);
      if (p) {
        this._pending.delete(m.id);
        if (m.type === 'pong' || m.success) p.resolve(m.result);
        else p.reject(new Error(m.error?.message || 'failed'));
      }
    } else if (m.type === 'event' && m.event?.event_type === 'state_changed') {
      const { entity_id, new_state } = m.event.data;
      if (new_state) this.states.set(entity_id, new_state);
      else this.states.delete(entity_id);
      this.emit('states', entity_id);
    }
  }

  /** Send any WebSocket command and resolve with its result. */
  request(msg) { return this._request(msg); }

  call(domain, service, data = {}, entityIds) {
    const msg = { type: 'call_service', domain, service, service_data: data };
    if (entityIds) msg.target = { entity_id: entityIds };
    return this._request(msg).catch((e) => console.warn('service call failed', domain, service, e));
  }

  close() {
    this._closed = true;
    clearInterval(this._ping);
    this.ws?.close();
  }
}

// What a pretend camera shows: a drawn front path, so the sample has a picture without any real one.
const DEMO_CAMERA = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#9fc3d8"/><rect y="96" width="320" height="84" fill="#7da36a"/><path d="M130 180 L150 96 L176 96 L214 180Z" fill="#cfc4b2"/><rect x="18" y="52" width="70" height="60" fill="#e8ded0"/><path d="M12 54 L53 26 L94 54Z" fill="#9a5b45"/><rect x="44" y="78" width="18" height="34" fill="#2f5d50"/><circle cx="262" cy="74" r="26" fill="#4f7f46"/><rect x="258" y="94" width="8" height="26" fill="#6b4a33"/></svg>');

/** Offline stand-in: keeps state locally so the plan can be explored without Home Assistant. */
export class DemoConnection extends Emitter {
  constructor(entityIds = [], groups = {}) {
    super();
    this.groups = groups; // group entity → member entities, so the demo behaves like HA groups
    this.prefix = '';
    this.demo = true;
    this.status = 'demo';
    this.states = new Map();
    this.ensure(entityIds);
  }

  /** Make sure simulated states exist for these entities. */
  ensure(entityIds) {
    for (const id of entityIds) {
      if (!id || this.states.has(id)) continue;
      const d = domainOf(id);
      const attrs = { friendly_name: id.split('.')[1]?.replace(/_/g, ' ') || id };
      if (d === 'light') attrs.supported_color_modes = /colou?r|rgb|hue/.test(id) ? ['color_temp', 'hs'] : ['brightness'];
      if (d === 'light' && attrs.supported_color_modes.length > 1) Object.assign(attrs, { min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500, color_temp_kelvin: 2700 });
      if (d === 'climate') Object.assign(attrs, { temperature: 21, current_temperature: 19.5, hvac_modes: /air|ac_|hvac|cool/.test(id) ? ['off', 'heat', 'cool', 'auto'] : ['off', 'heat'], min_temp: 5, max_temp: 30, target_temp_step: 0.5 });
      if (d === 'fan') Object.assign(attrs, { percentage: 0, percentage_step: 25, oscillating: false });
      if (d === 'cover') attrs.current_position = 0;
      if (d === 'media_player') Object.assign(attrs, { volume_level: 0.4, source_list: ['TV', 'Music', 'Radio'], source: 'TV' });
      let state = 'off';
      if (d === 'input_select') { state = 'Auto'; attrs.options = ['Auto', 'Off']; }
      if (d === 'climate') state = 'heat';
      if (d === 'sensor') { state = '21.5'; attrs.unit_of_measurement = '°C'; }
      if (d === 'cover') state = 'closed';
      if (d === 'media_player') state = 'paused';
      if (d === 'lock') state = 'locked';
      if (d === 'sensor' && /humid/.test(id)) { state = '48'; attrs.unit_of_measurement = '%'; }
      if (d === 'sensor' && /solar|power/.test(id)) { state = '3.4'; attrs.unit_of_measurement = 'kW'; }
      if (d === 'weather') { state = 'partlycloudy'; Object.assign(attrs, { temperature: 22, temperature_unit: '°C', humidity: 48, wind_speed: 11, wind_speed_unit: 'km/h', wind_bearing: 135, pressure: 1016, pressure_unit: 'hPa' }); }
      if (d === 'media_player' && /speaker|music/.test(id)) Object.assign(attrs, { media_title: 'Morning light', media_artist: 'The Sample Band', source_list: ['Music', 'Radio'], source: 'Music' });
      if (d === 'camera') { state = 'idle'; attrs.entity_picture = DEMO_CAMERA; }
      this.states.set(id, { entity_id: id, state, attributes: attrs });
    }
  }

  _set(id, state, attrs = {}) {
    const s = this.states.get(id) || { entity_id: id, attributes: {} };
    this.states.set(id, { ...s, state, attributes: { ...s.attributes, ...attrs } });
    this.emit('states', id);
  }

  call(domain, service, data = {}, entityIds = []) {
    const ids = Array.isArray(entityIds) ? entityIds : [entityIds];
    for (const id of ids) {
      const s = this.states.get(id);
      if (domain === 'script' || domain === 'scene') {
        for (const [sid, cur] of this.states) if (domainOf(sid) === 'input_select') this._set(sid, cur.state === 'Auto' ? 'Off' : 'Auto');
        continue;
      }
      if (domain === 'cover') {
        if (service === 'stop_cover') continue;
        const pos = service === 'set_cover_position' ? data.position : service === 'toggle' ? (s?.state === 'open' ? 0 : 100) : service === 'open_cover' ? 100 : 0;
        this._set(id, pos > 0 ? 'open' : 'closed', { current_position: pos });
        continue;
      }
      if (domain === 'fan' && service !== 'toggle' && service !== 'turn_on' && service !== 'turn_off') {
        if (service === 'set_percentage') this._set(id, data.percentage > 0 ? 'on' : 'off', { percentage: data.percentage });
        if (service === 'oscillate') this._set(id, s.state, { oscillating: data.oscillating });
        if (service === 'set_direction') this._set(id, s.state, { direction: data.direction });
        continue;
      }
      if (domain === 'media_player') {
        if (service === 'volume_set') this._set(id, s.state, { volume_level: data.volume_level });
        else if (service === 'select_source') this._set(id, s.state, { source: data.source });
        else this._set(id, s?.state === 'playing' ? 'paused' : 'playing');
        continue;
      }
      if (domain === 'lock') { this._set(id, service === 'lock' ? 'locked' : 'unlocked'); continue; }
      if (domain === 'climate') {
        if (service === 'set_temperature') this._set(id, s.state, { temperature: data.temperature });
        if (service === 'set_hvac_mode') this._set(id, data.hvac_mode);
        if (service === 'set_fan_mode') this._set(id, s.state, { fan_mode: data.fan_mode });
        continue;
      }
      const on = service === 'toggle' ? s?.state !== 'on' : service === 'turn_on';
      const attrs = {};
      if (on && domainOf(id) === 'light') {
        attrs.brightness = data.brightness_pct != null ? Math.round((data.brightness_pct / 100) * 255) : s?.attributes?.brightness ?? 255;
        if (data.color_temp_kelvin) attrs.color_temp_kelvin = data.color_temp_kelvin;
        if (data.hs_color) attrs.hs_color = data.hs_color;
      }
      this._set(id, on ? 'on' : 'off', attrs);
      if (this.groups[id]) this.call(domain === 'homeassistant' ? domain : domainOf(this.groups[id][0]), on ? 'turn_on' : 'turn_off', {}, this.groups[id]);
    }
    return Promise.resolve();
  }

  close() {}
}
