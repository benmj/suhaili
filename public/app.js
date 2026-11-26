import { newGame, endTurn, chooseOption, pendingEvent, estimate, forecast, dateOf, dayNo, rivalPositions, radioNews, title, SAVE_VERSION } from './engine.js';
import { TOTAL_NM, HISTORIC_DAYS, ACHIEVEMENTS, WIND_NAMES } from './data.js';
import { ChartMap } from './map.js';

const $ = (id) => document.getElementById(id);
const LS = 'suhaili.save.v1';
const HELP_SEEN = 'suhaili.help';

let S = null;               // game state
let updatedAt = 0;          // last local change
let user = null;            // signed-in user or null
let cfg = { google: false, email: false };
let busy = false;
let map = null;
let shownLog = 0;           // how many log entries are rendered

const safe = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// ---------- save / load ----------
function loadLocal() {
  try {
    const raw = JSON.parse(safe.get(LS) || 'null');
    if (raw && raw.state && raw.state.v === SAVE_VERSION) { updatedAt = raw.updatedAt || 0; return raw.state; }
  } catch { /* corrupt */ }
  return null;
}
let syncTimer = 0;
function save() {
  updatedAt = Date.now();
  safe.set(LS, JSON.stringify({ state: S, updatedAt }));
  if (user) { clearTimeout(syncTimer); syncTimer = setTimeout(pushSave, 700); setSync('Saving…'); }
}
async function pushSave() {
  try {
    const r = await fetch('/api/save', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ save: S, updatedAt }), keepalive: true });
    if (r.status === 401) { user = null; renderAuth(); return; }
    const j = await r.json();
    setSync(j.ok ? 'Saved to your account' : 'Could not save: ' + (j.error || r.status));
  } catch { setSync('Offline: saved on this device, will sync next time'); }
}
function setSync(t) { const el = $('syncState'); if (el) el.textContent = t; }

// ---------- rendering ----------
const fmtDate = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const num = (n) => Math.round(n).toLocaleString('en-US');

function meterColor(v) { return v > 60 ? 'var(--good)' : v > 30 ? 'var(--warn)' : 'var(--bad)'; }

function meter(label, v, max = 100, goodHigh = true, unit = '') {
  const pct = Math.max(0, Math.min(100, (v / max) * 100));
  const cls = pct > 60 ? '' : pct > 30 ? 'lbl-warn' : 'lbl-bad';
  return `<div class="meter ${cls}"><span>${label}</span><div class="bar"><i style="width:${pct}%;background:${meterColor(pct)}"></i></div><span class="n">${Math.round(v)}${unit}</span></div>`;
}

function renderStatus() {
  const f = S.flags;
  const flags = [];
  if (f.leak) flags.push('LEAK');
  if (f.vaneLost) flags.push('NO VANE');
  if (!f.radio) flags.push('RADIO DEAD');
  if (S.stores.food < 25) flags.push('FOOD LOW');
  if (S.stores.water < 20) flags.push('WATER LOW');
  $('meters').innerHTML = [
    meter('Hull', S.ship.hull), meter('Food', S.stores.food, 330, true, 'd'),
    meter('Rig', S.ship.rig), meter('Water', S.stores.water, 170, true, 'd'),
    meter('Vane', S.ship.vane), meter('Spares', S.stores.spares, 12),
    meter('Health', S.crew.health), meter('Morale', S.crew.morale),
    flags.length ? `<div class="flags">${flags.map((x) => `<span class="flag">${x}</span>`).join('')}</div>` : '',
  ].join('');
}

const SAIL = [['reef', 'Reefed', 'steady'], ['full', 'Full sail', 'fast, hard on gear'], ['hove', 'Heave-to', 'ride it out']];
const RATION = [['full', 'Full', '1x'], ['half', 'Half', 'lasts longer'], ['scant', 'Scant', 'starving']];
const TASK = [['none', 'Sail on', ''], ['repair', 'Repair', '-1 spare'], ['rest', 'Rest', '+health'], ['fish', 'Fish', '+food'], ['rain', 'Catch rain', '+water'], ['sunsight', 'Sun sight', '+speed'], ['radio', 'Radio', 'news']];

