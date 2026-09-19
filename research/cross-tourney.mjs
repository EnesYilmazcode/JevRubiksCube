// Cross sub-goal: shuffled options, split into chunks asked as parallel questions in ONE request,
// then a final question across the chunk winners. Where does a sub-goal-completing option land?
import { experimental_evaluate as evaluate } from "ai";
import { SOLVED_CUBE, applyMoves, serializeCube } from "../app/cube.ts";
import { STAGES, stagePattern } from "../app/method.ts";
import { demoScramble } from "../app/solver.ts";

const CHUNK = Number(process.argv[2] ?? 40), KEEP = Number(process.argv[3] ?? 3), N = Number(process.argv[4] ?? 10);
const stage = STAGES[0];
function rng(seed) { let x = seed >>> 0 || 1; return () => ((x ^= x << 13, x ^= x >>> 17, x ^= x << 5) >>> 0) / 4294967296; }
const shuffle = (a, r) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const state = (s) => ({ puzzle: "3x3 Rubik's Cube", stage: "White cross", goal: stage.goal, current_faces: serializeCube(s), goal_pattern: stagePattern(stage),
  notation: "Each face string is read row by row as viewed from outside that face. In goal_pattern '.' means any color." });
const instr = "Each option is a turn sequence and the cube it leads to. Choose the option whose resulting cube matches more of goal_pattern, without breaking stickers that already match.";
async function ask(st, questions) {
  for (let a = 0; ; a++) {
    try { return (await evaluate({ model: "typesafe-ai/jev", state: st, questions, maxRetries: 0 })).answers; }
    catch (e) { if (e?.data) return e.data; if (a > 4) throw e; await new Promise((r) => setTimeout(r, 400 * 2 ** a)); }
  }
}
const stats = [];
for (let i = 0; i < N; i++) {
  const r = rng(700 + i);
  let s = applyMoves(SOLVED_CUBE, demoScramble(20, r));
  const sub = i % 3; // test sub-goals 1..3
  for (let k = 0; k < sub; k++) { const hit = stage.macros.map((m) => applyMoves(s, m.moves)).find((c) => stage.checks[k](c)); if (hit) s = hit; }
  if (stage.checks[sub](s)) continue;
  const opts = shuffle(stage.macros.map((m) => ({ m, r: applyMoves(s, m.moves) })), r);
  const good = new Set(opts.filter((o) => stage.checks[sub](o.r)).map((o) => o.m.id));
  if (!good.size) continue;
  const chunks = []; for (let c = 0; c < opts.length; c += CHUNK) chunks.push(opts.slice(c, c + CHUNK));
  const crit = (list) => Object.fromEntries(list.map((o) => [o.m.id, `${o.m.moves.join(" ")} -> ${JSON.stringify(serializeCube(o.r))}`]));
  const a1 = await ask(state(s), Object.fromEntries(chunks.map((ch, c) => [`g${c}`, { type: "choice", instructions: instr, criteria: crit(ch) }])));
  const winners = chunks.flatMap((ch, c) => Object.entries(a1[`g${c}`].probabilities).sort((x, y) => y[1] - x[1]).slice(0, KEEP).map(([id]) => ch.find((o) => o.m.id === id)));
  const goodInFinal = winners.filter((o) => good.has(o.m.id)).length;
  const a2 = await ask(state(s), { final: { type: "choice", instructions: instr, criteria: crit(shuffle(winners, r)) } });
  const order = Object.entries(a2.final.probabilities).sort((x, y) => y[1] - x[1]).map(([id]) => id);
  const rank = order.findIndex((id) => good.has(id)) + 1;
  stats.push({ rank, survived: goodInFinal > 0 });
  console.log(`sub-goal ${sub + 1}: ${good.size}/${opts.length} good; ${goodInFinal} survived chunk round (${winners.length} finalists); final rank ${rank || "-"}`);
}
console.log(`chunk ${CHUNK} keep ${KEEP}: survived ${stats.filter((x) => x.survived).length}/${stats.length}, final top1 ${stats.filter((x) => x.rank === 1).length}, top3 ${stats.filter((x) => x.rank && x.rank <= 3).length}`);
