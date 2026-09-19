import { experimental_evaluate as evaluate } from "ai";
import { NextResponse } from "next/server";
import { MOVES, applyMove, serializeCube, type Move, type Sticker } from "../../cube";

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

export async function POST(request: Request) {
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    return NextResponse.json(
      { error: "Jev is not connected yet. Add an AI_GATEWAY_API_KEY to run real decisions." },
      { status: 503 },
    );
  }
  try {
    const body = await request.json() as { stickers?: unknown; history?: unknown };
    if (!Array.isArray(body.stickers) || body.stickers.length !== 54 || !body.stickers.every(validSticker)) {
      return NextResponse.json({ error: "Invalid cube state." }, { status: 400 });
    }
    const stickers = body.stickers as Sticker[];
    const history = Array.isArray(body.history) ? body.history.filter((move): move is string => typeof move === "string").slice(-8) : [];
    const criteria: Record<string, string> = {};
    for (const move of MOVES) {
      criteria[MOVE_KEY[move]] = `Apply ${move}. Resulting faces: ${JSON.stringify(serializeCube(applyMove(stickers, move)))}.`;
    }

    const result = await evaluate({
      model: "typesafe-ai/jev",
      state: {
        puzzle: "3x3 Rubik's Cube",
        current_faces: serializeCube(stickers),
        recent_moves: history,
        target_faces: { U: "WWWWWWWWW", D: "YYYYYYYYY", F: "GGGGGGGGG", B: "BBBBBBBBB", R: "RRRRRRRRR", L: "OOOOOOOOO" },
        notation: "Each face string is read row by row as viewed directly from outside that face.",
      },
      questions: {
        nextMove: {
          type: "choice",
          instructions: "Choose the single rotation whose resulting state is most likely to be closest to a fully solved cube. Avoid cycles and immediate reversals unless necessary.",
          criteria,
        },
      },
    });
    const answer = result.answers.nextMove;
    const move = KEY_MOVE[answer.choice];
    if (!move) return NextResponse.json({ error: "Jev returned an unknown move." }, { status: 502 });
    const probabilities = answer.probabilities ?? { [answer.choice]: 1 };
    return NextResponse.json({
      move,
      confidence: probabilities[answer.choice] ?? 0,
      probabilities,
      model: result.response.modelId,
      inputTokens: result.usage.inputTokens ?? 0,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Jev request failed." }, { status: 502 });
  }
}
