/* Arrow Escape engine: board generation, path tracing and solving. No DOM, so it runs in the browser and in Node tests. */
(function (root) {
'use strict';

const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // up, right, down, left
const T = { NONE: 0, STONE: 1, SLASH: 2, BACK: 3, PORTAL: 4, GATE: 5 };
// "/" turns up<->right and down<->left, "\" turns up<->left and down<->right
const TURN = { 2: [1, 0, 3, 2], 3: [3, 2, 1, 0] };
const PIECES = ['stones', 'locks', 'twin', 'turns', 'portals', 'gates', 'fuses', 'links'];

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SHAPES = {
  Square: () => true,
  Diamond: (u, v) => Math.abs(u) + Math.abs(v) <= 1.08,
  Round: (u, v) => u * u + v * v <= 1.05,
  Cross: (u, v) => Math.abs(u) < 0.45 || Math.abs(v) < 0.45,
  Hexagon: (u, v) => Math.abs(v) <= 0.98 && Math.abs(u) + Math.abs(v) * 0.5 <= 1.02,
  Frame: (u, v) => Math.max(Math.abs(u), Math.abs(v)) > 0.3,
};
const SHAPE_ORDER = ['Diamond', 'Round', 'Square', 'Cross', 'Hexagon', 'Frame'];

const WORLDS = [
  { name: 'First Steps', piece: null },
  { name: 'Stonefield', piece: 'stones', title: 'Stones',
    text: "Stones never move. An arrow that points at a stone can never leave that way, so look for another way out.",
    tip: "Grey stones never move. Arrows can't slide through them." },
  { name: 'Lock & Key', piece: 'locks', title: 'Locks and keys',
    text: "An arrow with a padlock can't move until the arrow carrying the matching key has left the board.",
    tip: 'Clear the key arrow first. Its number matches the lock.' },
  { name: 'Two-Way Street', piece: 'twin', title: 'Two-headed arrows',
    text: 'Arrows with a head at each end can leave either way. Tap close to the end you want to use.',
    tip: 'Tap near the end you want a two-headed arrow to leave from.' },
  { name: 'Switchbacks', piece: 'turns', title: 'Turn tiles',
    text: 'A turn tile bends any arrow that slides over it by 90°. Follow the path all the way to see where an arrow really goes.',
    tip: 'Diagonal tiles bend sliding arrows by 90°.' },
  { name: 'Wormholes', piece: 'portals', title: 'Portals',
    text: 'An arrow that slides into a portal comes out of the portal with the same number and keeps going the same way.',
    tip: 'Portals with the same number are connected.' },
  { name: 'Colour Gates', piece: 'gates', title: 'Colour gates',
    text: 'A gate only lets arrows of its own colour through. Every other arrow is stopped by it.',
    tip: 'Arrows can only pass gates of their own colour.' },
  { name: 'Short Fuse', piece: 'fuses', title: 'Fuse arrows',
    text: 'A fuse arrow shows a countdown. Every tap lowers it by one. Clear it before it reaches zero, or you lose a life and the fuse restarts.',
    tip: 'Clear fuse arrows before their counter reaches zero.' },
  { name: 'Chained', piece: 'links', title: 'Linked arrows',
    text: 'Arrows joined by a chain leave together. Both paths must be clear, or both bounce back.',
    tip: 'Chained arrows leave together. Both paths must be clear.' },
  { name: 'Endless', piece: null, title: 'Endless levels',
    text: 'Every piece you have met can now turn up together, and the levels never run out.', tip: null },
];

// ---------------------------------------------------------------- specs
function pickPieces(r, k, pool = PIECES) {
  const p = pool.slice(), out = {};
  while (Object.keys(out).length < k && p.length) out[p.splice(Math.floor(r() * p.length), 1)[0]] = true;
  return out;
}

function campaignSpec(n) {
  const w = Math.min(Math.floor((n - 1) / 10), 9), j = (n - 1) % 10, boss = j === 9 && w < 9;
  const r = rng(n * 977 + 5);
  let features = {};
  if (w < 9) {
    const p = WORLDS[w].piece;
    if (p) features[p] = true;
    if (w >= 2 && j >= 5) features[WORLDS[1 + Math.floor(r() * (w - 1))].piece] = true;
  } else features = pickPieces(r, 2 + Math.floor(r() * 2));
  const jj = w === 9 ? 7 : j;
  let W = Math.min(6 + Math.floor(j * 0.7) + Math.min(w, 4), 15);
  if (w >= 1 && w < 9 && j === 0) W = 7;
  if (boss) W = Math.min(W + 3, 18);
  if (w === 9) W = Math.min(10 + Math.floor((n - 91) / 5), 16);
  const H = Math.min(W + (j >= 4 || boss ? 2 : 0), 20);
  const shape = j < 2 && w < 9 ? 'Square' : SHAPE_ORDER[n % SHAPE_ORDER.length];
  return {
    kind: 'campaign', n, world: w, j: jj, boss, W, H, shape, features,
    maxLen: Math.min(4 + Math.floor(jj / 2) + Math.min(w, 3), 14), minLen: jj >= 3 ? 3 : 2, straight: 0.35,
    deep: Math.min(0.4 + jj * 0.05 + w * 0.02, 0.9), seed: n * 7919 + 13, tries: W * H > 200 ? 5 : 8,
  };
}
function dailySpec(dayNum) {
  const r = rng(dayNum * 31 + 3);
  return { kind: 'daily', j: 6, W: 12, H: 14, shape: SHAPE_ORDER[Math.floor(r() * 6)], features: pickPieces(r, 2),
    maxLen: 10, minLen: 3, straight: 0.35, deep: 0.8, seed: dayNum * 7 + 11, tries: 5 };
}
function zenSpec(k) {
  const r = rng(k * 131 + 17), W = 8 + Math.floor(r() * 4);
  return { kind: 'zen', j: 4, W, H: W + 2, shape: SHAPE_ORDER[Math.floor(r() * 6)], features: pickPieces(r, Math.floor(r() * 3)),
    maxLen: 8, minLen: 2, straight: 0.4, deep: 0.6, seed: k * 104729 + 7, tries: 4 };
}
function timeSpec(k) {
  const r = rng(k * 211 + 1);
  return { kind: 'time', j: 2, W: 6 + Math.floor(r() * 2), H: 7 + Math.floor(r() * 2), shape: 'Square',
    features: r() < 0.5 ? { stones: true } : {}, maxLen: 5, minLen: 2, straight: 0.45, deep: 0.5, seed: k * 3571 + 9, tries: 3 };
}
function duelSpec(k) {
  return { kind: 'duel', j: 2, W: 7, H: 8, shape: 'Square', features: {}, maxLen: 4, minLen: 2, straight: 0.4,
    deep: 0.6, seed: k * 6151 + 29, tries: 4 };
}
function surgeSpec(k) {
  return { kind: 'surge', j: 2, W: 9, H: 11, shape: 'Square', features: {}, maxLen: 5, minLen: 2, straight: 0.45,
    deep: 0, seed: k * 4099 + 5, tries: 1 };
}

// ---------------------------------------------------------------- tracing
// Follows an arrow's exit path from (sx,sy) heading d. Stops at the board edge (free) or at the first
// blocker. With `collect` (a Set) arrows are recorded and passed through instead of blocking.
function trace(B, occ, sx, sy, d, color, ignoreA, ignoreB, collect) {
  const { W, H, mask, tile, tdata, portal } = B;
  let x = sx, y = sy;
  const pts = [], cells = [], seen = new Set(), limit = 4 * (W + H) + 40;
  for (let step = 0; step < limit; step++) {
    x += DIRS[d][0]; y += DIRS[d][1];
    if (x < 0 || y < 0 || x >= W || y >= H) return { free: true, pts, cells, dir: d, end: [x, y] };
    const i = y * W + x;
    if (mask[i]) {
      const o = occ[i];
      if (o >= 0 && o !== ignoreA && o !== ignoreB) {
        if (!collect) return { free: false, block: { type: 'arrow', id: o, cell: i }, pts, cells };
        collect.add(o);
      }
      const t = tile[i];
      if (t === T.STONE) return { free: false, block: { type: 'stone', cell: i }, pts, cells };
      if (t === T.GATE && tdata[i] !== color) return { free: false, block: { type: 'gate', cell: i }, pts, cells };
      cells.push(i);
      if (t === T.SLASH || t === T.BACK) {
        pts.push([x, y]);
        d = TURN[t][d];
        const key = i * 4 + d;
        if (seen.has(key)) return { free: false, block: { type: 'loop' }, pts, cells };
        seen.add(key);
        continue;
      }
      if (t === T.PORTAL) {
        pts.push([x, y]);
        const key = i * 4 + d;
        if (seen.has(key)) return { free: false, block: { type: 'loop' }, pts, cells };
        seen.add(key);
        const j = portal[i];
        x = j % W; y = (j / W) | 0;
        pts.push([x, y, 1]); // 1 = teleport jump from the previous point
        cells.push(j);
        continue;
      }
    }
    pts.push([x, y]);
  }
  return { free: false, block: { type: 'loop' }, pts, cells };
}

function endInfo(a, end) {
  if (end === 'tail') return { c: a.cells[0], d: a.dir2 };
  return { c: a.cells[a.cells.length - 1], d: a.dir };
}
function traceEnd(S, a, end, collect) {
  const { c, d } = endInfo(a, end);
  return trace(S, S.occ, c[0], c[1], d, a.color, a.id, a.link, collect);
}
function ends(a) { return a.dir2 >= 0 ? ['head', 'tail'] : ['head']; }

// Can arrow `a` leave from `end` right now? Returns the paths needed to animate it.
function attempt(S, a, end) {
  if (a.lock >= 0 && !S.gone[a.lock]) return { ok: false, reason: 'locked' };
  const res = traceEnd(S, a, end);
  if (!res.free) return { ok: false, reason: 'blocked', res };
  if (a.link >= 0) {
    const p = S.arrows[a.link];
    if (p.lock >= 0 && !S.gone[p.lock]) return { ok: false, reason: 'partner-locked', res };
    const pres = traceEnd(S, p, 'head');
    if (!pres.free) return { ok: false, reason: 'partner', res, pres };
    return { ok: true, res, pres };
  }
  return { ok: true, res };
}
function movableEnd(S, a) {
  if (S.gone[a.id]) return null;
  for (const e of ends(a)) if (attempt(S, a, e).ok) return e;
  return null;
}
function removeArrow(S, a) {
  for (const [x, y] of a.cells) if (S.occ[y * S.W + x] === a.id) S.occ[y * S.W + x] = -1;
  S.gone[a.id] = 1;
}
function view(B) { return Object.assign({}, B, { occ: B.occ.slice(), gone: B.gone.slice() }); }
function isUnit(a) { return a.link < 0 || a.id < a.link; }
function unitsCount(B) { return B.arrows.filter(isUnit).length; }

// Removing an arrow never makes another arrow harder to move, so clearing any free arrow is always
// safe. That makes a greedy solver exact: if it gets stuck, the board is unsolvable.
function solve(B) {
  const S = view(B);
  let rounds = 0, free0 = 0;
  for (;;) {
    const free = S.arrows.filter(a => !S.gone[a.id] && isUnit(a) && movableEnd(S, a));
    if (!free.length) break;
    if (!rounds) free0 = free.length;
    for (const a of free) { removeArrow(S, a); if (a.link >= 0) removeArrow(S, S.arrows[a.link]); }
    rounds++;
  }
  return { solved: S.arrows.every(a => S.gone[a.id]), rounds, free0, units: unitsCount(B) };
}

// Every arrow that has to go before `T` can leave.
function closure(S, T) {
  const need = new Set(), stack = [T];
  while (stack.length) {
    const a = stack.pop(), add = [];
    if (a.lock >= 0 && !S.gone[a.lock]) add.push(a.lock);
    let best = null;
    for (const e of ends(a)) {
      const col = new Set();
      if (!traceEnd(S, a, e, col).free) continue;
      if (!best || col.size < best.size) best = col;
    }
    if (best) add.push(...best);
    if (a.link >= 0 && !S.gone[a.link]) add.push(a.link);
    for (const id of add) if (!S.gone[id] && !need.has(id) && id !== T.id) { need.add(id); stack.push(S.arrows[id]); }
  }
  return need;
}

// Plays the board in an order that clears fuse arrows as early as possible. Returns the move on which
// each target is cleared, which proves every fuse can be met.
function fusePlan(B, targets) {
  const S = view(B), at = {};
  let moves = 0;
  const size = new Map(targets.map(t => [t.id, closure(S, t).size]));
  const order = targets.slice().sort((a, b) => size.get(a.id) - size.get(b.id) || a.id - b.id);
  for (;;) {
    const movables = S.arrows.filter(a => !S.gone[a.id] && isUnit(a) && movableEnd(S, a));
    if (!movables.length) break;
    const Tg = order.find(t => !S.gone[t.id]);
    let pick = null;
    if (Tg) {
      if (movableEnd(S, Tg)) pick = Tg;
      else { const need = closure(S, Tg); pick = movables.find(a => need.has(a.id) || (a.link >= 0 && need.has(a.link))); }
    }
    pick = pick || movables[0];
    removeArrow(S, pick);
    if (pick.link >= 0) removeArrow(S, S.arrows[pick.link]);
    moves++;
    for (const t of targets) if (S.gone[t.id] && at[t.id] == null) at[t.id] = moves;
  }
  return at;
}

// ---------------------------------------------------------------- generation
function buildBase(spec, r) {
  const { W, H } = spec, N = W * H, fn = SHAPES[spec.shape] || SHAPES.Square;
  const mask = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x - (W - 1) / 2) / (W / 2), v = (y - (H - 1) / 2) / (H / 2);
    mask[y * W + x] = fn(u, v) ? 1 : 0;
  }
  const B = { W, H, shape: spec.shape, mask, tile: new Uint8Array(N), tdata: new Int8Array(N).fill(-1),
    portal: new Int32Array(N).fill(-1), occ: new Int16Array(N).fill(-1), arrows: [], gone: [], ncol: 0,
    features: spec.features || {}, kind: spec.kind };
  const f = B.features, j = spec.j || 0;
  const masked = [];
  for (let i = 0; i < N; i++) if (mask[i]) masked.push(i);
  const interior = i => {
    const x = i % W, y = (i / W) | 0;
    return x > 0 && y > 0 && x < W - 1 && y < H - 1 && mask[i - 1] && mask[i + 1] && mask[i - W] && mask[i + W];
  };
  const pickCell = pred => {
    for (let t = 0; t < 200; t++) {
      const i = masked[Math.floor(r() * masked.length)];
      if (B.tile[i] === T.NONE && pred(i)) return i;
    }
    return -1;
  };
  if (f.stones) {
    const n = Math.round(masked.length * (0.05 + 0.005 * j));
    for (let k = 0; k < n; k++) { const i = pickCell(() => true); if (i >= 0) B.tile[i] = T.STONE; }
  }
  if (f.turns) {
    const n = Math.max(2, Math.round(masked.length * (0.03 + 0.003 * j)));
    for (let k = 0; k < n; k++) { const i = pickCell(interior); if (i >= 0) B.tile[i] = r() < 0.5 ? T.SLASH : T.BACK; }
  }
  if (f.portals) {
    const pairs = 1 + (j >= 5 ? 1 : 0) + (masked.length > 200 ? 1 : 0);
    for (let p = 0; p < pairs; p++) {
      const a = pickCell(interior); if (a < 0) continue;
      const ax = a % W, ay = (a / W) | 0;
      const b = pickCell(i => i !== a && interior(i) && Math.abs(i % W - ax) + Math.abs(((i / W) | 0) - ay) >= 4);
      if (b < 0) continue;
      B.tile[a] = B.tile[b] = T.PORTAL; B.tdata[a] = B.tdata[b] = p; B.portal[a] = b; B.portal[b] = a;
    }
  }
  if (f.gates) {
    B.ncol = j >= 6 ? 3 : 2;
    const n = 3 + Math.round(j * 0.6) + Math.floor(masked.length / 120);
    for (let k = 0; k < n; k++) { const i = pickCell(() => true); if (i >= 0) { B.tile[i] = T.GATE; B.tdata[i] = Math.floor(r() * B.ncol); } }
  }
  return B;
}

