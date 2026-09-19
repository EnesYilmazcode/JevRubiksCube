// Offline checks for the method menus: algorithm translation, and how many menu steps each sub-goal needs (exhaustive BFS).
import { SOLVED_CUBE, applyMoves, serializeCube } from "../app/cube.ts";
import { STAGES, alg, progress, isSolvedCube, stagePattern } from "../app/method.ts";
import { demoScramble } from "../app/solver.ts";

const rep = (t, n) => Array(n).fill(t).join(" ");
const ok = (label, v) => console.log(v ? "ok  " : "FAIL", label);
ok("corner insert x6 is identity", isSolvedCube(applyMoves(SOLVED_CUBE, alg(rep("R U R' U'", 6)))));
ok("twist x6 is identity", isSolvedCube(applyMoves(SOLVED_CUBE, alg(rep("R' D' R D", 6)))));
for (const [name, text] of [["yellow cross alg", "F R U R' U' F'"], ["edge swap", "R U R' U R U2 R' U"], ["corner cycle", "U R U' L' U R' U' L"], ["insert right", "U R U' R' U' F' U F"], ["insert left", "U' L' U L U F U' F'"]]) {
  for (const view of [0, 1, 2, 3]) {
    const s = applyMoves(SOLVED_CUBE, alg(text, view));
    const keep = name.startsWith("insert") ? progress.whiteEdges(s) === 4 && progress.whiteCorners(s) === 4 : progress.firstTwo(s);
    if (!keep) ok(`${name} view ${view} keeps the solved layers`, false);
  }
}
ok("layer-preservation checks ran", true);
ok("corner cycle x3 is identity", isSolvedCube(applyMoves(SOLVED_CUBE, alg(rep("U R U' L' U R' U' L", 3)))));
for (const st of STAGES) console.log(st.id.padEnd(15), String(st.macros.length).padStart(4), "macros  pattern", JSON.stringify(stagePattern(st)));

// Exhaustive BFS per sub-goal: fewest menu steps needed.
const key = (s) => Object.values(serializeCube(s)).join("");
function bfs(start, stage, check, maxDepth) {
  if (check(start)) return { depth: 0, state: start };
  let frontier = [start]; const seen = new Set([key(start)]);
  for (let d = 1; d <= maxDepth; d++) {
    const next = [];
    for (const s of frontier) for (const m of stage.macros) {
      const c = applyMoves(s, m.moves); const k = key(c);
      if (seen.has(k)) continue; seen.add(k);
      if (check(c)) return { depth: d, state: c };
      next.push(c);
    }
    frontier = next;
    if (frontier.length > 60000) return { depth: Infinity, state: null };
  }
  return { depth: Infinity, state: null };
}
const worst = {};
const N = Number(process.argv[2] ?? 12);
let r = 7; const rand = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
for (let i = 0; i < N; i++) {
  let s = applyMoves(SOLVED_CUBE, demoScramble(20, rand));
  let total = 0;
  for (const st of STAGES) for (let k = 0; k < st.checks.length; k++) {
    const res = bfs(s, st, st.checks[k], st.id === "daisy" ? 4 : 4);
    const tag = `${st.id}#${k + 1}`;
    worst[tag] = Math.max(worst[tag] ?? 0, res.depth);
    if (!res.state) { console.log("stuck at", tag, "scramble", i); total = -1; break; }
    s = res.state; total += res.depth;
  }
  if (total < 0) continue;
}
console.log("worst menu steps per sub-goal over", N, "scrambles:", JSON.stringify(worst));
