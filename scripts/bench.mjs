// Closed-loop Jev benchmark: scramble N moves, let Jev pick one move per call until solved or out of steps.
import { experimental_evaluate as evaluate } from "ai";
import { appendFileSync } from "node:fs";
import { MOVES, SOLVED_CUBE, applyMove, applyMoves, isSolved, serializeCube } from "../app/cube.ts";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const depth = Number(args.depth ?? 1);
const trials = Number(args.trials ?? 5);
const strategy = args.strategy ?? "baseline";
const seed0 = Number(args.seed ?? 1);
const maxSteps = Number(args.steps ?? Math.max(6, depth * 3));
const concurrency = Number(args.conc ?? 5);
const out = args.out ?? "results/bench-log.jsonl";

const TARGET = serializeCube(SOLVED_CUBE);
const key = (m) => (m.endsWith("'") ? `${m[0]}_prime` : m);
const unkey = Object.fromEntries(MOVES.map((m) => [key(m), m]));
const stateKey = (s) => Object.values(serializeCube(s)).join("");

function rng(seed) { let x = seed >>> 0 || 1; return () => ((x ^= x << 13, x ^= x >>> 17, x ^= x << 5) >>> 0) / 4294967296; }
function scrambleFor(seed, n) {
  const r = rng(seed * 7919 + n * 104729); const out = [];
  while (out.length < n) {
    const m = MOVES[Math.floor(r() * MOVES.length)];
    const last = out.at(-1);
    // no same face twice, and no opposite-face commuting pair that could collapse (keep true depth n)
    if (last && last[0] === m[0]) continue;
    out.push(m);
  }
  return out;
}

// The SDK rejects answers whose rounded probabilities tie or near-tie the chosen option; take the argmax ourselves.
async function ask(req, attempt = 0) {
  try { const r = await evaluate({ model: "typesafe-ai/jev", ...req }); return { answer: r.answers.nextMove, tokens: r.usage.inputTokens ?? 0 }; }
  catch (e) {
    const a = e?.data?.nextMove;
    if (!a?.probabilities) {
      if (attempt < 4) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); return ask(req, attempt + 1); }
      throw e;
    }
    const choice = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1])[0][0];
    return { answer: { ...a, choice }, tokens: 0, recovered: true };
  }
}
const faceStr = (s) => Object.entries(serializeCube(s)).map(([f, v]) => `${f}:${v}`).join(" ");
// Legal-move filter shared by the no-revisit strategies: never turn the face just turned, never return to a seen state.
function allowedMoves(stickers, history, visited) {
  return MOVES.filter((m) => m[0] !== history.at(-1)?.[0] && !visited.includes(stateKey(applyMove(stickers, m))));
}
const STRATEGIES = {
  baseline(stickers, history) {
    const criteria = {};
    for (const move of MOVES) criteria[key(move)] = `Apply ${move}. Resulting faces: ${JSON.stringify(serializeCube(applyMove(stickers, move)))}.`;
    return {
      state: {
        puzzle: "3x3 Rubik's Cube", current_faces: serializeCube(stickers), recent_moves: history.slice(-8), target_faces: TARGET,
        notation: "Each face string is read row by row as viewed directly from outside that face.",
      },
      questions: { nextMove: { type: "choice", instructions: "Choose the single rotation whose resulting state is most likely to be closest to a fully solved cube. Avoid cycles and immediate reversals unless necessary.", criteria } },
    };
  },
  tabu(stickers, history, visited) {
    const req = STRATEGIES.baseline(stickers, history);
    const allowed = new Set(allowedMoves(stickers, history, visited).map(key));
    req.questions.nextMove.criteria = Object.fromEntries(Object.entries(req.questions.nextMove.criteria).filter(([k]) => allowed.has(k)));
    return req;
  },
  compact(stickers, history, visited) {
    const criteria = {};
    for (const m of allowedMoves(stickers, history, visited)) criteria[key(m)] = `After ${m}: ${faceStr(applyMove(stickers, m))}`;
    return {
      state: `3x3 Rubik's Cube. Current: ${faceStr(stickers)}. Solved means every face is one color: ${faceStr(SOLVED_CUBE)}. Moves so far: ${history.join(" ") || "none"}.`,
      questions: { nextMove: { type: "choice", instructions: "Which move leaves the cube the fewest moves away from solved?", criteria } },
    };
  },
};

