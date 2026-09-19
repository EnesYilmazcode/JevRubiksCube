import { MOVES, applyMove, isSolved, serializeCube, type Move, type Sticker } from "./cube.ts";
import { STAGES, type Macro, type Stage } from "./method.ts";

// Jev-guided beam search. Jev ranks the legal moves from each kept position; the search keeps the
// `width` best lines by summed log-probability and stops when one of the kept positions is solved.
// Jev gets no distance heuristic; the only rules added here are "don't turn the same face twice in a
// row" and "don't revisit a position", which is what stopped the old U U' U U' loop.

export type Ranking = { probabilities: Partial<Record<Move, number>>; tokens: number };
export type AskJev = (stickers: Sticker[], moves: Move[]) => Promise<Ranking>;
export type SolveStep = { move: Move; probability: number };
export type SolveResult = { path: SolveStep[] | null; calls: number; tokens: number };

const stateKey = (stickers: Sticker[]) => Object.values(serializeCube(stickers)).join("");

export async function solveWithJev(
  start: Sticker[], ask: AskJev,
  { width = 4, maxDepth = 8, onProgress, signal }: {
    width?: number; maxDepth?: number; signal?: AbortSignal;
    onProgress?: (progress: { calls: number; depth: number }) => void;
  } = {},
): Promise<SolveResult> {
  type Node = { stickers: Sticker[]; path: SolveStep[]; score: number };
  let beam: Node[] = [{ stickers: start, path: [], score: 0 }];
  const seen = new Set([stateKey(start)]);
  let calls = 0, tokens = 0;
  if (isSolved(start)) return { path: [], calls, tokens };

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const expanded = await Promise.all(beam.map(async (node) => {
      const last = node.path.at(-1)?.move;
      const moves = MOVES.filter((move) => move[0] !== last?.[0]);
      const ranking = await ask(node.stickers, moves);
      calls += 1; tokens += ranking.tokens;
      onProgress?.({ calls, depth: depth + 1 });
      return moves.map((move) => {
        const probability = ranking.probabilities[move] ?? 0;
        return {
          stickers: applyMove(node.stickers, move),
          path: [...node.path, { move, probability }],
          score: node.score + Math.log(Math.max(1e-3, probability)),
        };
      });
    }));
    if (signal?.aborted) break;
    const next: Node[] = [];
    for (const child of expanded.flat().sort((a, b) => b.score - a.score)) {
      const key = stateKey(child.stickers);
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(child);
      if (next.length >= width) break;
    }
    const solved = next.find((node) => isSolved(node.stickers));
    if (solved) return { path: solved.path, calls, tokens };
    beam = next;
  }
  return { path: null, calls, tokens };
}

/** Random scramble with no two consecutive turns on the same axis, so it cannot partly cancel itself. */
export function demoScramble(length: number, random = Math.random): Move[] {
  const axisOf = (move: Move) => "UDRLFB".indexOf(move[0]) >> 1;
  const result: Move[] = [];
  while (result.length < length) {
    const move = MOVES[Math.floor(random() * MOVES.length)];
    const last = result.at(-1);
    if (last && axisOf(last) === axisOf(move)) continue;
    result.push(move);
  }
  return result;
}

// ---------- Jev running the beginner's method ----------


export type StepRanking = { probabilities: Record<string, number>; tokens: number };
export type AskStep = (stickers: Sticker[], stage: Stage, macros: Macro[], check: number) => Promise<StepRanking>;
export type MethodStep = { stage: Stage; macro: Macro; probability: number; topChoice: boolean };

/**
 * Beam search over one stage's menu until the next sub-goal holds. Jev ranks the menu from each kept
 * position; the check only looks at positions Jev chose to keep.
 */
async function reachSubgoal(
  start: Sticker[], stage: Stage, checkIndex: number, ask: AskStep,
  width: number, maxDepth: number, count: (tokens: number) => void,
): Promise<{ steps: MethodStep[]; state: Sticker[] } | null> {
  type Node = { stickers: Sticker[]; steps: MethodStep[]; score: number };
  const check = stage.checks[checkIndex];
  let beam: Node[] = [{ stickers: start, steps: [], score: 0 }];
  const seen = new Set([stateKey(start)]);
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const expanded = await Promise.all(beam.map(async (node) => {
      const options: { macro: Macro; stickers: Sticker[] }[] = [];
      const local = new Set<string>();
      for (const macro of stage.macros) {
        const stickers = macro.moves.reduce((s, m) => applyMove(s, m), node.stickers);
        const key = stateKey(stickers);
        if (seen.has(key) || local.has(key)) continue;
        local.add(key);
        options.push({ macro, stickers });
      }
      if (!options.length) return [];
      const ranking = await ask(node.stickers, stage, options.map((o) => o.macro), checkIndex);
      count(ranking.tokens);
      const top = options.reduce((best, o) => ((ranking.probabilities[o.macro.id] ?? 0) > (ranking.probabilities[best.macro.id] ?? 0) ? o : best), options[0]);
      return options.map((o) => {
        const probability = ranking.probabilities[o.macro.id] ?? 0;
        return {
          stickers: o.stickers,
          steps: [...node.steps, { stage, macro: o.macro, probability, topChoice: o === top }],
          score: node.score + Math.log(Math.max(1e-4, probability)),
        };
      });
    }));
    const next: Node[] = [];
    for (const child of expanded.flat().sort((a, b) => b.score - a.score)) {
      const key = stateKey(child.stickers);
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(child);
      if (next.length >= width) break;
    }
    const done = next.find((node) => check(node.stickers));
    if (done) return { steps: done.steps, state: done.stickers };
    if (!next.length) return null;
    beam = next;
  }
  return null;
}

export type MethodResult = { steps: MethodStep[]; solved: boolean; calls: number; tokens: number; failedStage?: string };

export async function solveWithMethod(
  start: Sticker[], ask: AskStep,
  { width = 3, maxDepth = 4, onSteps, onProgress, stages = STAGES }: {
    width?: number; maxDepth?: number; stages?: Stage[];
    onSteps?: (steps: MethodStep[], state: Sticker[]) => void;
    onProgress?: (progress: { calls: number; stage: Stage }) => void;
  } = {},
): Promise<MethodResult> {
  let state = start, calls = 0, tokens = 0;
  const steps: MethodStep[] = [];
  for (const stage of stages) {
    for (let checkIndex = 0; checkIndex < stage.checks.length; checkIndex += 1) {
      if (stage.checks[checkIndex](state)) continue;
      const count = (t: number) => { calls += 1; tokens += t; onProgress?.({ calls, stage }); };
      // Follow Jev's top pick alone first (one call per step); widen only if that line misses.
      const found = await reachSubgoal(state, stage, checkIndex, ask, 1, 3, count)
        ?? await reachSubgoal(state, stage, checkIndex, ask, width, maxDepth, count)
        ?? await reachSubgoal(state, stage, checkIndex, ask, width * 3, maxDepth, count);
      if (!found) return { steps, solved: false, calls, tokens, failedStage: stage.id };
      steps.push(...found.steps);
      state = found.state;
      onSteps?.(found.steps, state);
    }
  }
  return { steps, solved: stages === STAGES ? isSolved(state) : stages.every((st) => st.checks.every((c) => c(state))), calls, tokens };
}
