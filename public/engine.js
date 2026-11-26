// Suhaili rules engine. Pure functions on a plain-JSON state, so a save is
// just the state. No DOM here: the tests run it in Node.
import {
  DAYS_PER_TURN, HISTORIC_DAYS, TOTAL_NM, LANDMARKS, ZONES, WIND_NAMES,
  zoneAt, rivalNm, RIVALS, ACHIEVEMENTS,
} from './data.js';
import { EVENTS, EVENT_BY_ID, MILESTONE_EVENTS } from './events.js';

export const SAVE_VERSION = 1;

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The RNG state lives in the save (state.rng), so reloading never rerolls.
function rand(s) {
  const f = mulberry32(s.rng);
  const v = f();
  s.rng = (s.rng + 0x9e3779b9) | 0;
  return v;
}

export function newGame(seed = (Math.random() * 2 ** 31) | 0) {
  return {
    v: SAVE_VERSION,
    rng: seed,
    turn: 0,
    nm: 0,
    ship: { hull: 100, rig: 100, vane: 100 },
    stores: { food: 330, water: 170, spares: 12 },
    crew: { health: 100, morale: 85 },
    flags: { leak: false, radio: true, vaneLost: false, hungry: 0, thirsty: 0 },
    orders: { sail: 'reef', ration: 'full', task: 'none' },
    wind: 2,
    pending: null,
    achieved: [],
    seen: [],
    stats: { gales: 0, knockdowns: 0, repairs: 0, fish: 0, nmBest: 0 },
    log: [{ turn: 0, kind: 'event', text: '14 June 1968. Falmouth falls astern. Suhaili is a 32-foot ketch, and you are alone aboard her. Non-stop, solo, round the world.' }],
    over: null,
  };
}

export function dateOf(s) {
  const d = new Date(Date.UTC(1968, 5, 14) + s.turn * DAYS_PER_TURN * 86400000);
  return d;
}
export function dayNo(s) { return s.turn * DAYS_PER_TURN; }

function clamp(v, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, v)); }

export function applyEffects(s, fx) {
  if (!fx) return;
  for (const k of ['hull', 'rig', 'vane']) if (fx[k]) s.ship[k] = clamp(s.ship[k] + fx[k]);
  if (fx.food) s.stores.food = Math.max(0, s.stores.food + fx.food);
  if (fx.water) s.stores.water = Math.max(0, Math.min(250, s.stores.water + fx.water));
  if (fx.spares) s.stores.spares = Math.max(0, s.stores.spares + fx.spares);
  if (fx.health) s.crew.health = clamp(s.crew.health + fx.health);
  if (fx.morale) s.crew.morale = clamp(s.crew.morale + fx.morale);
  if (fx.nm) s.nm = Math.max(0, Math.min(TOTAL_NM, s.nm + fx.nm));
  if (fx.flags) Object.assign(s.flags, fx.flags);
  if (fx.vaneLost) { s.flags.vaneLost = true; s.ship.vane = 0; }
}

export function say(s, text, kind = 'info') {
  s.log.push({ turn: s.turn, kind, text });
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
}

// ---- Weather ----
export function rollWind(s) {
  const z = zoneAt(s.nm);
  let r = rand(s) * 100;
  for (let i = 0; i < z.odds.length; i++) {
    r -= z.odds[i];
    if (r < 0) return i;
  }
  return 2;
}

// Distance per day (nm) by wind and sail plan.
const DAY_NM = {
  reef: [28, 78, 112, 118, 70],
  full: [34, 92, 134, 150, 90],
  hove: [4, 8, 10, 12, 14],
};

export function forecast(s) {
  const z = zoneAt(s.nm);
  return { zone: z, wind: s.wind, windName: WIND_NAMES[s.wind] };
}

// What the current orders should give, with no luck applied: for the UI.
export function estimate(s, orders) {
  const o = { ...s.orders, ...orders };
  let perDay = DAY_NM[o.sail][s.wind];
  if (s.flags.vaneLost) perDay *= 0.82;
  if (s.flags.leak) perDay *= 0.92;
  if (s.ship.rig < 50) perDay *= 0.6 + s.ship.rig / 125;
  if (o.task === 'sunsight') perDay *= 1.05;
  if (o.task === 'repair' || o.task === 'rest') perDay *= 0.7;
  if (o.task === 'fish' || o.task === 'rain') perDay *= 0.9;
  const risk = [0.1, 0.3, 0.6, 1.8, 3.6][s.wind] * ({ reef: 1, full: 1.7, hove: 0.5 }[o.sail]);
  return { perDay: Math.round(perDay), risk: risk < 0.5 ? 'low' : risk < 1.5 ? 'moderate' : risk < 3 ? 'high' : 'severe' };
}

