// Where does Jev rank the menu options that complete the next cross sub-goal? compact vs JSON encoding.
import { experimental_evaluate as evaluate } from "ai";
import { SOLVED_CUBE, applyMoves, serializeCube } from "../app/cube.ts";
import { STAGES, stagePattern } from "../app/method.ts";
import { demoScramble } from "../app/solver.ts";

const enc = process.argv[2] ?? "json";
const sub = Number(process.argv[3] ?? 0);
const stage = STAGES[0];
function rng(seed) { let x = seed >>> 0 || 1; return () => ((x ^= x << 13, x ^= x >>> 17, x ^= x << 5) >>> 0) / 4294967296; }
const faceStr = (s) => Object.entries(serializeCube(s)).map(([f, v]) => `${f}:${v}`).join(" ");
const show = (s) => (enc === "json" ? JSON.stringify(serializeCube(s)) : faceStr(s));
const pattern = stagePattern(stage);
const ranks = [];
for (let i = 0; i < 10; i++) {
  let s = applyMoves(SOLVED_CUBE, demoScramble(20, rng(500 + i)));
  // walk to the requested sub-goal with a cheap BFS so we test sub-goal `sub`
  for (let k = 0; k < sub; k++) {
    const hit = stage.macros.map((m) => applyMoves(s, m.moves)).find((c) => stage.checks[k](c));
    if (hit) s = hit;
  }
  if (stage.checks[sub](s)) continue;
  const options = stage.macros.map((m) => ({ m, r: applyMoves(s, m.moves) }));
  const good = new Set(options.filter((o) => stage.checks[sub](o.r)).map((o) => o.m.id));
  if (!good.size) continue;
  const criteria = Object.fromEntries(options.map((o) => [o.m.id, `${o.m.moves.join(" ")} -> ${show(o.r)}`]));
  const state = enc === "json"
    ? { puzzle: "3x3 Rubik's Cube", stage: "White cross", goal: stage.goal, current_faces: serializeCube(s), goal_pattern: pattern, notation: "Each face string is read row by row as viewed from outside that face. In goal_pattern '.' means any color." }
    : { puzzle: "3x3 Rubik's Cube", stage: "White cross", goal: stage.goal, current: faceStr(s), goal_pattern: Object.entries(pattern).map(([f, v]) => `${f}:${v}`).join(" ") };
  let probs;
  try {
    const r = await evaluate({ model: "typesafe-ai/jev", state, questions: { step: { type: "choice", instructions: "Choose the step whose resulting cube matches more of goal_pattern, without breaking stickers that already match.", criteria } } });
    probs = r.answers.step.probabilities;
  } catch (e) { probs = e?.data?.step?.probabilities; if (!probs) throw e; }
  const order = Object.entries(probs).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const rank = order.findIndex((k) => good.has(k)) + 1;
  ranks.push(rank);
  console.log(`scramble ${i}: ${good.size} of ${options.length} options complete it; best of them ranked #${rank}; top prob ${Math.max(...Object.values(probs)).toFixed(2)}`);
}
console.log(enc, "sub-goal", sub + 1, "ranks", ranks.join(","), "top1", ranks.filter((r) => r === 1).length + "/" + ranks.length, "top3", ranks.filter((r) => r <= 3).length + "/" + ranks.length);
