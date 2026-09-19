import { MOVES, applyMove, isSolved, serializeCube, type Move, type Sticker } from "./cube.ts";

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
