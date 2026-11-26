// Suhaili server: static files, sign-in (Google or an emailed link) and one saved voyage per account.
// Zero dependencies. Secrets come from the environment or SECRETS_FILE, never from the repo.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = process.env.PUBLIC_DIR || path.join(HERE, '..', 'public');
const DATA = process.env.DATA_DIR || path.join(HERE, '..', 'data');
const PORT = Number(process.env.PORT || 8110);
const HOST = process.env.HOST || '127.0.0.1';

function loadEnvFile(p) {
  try {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* no secrets file */ }
}
loadEnvFile(process.env.SECRETS_FILE || path.join(process.env.HOME || '.', '.config', 'suhaili', 'secrets.env'));

const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SECURE = BASE_URL.startsWith('https://');
const GOOGLE_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const BREVO_KEY = process.env.BREVO_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || '';       // e.g. "Suhaili <noreply@example.com>"
const MAIL_DEV = process.env.MAIL_DEV === '1';       // dev only: log the link instead of sending

fs.mkdirSync(path.join(DATA, 'users'), { recursive: true, mode: 0o700 });

// ---------- small helpers ----------
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const b64u = (b) => Buffer.from(b).toString('base64url');

function secretKey() {
  const p = path.join(DATA, 'secret');
  try { return fs.readFileSync(p); } catch { /* first run */ }
  const k = crypto.randomBytes(32);
  fs.writeFileSync(p, k, { mode: 0o600 });
  return k;
}
const KEY = secretKey();

function sign(obj) {
  const body = b64u(JSON.stringify(obj));
  return body + '.' + crypto.createHmac('sha256', KEY).update(body).digest('base64url');
}
function unsign(tok) {
  if (typeof tok !== 'string') return null;
  const [body, mac] = tok.split('.');
  if (!body || !mac) return null;
  const want = crypto.createHmac('sha256', KEY).update(body).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const o = JSON.parse(Buffer.from(body, 'base64url').toString());
    return o.exp && o.exp > Date.now() ? o : null;
  } catch { return null; }
}