async function trial(i) {
  const seed = seed0 + i;
  const scramble = scrambleFor(seed, depth);
  let stickers = applyMoves(SOLVED_CUBE, scramble);
  const history = []; const visited = [stateKey(stickers)]; const calls = [];
  let tokens = 0;
  for (let step = 0; step < maxSteps && !isSolved(stickers); step += 1) {
    const req = STRATEGIES[strategy](stickers, history, visited);
    const res = await ask(req);
    const a = res.answer; const move = unkey[a.choice];
    tokens += res.tokens;
    stickers = applyMove(stickers, move); history.push(move);
    const k = stateKey(stickers); const revisit = visited.includes(k); visited.push(k);
    calls.push({ move, p: a.probabilities?.[a.choice], revisit });
  }
  const r = { strategy, depth, seed, scramble: scramble.join(" "), solved: isSolved(stickers), steps: history.length, moves: history.join(" "), revisits: calls.filter((c) => c.revisit).length, tokens };
  appendFileSync(out, JSON.stringify(r) + "\n");
  return r;
}

function policyReq(stickers, path, allowed) {
  const criteria = {};
  for (const m of allowed) criteria[key(m)] = `Apply ${m}. Resulting faces: ${JSON.stringify(serializeCube(applyMove(stickers, m)))}.`;
  return {
    state: { puzzle: "3x3 Rubik's Cube", current_faces: serializeCube(stickers), target_faces: TARGET,
      notation: "Each face string is read row by row as viewed directly from outside that face." },
    questions: { nextMove: { type: "choice", instructions: "Choose the single rotation whose resulting state is most likely to be closest to a fully solved cube.", criteria } },
  };
}
async function beamTrial(i) {
  const W = Number(args.width ?? 4);
  const seed = seed0 + i; const scramble = scrambleFor(seed, depth);
  const start = applyMoves(SOLVED_CUBE, scramble);
  let beam = [{ stickers: start, path: [], logp: 0 }];
  const seen = new Set([stateKey(start)]);
  let calls = 0, tokens = 0, found = null;
  for (let level = 0; level < maxSteps && !found; level += 1) {
    const expanded = await Promise.all(beam.map(async (node) => {
      const allowed = MOVES.filter((m) => m[0] !== node.path.at(-1)?.[0]);
      const { answer, tokens: t } = await ask(policyReq(node.stickers, node.path, allowed));
      calls += 1; tokens += t;
      return allowed.map((m) => ({ stickers: applyMove(node.stickers, m), path: [...node.path, m],
        logp: node.logp + Math.log(Math.max(1e-3, answer.probabilities?.[key(m)] ?? (answer.choice === key(m) ? 1 : 0))) }));
    }));
    const children = expanded.flat().sort((a, b) => b.logp - a.logp);
    found = children.find((c) => isSolved(c.stickers)) ?? null;
    beam = [];
    for (const c of children) { const k = stateKey(c.stickers); if (seen.has(k)) continue; seen.add(k); beam.push(c); if (beam.length >= W) break; }
  }
  const r = { strategy: `beam${W}`, depth, seed, scramble: scramble.join(" "), solved: !!found, steps: calls, moves: found ? found.path.join(" ") : "", revisits: 0, tokens };
  appendFileSync(out, JSON.stringify(r) + "\n");
  return r;
}

const results = []; let next = 0;
await Promise.all(Array.from({ length: Math.min(concurrency, trials) }, async () => {
  while (next < trials) { const i = next++; const r = strategy === "beam" ? await beamTrial(i) : await trial(i); results.push(r);
    console.log(`${r.solved ? "SOLVED" : "fail  "} d=${depth} seed=${r.seed} scr=[${r.scramble}] -> [${r.moves}] revisits=${r.revisits}`); }
}));
const solved = results.filter((r) => r.solved).length;
const tok = results.reduce((s, r) => s + r.tokens, 0);
console.log(`\n${strategy} depth ${depth}: ${solved}/${trials} solved, ${results.reduce((s, r) => s + r.steps, 0)} calls, ${tok} input tokens, ~$${(tok * 0.042e-6).toFixed(4)}`);
