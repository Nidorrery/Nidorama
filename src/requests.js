// Feature requests and bug reports. A request is only ever *logged* (as a GitHub issue on the
// project); nothing is built until the project owner approves it. The owner reviews the log in the
// app and marks requests approved or declined.
const REPO = __REPO__;
const API = `https://api.github.com/repos/${REPO}`;
export const NEW_ISSUE_URL = `https://github.com/${REPO}/issues/new`;

async function gh(token, path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts, cache: 'no-store',
    headers: { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opts.body ? { 'content-type': 'application/json' } : {}) },
  });
  if (res.status === 401) throw new Error('GitHub rejected the access token');
  if (res.status === 403 || res.status === 404) throw new Error('the access token does not allow this (it needs Issues: read and write)');
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return res.status === 204 ? null : res.json();
}

/** Is this token the project owner's (may approve requests)? */
export async function isOwner(token) {
  try { const r = await gh(token, ''); return !!(r.permissions?.push || r.permissions?.admin); } catch { return false; }
}

/** What part of the app a request is about (#61, #68). Stored as a label and as a line in the request. */
export const AREAS = [['buttons', 'Widget pages'], ['plan', 'Floor plans'], ['interface', 'Interface']];
const areaOf = (labels) => AREAS.find(([k]) => labels.includes(k))?.[0] || '';
export const areaName = (k) => AREAS.find((a) => a[0] === k)?.[1] || '';
const statusOf = (labels) => (labels.includes('approved') ? 'approved' : 'new');
/** Where an approved request is to be built first (#75): the Developer channel, or the owner's private build. */
export const TARGETS = [['dev', 'Alpha'], ['private', 'Private']];
const targetOf = (labels) => (labels.includes('target-private') ? 'private' : labels.includes('target-dev') ? 'dev' : '');
/** Open requests, newest first: { number, title, body, kind, status, by, at, url }. */
export async function listRequests(token) {
  const issues = await gh(token, '/issues?state=open&per_page=100&sort=created&direction=desc');
  return issues.filter((i) => !i.pull_request).map((i) => {
    const labels = i.labels.map((l) => l.name);
    return { number: i.number, title: i.title, body: i.body || '', kind: ['fix', 'feature', 'change'].find((k) => labels.includes(k)) || 'request', area: areaOf(labels), comments: i.comments || 0, votes: i.reactions?.['+1'] || 0, status: statusOf(labels), target: targetOf(labels), experimental: labels.includes('experimental'), by: i.user?.login || '', at: i.created_at, url: i.html_url };
  });
}

/** Log a request. It is not acted on until the owner approves it. */
export function sendRequest(token, { kind, area, title, details, version }) {
  const body = `${details || '(no details)'}\n\nAbout: ${areaName(area) || 'not said'}\n\n---\nSent from the Nidorama app ${version} · ${/Android/.test(navigator.userAgent) ? 'Android' : 'browser'}`;
  return gh(token, '/issues', { method: 'POST', body: JSON.stringify({ title, body, labels: ['request', kind, ...(area ? [area] : [])] }) });
}

// ---------- screenshots (#66) ----------
// GitHub has no way for an app to upload a picture to an issue, so a screenshot is shrunk and
// kept as text in a comment on the request. The app can read it back from there.
const MARK = 'nidorama-screenshot';
const LIMIT = 60000; // a comment holds 65 536 characters
/** Shrink a picture until it fits in one comment. Resolves with a JPEG data URL. */
export async function shrinkScreenshot(file) {
  const img = await createImageBitmap(file);
  for (const [side, q] of [[1280, 0.6], [1100, 0.5], [960, 0.45], [800, 0.4], [640, 0.38], [520, 0.35], [400, 0.3]]) {
    const k = Math.min(1, side / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', q);
    if (url.length <= LIMIT) return url;
  }
  throw new Error('That picture could not be made small enough');
}
export const attachScreenshot = (token, n, dataUrl, i) => gh(token, `/issues/${n}/comments`, { method: 'POST',
  body: JSON.stringify({ body: `<!-- ${MARK} -->\n<details><summary>Screenshot ${i} (shown in the Nidorama app: More → Requests)</summary>\n\n\`\`\`\n${dataUrl}\n\`\`\`\n\n</details>` }) });
/** The screenshots attached to a request, as data URLs. */
export async function screenshotsOf(token, n) {
  const comments = await gh(token, `/issues/${n}/comments?per_page=100`);
  return comments.filter((c) => (c.body || '').includes(MARK)).map((c) => (c.body.match(/data:image\/jpeg;base64,[A-Za-z0-9+/=]+/) || [])[0]).filter(Boolean);
}

/** Approve a request and say where it goes: 'dev' or 'private', and whether it stays behind experimental mode. */
export async function approve(token, n, { target = 'dev', experimental = false } = {}) {
  for (const old of ['target-dev', 'target-private', 'experimental']) await gh(token, `/issues/${n}/labels/${old}`, { method: 'DELETE' }).catch(() => null);
  return gh(token, `/issues/${n}/labels`, { method: 'POST', body: JSON.stringify({ labels: ['approved', `target-${target}`, ...(experimental ? ['experimental'] : [])] }) });
}
/** Vote for a request (#77): a thumbs-up on its issue, one per GitHub account. Resolves with the vote's id. */
export const vote = async (token, n) => (await gh(token, `/issues/${n}/reactions`, { method: 'POST', body: JSON.stringify({ content: '+1' }) })).id;
export const unvote = (token, n, id) => gh(token, `/issues/${n}/reactions/${id}`, { method: 'DELETE' });
/** Owner only: change a request's title and text. */
export const editRequest = (token, n, { title, body }) => gh(token, `/issues/${n}`, { method: 'PATCH', body: JSON.stringify({ title, body }) });
export const unapprove = (token, n) => gh(token, `/issues/${n}/labels/approved`, { method: 'DELETE' }).catch(() => null);
export const decline = (token, n) => gh(token, `/issues/${n}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'not_planned' }) });
