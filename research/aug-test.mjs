// (a) color-relabel ensembles on the json choice encoding; (b) calibration of an absolute distance score.
import * as fc from "./fastcube.mjs";
import { ENCODINGS, ask, stats, rng, pool, log } from "./research.mjs";
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const N = Number(args.n ?? 30); const K = Number(args.k ?? 4);
const { dist, layers } = fc.buildTable(5);
function perm6(r) { const p = [0, 1, 2, 3, 4, 5]; for (let i = 5; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } return p; }
const relabel = (s, p) => Uint8Array.from(s, (c) => p[c]);
// relabeled solved state is still "solved" structurally; encodings use fc.faces(fc.SOLVED) for target, so patch target by passing relabeled solved via closure
function jsonAug(s, ms, p) {
  const { req, read } = ENCODINGS.json(relabel(s, p), []);
  const criteria = {};
  const mk = (m) => (m.endsWith("'") ? `${m[0]}_prime` : m);
  for (const m of ms) criteria[mk(m)] = `Apply ${m}. Resulting faces: ${JSON.stringify(fc.faces(relabel(fc.move(s, m), p)))}.`;
  req.state.target_faces = fc.faces(relabel(fc.SOLVED, p));
  req.questions.q.criteria = criteria;
  return { req, read: (a) => Object.fromEntries(ms.map((m) => [m, a.q.probabilities?.[mk(m)] ?? (a.q.choice === mk(m) ? 1 : 0)])) };
}
if (args.mode === "aug") for (const d of [3, 4, 5]) {
  const r = rng(1000 + d); const states = Array.from({ length: N }, () => layers[d][Math.floor(r() * layers[d].length)]);
  const pr = rng(77 + d);
  const res = await pool(states, 3, async (k) => {
    const s = fc.fromKey(k); const sum = Object.fromEntries(fc.MOVES.map((m) => [m, 0])); const single = [];
    const perms = [[0, 1, 2, 3, 4, 5], ...Array.from({ length: K - 1 }, () => perm6(pr))];
    const good = new Set(fc.MOVES.filter((m) => dist.get(fc.key(fc.move(s, m))) === d - 1));
    for (const p of perms) {
      const { req, read } = jsonAug(s, fc.MOVES, p); const v = read(await ask(req));
      single.push(good.has(Object.entries(v).sort((a, b) => b[1] - a[1])[0][0]));
      for (const m of fc.MOVES) sum[m] += Math.log(Math.max(0.005, v[m]));
    }
    const ranked = Object.entries(sum).sort((a, b) => b[1] - a[1]).map(([m]) => m);
    return { rank: ranked.findIndex((m) => good.has(m)), singleTop1: single.filter(Boolean).length / single.length };
  });
  const top = (k) => res.filter((x) => x.rank >= 0 && x.rank < k).length / N;
  const row = { kind: "policy-aug", enc: `json-relabel${K}`, d, n: N, top1: top(1), top3: top(3), top5: top(5), singleTop1: res.reduce((a, x) => a + x.singleTop1, 0) / N };
  log(row); console.log(JSON.stringify(row));
}
if (args.mode === "calib") {
  const out = {};
  for (const d of [0, 1, 2, 3, 4, 5]) {
    const r = rng(500 + d); const states = Array.from({ length: d === 0 ? 3 : N }, () => layers[d][Math.floor(r() * layers[d].length)]);
    const scores = await pool(states, 3, async (k) => {
      const s = fc.fromKey(k);
      const faceStr = Object.entries(fc.faces(s)).map(([f, v]) => `${f}:${v}`).join(" ");
      const solved = Object.entries(fc.faces(fc.SOLVED)).map(([f, v]) => `${f}:${v}`).join(" ");
      const a = await ask({ state: `3x3 Rubik's Cube. Each face is 9 stickers read row by row. Solved: ${solved}. Current: ${faceStr}.`,
        questions: { q: { type: "score", instructions: "How many face turns does the current cube need to be solved?", criteria: ["0, it is already solved", "1 turn", "2 turns", "3 turns", "4 turns", "5 or more turns"] } } });
      return a.q.score;
    });
    out[d] = { mean: +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2), min: Math.min(...scores).toFixed(2), max: Math.max(...scores).toFixed(2) };
  }
  log({ kind: "calibration", enc: "score-current", out }); console.log(JSON.stringify(out));
}
console.log(`calls ${stats.calls} tokens ${stats.tokens} ~$${(stats.tokens * 0.042e-6).toFixed(4)}`);
