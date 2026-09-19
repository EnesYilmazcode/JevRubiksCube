// Jev-guided search over the fast cube. The only judgment is Jev's; the code supplies legal moves,
// a no-revisit rule, and a goal test (is the cube solved).
import * as fc from "./fastcube.mjs";
import { ask } from "./research.mjs";

const mk = (m) => (m.endsWith("'") ? `${m[0]}_prime` : m);
const NOTATION = "Each face string is read row by row as viewed directly from outside that face.";
const TARGET = fc.faces(fc.SOLVED);
const legal = (path) => fc.MOVES.filter((m) => m[0] !== path.at(-1)?.[0]);
const SOLVED_KEY = fc.key(fc.SOLVED);

// Per-parent choice over its legal children (the original app prompt, minus history).
export function policyRequest(s, ms) {
  const criteria = {};
  for (const m of ms) criteria[mk(m)] = `Apply ${m}. Resulting faces: ${JSON.stringify(fc.faces(fc.move(s, m)))}.`;
  return {
    state: { puzzle: "3x3 Rubik's Cube", current_faces: fc.faces(s), target_faces: TARGET, notation: NOTATION },
    questions: { q: { type: "choice", instructions: "Choose the single rotation whose resulting state is most likely to be closest to a fully solved cube.", criteria } },
  };
}
// One choice across many candidate states from different parents, so probabilities are comparable.
export function globalRequest(states) {
  const criteria = {};
  states.forEach((s, i) => { criteria[`c${i}`] = `Faces: ${JSON.stringify(fc.faces(s))}.`; });
  return {
    state: { puzzle: "3x3 Rubik's Cube", target_faces: TARGET, notation: NOTATION },
    questions: { q: { type: "choice", instructions: "Each option is a cube state. Choose the state that is closest to fully solved, meaning the fewest face turns away from the target faces.", criteria } },
  };
}
const LEVELS = ["0, it is already solved", "1 turn", "2 turns", "3 turns", "4 turns", "5 or more turns"];
export function scoreRequest(states) {
  const questions = {};
  states.forEach((s, i) => { questions[`c${i}`] = { type: "score", instructions: `Cube faces: ${JSON.stringify(fc.faces(s))}. How many face turns does this cube need to be solved?`, criteria: LEVELS }; });
  return { state: { puzzle: "3x3 Rubik's Cube", target_faces: TARGET, notation: NOTATION }, questions };
}

async function mapLimit(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const j = i++; out[j] = await fn(items[j]); } }));
  return out;
}
const probOf = (a, id) => a.probabilities?.[id] ?? (a.choice === id ? 1 : 0);

/**
 * opts: { width, rank: "cumulative" | "global" | "score" | "hybrid", maxDepth, parallel }
 * returns { path | null, calls, levels }
 */