function seg(el, items, key) {
  el.innerHTML = items.map(([v, l, sub]) => `<button type="button" class="opt" role="radio" aria-checked="${S.orders[key] === v}" data-v="${v}">${l}${sub ? `<small>${sub}</small>` : ''}</button>`).join('');
  el.onclick = (e) => {
    const b = e.target.closest('.opt'); if (!b || busy) return;
    S.orders[key] = b.dataset.v; save(); renderOrders();
  };
}

function renderOrders() {
  const fc = forecast(S);
  $('forecast').innerHTML = `Wind: <b>${WIND_NAMES[fc.wind]}</b> · Sea: <b>${fc.zone.name}</b>`;
  seg($('segSail'), SAIL, 'sail'); seg($('segRation'), RATION, 'ration'); seg($('segTask'), TASK, 'task');
  const est = estimate(S);
  const tips = [];
  tips.push(`About <b>${est.perDay} nm/day</b>. Risk to the ship: <b>${est.risk}</b>.`);
  if (S.orders.task === 'repair' && S.stores.spares <= 0) tips.push('No spares left: repairs will fail.');
  if (S.orders.task === 'radio' && !S.flags.radio) tips.push('The radio is dead.');
  $('hint').innerHTML = tips.join(' ');
  $('goLabel').textContent = busy ? 'Sailing…' : S.over ? 'Voyage ended' : S.pending ? 'Answer the event' : 'Sail on ▶ 4 days';
  $('goBtn').disabled = busy || !!S.over;
  $('goBtn').classList.toggle('busy', busy);
}

function renderTop() {
  const d = dateOf(S);
  $('date').textContent = `${fmtDate(d)} · Day ${dayNo(S)}`;
  $('zoneName').textContent = forecast(S).zone.name;
  $('windChip').textContent = WIND_NAMES[S.wind];
  $('miles').textContent = num(S.nm); $('total').textContent = num(TOTAL_NM);
  $('togo').textContent = num(TOTAL_NM - S.nm) + ' nm';
  $('progFill').style.width = (S.nm / TOTAL_NM) * 100 + '%';
}

function logHTML(e) {
  const t = fmtDate(new Date(Date.UTC(1968, 5, 14) + e.turn * 4 * 86400000));
  return `<li class="k-${e.kind}"><span class="t">${t}</span>${esc(e.text)}</li>`;
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function renderLog(full = true) {
  const ol = $('log');
  if (full) { ol.innerHTML = S.log.slice().reverse().map(logHTML).join(''); shownLog = S.log.length; return; }
  const fresh = S.log.slice(shownLog);
  ol.insertAdjacentHTML('afterbegin', fresh.slice().reverse().map(logHTML).join(''));
  shownLog = S.log.length;
}

function renderAll() {
  renderTop(); renderStatus(); renderOrders(); renderLog();
  map.rivals = rivalPositions(S); map.draw(S.nm);
}

// ---------- the turn ----------
let minPending = (ms) => new Promise((r) => setTimeout(r, ms));
async function sail() {
  if (busy || S.over) return;
  if (S.pending) { showEvent(); return; }
  busy = true; renderOrders();
  const from = S.nm;
  const t0 = performance.now();
  endTurn(S, {});
  save();
  map.rivals = rivalPositions(S);
  await map.animate(from, S.nm, 700, map.rivals);
  const wait = 350 - (performance.now() - t0); if (wait > 0) await minPending(wait);
  busy = false;
  renderTop(); renderStatus(); renderLog(false); renderOrders();
  afterTurn();
}

function afterTurn() {
  if (S.pending) showEvent();
  else if (S.over) showEnd();
}

function showEvent() {
  const ev = pendingEvent(S); if (!ev) { S.pending = null; return; }
  $('evTitle').textContent = ev.title;
  $('evText').textContent = ev.text;
  const box = $('evChoices');
  box.innerHTML = ev.choices.map((c, i) => `<button type="button" class="btn" data-i="${i}">${esc(c.label)}${c.hint ? `<small>${esc(c.hint)}</small>` : ''}</button>`).join('');
  box.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    b.classList.add('busy');
    chooseOption(S, Number(b.dataset.i)); save();
    $('evDlg').close();
    renderTop(); renderStatus(); renderLog(false); renderOrders();
    map.draw(S.nm);
    afterTurn();
  };
  const d = $('evDlg'); if (!d.open) d.showModal();
  box.querySelector('button')?.focus();
}

