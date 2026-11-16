// The integrations layer. Nidorama is a layer on top of whatever runs the home: each integration
// (Home Assistant, Homey, …) is a connection with the same small interface — a map of entity
// states and call(domain, service, data, entityIds) — and the hub presents them all as one.
//
// Home Assistant entities keep their plain ids ("light.kitchen"). Every other integration's
// entities are prefixed with its name ("homey:light.4f2a…"), which is how a call finds its way.
import { DemoConnection } from './ha.js';

const prefixOf = (id) => (id.includes(':') ? id.slice(0, id.indexOf(':')) : '');

/** A read-only view over several state maps that behaves like one Map. */
class Merged {
  constructor(providers) { this.providers = providers; }
  get(id) { return this.providers.find((p) => p.prefix === prefixOf(id))?.states.get(id); }
  has(id) { return this.get(id) !== undefined; }
  *values() { for (const p of this.providers) yield* p.states.values(); }
  *[Symbol.iterator]() { for (const p of this.providers) yield* p.states; }
}

export class Hub {
  constructor() {
    this.providers = [];
    this.states = new Merged(this.providers);
    this._listeners = new Set();
  }
  on(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }

  /** Replace the set of connections. With none, a simulated home is used so the app can be explored. */
  use(connections) {
    for (const p of this.providers) p.close();
    this.providers = connections.length ? connections : [Object.assign(new DemoConnection(), { prefix: '' })];
    this.states = new Merged(this.providers);
    for (const p of this.providers) p.on((kind, id) => { for (const fn of this._listeners) fn(kind, id, p); });
  }
  get ha() { return this.providers.find((p) => p.prefix === '' && !p.demo) || null; }
  get demo() { return this.providers.every((p) => p.demo); }
  /** Overall status: the main connection's (Home Assistant if there is one). */
  get status() { return (this.ha || this.providers[0])?.status || 'connecting'; }
  get error() { return (this.ha || this.providers[0])?.error || ''; }

  call(domain, service, data = {}, entityIds = []) {
    const ids = [].concat(entityIds);
    const jobs = [];
    for (const p of this.providers) {
      const mine = ids.filter((id) => prefixOf(id) === p.prefix);
      if (mine.length) jobs.push(p.call(domain, service, data, Array.isArray(entityIds) ? mine : mine[0]));
    }
    return Promise.all(jobs);
  }
  /** Home Assistant-only commands (saving the library, etc.). */
  request(msg) { return this.ha ? this.ha.request(msg) : Promise.reject(new Error('Not connected to Home Assistant')); }
  // The simulated home needs to know which entities to pretend exist.
  ensure(ids) { for (const p of this.providers) if (p.demo) p.ensure(ids.filter((id) => !prefixOf(id))); }
  set groups(g) { for (const p of this.providers) if (p.demo) p.groups = g; }
  close() { for (const p of this.providers) p.close(); }
}