function isFree(B, x, y) {
  return x >= 0 && y >= 0 && x < B.W && y < B.H && B.mask[y * B.W + x] && B.tile[y * B.W + x] === T.NONE && B.occ[y * B.W + x] < 0;
}

// One random arrow whose exit path is clear right now. Arrows placed later may block it, which is
// what creates the puzzle; arrows placed earlier never can, so the board always stays solvable.
function tryPlace(B, r, spec, rayHits) {
  const { W } = B;
  const hx = Math.floor(r() * B.W), hy = Math.floor(r() * B.H);
  if (!isFree(B, hx, hy)) return null;
  const d = Math.floor(r() * 4), [dx, dy] = DIRS[d], bx = hx - dx, by = hy - dy;
  if (!isFree(B, bx, by)) return null;
  const color = B.ncol ? Math.floor(r() * B.ncol) : -1;
  const res = trace(B, B.occ, hx, hy, d, color, -1, -1);
  if (!res.free) return null;
  const path = new Set(res.cells);
  if (path.has(hy * W + hx) || path.has(by * W + bx)) return null;
  const body = [[hx, hy], [bx, by]], used = new Set([hy * W + hx, by * W + bx]);
  const L = spec.minLen + Math.floor(r() * (spec.maxLen - spec.minLen + 1));
  let dir = (d + 2) % 4;
  while (body.length < L) {
    const [cx, cy] = body[body.length - 1];
    let opts = [0, 1, 2, 3].filter(k => k !== (dir + 2) % 4);
    opts.sort(() => r() - 0.5);
    if (r() < spec.straight) opts = [dir, ...opts.filter(k => k !== dir)];
    let moved = false;
    for (const k of opts) {
      const nx = cx + DIRS[k][0], ny = cy + DIRS[k][1], id = ny * W + nx;
      if (isFree(B, nx, ny) && !path.has(id) && !used.has(id)) { body.push([nx, ny]); used.add(id); dir = k; moved = true; break; }
    }
    if (!moved) break;
  }
  let chain = 1;
  const hit = new Set();
  if (rayHits) for (const [cx, cy] of body) for (const o of rayHits[cy * W + cx]) { hit.add(o); chain = Math.max(chain, B.arrows[o].chain + 1); }
  return { cells: body.reverse(), dir: d, color, path: res.cells, chain, score: chain * 3 + hit.size * 1.5 + body.length * 0.2 };
}

