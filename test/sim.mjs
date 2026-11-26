// Balance simulation: a sensible bot plays N voyages. Prints win rate and days.
import { newGame, endTurn, pendingEvent, chooseOption, dayNo } from '../public/engine.js';

export function bot(s) {
  const o = { sail: 'reef', ration: 'full', task: 'none' };
  if (s.wind >= 4) o.sail = 'hove';
  else if (s.wind <= 1 && s.ship.rig > 60) o.sail = 'full';
  if (s.stores.food < 60) o.ration = 'half';
  if (s.stores.food < 25) o.ration = 'scant';
  if (s.stores.water < 25 && s.stores.food > 10) o.task = 'rain';
  else if (s.ship.hull < 62 || s.ship.rig < 55 || s.flags.leak || (s.flags.vaneLost && s.stores.spares > 2)) o.task = s.stores.spares > 0 ? 'repair' : 'rest';
  else if (s.crew.health < 55 || s.crew.morale < 35) o.task = 'rest';
  else if (s.stores.food < 150) o.task = 'fish';
  else if (s.stores.water < 90) o.task = 'rain';
  else if (s.turn % 6 === 0) o.task = 'sunsight';
  return o;
}

export function play(seed, pick = bot) {
  const s = newGame(seed);
  let guard = 0;
  while (!s.over && guard++ < 400) {
    endTurn(s, pick(s));
    while (s.pending && !s.over) {
      const ev = pendingEvent(s);
      chooseOption(s, 0);
    }
  }
  return s;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const N = Number(process.argv[2] || 300);
  const res = { win: 0, other: {} };
  const days = [];
  const stats = { food: 0, water: 0, spares: 0, hull: 0 };
  for (let i = 1; i <= N; i++) {
    const s = play(i);
    if (s.over?.type === 'win') { res.win++; days.push(dayNo(s)); stats.food += s.stores.food; stats.water += s.stores.water; stats.spares += s.stores.spares; stats.hull += s.ship.hull; }
    else res.other[s.over?.type || 'stuck'] = (res.other[s.over?.type || 'stuck'] || 0) + 1;
  }
  days.sort((a, b) => a - b);
  console.log(`runs ${N}  wins ${res.win} (${Math.round((res.win / N) * 100)}%)  others`, res.other);
  if (days.length) console.log(`days: min ${days[0]} median ${days[days.length >> 1]} max ${days[days.length - 1]}`, `avg leftovers food ${Math.round(stats.food / days.length)} water ${Math.round(stats.water / days.length)} spares ${(stats.spares / days.length).toFixed(1)} hull ${Math.round(stats.hull / days.length)}`);
}
