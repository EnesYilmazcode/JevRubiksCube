// Pre-solve real 20-move scrambles with Jev and save each run for the render page (public/runs/<seed>.json).
import { experimental_evaluate as evaluate } from "ai";
import { writeFileSync } from "node:fs";
import { SOLVED_CUBE, applyMoves, isSolved } from "../app/cube.ts";
import { STAGES } from "../app/method.ts";
import { stepRequest } from "../app/prompts.ts";
import { demoScramble, solveWithMethod } from "../app/solver.ts";

// usage: make-run.mjs <seeds: "600,601" or "700-739"> [concurrency]
const spec = process.argv[2] ?? "600,601,602";
const seeds = spec.includes("-") ? (([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))(spec.split("-").map(Number)) : spec.split(",").map(Number);
const conc = Number(process.argv[3] ?? 3);
function rng(seed) { let x = seed >>> 0 || 1; return () => ((x ^= x << 13, x ^= x >>> 17, x ^= x << 5) >>> 0) / 4294967296; }
async function ask(stickers, stage, macros, check, attempt = 0) {
  try {
    const r = await evaluate({ model: "typesafe-ai/jev", ...stepRequest(stickers, stage, macros, check), maxRetries: 0, abortSignal: AbortSignal.timeout(20000) });
    return { probabilities: r.answers.step.probabilities ?? { [r.answers.step.choice]: 1 }, tokens: r.usage.inputTokens ?? 0 };
  } catch (e) {
    if (e?.data?.step?.probabilities) return { probabilities: e.data.step.probabilities, tokens: 0 };
    if (attempt < 16) { await new Promise((r) => setTimeout(r, 200 + Math.random() * 300 + attempt * 200)); return ask(stickers, stage, macros, check, attempt + 1); }
    throw e;
  }
}
const results = [];
let next = 0;
await Promise.all(Array.from({ length: Math.min(conc, seeds.length) }, async () => { while (next < seeds.length) await solveOne(seeds[next++]); }));
results.sort((x, y) => x.moves - y.moves);
console.log("shortest:", results.slice(0, 5).map((r) => `${r.seed} (${r.moves} moves, ${r.steps} steps)`).join(", "));

async function solveOne(seed) {
  const scramble = demoScramble(20, rng(seed));
  const start = applyMoves(SOLVED_CUBE, scramble);
  const t = Date.now();
  const res = await solveWithMethod(start, ask);
  const moves = res.steps.flatMap((s) => s.macro.moves);
  const ok = res.solved && isSolved(applyMoves(start, moves));
  console.log(`seed ${seed}: ${ok ? "SOLVED" : "failed at " + res.failedStage} in ${moves.length} moves, ${res.steps.length} steps, ${res.calls} calls, ${((Date.now() - t) / 1000).toFixed(0)} s`);
  if (!ok) return;
  results.push({ seed, moves: moves.length, steps: res.steps.length });
  writeFileSync(`public/runs/${seed}.json`, JSON.stringify({
    seed, scramble,
    steps: res.steps.map((s) => ({ stage: STAGES.indexOf(s.stage), title: s.stage.title, label: s.macro.label, moves: s.macro.moves, probability: +s.probability.toFixed(3), topChoice: s.topChoice })),
    stats: { calls: res.calls, tokens: res.tokens, seconds: Math.round((Date.now() - t) / 1000), moves: moves.length },
  }, null, 1));
}
