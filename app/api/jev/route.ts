import { experimental_evaluate as evaluate } from "ai";
import { NextResponse } from "next/server";
import { MOVES, applyMove, serializeCube, type Move, type Sticker } from "../../cube";
import { macroById, stageById, type Macro } from "../../method";
import { stepRequest } from "../../prompts";

export const runtime = "edge";

const MOVE_KEY = Object.fromEntries(MOVES.map((move) => [
  move, move.endsWith("'") ? `${move[0]}_prime` : move,
])) as Record<Move, string>;
const KEY_MOVE = Object.fromEntries(Object.entries(MOVE_KEY).map(([move, key]) => [key, move])) as Record<string, Move>;

function validSticker(sticker: unknown): sticker is Sticker {
  if (!sticker || typeof sticker !== "object") return false;
  const value = sticker as Partial<Sticker>;
  const validAxis = (axis: unknown) => Array.isArray(axis) && axis.length === 3 && axis.every((item) => [-1, 0, 1].includes(Number(item)));
  return typeof value.id === "string" && typeof value.color === "string" && validAxis(value.pos) && validAxis(value.normal);
}

type Answer = { choice: string; probabilities?: Record<string, number> };

// Jev's service answers 503 "temporarily unavailable" in bursts, usually within 200 ms. Those come back
// fast and at random, so retry quickly with jitter instead of backing off for seconds.
const unavailable = (error: unknown) => (error as { statusCode?: number })?.statusCode === 503 || /temporarily unavailable/i.test(String(error));
async function withRetry<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try { return await call(); } catch (error) {
      if (!unavailable(error) || attempt >= 10) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 + Math.random() * 250 + attempt * 150));
    }
  }
}

// The SDK rejects an answer when rounded probabilities near-tie and the provider's pick is not the
// exact maximum. That used to kill the auto-run; the distribution is still valid, so take its argmax.
async function rankMoves(stickers: Sticker[], moves: Move[]): Promise<{ answer: Answer; tokens: number }> {
  const criteria: Record<string, string> = {};
  for (const move of moves) {
    criteria[MOVE_KEY[move]] = `Apply ${move}. Resulting faces: ${JSON.stringify(serializeCube(applyMove(stickers, move)))}.`;
  }
  const request = {
    model: "typesafe-ai/jev",
    state: {
      puzzle: "3x3 Rubik's Cube",
      current_faces: serializeCube(stickers),
      target_faces: { U: "WWWWWWWWW", D: "YYYYYYYYY", F: "GGGGGGGGG", B: "BBBBBBBBB", R: "RRRRRRRRR", L: "OOOOOOOOO" },
      notation: "Each face string is read row by row as viewed directly from outside that face.",
    },
    questions: {
      nextMove: {
        type: "choice" as const,
        instructions: "Choose the single rotation whose resulting state is most likely to be closest to a fully solved cube.",
        criteria,
      },
    },
  };
  try {
    const result = await withRetry(() => evaluate({ ...request, maxRetries: 0, abortSignal: AbortSignal.timeout(12_000) }));
    return { answer: result.answers.nextMove, tokens: result.usage.inputTokens ?? 0 };
  } catch (error) {
    const answer = (error as { data?: { nextMove?: Answer } })?.data?.nextMove;
    if (!answer?.probabilities) throw error;
    const choice = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1])[0][0];
    return { answer: { ...answer, choice }, tokens: 0 };
  }
}

// Method mode: Jev ranks one stage's menu of standard steps (see app/method.ts and app/prompts.ts).
async function rankSteps(stickers: Sticker[], stageId: string, ids: string[], check: number) {
  const stage = stageById(stageId);
  if (!stage) return NextResponse.json({ error: "Unknown stage." }, { status: 400 });
  const macros = ids.map((id) => macroById(stage, id)).filter((m): m is Macro => !!m);
  if (macros.length < 2 || macros.length > 255) return NextResponse.json({ error: "Bad step list." }, { status: 400 });
  const req = stepRequest(stickers, stage, macros, check);
  let probabilities: Record<string, number>, tokens = 0;
  try {
    const result = await withRetry(() => evaluate({ model: "typesafe-ai/jev", ...req, maxRetries: 0, abortSignal: AbortSignal.timeout(20_000) }));
    probabilities = result.answers.step.probabilities ?? { [result.answers.step.choice]: 1 };
    tokens = result.usage.inputTokens ?? 0;
  } catch (error) {
    const fallback = (error as { data?: { step?: Answer } })?.data?.step?.probabilities;
    if (!fallback) throw error;
    probabilities = fallback;
  }
  return NextResponse.json({ probabilities, inputTokens: tokens });
}

export async function POST(request: Request) {
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    return NextResponse.json(
      { error: "Jev is not connected yet. Add an AI_GATEWAY_API_KEY to run real decisions." },
      { status: 503 },
    );
  }
  try {
    const body = await request.json() as { stickers?: unknown; moves?: unknown; stage?: unknown; steps?: unknown; check?: unknown };
    if (!Array.isArray(body.stickers) || body.stickers.length !== 54 || !body.stickers.every(validSticker)) {
      return NextResponse.json({ error: "Invalid cube state." }, { status: 400 });
    }
    if (typeof body.stage === "string" && Array.isArray(body.steps)) {
      const check = Number.isInteger(body.check) ? Number(body.check) : 0;
      return await rankSteps(body.stickers as Sticker[], body.stage, body.steps.filter((id): id is string => typeof id === "string"), check);
    }
    const requested = Array.isArray(body.moves) ? body.moves.filter((move): move is Move => MOVES.includes(move as Move)) : [];
    const moves = requested.length >= 2 ? [...new Set(requested)] : [...MOVES];
    const { answer, tokens } = await rankMoves(body.stickers as Sticker[], moves);
    const move = KEY_MOVE[answer.choice];
    if (!move) return NextResponse.json({ error: "Jev returned an unknown move." }, { status: 502 });
    const probabilities = Object.fromEntries(moves.map((m) => [m, answer.probabilities?.[MOVE_KEY[m]] ?? (m === move ? 1 : 0)]));
    return NextResponse.json({ move, confidence: probabilities[move], probabilities, model: "typesafe-ai/jev", inputTokens: tokens });
  } catch (error) {
    const status = (error as { statusCode?: number })?.statusCode === 503 || /temporarily unavailable/i.test(String(error)) ? 503 : 502;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Jev request failed." }, { status });
  }
}