function commit(B, c, rayHits) {
  const id = B.arrows.length;
  for (const [x, y] of c.cells) B.occ[y * B.W + x] = id;
  if (rayHits) for (const i of c.path) rayHits[i].push(id);
  B.arrows.push({ id, cells: c.cells, dir: c.dir, dir2: -1, color: c.color, lock: -1, tag: -1, keyTag: -1,
    link: -1, fuse: 0, chain: c.chain });
  B.gone.push(0);
  return B.arrows[id];
}

// Adds one arrow to a live board (Surge mode). Its path is clear when it appears, so the board stays solvable.
function spawn(B, r, spec) {
  for (let t = 0; t < 80; t++) {
    const c = tryPlace(B, r, spec, null);
    if (c && c.cells.length >= 2) return commit(B, c, null);
  }
  return null;
}

function dirIndex(dx, dy) { return DIRS.findIndex(([a, b]) => a === dx && b === dy); }

function buildBoard(spec, seed) {
  const r = rng(seed);
  const B = buildBase(spec, r);
  const f = B.features, j = spec.j || 0;
  const rayHits = Array.from({ length: B.W * B.H }, () => []);
  let fails = 0;
  while (fails < 60) {
    const cands = [];
    for (let i = 0; i < 40; i++) { const c = tryPlace(B, r, spec, rayHits); if (c) cands.push(c); }
    const good = cands.filter(c => c.cells.length >= spec.minLen);
    const list = good.length ? good : fails > 30 ? cands : [];
    if (!list.length) { fails++; continue; }
    let pick = list[Math.floor(r() * list.length)];
    if (r() < spec.deep) pick = list.reduce((b, c) => (c.score > b.score ? c : b));
    commit(B, pick, rayHits);
    fails = 0;
  }
  const A = B.arrows;
  if (A.length < 2) return null;
  const shuffled = () => A.slice().sort(() => r() - 0.5);

  if (f.twin) {
    let want = Math.max(1, Math.round(A.length * 0.3));
    for (const a of shuffled()) {
      if (!want) break;
      const [c0, c1] = a.cells, d2 = dirIndex(c0[0] - c1[0], c0[1] - c1[1]);
      const col = new Set();
      const res = trace(B, B.occ, c0[0], c0[1], d2, a.color, -1, -1, col);
      if (!res.free || col.has(a.id)) continue;
      a.dir2 = d2; want--;
    }
  }
  if (f.locks) {
    let tag = 0;
    const pairs = 1 + Math.floor(j / 3);
    for (let t = 0; t < 60 && tag < pairs; t++) {
      const L = A[Math.floor(r() * A.length)], K = A[Math.floor(r() * A.length)];
      if (K.id <= L.id || L.lock >= 0 || L.keyTag >= 0 || K.keyTag >= 0 || K.lock >= 0) continue;
      L.lock = K.id; L.tag = tag; K.keyTag = tag;
      if (!solve(B).solved) { L.lock = -1; L.tag = -1; K.keyTag = -1; continue; }
      tag++;
    }
  }
  if (f.links) {
    let made = 0;
    const pairs = 1 + Math.floor(j / 4);
    const plain = a => a.dir2 < 0 && a.lock < 0 && a.keyTag < 0 && a.link < 0;
    for (let t = 0; t < 80 && made < pairs; t++) {
      const a = A[Math.floor(r() * A.length)];
      if (!plain(a)) continue;
      const gap = b => Math.min(...a.cells.flatMap(p => b.cells.map(q => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]))));
      const near = A.filter(b => b !== a && plain(b) && gap(b) <= 2);
      if (!near.length) continue;
      const b = near[Math.floor(r() * near.length)];
      a.link = b.id; b.link = a.id;
      if (!solve(B).solved) { a.link = b.link = -1; continue; }
      made++;
    }
  }
  if (!solve(B).solved) return null;
  return B;
}