// ---- The turn ----
export function endTurn(s, orders) {
  if (s.over || s.pending) return s;
  if (orders) s.orders = { ...s.orders, ...orders };
  const o = s.orders;
  const zone = zoneAt(s.nm);
  const wind = s.wind;
  const notes = [];

  // Distance
  let perDay = DAY_NM[o.sail][wind];
  if (s.flags.vaneLost) perDay *= 0.82;
  if (s.flags.leak) perDay *= 0.92;
  if (s.ship.rig < 50) perDay *= 0.6 + s.ship.rig / 125;
  if (o.task === 'sunsight') perDay *= 1.05;
  if (o.task === 'repair' || o.task === 'rest') perDay *= 0.7;
  if (o.task === 'fish' || o.task === 'rain') perDay *= 0.9;
  const jitter = 0.92 + rand(s) * 0.16;
  const dist = perDay * DAYS_PER_TURN * jitter;
  const before = s.nm;
  s.nm = Math.min(TOTAL_NM, s.nm + dist);
  s.stats.nmBest = Math.max(s.stats.nmBest, Math.round(dist));

  // Wear. Heavy weather, full sail and a leak all cost.
  const heavy = [0.12, 0.3, 0.6, 1.8, 3.6][wind];
  const sailWear = { reef: 1, full: 1.7, hove: 0.5 }[o.sail];
  let hullWear = heavy * sailWear * 1.0 * (o.sail === 'hove' ? 0.6 : 1) * (0.7 + rand(s) * 0.6);
  let rigWear = heavy * sailWear * 1.3 * (0.7 + rand(s) * 0.6);
  if (s.flags.leak) hullWear += 3.5;
  s.ship.hull = clamp(s.ship.hull - hullWear);
  s.ship.rig = clamp(s.ship.rig - rigWear);
  if (!s.flags.vaneLost) s.ship.vane = clamp(s.ship.vane - heavy * 0.6);
  if (s.ship.vane <= 0 && !s.flags.vaneLost) {
    s.flags.vaneLost = true;
    notes.push(['bad', 'The self-steering vane carries away. From now on you steer by trimming the sails, and it is slower.']);
  }
  if (wind >= 3) s.stats.gales++;

  // Stores
  const rationDay = { full: 1, half: 0.62, scant: 0.38 }[o.ration];
  s.stores.food = Math.max(0, s.stores.food - rationDay * DAYS_PER_TURN);
  s.stores.water = Math.max(0, s.stores.water - (rationDay > 0.5 ? 1 : 0.7) * DAYS_PER_TURN * 0.5);

  // Crew
  let health = 0, morale = 0;
  health += { full: 1.5, half: -0.5, scant: -3 }[o.ration];
  morale += { full: 0.5, half: -1.5, scant: -3.5 }[o.ration];
  if (o.sail === 'hove') { health += 2; morale += 1; }
  if (wind >= 3 && o.sail !== 'hove') { health -= 1.5; morale -= 2.5; }
  if (wind === 0) morale -= 1.5;
  if (s.flags.vaneLost) health -= 1.2;
  if (s.flags.leak) morale -= 2;
  if (s.crew.morale > 90 && s.crew.health > 90) morale -= 1; // no free lunch
  if (zone.id === 'fifties' || zone.id === 'horn') morale -= 1.2;

  // Task
  switch (o.task) {
    case 'repair': {
      if (s.stores.spares <= 0) { notes.push(['bad', 'You have no spares left to repair with.']); break; }
      s.stores.spares -= 1; s.stats.repairs++;
      const h = 14 + rand(s) * 8, r = 14 + rand(s) * 8;
      s.ship.hull = clamp(s.ship.hull + h); s.ship.rig = clamp(s.ship.rig + r);
      if (s.flags.leak && rand(s) < 0.75) { s.flags.leak = false; notes.push(['good', 'You find the leak and stop it with tallow and canvas.']); }
      if (s.flags.vaneLost && rand(s) < 0.4) { s.flags.vaneLost = false; s.ship.vane = 50; notes.push(['good', 'You rig a new vane from a spare board and a length of spar.']); }
      notes.push(['info', 'You spend the watch on repairs. Hull and rig are better for it.']);
      health -= 0.8;
      break;
    }
    case 'rest': health += 5; morale += 4; notes.push(['info', 'You sleep as much as the ship allows.']); break;
    case 'fish': {
      const luck = (zone.tropic ? 0.8 : 0.5) + (wind <= 1 ? 0.15 : wind >= 3 ? -0.4 : 0);
      if (rand(s) < luck) { const f = 8 + Math.round(rand(s) * 8); s.stores.food += f; s.stats.fish++; morale += 2; notes.push(['good', `You land a good catch. +${f} days of food.`]); }
      else notes.push(['info', 'You trail a line all watch and catch nothing.']);
      break;
    }
    case 'rain': {
      const rain = rand(s) < zone.rain * (wind >= 2 ? 1.1 : 0.8);
      if (rain) { const w = 25 + Math.round(rand(s) * 20); s.stores.water = Math.min(250, s.stores.water + w); notes.push(['good', `Rain! You catch it in the sail. +${w} days of water.`]); }
      else notes.push(['info', 'You rig the catchment, but no rain comes.']);
      break;
    }
    case 'sunsight': notes.push(['info', 'You take a good sun sight. The chart is sound and the sails are trimmed to it.']); morale += 0.5; break;
    case 'radio': {
      if (!s.flags.radio) { notes.push(['bad', 'The radio is dead. You hear only static.']); morale -= 1; break; }
      morale += 3;
      const news = radioNews(s, true);
      if (news) notes.push(['news', news]);
      break;
    }
  }

  s.crew.health = clamp(s.crew.health + health);
  s.crew.morale = clamp(s.crew.morale + morale);

  // Starvation and thirst
  if (s.stores.food <= 0) { s.flags.hungry++; s.crew.health = clamp(s.crew.health - 12); notes.push(['bad', 'The food is gone.']); } else s.flags.hungry = 0;
  if (s.stores.water <= 0) { s.flags.thirsty++; s.crew.health = clamp(s.crew.health - 18); notes.push(['bad', 'The water is gone.']); } else s.flags.thirsty = 0;

  s.turn++;
  for (const [k, t] of notes) say(s, t, k);

  // Weather for next turn, then the forecast reads right.
  s.wind = rollWind(s);
  if (wind >= 4) say(s, 'Storm. You lie ahull under bare poles while the sea breaks over her.', 'bad');
  else if (wind === 3) say(s, 'A gale. The wind howls in the rigging.', 'warn');
  else if (wind === 0) say(s, 'Dead calm. The sails slat and the sea is like glass.', 'info');

  // Milestones
  milestones(s, before);

  // Events
  if (!s.pending && !s.over) {
    const ev = drawEvent(s, wind, o);
    if (ev) startEvent(s, ev);
  }
  checkEnd(s);
  return s;
}

