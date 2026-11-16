// In-app updates for the Android app, and build channels (#75).
//
// Every build is a GitHub release that carries its channel in its notes:
//     <!-- nidorama:channel=dev requests=75,76 -->
// A build starts in Developer (builds of main) or Private (builds with the owner's private layer).
// The owner promotes a Developer build to Beta, and a Beta build to Stable; a promotion only
// re-labels the release, so the build people tested is the build that ships. Each device chooses
// the channel it takes updates from. This is the only thing in the app that talks to the
// internet, and it can be switched off in Settings.
const API = `https://api.github.com/repos/${__REPO__}/releases`;
// A private repository only answers with a read-only access token (Settings); a public one needs none.

// The first stage is shown as Alpha (#76); its id in release notes and settings stays `dev`.
export const CHANNELS = { stable: 'Stable', beta: 'Beta', dev: 'Alpha', private: 'Private' };
/** What a device on each channel accepts: a later stage is always fine for an earlier one. */
const ACCEPTS = { stable: ['stable'], beta: ['beta', 'stable'], dev: ['dev', 'beta', 'stable'], private: ['private'] };
/** The step after each stage. Nothing can skip one. */
export const NEXT = { dev: 'beta', beta: 'stable' };
const MARK = /<!--\s*nidorama:channel=(\w+)(?:\s+requests=([\d,]*))?\s*-->/;
/** The channel this build was made for ('dev', 'private', or '' for a local build). */
export const BUILT_FOR = __CHANNEL__;

/** Build number of this app ("0.2.0+14" → 14). 0 for a development build. */
export const buildOf = (version) => +(String(version).split('+')[1] || 0);

async function gh(token, path = '', opts = {}) {
  const headers = { accept: 'application/vnd.github+json', ...(opts.body ? { 'content-type': 'application/json' } : {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { ...opts, headers, cache: 'no-store' });
  if (res.status === 404 || res.status === 401) throw new Error(token ? 'GitHub rejected the token' : 'needs a GitHub token — see Settings');
  if (res.status === 403) throw new Error('the access token does not allow this (promoting needs "Contents: read and write")');
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return res.json();
}

/** The released builds, newest first: { id, build, version, channel, requests, url, size, at, body }. */
export async function listBuilds(token = '') {
  if (!__REPO__) return [];
  const out = [];
  for (const r of await gh(token, '?per_page=40')) {
    const build = +(/build\.(\d+)$/.exec(r.tag_name || '')?.[1] || 0);
    const apk = (r.assets || []).find((a) => a.name.endsWith('.apk'));
    if (r.draft || !apk || !build) continue;
    const m = MARK.exec(r.body || '');
    out.push({ id: r.id, build, version: (r.name || r.tag_name).replace(/^Nidorama\s*/, '').replace(/\s*\(.*\)$/, ''), channel: m ? m[1] : 'private', // builds from before channels were the owner's own
      requests: m?.[2] ? m[2].split(',').filter(Boolean).map(Number) : [], url: apk.url, size: apk.size, at: r.published_at || r.created_at, body: r.body || '' });
  }
  return out.sort((a, b) => b.build - a.build);
}

/** The newest build in a device's channel that is newer than this one, or null. */
export async function findUpdate(currentVersion, token = '', channel = 'stable') {
  const mine = buildOf(currentVersion);
  if (!mine || !__REPO__) return null;
  const ok = ACCEPTS[channel] || ACCEPTS.stable;
  return (await listBuilds(token)).find((b) => ok.includes(b.channel) && b.build > mine) || null;
}
/** The newest build a channel offers, whatever is installed (used to go back to an earlier stage). */
export async function latestIn(channel, token = '') {
  const ok = ACCEPTS[channel] || ACCEPTS.stable;
  return (await listBuilds(token)).find((b) => ok.includes(b.channel)) || null;
}
/** The channels a comma list for the background check on Android. */
export const acceptedBy = (channel) => (ACCEPTS[channel] || ACCEPTS.stable).join(',');

/** Owner only: move a build one stage on (Developer → Beta → Stable). The release is re-labelled, not rebuilt. */
export async function promote(token, b) {
  const to = NEXT[b.channel];
  if (!to) throw new Error('this build cannot be promoted');
  const body = b.body.replace(MARK, (all, ch, reqs) => `<!-- nidorama:channel=${to}${reqs != null ? ` requests=${reqs}` : ''} -->`).replace(/^Channel: .*$/m, `Channel: ${CHANNELS[to]}`);
  await gh(token, `/${b.id}`, { method: 'PATCH', body: JSON.stringify({ body, prerelease: to !== 'stable', ...(to === 'stable' ? { make_latest: 'true' } : {}) }) });
  return to;
}