function showEnd() {
  const o = S.over;
  $('endTitle').textContent = o.title;
  $('endText').textContent = o.text;
  $('endStats').innerHTML = [
    ['Result', title(S)], ['Score', num(o.score)], ['Days', o.day], ['Miles', num(S.nm)],
    ['Gales', S.stats.gales], ['Knockdowns', S.stats.knockdowns], ['Repairs', S.stats.repairs], ['Caps', S.achieved.length + ' of ' + ACHIEVEMENTS.length],
  ].map(([k, v]) => `<div class="dim">${k}<b>${esc(v)}</b></div>`).join('');
  if (user && !S.historyPosted) {
    S.historyPosted = true; save();
    fetch('/api/history', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title(S), type: o.type, days: o.day, nm: Math.round(S.nm), score: o.score, at: Date.now() }) }).then(() => loadFame()).catch(() => {});
  }
  const d = $('endDlg'); if (!d.open) d.showModal();
}

function newVoyage() {
  S = newGame();
  save(); shownLog = 0;
  renderAll();
  toast('Cast off from Falmouth.');
}

// ---------- menu, account ----------
function renderAuth() {
  $('signedOut').hidden = !!user; $('signedIn').hidden = !user;
  if (user) { $('who').textContent = user.email; setSync('Saved to your account'); }
  $('googleBtn').hidden = !cfg.google;
  $('emailForm').hidden = !cfg.email;
  $('acctNote').textContent = user ? 'Your voyage follows you to any device.' : 'You can play without an account. Sign in to keep your voyage across devices.';
  if (!user && !cfg.google && !cfg.email) $('authMsg').textContent = 'Sign-in is not available right now.';
}

function renderMenu() {
  $('achList').innerHTML = ACHIEVEMENTS.map((a) => `${S.achieved.includes(a.id) ? '★' : '☆'} ${esc(a.label)}`).join('<br>');
}

async function loadFame() {
  if (!user) return;
  try {
    const j = await (await fetch('/api/save')).json();
    const h = (j.history || []).slice(-8).reverse();
    $('fame').innerHTML = h.length ? h.map((x) => `<li>${esc(x.title)}: ${x.days} days, ${num(x.nm)} nm, ${num(x.score)} pts</li>`).join('') : '<li class="dim">No finished voyages yet.</li>';
  } catch { /* ignore */ }
}

async function startGoogle() {
  $('authMsg').className = 'msg'; $('authMsg').textContent = 'Opening Google…';
  try {
    const r = await fetch('/auth/google/start', { method: 'POST', headers: { 'x-requested-with': 'suhaili' } });
    const j = await r.json();
    if (!j.url) throw new Error(j.error || 'failed');
    save(); // keep this voyage safe across the redirect
    location.href = j.url;
  } catch (e) { $('authMsg').className = 'msg err'; $('authMsg').textContent = 'Could not start Google sign-in.'; }
}

async function sendLink(e) {
  e.preventDefault();
  const email = $('email').value.trim(); if (!email) return;
  const b = $('emailBtn'); b.disabled = true; b.classList.add('busy');
  $('authMsg').className = 'msg'; $('authMsg').textContent = 'Sending…';
  const t0 = performance.now();
  try {
    const r = await fetch('/auth/email/start', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'suhaili' }, body: JSON.stringify({ email }) });
    const j = await r.json();
    const w = 500 - (performance.now() - t0); if (w > 0) await minPending(w);
    if (!r.ok) throw new Error(j.error || 'failed');
    $('authMsg').textContent = 'Check your email for a sign-in link. It works for 15 minutes.';
  } catch (err) { $('authMsg').className = 'msg err'; $('authMsg').textContent = err.message === 'failed' ? 'Could not send the link.' : err.message; }
  b.disabled = false; b.classList.remove('busy');
}

async function logout() {
  await fetch('/auth/logout', { method: 'POST', headers: { 'x-requested-with': 'suhaili' } }).catch(() => {});
  user = null; renderAuth(); toast('Signed out. Your voyage stays on this device.');
}