function assignFuses(B, spec) {
  const j = spec.j || 0, r = rng(spec.seed + 99);
  const S = view(B);
  const cand = B.arrows.filter(a => a.link < 0)
    .map(a => ({ a, need: closure(S, a).size }))
    .filter(o => o.need >= 2)
    .sort((x, y) => y.need - x.need);
  const count = Math.min(cand.length, 1 + Math.floor(j / 4));
  const pool = cand.slice(0, Math.max(count * 2, 1));
  const targets = [];
  while (targets.length < count && pool.length) targets.push(pool.splice(Math.floor(r() * pool.length), 1)[0].a);
  if (!targets.length) return;
  const at = fusePlan(B, targets);
  const slack = j >= 6 ? 1 : 2;
  for (const t of targets) if (at[t.id] != null) t.fuse = at[t.id] + slack;
}

function generate(spec) {
  let best = null, bestScore = -Infinity;
  for (let c = 0; c < spec.tries; c++) {
    const B = buildBoard(spec, spec.seed + c * 1013);
    if (!B) continue;
    const A = solve(B);
    if (!A.solved || A.units < 2) continue;
    const avgLen = B.arrows.reduce((s, a) => s + a.cells.length, 0) / B.arrows.length;
    const score = A.rounds * 3 - (A.free0 / A.units) * 14 + avgLen * 0.4;
    if (score > bestScore) { bestScore = score; best = B; Object.assign(B, { rounds: A.rounds, units: A.units, free0: A.free0 }); }
  }
  if (!best) { // fall back to a plain board, which always works
    const plain = Object.assign({}, spec, { features: {}, tries: 1 });
    best = buildBoard(plain, spec.seed + 777);
    const A = solve(best);
    Object.assign(best, { rounds: A.rounds, units: A.units, free0: A.free0 });
  }
  if (best.features.fuses) assignFuses(best, spec);
  best.spec = spec;
  return best;
}