function milestones(s, before) {
  for (const m of LANDMARKS) {
    if (before < m.nm && s.nm >= m.nm) {
      const idx = ACHIEVEMENTS.find((a) => a.nm === m.name && !s.achieved.includes(a.id) && (m.name !== 'Equator' || a.id === 'equator1'));
      const dup = m.name === 'Equator' && s.achieved.includes('equator1');
      if (idx && !dup) {
        s.achieved.push(idx.id);
        s.crew.morale = clamp(s.crew.morale + (idx.id === 'home' ? 0 : 8));
        say(s, `${idx.label}: ${m.name}. Day ${dayNo(s)}.`, 'great');
      } else if (m.name === 'Equator' && !s.achieved.includes('equator2') && s.achieved.includes('equator1')) {
        s.achieved.push('equator2');
        say(s, 'Back across the Line, northbound. The Atlantic is yours again.', 'great');
        s.crew.morale = clamp(s.crew.morale + 8);
      } else if (m.name === 'Tasmania' || m.name === 'Azores') {
        say(s, `${m.name} is abeam, over the horizon.`, 'info');
      }
    }
  }
  for (const me of MILESTONE_EVENTS) {
    if (!s.seen.includes(me.id) && before < me.nm && s.nm >= me.nm) {
      s.seen.push(me.id);
      startEvent(s, me);
    }
  }
}

// ---- Events ----
function weightedPick(s, list) {
  const total = list.reduce((a, e) => a + e.weight, 0);
  if (!total) return null;
  let r = rand(s) * total;
  for (const e of list) { r -= e.weight; if (r < 0) return e; }
  return list[list.length - 1];
}

function drawEvent(s, wind, o) {
  const chance = 0.42 + (wind >= 3 ? 0.18 : 0) + (o.sail === 'full' ? 0.08 : 0) - (o.sail === 'hove' ? 0.1 : 0);
  if (rand(s) > chance) return null;
  const z = zoneAt(s.nm);
  const pool = EVENTS.filter((e) => (!e.zones || e.zones.includes(z.id)) && (!e.when || e.when(s, wind, o)) && !(e.once && s.seen.includes(e.id)));
  return weightedPick(s, pool);
}

