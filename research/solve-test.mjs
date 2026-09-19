// Closed-loop solve rate on scrambles of known TRUE optimal distance.
import * as fc from "./fastcube.mjs";
import { solve, greedy } from "./jev-solver.mjs";
import { stats, rng, pool, log } from "./research.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const N = Number(args.n ?? 20); const depths = (args.depths ?? "3,4,5").split(",").map(Number);
const methods = (args.methods ?? "greedy").split(",");
const { dist, layers } = fc.buildTable(5);

function statesAt(d, seed) {
  const r = rng(seed + d);
  if (d <= 5) return Array.from({ length: N }, () => layers[d][Math.floor(r() * layers[d].length)]);
  // d = 6: random 6-move sequences whose state is beyond the depth-5 table (so exactly 6 away)
  const out = [];
  while (out.length < N) {
    let s = fc.SOLVED; let last = "";
    for (let i = 0; i < d; i++) { let m; do m = fc.MOVES[Math.floor(r() * 18)]; while (m[0] === last); last = m[0]; s = fc.move(s, m); }
    if (!dist.has(fc.key(s))) out.push(fc.key(s));
  }
  return out;
}

for (const method of methods) for (const d of depths) {
  const [kind, W, F] = method.split(":"); // greedy | cumulative:5 | global:5 | score:5 | hybrid:5 | tournament:W:fullLevels
  const states = statesAt(d, Number(args.seed ?? 9000));
  const t0 = stats.tokens;
  const res = await pool(states, Number(args.conc ?? 1), async (k) => {
    const t = Date.now(); let trace;
    const r = kind === "greedy" ? await greedy(fc.fromKey(k), d + 6)
      : await solve(fc.fromKey(k), { width: Number(W), rank: kind, full: Number(F ?? 0), chunk: Number(args.chunk ?? 100), maxDepth: d + Number(args.slack ?? 3), parallel: Number(args.par ?? 3), dist, trace: (trace = []) });
    if (r.path && fc.key(fc.moves(fc.fromKey(k), r.path)) !== fc.key(fc.SOLVED)) throw new Error("bad path");
    if (!r.path && args.trace) console.log("fail trace (min true dist in beam per level):", trace?.join(" "));
    return { solved: !!r.path, len: r.path?.length, calls: r.calls, secs: (Date.now() - t) / 1000 };
  });
  const ok = res.filter((r) => r.solved);
  const row = {
    kind: "solve", method, d, n: N, solved: ok.length, rate: ok.length / N,
    meanLen: ok.length ? +(ok.reduce((a, r) => a + r.len, 0) / ok.length).toFixed(2) : null,
    callsPerTrial: +(res.reduce((a, r) => a + r.calls, 0) / N).toFixed(1),
    secsPerTrial: +(res.reduce((a, r) => a + r.secs, 0) / N).toFixed(1),
    tokens: stats.tokens - t0, usd: +((stats.tokens - t0) * 0.042e-6).toFixed(4),
  };
  log(row); console.log(JSON.stringify(row));
}
console.log(`retries ${stats.retries} calls ${stats.calls} tokens ${stats.tokens} ~$${(stats.tokens * 0.042e-6).toFixed(4)}`);
