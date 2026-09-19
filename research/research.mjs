// Policy-quality + closed-loop research harness for Jev on the cube.
import { experimental_evaluate as evaluate } from "ai";
import { appendFileSync } from "node:fs";
import * as fc from "./fastcube.mjs";

const OUT = "results/research-results.jsonl";
const mk = (m) => (m.endsWith("'") ? `${m[0]}_prime` : m);
const unmk = Object.fromEntries(fc.MOVES.map((m) => [mk(m), m]));
const faceStr = (s) => Object.entries(fc.faces(s)).map(([f, v]) => `${f}:${v}`).join(" ");
const SOLVED_FACES = fc.faces(fc.SOLVED);

export const stats = { calls: 0, tokens: 0, retries: 0 };
export async function ask(req, attempt = 0) {
  try {
    const r = await evaluate({ model: "typesafe-ai/jev", maxRetries: 0, ...req });
    stats.calls++; stats.tokens += r.usage.inputTokens ?? 0;
    return r.answers;
  } catch (e) {
    if (e?.data && typeof e.data === "object" && Object.values(e.data).every((a) => a && a.type)) {
      stats.calls++;
      const fixed = {};
      for (const [q, a] of Object.entries(e.data)) {
        fixed[q] = a.type === "choice" && a.probabilities ? { ...a, choice: Object.entries(a.probabilities).sort((x, y) => y[1] - x[1])[0][0] } : a;
      }
      return fixed;
    }
    if (attempt < 6) { stats.retries++; await new Promise((r) => setTimeout(r, 400 * 2 ** attempt)); return ask(req, attempt + 1); }
    throw e;
  }
}

// Each encoding: (state, moves[]) -> { req, read(answers) -> {move: value (higher = better)} }
export const ENCODINGS = {
  json(s, ms) {
    const criteria = {};
    for (const m of ms) criteria[mk(m)] = `Apply ${m}. Resulting faces: ${JSON.stringify(fc.faces(fc.move(s, m)))}.`;
    return {
      req: { state: { puzzle: "3x3 Rubik's Cube", current_faces: fc.faces(s), target_faces: SOLVED_FACES, notation: "Each face string is read row by row as viewed directly from outside that face." },
        questions: { q: { type: "choice", instructions: "Choose the single rotation whose resulting state is most likely to be closest to a fully solved cube.", criteria } } },
      read: (a) => Object.fromEntries(ms.map((m) => [m, a.q.probabilities?.[mk(m)] ?? (a.q.choice === mk(m) ? 1 : 0)])),
    };
  },
  compact(s, ms) {
    const criteria = {};
    for (const m of ms) criteria[mk(m)] = `After ${m}: ${faceStr(fc.move(s, m))}`;
    return {
      req: { state: `3x3 Rubik's Cube. Current: ${faceStr(s)}. Solved: ${faceStr(fc.SOLVED)}. Each face is 9 stickers read row by row.`,
        questions: { q: { type: "choice", instructions: "Which move leaves the cube the fewest moves away from solved?", criteria } } },
      read: (a) => Object.fromEntries(ms.map((m) => [m, a.q.probabilities?.[mk(m)] ?? (a.q.choice === mk(m) ? 1 : 0)])),
    };
  },
  cubie(s, ms) {
    const criteria = {};
    for (const m of ms) criteria[mk(m)] = `After ${m}: ${fc.cubies(fc.move(s, m))}`;
    return {
      req: { state: `3x3 Rubik's Cube, listed piece by piece. Each entry is slot:colors-now/colors-that-belong-there, colors in the order of the slot's faces (U/D first, then F/B, then R/L). Current: ${fc.cubies(s)}`,
        questions: { q: { type: "choice", instructions: "Which move leaves the cube the fewest moves away from solved (every slot showing the colors that belong there)?", criteria } } },
      read: (a) => Object.fromEntries(ms.map((m) => [m, a.q.probabilities?.[mk(m)] ?? (a.q.choice === mk(m) ? 1 : 0)])),
    };
  },
  score(s, ms) {
    const questions = {};
    for (const m of ms) questions[mk(m)] = { type: "score", instructions: `The cube after move ${m} is: ${faceStr(fc.move(s, m))}. How many more face turns does that cube need to be solved?`,
      criteria: ["0, it is already solved", "1 turn", "2 turns", "3 turns", "4 turns", "5 or more turns"] };
    return {
      req: { state: `3x3 Rubik's Cube. Each face is 9 stickers read row by row. Solved: ${faceStr(fc.SOLVED)}. Current: ${faceStr(s)}.`, questions },
      read: (a) => Object.fromEntries(ms.map((m) => [m, -a[mk(m)].score])),
    };
  },
  scoreCubie(s, ms) {
    const questions = {};
    for (const m of ms) questions[mk(m)] = { type: "score", instructions: `The cube after move ${m}, piece by piece: ${fc.cubies(fc.move(s, m))}. How many more face turns does that cube need to be solved?`,
      criteria: ["0, it is already solved", "1 turn", "2 turns", "3 turns", "4 turns", "5 or more turns"] };
    return {
      req: { state: `3x3 Rubik's Cube, listed piece by piece. Each entry is slot:colors-now/colors-that-belong-there. Current: ${fc.cubies(s)}`, questions },
      read: (a) => Object.fromEntries(ms.map((m) => [m, -a[mk(m)].score])),
    };
  },
  bool(s, ms) {
    const questions = {};
    for (const m of ms) questions[mk(m)] = { type: "boolean", instructions: `After move ${m} the cube is: ${faceStr(fc.move(s, m))}. Is that cube closer to solved than the current cube?` };
    return {
      req: { state: `3x3 Rubik's Cube. Each face is 9 stickers read row by row. Solved: ${faceStr(fc.SOLVED)}. Current: ${faceStr(s)}.`, questions },
      read: (a) => Object.fromEntries(ms.map((m) => [m, a[mk(m)].probability])),
    };
  },
};

export function rng(seed) { let x = seed >>> 0 || 1; return () => ((x ^= x << 13, x ^= x >>> 17, x ^= x << 5) >>> 0) / 4294967296; }
export async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const j = i++; out[j] = await fn(items[j], j); } })); return out; }

export function log(obj) { appendFileSync(OUT, JSON.stringify({ t: new Date().toISOString(), ...obj }) + "\n"); }
