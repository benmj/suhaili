import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, endTurn, chooseOption, pendingEvent, radioNews } from '../public/engine.js';
import { EVENTS, MILESTONE_EVENTS } from '../public/events.js';
import { TOTAL_NM, pointAt, ROUTE } from '../public/data.js';
import { play } from './sim.mjs';

test('same seed, same voyage', () => {
  const a = play(7), b = play(7);
  assert.deepEqual(a, b);
});

test('a save round-trips through JSON and continues identically', () => {
  const a = newGame(11);
  for (let i = 0; i < 10; i++) { endTurn(a, {}); while (a.pending) chooseOption(a, 0); }
  const copy = JSON.parse(JSON.stringify(a));
  endTurn(a, {}); endTurn(copy, {});
  assert.deepEqual(a, copy);
});

test('a bot can win and lose', () => {
  const outcomes = new Set();
  for (let i = 1; i <= 60; i++) outcomes.add(play(i).over?.type);
  assert.ok(outcomes.has('win'));
  assert.ok(outcomes.size > 1);
});

test('route is one line from Falmouth to Falmouth', () => {
  const s = pointAt(0), e = pointAt(TOTAL_NM);
  assert.ok(Math.abs(s.lat - e.lat) < 1e-6);
  assert.ok(Math.abs(e.lon - s.lon - 360) < 1);
  assert.equal(ROUTE.length > 30, true);
});

test('every event has choices that resolve cleanly', () => {
  for (const ev of EVENTS.concat(MILESTONE_EVENTS)) {
    assert.ok(ev.title && ev.text && ev.choices.length >= 1, ev.id);
    ev.choices.forEach((ch, i) => {
      for (let k = 0; k < 20; k++) {
        const s = newGame(k + 1);
        s.pending = { id: ev.id };
        chooseOption(s, i);
        assert.equal(s.pending, null, `${ev.id}#${i}`);
        for (const v of [s.ship.hull, s.ship.rig, s.crew.health, s.crew.morale]) assert.ok(v >= 0 && v <= 100);
      }
    });
  }
});

test('turns are blocked while an event is pending, and after the end', () => {
  const s = newGame(3);
  s.pending = { id: 'dolphins' };
  const nm = s.nm; endTurn(s, {});
  assert.equal(s.nm, nm);
  assert.ok(pendingEvent(s));
  s.pending = null; s.over = { type: 'win' };
  endTurn(s, {});
  assert.equal(s.nm, nm);
});

test('radio news names rivals once they have started', () => {
  const s = newGame(5); s.turn = 30; s.nm = 5000;
  assert.match(radioNews(s, true), /Radio:/);
});