// ---------------------------------------------------------------- tutorial
const TUTORIAL_STEPS = [
  { target: 1, text: 'Arrows slide the way they point. Its path is clear, so <b>tap the glowing arrow.</b>' },
  { target: 2, text: "This one points straight at another arrow. <b>Tap it to see what happens.</b> It's free this time." },
  { target: 0, text: 'It bounced back. In real levels that costs a life. <b>Clear the arrow in its way first.</b>' },
  { target: 2, text: 'The path is open now. <b>Tap the last arrow.</b>' },
];
function buildTutorial() {
  const spec = { kind: 'tutorial', W: 5, H: 5, shape: 'Square', features: {}, j: 0 };
  const B = buildBase(spec, rng(1));
  const defs = [
    { cells: [[0, 2], [1, 2]], dir: 1 },
    { cells: [[3, 4], [3, 3], [3, 2]], dir: 0 },
    { cells: [[2, 0], [1, 0], [1, 1]], dir: 2 },
  ];
  for (const d of defs) commit(B, { cells: d.cells, dir: d.dir, color: -1, path: [], chain: 1 }, null);
  Object.assign(B, solve(B));
  B.spec = spec;
  return B;
}

function dayNumber(date = new Date()) {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

// The closest pair of cells between two arrows (where the chain is drawn).
function closestCells(a, b) {
  let best = null, bd = Infinity;
  for (const p of a.cells) for (const q of b.cells) { const d = Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]); if (d < bd) { bd = d; best = [p, q]; } }
  return best;
}

const API = { closestCells, DIRS, T, PIECES, WORLDS, SHAPES, SHAPE_ORDER, rng, campaignSpec, dailySpec, zenSpec, timeSpec, duelSpec,
  surgeSpec, trace, traceEnd, attempt, movableEnd, removeArrow, view, solve, closure, fusePlan, buildBase, buildBoard,
  generate, spawn, isUnit, unitsCount, ends, buildTutorial, TUTORIAL_STEPS, dayNumber };
root.ArrowEngine = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
