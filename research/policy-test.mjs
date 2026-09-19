import * as fc from "./fastcube.mjs";
import { ENCODINGS, ask, stats, rng, pool, log } from "./research.mjs";
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const encs = (args.enc ?? "json").split(","); const depths = (args.depths ?? "2,3,4,5").split(",").map(Number); const N = Number(args.n ?? 30);
const { dist, layers } = fc.buildTable(5);
for (const enc of encs) for (const d of depths) {
  const r = rng(1000 + d); const states = Array.from({ length: N }, () => layers[d][Math.floor(r() * layers[d].length)]);
  const t0 = stats.tokens; const c0 = stats.calls; const w0 = Date.now();
  const res = await pool(states, 3, async (k) => {
    const s = fc.fromKey(k); const { req, read } = ENCODINGS[enc](s, fc.MOVES);
    const vals = read(await ask(req));
    const ranked = Object.entries(vals).sort((a, b) => b[1] - a[1]).map(([m]) => m);
    const good = new Set(fc.MOVES.filter((m) => dist.get(fc.key(fc.move(s, m))) === d - 1));
    const rank = ranked.findIndex((m) => good.has(m));
    return rank;
  });
  const top = (k) => res.filter((x) => x >= 0 && x < k).length / N;
  const row = { kind: "policy", enc, d, n: N, top1: top(1), top3: top(3), top5: top(5), tokPerCall: Math.round((stats.tokens - t0) / (stats.calls - c0)), secs: (Date.now() - w0) / 1000 };
  log(row); console.log(JSON.stringify(row));
}
console.log(`total calls ${stats.calls} tokens ${stats.tokens} ~$${(stats.tokens * 0.042e-6).toFixed(4)}`);
