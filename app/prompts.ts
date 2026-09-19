import { SOLVED_CUBE, applyMove, serializeCube, type Sticker } from "./cube.ts";
import { STAGES, pieceSummary, stagePattern, type Macro, type Stage } from "./method.ts";

// What Jev sees for one method step. Shared by the API route and the benchmark script, so the
// benchmark measures exactly what the page sends. No distance, count, or solver output is included:
// only the cube, the stage goal in words and as a masked pattern, and where each menu step would lead.

// JSON face objects: in the encoding tests Jev ranked moves best from this form.
const faces = (stickers: Sticker[]) => JSON.stringify(serializeCube(stickers));
const patterns = new Map(STAGES.map((stage) => [stage.id, stagePattern(stage)]));

export function stepRequest(stickers: Sticker[], stage: Stage, macros: Macro[], check = 0) {
  const criteria: Record<string, string> = {};
  // Shuffled each call: a judgment model leans toward options listed early.
  const order = [...macros];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (const macro of order) {
    const result = macro.moves.reduce((s, m) => applyMove(s, m), stickers);
    criteria[macro.id] = `${macro.label} [${macro.moves.join(" ")}] -> pieces: ${pieceSummary(result, stage)}. Faces: ${faces(result)}`;
  }
  const pattern = patterns.get(stage.id)!;
  return {
    state: {
      puzzle: "3x3 Rubik's Cube solved with the beginner's layer-by-layer method",
      stage: `${STAGES.indexOf(stage) + 1} of ${STAGES.length}: ${stage.title}`,
      goal: stage.goal,
      ...(stage.tasks?.[check] ? { current_task: stage.tasks[check] } : {}),
      current_pieces: pieceSummary(stickers, stage),
      target_pieces: pieceSummary(SOLVED_CUBE, stage),
      current_faces: serializeCube(stickers),
      goal_pattern: pattern,
      notation: "Faces are U (white center), D (yellow center), F, B, R, L. A slot is named by the faces it touches, like UF or DFR. Each face string lists its 9 stickers row by row as seen from outside that face. In goal_pattern '.' means any color.",
    },
    questions: {
      step: {
        type: "choice" as const,
        instructions: "Choose the step that completes current_task if there is one, otherwise the step after which more pieces match target_pieces (and more stickers match goal_pattern) than now, without moving pieces that already match unless the goal says they may be disturbed.",
        criteria,
      },
    },
  };
}