async function initAccount() {
  try {
    cfg = await (await fetch('/api/config')).json();
    const me = await (await fetch('/api/me')).json();
    user = me.user || null;
  } catch { user = null; }
  renderAuth();
  if (!user) return;
  try {
    const j = await (await fetch('/api/save')).json();
    if (j.save && j.save.v === SAVE_VERSION) {
      if ((j.updatedAt || 0) > updatedAt) {
        S = j.save; updatedAt = j.updatedAt; safe.set(LS, JSON.stringify({ state: S, updatedAt }));
        renderAll(); toast('Loaded your saved voyage.');
        if (S.pending) showEvent(); else if (S.over) showEnd();
      } else if (updatedAt > (j.updatedAt || 0)) pushSave();
    } else if (S.turn > 0) pushSave();
    loadFame(); setSync('Saved to your account');
  } catch { setSync('Offline: saved on this device'); }
}

// ---------- chrome: toast, header peek, keyboard lift ----------
let toastT = 0;
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2400); }

function headerPeek() {
  const bar = $('topbar'); let last = window.scrollY, ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY, dy = y - last;
      if (y < bar.offsetHeight || dy < -6) bar.classList.remove('hide');
      else if (dy > 6) bar.classList.add('hide');
      if (Math.abs(dy) > 6) last = y;
      ticking = false;
    });
  }, { passive: true });
  bar.addEventListener('focusin', () => bar.classList.remove('hide'));
}

function keyboardLift() {
  const vv = window.visualViewport; if (!vv) return;
  const lift = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.querySelectorAll('dialog.dlg[open]').forEach((d) => {
      d.style.marginBottom = kb ? kb + 'px' : '';
      d.style.setProperty('--dlg-h', kb ? Math.floor(vv.height - 16) + 'px' : '88dvh');
    });
  };
  vv.addEventListener('resize', lift); vv.addEventListener('scroll', lift);
}

// ---------- boot ----------
function init() {
  S = loadLocal() || newGame();
  map = new ChartMap($('base'), $('over'));
  $('chart').addEventListener('click', (e) => { { const m = map.toggle(); $('zoomBtn').textContent = m === 'world' ? 'Region' : 'World'; } });
  addEventListener('resize', () => { map.resize(); });
  $('goBtn').onclick = sail;
  $('menuBtn').onclick = () => { renderMenu(); $('menuDlg').showModal(); loadFame(); };
  $('menuClose').onclick = () => $('menuDlg').close();
  $('newBtn').onclick = () => { if (S.over || S.turn === 0 || confirm('Abandon this voyage and start again?')) { $('menuDlg').close(); newVoyage(); } };
  $('helpBtn').onclick = () => { $('menuDlg').close(); $('helpDlg').showModal(); };
  $('helpClose').onclick = $('helpOk').onclick = () => { $('helpDlg').close(); safe.set(HELP_SEEN, '1'); };
  $('endNew').onclick = () => { $('endDlg').close(); newVoyage(); };
  $('endClose').onclick = () => $('endDlg').close();
  $('googleBtn').onclick = startGoogle;
  $('emailForm').addEventListener('submit', sendLink);
  $('logoutBtn').onclick = logout;
  $('evDlg').addEventListener('cancel', (e) => e.preventDefault()); // must answer an event
  // clicking a dialog's backdrop closes menu/help
  for (const id of ['menuDlg', 'helpDlg']) $(id).addEventListener('click', (e) => { if (e.target === $(id)) $(id).close(); });
  headerPeek(); keyboardLift();
  renderAll();
  if (!safe.get(HELP_SEEN) && S.turn === 0) $('helpDlg').showModal();
  if (S.pending) showEvent(); else if (S.over) showEnd();
  initAccount();
  const q = new URLSearchParams(location.search);
  if (q.get('signin') === 'ok') { toast('Signed in.'); history.replaceState(null, '', location.pathname); }
  else if (q.get('signin')) { toast('Sign-in failed. Try again.'); history.replaceState(null, '', location.pathname); }
  window.__suhaili = { get state() { return S; }, sail };
}
init();