function writeJSON(file, obj) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
const userFile = (email) => path.join(DATA, 'users', sha(email) + '.json');
function readUser(email) { try { return JSON.parse(fs.readFileSync(userFile(email), 'utf8')); } catch { return null; } }

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setCookie(res, name, value, maxAge) {
  const c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${SECURE ? '; Secure' : ''}`;
  const prev = res.getHeader('Set-Cookie') || [];
  res.setHeader('Set-Cookie', [].concat(prev, c));
}

function sessionUser(req) {
  const s = unsign(cookies(req).sid);
  if (!s || !s.e) return null;
  return { email: s.e, name: s.n || '' };
}
function startSession(res, email, name) {
  setCookie(res, 'sid', sign({ e: email, n: name || '', exp: Date.now() + 90 * 86400e3 }), 90 * 86400);
  if (!readUser(email)) writeJSON(userFile(email), { email, name: name || '', created: Date.now(), save: null, updatedAt: 0, history: [] });
}

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function html(res, code, body) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}
function redirect(res, to) { res.writeHead(302, { location: to, 'cache-control': 'no-store' }); res.end(); }

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(Object.assign(new Error('too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function readJSON(req, limit) {
  const t = await readBody(req, limit);
  try { return t ? JSON.parse(t) : {}; } catch { throw Object.assign(new Error('bad json'), { code: 400 }); }
}

// POSTs must come from our own pages
function sameOrigin(req) {
  if (req.headers['x-requested-with'] !== 'suhaili' && !String(req.headers['content-type'] || '').startsWith('application/json')) return false;
  const o = req.headers.origin;
  return !o || o === BASE_URL || (!SECURE && o.startsWith('http://localhost'));
}

// ---------- rate limits (memory only) ----------
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return true; }
  arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
  return false;
}
const clientIP = (req) => req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '?';

// ---------- email sign-in ----------
const magicFile = path.join(DATA, 'magic.json');
let magic = {};
try { magic = JSON.parse(fs.readFileSync(magicFile, 'utf8')); } catch { magic = {}; }
function pruneMagic() { const now = Date.now(); for (const k of Object.keys(magic)) if (magic[k].exp < now) delete magic[k]; writeJSON(magicFile, magic); }

async function sendMail(to, link) {
  if (MAIL_DEV) { console.log(`[mail-dev] sign-in link for ${to}: ${link}`); return; }
  if (!BREVO_KEY || !MAIL_FROM) throw new Error('mail not configured');
  const m = MAIL_FROM.match(/^(.*)<(.+)>$/);
  const sender = m ? { name: m[1].trim(), email: m[2].trim() } : { email: MAIL_FROM };
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender, to: [{ email: to }], subject: 'Your Suhaili sign-in link',
      textContent: `Open this link to sign in to Suhaili and keep your voyage:\n\n${link}\n\nIt works once, for 15 minutes. If you did not ask for it, ignore this email.`,
      htmlContent: `<p>Open this link to sign in to <b>Suhaili</b> and keep your voyage:</p><p><a href="${link}">Sign in to Suhaili</a></p><p>It works once, for 15 minutes. If you did not ask for it, ignore this email.</p>`,
    }),
  });
  if (!r.ok) throw new Error('mail failed ' + r.status);
}

const EMAIL_RE = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[^\s@<>"']{2,}$/;

// ---------- Google sign-in (code flow with PKCE) ----------
function googleStart(res) {
  const state = crypto.randomBytes(16).toString('base64url');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  setCookie(res, 'gst', sign({ s: state, v: verifier, exp: Date.now() + 10 * 60e3 }), 600);
  const q = new URLSearchParams({
    client_id: GOOGLE_ID, redirect_uri: BASE_URL + '/auth/google/callback', response_type: 'code',
    scope: 'openid email profile', state, code_challenge: challenge, code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + q;
}

async function googleCallback(req, res, url) {
  const st = unsign(cookies(req).gst);
  setCookie(res, 'gst', '', 0);
  const code = url.searchParams.get('code'), state = url.searchParams.get('state');
  if (!st || !code || state !== st.s) return redirect(res, '/?signin=failed');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: GOOGLE_ID, client_secret: GOOGLE_SECRET, redirect_uri: BASE_URL + '/auth/google/callback', grant_type: 'authorization_code', code_verifier: st.v }),
  });
  if (!r.ok) return redirect(res, '/?signin=failed');
  const tok = await r.json();
  // The ID token came straight from Google's token endpoint over TLS, so decoding it is enough.
  let claims; try { claims = JSON.parse(Buffer.from(String(tok.id_token).split('.')[1], 'base64url').toString()); } catch { return redirect(res, '/?signin=failed'); }
  const okIss = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
  if (!okIss || claims.aud !== GOOGLE_ID || claims.exp * 1000 < Date.now() || !claims.email || claims.email_verified !== true) return redirect(res, '/?signin=failed');
  startSession(res, String(claims.email).toLowerCase(), claims.name || '');
  redirect(res, '/?signin=ok');
}

// ---------- routes ----------
async function api(req, res, url) {
  const p = url.pathname;
  if (p === '/api/health') return json(res, 200, { ok: true });
  if (p === '/api/config') return json(res, 200, { google: !!(GOOGLE_ID && GOOGLE_SECRET), email: !!(MAIL_DEV || (BREVO_KEY && MAIL_FROM)) });
  if (p === '/api/me') { const u = sessionUser(req); return json(res, 200, { user: u ? { email: u.email, name: u.name } : null }); }

  if (p === '/api/save') {
    const u = sessionUser(req); if (!u) return json(res, 401, { error: 'not signed in' });
    if (req.method === 'GET') {
      const rec = readUser(u.email) || {};
      return json(res, 200, { save: rec.save || null, updatedAt: rec.updatedAt || 0, history: rec.history || [] });
    }
    if (req.method === 'PUT') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'bad origin' });
      if (limited('save:' + u.email, 120, 60e3)) return json(res, 429, { error: 'slow down' });
      const b = await readJSON(req, 300 * 1024);
      const s = b.save;
      if (!s || typeof s !== 'object' || s.v !== 1 || typeof s.turn !== 'number' || !s.ship || !s.stores || !s.crew || !Array.isArray(s.log)) return json(res, 400, { error: 'not a save' });
      const rec = readUser(u.email) || { email: u.email, history: [] };
      rec.save = s; rec.updatedAt = Math.min(Number(b.updatedAt) || Date.now(), Date.now());
      writeJSON(userFile(u.email), rec);
      return json(res, 200, { ok: true, updatedAt: rec.updatedAt });
    }
    return json(res, 405, { error: 'method' });
  }

  if (p === '/api/history' && req.method === 'POST') {
    const u = sessionUser(req); if (!u) return json(res, 401, { error: 'not signed in' });
    if (!sameOrigin(req)) return json(res, 403, { error: 'bad origin' });
    const b = await readJSON(req, 4096);
    const rec = readUser(u.email); if (!rec) return json(res, 404, { error: 'no user' });
    rec.history = (rec.history || []).concat({
      title: String(b.title || '').slice(0, 40), type: String(b.type || '').slice(0, 12),
      days: Math.max(0, Math.min(2000, Number(b.days) || 0)), nm: Math.max(0, Math.min(40000, Number(b.nm) || 0)),
      score: Math.max(0, Math.min(100000, Number(b.score) || 0)), at: Date.now(),
    }).slice(-50);
    writeJSON(userFile(u.email), rec);
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'not found' });
}

async function auth(req, res, url) {
  const p = url.pathname;
  if (p === '/auth/google/start' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'bad origin' });
    if (!GOOGLE_ID) return json(res, 503, { error: 'Google sign-in is not set up' });
    return json(res, 200, { url: googleStart(res) });
  }
  if (p === '/auth/google/callback' && req.method === 'GET') {
    if (!GOOGLE_ID) return redirect(res, '/?signin=failed');
    return googleCallback(req, res, url);
  }
  if (p === '/auth/email/start' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'bad origin' });
    const b = await readJSON(req, 2048);
    const email = String(b.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) return json(res, 400, { error: 'That does not look like an email address.' });
    if (limited('mip:' + clientIP(req), 20, 3600e3) || limited('mem:' + email, 3, 600e3)) return json(res, 429, { error: 'Too many requests. Try again in a few minutes.' });
    const tok = crypto.randomBytes(32).toString('base64url');
    magic[sha(tok)] = { email, exp: Date.now() + 15 * 60e3 };
    pruneMagic();
    try { await sendMail(email, `${BASE_URL}/auth/email/verify?t=${tok}`); }
    catch (e) { console.error('mail error', e.message); return json(res, 503, { error: 'Could not send the email right now.' }); }
    return json(res, 200, { ok: true });
  }
  if (p === '/auth/email/verify' && req.method === 'GET') {
    // A GET only shows a button: mail scanners that prefetch links must not use the token up.
    const t = url.searchParams.get('t') || '';
    return html(res, 200, `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Sign in to Suhaili</title>
<body style="font:16px ui-monospace,Menlo,monospace;background:#0b1a4a;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0">
<form method=post action="/auth/email/verify" style="background:#c3c3c3;color:#111;border:2px solid #000;padding:20px;max-width:340px;text-align:center">
<p><b>SUHAILI</b></p><p>Tap to sign in and keep your voyage.</p>
<input type=hidden name=t value="${t.replace(/[^A-Za-z0-9_-]/g, '')}">
<button style="font:inherit;font-weight:700;padding:12px 20px;background:#ffcf3a;border:2px solid #000;cursor:pointer">Sign in</button></form>`);
  }
  if (p === '/auth/email/verify' && req.method === 'POST') {
    const form = new URLSearchParams(await readBody(req, 2048));
    const h = sha(form.get('t') || '');
    const m = magic[h];
    delete magic[h]; pruneMagic();
    if (!m || m.exp < Date.now()) return html(res, 400, '<!doctype html><meta charset=utf-8><body style="font:16px sans-serif;padding:24px">That link has expired or was already used. <a href="/">Back to Suhaili</a> and ask for a new one.');
    startSession(res, m.email, '');
    return redirect(res, '/?signin=ok');
  }
  if (p === '/auth/logout' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'bad origin' });
    setCookie(res, 'sid', '', 0);
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'not found' });
}

// ---------- static ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.ico': 'image/x-icon' };
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep) && file !== PUBLIC) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
    const ext = path.extname(file);
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-cache', 'content-length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const server = http.createServer(async (req, res) => {
  res.setHeader('content-security-policy', CSP);
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('x-frame-options', 'DENY');
  try {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/auth/')) return await auth(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, url);
  } catch (e) {
    const code = e.code === 413 || e.code === 400 ? e.code : 500;
    if (code === 500) console.error(e);
    if (!res.headersSent) json(res, code, { error: code === 500 ? 'server error' : e.message });
  }
});

server.listen(PORT, HOST, () => console.log(`suhaili on http://${HOST}:${PORT} (${BASE_URL}) google=${!!GOOGLE_ID} mail=${!!(BREVO_KEY && MAIL_FROM)}`));
