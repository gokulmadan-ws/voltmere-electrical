// tests/unit/clock.test.mjs: unit tests for js/core/clock.js (the ?now= override, freeze, setClock, clockQuery)
// Owner: WP1
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// The clock reads location.search once, at first use, so each case imports a fresh module instance
// (a unique query string on the specifier gives Node a separate module).
let counter = 0;
async function freshClock(search) {
  if (search === undefined) delete globalThis.location;
  else globalThis.location = { search };
  counter += 1;
  return import(`../../js/core/clock.js?case=${counter}`);
}

afterEach(() => {
  delete globalThis.location;
});

test('without an override the real clock is used', async () => {
  const clock = await freshClock(undefined);
  assert.equal(clock.isClockOverridden(), false);
  assert.equal(clock.clockOverrideStamp(), null);
  assert.equal(clock.clockQuery(), '');
  assert.ok(Math.abs(clock.now().getTime() - new Date().getTime()) < 5000);
  assert.match(clock.nowStamp(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.equal(clock.todayKey(), clock.nowStamp().slice(0, 10));
});

test('?now= parses YYYY-MM-DDTHH:mm and freeze=1 pins it', async () => {
  const clock = await freshClock('?now=2026-10-23T20:30&freeze=1');
  assert.equal(clock.isClockOverridden(), true);
  assert.equal(clock.nowStamp(), '2026-10-23T20:30');
  assert.equal(clock.todayKey(), '2026-10-23');
  assert.equal(clock.clockOverrideStamp(), '2026-10-23T20:30');
  const first = clock.now().getTime();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(clock.now().getTime(), first, 'a frozen clock never moves');
});

test('?now= accepts seconds', async () => {
  const clock = await freshClock('?now=2026-10-23T20:30:45&freeze=1');
  assert.equal(clock.nowStamp(), '2026-10-23T20:30');
  assert.equal(clock.now().getSeconds(), 45);
  assert.equal(clock.clockOverrideStamp(), '2026-10-23T20:30');
});

test('bad ?now= values are ignored', async () => {
  const bad = [
    '?now=garbage', '?now=2026-10-23', '?now=2026-10-23T20', '?now=2026-13-45T10:00', '?now=2026-02-31T10:00',
    '?now=2026-10-23T25:00', '?now=2026-10-23 20:30', '?now=', '?other=1', '?now=2026-10-23T20:30:99x'
  ];
  for (const search of bad) {
    const clock = await freshClock(search);
    assert.equal(clock.isClockOverridden(), false, `ignored: ${search}`);
    assert.equal(clock.clockQuery(), '');
  }
});

test('without freeze the override keeps ticking from that instant', async () => {
  const clock = await freshClock('?now=2026-10-23T20:30');
  assert.equal(clock.isClockOverridden(), true);
  assert.equal(clock.clockQuery(), '?now=2026-10-23T20:30');
  const start = new Date(2026, 9, 23, 20, 30, 0, 0).getTime();
  await new Promise((resolve) => setTimeout(resolve, 60));
  const moved = clock.now().getTime() - start;
  assert.ok(moved >= 40 && moved < 5000, `ticked ${moved}ms`);
});

test('setClock pins a Date, null restores real time', async () => {
  const clock = await freshClock(undefined);
  clock.setClock(new Date(2026, 9, 23, 9, 30));
  assert.equal(clock.nowStamp(), '2026-10-23T09:30');
  assert.equal(clock.isClockOverridden(), true);
  clock.setClock(null);
  assert.equal(clock.isClockOverridden(), false);
  assert.ok(Math.abs(clock.now().getTime() - new Date().getTime()) < 5000);
  assert.equal(clock.clockQuery(), '');
});

test('setClock wins over the URL, and null stays cleared', async () => {
  const clock = await freshClock('?now=2026-01-01T00:00&freeze=1');
  assert.equal(clock.todayKey(), '2026-01-01');
  clock.setClock(null);
  assert.equal(clock.isClockOverridden(), false);
  clock.setClock(new Date(2026, 5, 1, 12, 0), { frozen: false });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(clock.now().getTime() > new Date(2026, 5, 1, 12, 0).getTime());
  assert.equal(clock.clockQuery(), '?now=2026-06-01T12:00');
});

test('clockQuery round-trips through a second page', async () => {
  const one = await freshClock(undefined);
  one.setClock(new Date(2026, 9, 23, 20, 30), { frozen: true });
  const query = one.clockQuery();
  assert.equal(query, '?now=2026-10-23T20:30&freeze=1');
  const two = await freshClock(query);
  assert.equal(two.nowStamp(), '2026-10-23T20:30');
  assert.equal(two.clockQuery(), query);
});
