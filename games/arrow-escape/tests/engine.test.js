// Run with: npm test (or node --test tests/*.test.js)
const test = require('node:test');
const assert = require('node:assert');
const E = require('../engine.js');

const count = (B, t) => B.tile.reduce((n, v) => n + (v === t ? 1 : 0), 0);

test('tutorial is solvable and needs 3 rounds', () => {
  const B = E.buildTutorial();
  const r = E.solve(B);
  assert.ok(r.solved);
  assert.strictEqual(r.rounds, 3);
});

test('tutorial steps follow a legal order', () => {
  const B = E.buildTutorial();
  // step 2 is the deliberate bump demo, so it must be blocked; the others must be free
  E.TUTORIAL_STEPS.forEach((s, i) => {
    const a = B.arrows[s.target];
    const ok = E.attempt(B, a, 'head').ok;
    if (i === 1) assert.ok(!ok, 'demo arrow should be blocked');
    else { assert.ok(ok, `step ${i} target should be free`); E.removeArrow(B, a); }
  });
});

test('campaign levels 2-150 are all solvable', () => {
  for (let n = 2; n <= 150; n++) {
    const B = E.generate(E.campaignSpec(n));
    assert.ok(E.solve(B).solved, `level ${n} unsolvable`);
  }
});

test("each world's levels contain that world's piece", () => {
  for (let w = 1; w <= 8; w++) {
    const piece = E.WORLDS[w].piece;
    for (let n = w * 10 + 1; n <= w * 10 + 10; n++) {
      const B = E.generate(E.campaignSpec(n)), A = B.arrows;
      const has = {
        stones: count(B, E.T.STONE) > 0,
        locks: A.some(a => a.lock >= 0),
        twin: A.some(a => a.dir2 >= 0),
        turns: count(B, E.T.SLASH) + count(B, E.T.BACK) > 0,
        portals: count(B, E.T.PORTAL) >= 2,
        gates: count(B, E.T.GATE) > 0,
        fuses: A.some(a => a.fuse > 0),
        links: A.some(a => a.link >= 0),
      }[piece];
      assert.ok(has, `level ${n} (world ${w}) is missing ${piece}`);
    }
  }
});

test('fuse deadlines can always be met', () => {
  for (let n = 71; n <= 80; n++) {
    const B = E.generate(E.campaignSpec(n));
    const targets = B.arrows.filter(a => a.fuse);
    const at = E.fusePlan(B, targets);
    for (const t of targets) assert.ok(at[t.id] != null && at[t.id] < t.fuse, `level ${n} arrow ${t.id}: cleared at ${at[t.id]}, fuse ${t.fuse}`);
  }
});

test('levels are the same every time (seeded)', () => {
  const a = E.generate(E.campaignSpec(37)), b = E.generate(E.campaignSpec(37));
  assert.deepStrictEqual(a.arrows.map(x => x.cells), b.arrows.map(x => x.cells));
  assert.deepStrictEqual(Array.from(a.tile), Array.from(b.tile));
});

test('daily, zen, time attack and duel boards are solvable', () => {
  for (let d = 0; d < 40; d++) assert.ok(E.solve(E.generate(E.dailySpec(20261101 + d))).solved, `daily ${d}`);
  for (let k = 1; k <= 40; k++) {
    assert.ok(E.solve(E.generate(E.zenSpec(k))).solved, `zen ${k}`);
    assert.ok(E.solve(E.generate(E.timeSpec(k))).solved, `time ${k}`);
    assert.ok(E.solve(E.generate(E.duelSpec(k))).solved, `duel ${k}`);
  }
});

test('surge stays solvable while arrows spawn and leave', () => {
  const spec = E.surgeSpec(1), r = E.rng(42), B = E.buildBase(spec, r);
  for (let step = 0; step < 400; step++) {
    if (r() < 0.6) E.spawn(B, r, spec);
    else {
      const free = B.arrows.filter(a => !B.gone[a.id] && E.movableEnd(B, a));
      if (free.length) E.removeArrow(B, free[Math.floor(r() * free.length)]);
    }
    assert.ok(E.solve(B).solved, `step ${step}`);
  }
});

test('turn tiles and portals redirect paths', () => {
  const spec = { W: 5, H: 5, shape: 'Square', features: {}, j: 0 };
  const B = E.buildBase(spec, E.rng(1));
  B.tile[2 * 5 + 3] = E.T.SLASH; // "/" at (3,2)
  let r = E.trace(B, B.occ, 0, 2, 1, -1, -1, -1); // heading right from (0,2)
  assert.ok(r.free); assert.strictEqual(r.dir, 0); // turned to go up
  const C2 = E.buildBase(spec, E.rng(1));
  const a = 1 * 5 + 1, b = 3 * 5 + 3;
  C2.tile[a] = C2.tile[b] = E.T.PORTAL; C2.tdata[a] = C2.tdata[b] = 0; C2.portal[a] = b; C2.portal[b] = a;
  r = E.trace(C2, C2.occ, 1, 4, 0, -1, -1, -1); // heading up from (1,4) into the portal at (1,1)
  assert.ok(r.free); assert.deepStrictEqual(r.end, [3, -1]); // came out at (3,3) and kept going up
});

test('gates stop arrows of other colours', () => {
  const spec = { W: 5, H: 1, shape: 'Square', features: {}, j: 0 };
  const B = E.buildBase(spec, E.rng(1));
  B.tile[3] = E.T.GATE; B.tdata[3] = 1;
  assert.ok(!E.trace(B, B.occ, 0, 0, 1, 0, -1, -1).free);
  assert.ok(E.trace(B, B.occ, 0, 0, 1, 1, -1, -1).free);
});