export async function solve(start, opts = {}) {
  const W = opts.width ?? 5; const rank = opts.rank ?? "cumulative"; const maxDepth = opts.maxDepth ?? 8; const par = opts.parallel ?? 3;
  let calls = 0;
  if (fc.key(start) === SOLVED_KEY) return { path: [], calls, levels: 0 };
  const seen = new Set([fc.key(start)]);
  let beam = [{ s: start, path: [], logp: 0 }];
  for (let level = 1; level <= maxDepth; level += 1) {
    let children = [];
    for (const node of beam) for (const m of legal(node.path)) {
      const s = fc.move(node.s, m); const k = fc.key(s);
      if (seen.has(k)) continue;
      children.push({ s, k, path: [...node.path, m], parent: node, move: m, logp: node.logp });
    }
    // same state reached from two parents: keep the first (parents are in rank order)
    const byKey = new Map(); for (const c of children) if (!byKey.has(c.k)) byKey.set(c.k, c); children = [...byKey.values()];
    const goal = children.find((c) => c.k === SOLVED_KEY);
    if (goal) return { path: goal.path, calls, levels: level };
    if (!children.length) break;

    if (rank === "cumulative" || rank === "hybrid") {
      const perParent = await mapLimit(beam, par, async (node) => {
        const ms = legal(node.path); const a = await ask(policyRequest(node.s, ms)); calls += 1;
        return new Map(ms.map((m) => [m, probOf(a.q, mk(m))]));
      });
      const byParent = new Map(beam.map((n, i) => [n, perParent[i]]));
      for (const c of children) { c.p = byParent.get(c.parent).get(c.move); c.logp = c.parent.logp + Math.log(Math.max(0.005, c.p)); }
    }
    if (rank === "cumulative") children.sort((a, b) => b.logp - a.logp);
    if (rank === "hybrid") {
      // shortlist each parent's top-k by its own choice, then one global choice across the shortlist
      const k = Math.max(3, Math.ceil((3 * W) / beam.length));
      const shortlist = [];
      for (const node of beam) shortlist.push(...children.filter((c) => c.parent === node).sort((a, b) => b.p - a.p).slice(0, k));
      const a = await ask(globalRequest(shortlist.map((c) => c.s))); calls += 1;
      shortlist.forEach((c, i) => { c.g = probOf(a.q, `c${i}`); });
      children = shortlist.sort((x, y) => y.g - x.g || y.logp - x.logp);
    }
    if (rank === "global") {
      const chunks = []; for (let i = 0; i < children.length; i += 120) chunks.push(children.slice(i, i + 120));
      await mapLimit(chunks, par, async (chunk) => {
        const a = await ask(globalRequest(chunk.map((c) => c.s))); calls += 1;
        chunk.forEach((c, i) => { c.g = probOf(a.q, `c${i}`) * chunk.length; });
      });
      children.sort((x, y) => y.g - x.g);
    }
    if (rank === "tournament" && level > (opts.full ?? 0)) {
      // chunks of <=100 candidates, keep each chunk's top-k, then one final choice across the winners
      const size = opts.chunk ?? 100; const chunks = []; for (let i = 0; i < children.length; i += size) chunks.push(children.slice(i, i + size));
      const k = chunks.length === 1 ? W : Math.max(2, Math.ceil((2 * W) / chunks.length));
      const winners = (await mapLimit(chunks, par, async (chunk) => {
        const a = await ask(globalRequest(chunk.map((c) => c.s))); calls += 1;
        chunk.forEach((c, i) => { c.g = probOf(a.q, `c${i}`); });
        return chunk.slice().sort((x, y) => y.g - x.g).slice(0, k);
      })).flat();
      if (chunks.length > 1 && winners.length > W) {
        const a = await ask(globalRequest(winners.map((c) => c.s))); calls += 1;
        winners.forEach((c, i) => { c.g = probOf(a.q, `c${i}`) + c.g * 1e-3; });
        winners.sort((x, y) => y.g - x.g);
      }
      children = winners;
    }
    if (rank === "tournament" && level <= (opts.full ?? 0)) { beam = children; for (const c of beam) seen.add(c.k); if (opts.dist) opts.trace?.push(Math.min(...beam.map((c) => opts.dist.get(c.k) ?? 9))); continue; }
    if (rank === "score") {
      const chunks = []; for (let i = 0; i < children.length; i += 18) chunks.push(children.slice(i, i + 18));
      await mapLimit(chunks, par, async (chunk) => {
        const a = await ask(scoreRequest(chunk.map((c) => c.s))); calls += 1;
        chunk.forEach((c, i) => { c.score = a[`c${i}`].score; });
      });
      children.sort((x, y) => x.score - y.score);
    }
    beam = children.slice(0, W);
    for (const c of beam) seen.add(c.k);
    if (opts.dist) opts.trace?.push(Math.min(...beam.map((c) => opts.dist.get(c.k) ?? 9)));
  }
  return { path: null, calls, levels: maxDepth };
}

// Closed-loop greedy with the no-revisit rule, for comparison.
export async function greedy(start, maxSteps = 12) {
  let s = start; const path = []; const seen = new Set([fc.key(s)]); let calls = 0;
  while (path.length < maxSteps && fc.key(s) !== SOLVED_KEY) {
    const ms = legal(path).filter((m) => !seen.has(fc.key(fc.move(s, m))));
    const a = await ask(policyRequest(s, ms)); calls += 1;
    const m = ms.slice().sort((x, y) => probOf(a.q, mk(y)) - probOf(a.q, mk(x)))[0];
    s = fc.move(s, m); path.push(m); seen.add(fc.key(s));
  }
  return { path: fc.key(s) === SOLVED_KEY ? path : null, calls, levels: path.length };
}

// Best measured setting (true-distance scrambles): d3 20/20, d4 43/50, d5 9/20.
export const RECOMMENDED = { rank: "tournament", width: 24, chunk: 40, full: 0, maxDepth: 7, parallel: 2 };
