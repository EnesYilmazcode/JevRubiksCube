export type Vec3 = [number, number, number];
export type Face = "U" | "D" | "F" | "B" | "R" | "L";
export type CubeColor = "white" | "yellow" | "green" | "blue" | "red" | "orange";
export type Sticker = { id: string; color: CubeColor; pos: Vec3; normal: Vec3 };

export const FACE_COLORS: Record<Face, CubeColor> = {
  U: "white", D: "yellow", F: "green", B: "blue", R: "red", L: "orange",
};
export const COLOR_HEX: Record<CubeColor, string> = {
  white: "#f4f1e8", yellow: "#ffd93d", green: "#25a96b",
  blue: "#2f72e2", red: "#ef4b45", orange: "#ff8a2a",
};
export const FACES: Face[] = ["U", "R", "F", "D", "L", "B"];
export const MOVES = [
  "U", "U'", "U2", "D", "D'", "D2", "R", "R'", "R2",
  "L", "L'", "L2", "F", "F'", "F2", "B", "B'", "B2",
] as const;
export type Move = (typeof MOVES)[number];

function facePosition(face: Face, row: number, col: number): { pos: Vec3; normal: Vec3 } {
  const x = col - 1;
  const y = 1 - row;
  switch (face) {
    case "F": return { pos: [x, y, 1], normal: [0, 0, 1] };
    case "B": return { pos: [-x, y, -1], normal: [0, 0, -1] };
    case "R": return { pos: [1, y, -x], normal: [1, 0, 0] };
    case "L": return { pos: [-1, y, x], normal: [-1, 0, 0] };
    case "U": return { pos: [x, 1, row - 1], normal: [0, 1, 0] };
    case "D": return { pos: [x, -1, 1 - row], normal: [0, -1, 0] };
  }
}

export function createSolvedCube(): Sticker[] {
  return FACES.flatMap((face) => Array.from({ length: 9 }, (_, index) => ({
    id: `${face}${index}`,
    color: FACE_COLORS[face],
    ...facePosition(face, Math.floor(index / 3), index % 3),
  })));
}
export const SOLVED_CUBE = createSolvedCube();

function rotateVector([x, y, z]: Vec3, axis: 0 | 1 | 2, quarter: 1 | -1): Vec3 {
  if (axis === 0) return quarter === 1 ? [x, -z, y] : [x, z, -y];
  if (axis === 1) return quarter === 1 ? [z, y, -x] : [-z, y, x];
  return quarter === 1 ? [-y, x, z] : [y, -x, z];
}

const MOVE_SPEC: Record<string, { axis: 0 | 1 | 2; layer: 1 | -1; quarter: 1 | -1 }> = {
  R: { axis: 0, layer: 1, quarter: -1 }, L: { axis: 0, layer: -1, quarter: 1 },
  U: { axis: 1, layer: 1, quarter: -1 }, D: { axis: 1, layer: -1, quarter: 1 },
  F: { axis: 2, layer: 1, quarter: -1 }, B: { axis: 2, layer: -1, quarter: 1 },
};

export function applyMove(stickers: Sticker[], move: Move): Sticker[] {
  const spec = MOVE_SPEC[move[0]];
  const turns = move.endsWith("2") ? 2 : 1;
  const direction = move.endsWith("'") ? (spec.quarter * -1) as 1 | -1 : spec.quarter;
  let next = stickers.map((sticker) => ({
    ...sticker, pos: [...sticker.pos] as Vec3, normal: [...sticker.normal] as Vec3,
  }));
  for (let turn = 0; turn < turns; turn += 1) {
    next = next.map((sticker) => sticker.pos[spec.axis] !== spec.layer ? sticker : ({
      ...sticker,
      pos: rotateVector(sticker.pos, spec.axis, direction),
      normal: rotateVector(sticker.normal, spec.axis, direction),
    }));
  }
  return next;
}

export function faceForNormal([x, y, z]: Vec3): Face {
  if (y === 1) return "U";
  if (y === -1) return "D";
  if (z === 1) return "F";
  if (z === -1) return "B";
  return x === 1 ? "R" : "L";
}

export function faceCell(sticker: Sticker): { face: Face; row: number; col: number } {
  const face = faceForNormal(sticker.normal);
  const [x, y, z] = sticker.pos;
  switch (face) {
    case "F": return { face, row: 1 - y, col: x + 1 };
    case "B": return { face, row: 1 - y, col: 1 - x };
    case "R": return { face, row: 1 - y, col: 1 - z };
    case "L": return { face, row: 1 - y, col: z + 1 };
    case "U": return { face, row: z + 1, col: x + 1 };
    case "D": return { face, row: 1 - z, col: x + 1 };
  }
}

export function faceGrid(stickers: Sticker[], face: Face): Sticker[] {
  const result = Array<Sticker>(9);
  for (const sticker of stickers) {
    const cell = faceCell(sticker);
    if (cell.face === face) result[cell.row * 3 + cell.col] = sticker;
  }
  return result;
}

export function serializeCube(stickers: Sticker[]): Record<Face, string> {
  const letter: Record<CubeColor, string> = {
    white: "W", yellow: "Y", green: "G", blue: "B", red: "R", orange: "O",
  };
  return Object.fromEntries(FACES.map((face) => [
    face, faceGrid(stickers, face).map((sticker) => letter[sticker.color]).join(""),
  ])) as Record<Face, string>;
}

export function solvedStickerCount(stickers: Sticker[]): number {
  return FACES.reduce((total, face) => {
    const grid = faceGrid(stickers, face);
    return total + grid.filter((sticker) => sticker.color === grid[4].color).length;
  }, 0);
}
export function isSolved(stickers: Sticker[]): boolean { return solvedStickerCount(stickers) === 54; }

export function makeScramble(length: number): Move[] {
  const result: Move[] = [];
  while (result.length < length) {
    const candidate = MOVES[Math.floor(Math.random() * MOVES.length)];
    if (result.at(-1)?.[0] !== candidate[0]) result.push(candidate);
  }
  return result;
}
export function applyMoves(stickers: Sticker[], moves: readonly Move[]): Sticker[] {
  return moves.reduce((state, move) => applyMove(state, move), stickers);
}