function startEvent(s, ev) {
  if (ev.once) s.seen.push(ev.id);
  s.pending = { id: ev.id };
  say(s, ev.title, 'event');
}

export function pendingEvent(s) {
  return s.pending ? EVENT_BY_ID[s.pending.id] || null : null;
}

export function chooseOption(s, index) {
  const ev = pendingEvent(s);
  if (!ev) return s;
  const ch = ev.choices[index];
  if (!ch) return s;
  const res = ch.resolve(s, () => rand(s)) || {};
  applyEffects(s, res.fx);
  s.pending = null;
  if (res.text) say(s, res.text, res.kind || 'info');
  if (ch.stat) s.stats[ch.stat] = (s.stats[ch.stat] || 0) + 1;
  checkEnd(s);
  return s;
}

// ---- Radio ----
export function radioNews(s, force) {
  if (!force && !s.flags.radio) return null;
  const lines = [];
  const mine = s.nm;
  for (const r of RIVALS) {
    const out = r.out && s.turn >= r.out.turn;
    const rn = rivalNm(r, s.turn);
    if (s.turn < r.start) continue;
    if (out) { lines.push(r.out.text); continue; }
    const gap = Math.round(rn - mine);
    if (Math.abs(gap) < 150) lines.push(`${r.name} is within sight of your wake, level with you.`);
    else lines.push(`${r.name} is about ${Math.abs(gap)} miles ${gap > 0 ? 'ahead of' : 'behind'} you.`);
  }
  if (!lines.length) return 'The BBC reports you are the only one still afloat in the race.';
  // Keep it short: pick two lines by turn so it varies.
  const a = lines[s.turn % lines.length];
  const b = lines[(s.turn + 1) % lines.length];
  return 'Radio: ' + (a === b ? a : `${a} ${b}`);
}

export function rivalPositions(s) {
  return RIVALS.filter((r) => s.turn >= r.start).map((r) => ({
    id: r.id, name: r.name, color: r.color,
    nm: rivalNm(r, s.turn), out: !!(r.out && s.turn >= r.out.turn),
  }));
}

// ---- End states and score ----
function checkEnd(s) {
  if (s.over) return;
  const end = (type, title, text) => { s.over = { type, title, text, day: dayNo(s), score: score(s, type) }; say(s, title, 'over'); };
  if (s.nm >= TOTAL_NM) {
    const d = dayNo(s);
    const note = d < HISTORIC_DAYS ? `${HISTORIC_DAYS - d} days faster than Knox-Johnston's own ${HISTORIC_DAYS}.` : d === HISTORIC_DAYS ? 'The same 312 days as Knox-Johnston.' : `${d - HISTORIC_DAYS} days slower than Knox-Johnston's 312.`;
    end('win', 'Falmouth. Home.', `Day ${d}. The first non-stop solo circumnavigation is yours. ${note}`);
  } else if (s.ship.hull <= 0) end('sunk', 'Suhaili founders.', 'The hull gives up. You are in the liferaft and the sea takes the ship.');
  else if (s.crew.health <= 0) end('dead', 'You die at sea.', 'Hunger, thirst and exhaustion finish what the sea began.');
  else if (s.crew.morale <= 0) end('quit', 'You give up.', 'You turn for the nearest port. That ends the race: the voyage must be non-stop.');
  else if (s.ship.rig <= 0 && s.stores.spares <= 0) end('dismasted', 'Dismasted, no spares.', 'With the rig gone and nothing left to jury-rig with, you drift until a ship finds you.');
}

export function score(s, type) {
  const d = dayNo(s);
  const miles = Math.round((s.nm / TOTAL_NM) * 1000);
  if (type === 'win') return 1000 + Math.max(0, (HISTORIC_DAYS - d) * 10) + s.achieved.length * 20 + Math.round(s.ship.hull);
  return miles + s.achieved.length * 20;
}

export function title(s) {
  const o = s.over; if (!o) return '';
  if (o.type !== 'win') return 'Lost at sea';
  const d = o.day;
  if (d <= 270) return 'Record breaker';
  if (d <= HISTORIC_DAYS) return 'Golden Globe winner';
  if (d <= 360) return 'Circumnavigator';
  return 'Last one home';
}

// Convenience for tests and UI
export function zoneList() { return ZONES; }
