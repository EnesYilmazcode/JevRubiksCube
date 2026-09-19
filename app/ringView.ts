import { MOVES, SOLVED_CUBE, applyMove, moveGeometry, type CubeColor, type Move, type Sticker, type Vec3 } from "./cube.ts";

// Ring graph: one family of three concentric circles per axis, centered on the corners of a triangle.
// A face turn slides the 12 stickers of that layer's belt along one circle; every sticker sits where
// the circles of its two in-plane axes cross, so each face shows up as a 3x3 cluster of crossings.

type Point = { x: number; y: number };
export type RingLayoutOptions = {
  /** Which axis family sits at the top, lower-left and lower-right corner. */
  corners: [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2];
  /** +1 means layer +1 gets the larger radius in that family. */
  radiusSign: [1 | -1, 1 | -1, 1 | -1];
  /** For each face axis, which face sign sits on the inner crossing. */
  innerSign: [1 | -1, 1 | -1, 1 | -1];
};
export const DEFAULT_RING_OPTIONS: RingLayoutOptions = { corners: [1, 2, 0], radiusSign: [1, 1, 1], innerSign: [1, 1, 1] };

const SIDE = 1;
const R0 = 1.02;
const DR = 0.15;

export type RingLayout = {
  centers: Point[]; // indexed by axis
  radius: (axis: number, layer: number) => number;
  slot: Map<string, Point>; // sticker location key -> point
  /** Per circle key `${axis}:${layer}`, the angular direction (+1/-1) a positive quarter turn moves stickers. */
  beltSign: Map<string, number>;
  /** Per face key `${axis}:${sign}`, the 2D rotation sign for a positive quarter turn of that face's layer. */
  faceSign: Map<string, number>;
};

export const locKey = (pos: Vec3, normal: Vec3) => `${pos.join(",")}|${normal.join(",")}`;

function intersections(c1: Point, r1: number, c2: Point, r2: number): [Point, Point] {
  const dx = c2.x - c1.x, dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const px = c1.x + a * dx / d, py = c1.y + a * dy / d;
  return [{ x: px - h * dy / d, y: py + h * dx / d }, { x: px + h * dy / d, y: py - h * dx / d }];
}

const angleAbout = (c: Point, p: Point) => Math.atan2(p.y - c.y, p.x - c.x);
const wrapPositive = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

export function buildRingLayout(options: RingLayoutOptions = DEFAULT_RING_OPTIONS): RingLayout {
  const circum = SIDE / Math.sqrt(3);
  const cornerPoints: Point[] = [-90, 150, 30].map((deg) => ({
    x: circum * Math.cos(deg * Math.PI / 180), y: circum * Math.sin(deg * Math.PI / 180),
  }));
  const centers: Point[] = [];
  options.corners.forEach((axis, corner) => { centers[axis] = cornerPoints[corner]; });
  const radius = (axis: number, layer: number) => R0 + options.radiusSign[axis] * layer * DR;

  const slot = new Map<string, Point>();
  for (const sticker of SOLVED_CUBE) {
    const a = sticker.normal.findIndex((v) => v !== 0);
    const sign = sticker.normal[a];
    const [b, c] = [0, 1, 2].filter((axis) => axis !== a);
    const pair = intersections(centers[b], radius(b, sticker.pos[b]), centers[c], radius(c, sticker.pos[c]));
    const dist = pair.map((p) => Math.hypot(p.x, p.y));
    const outer = dist[0] > dist[1] ? pair[0] : pair[1];
    const inner = dist[0] > dist[1] ? pair[1] : pair[0];
    slot.set(locKey(sticker.pos, sticker.normal), sign === options.innerSign[a] ? inner : outer);
  }

  // Derive motion directions from a positive quarter turn of each layer.
  const beltSign = new Map<string, number>();
  const faceSign = new Map<string, number>();
  for (const move of MOVES) {
    if (move.length !== 1) continue;
    const { axis, layer, angle } = moveGeometry(move);
    const after = applyMove(SOLVED_CUBE, move);
    const moveDir = Math.sign(angle);
    let beltVotes = 0, faceVotes = 0;
    for (let i = 0; i < SOLVED_CUBE.length; i += 1) {
      const before = SOLVED_CUBE[i];
      if (before.pos[axis] !== layer) continue;
      const from = slot.get(locKey(before.pos, before.normal))!;
      const to = slot.get(locKey(after[i].pos, after[i].normal))!;
      if (before.normal[axis] === 0) {
        const c = centers[axis];
        const delta = wrapPositive(angleAbout(c, to) - angleAbout(c, from));
        beltVotes += delta < Math.PI ? 1 : -1;
      } else {
        const center = slot.get(locKey([0, 0, 0].map((_, k) => (k === axis ? layer : 0)) as Vec3, before.normal))!;
        if (from === center) continue;
        const delta = wrapPositive(angleAbout(center, to) - angleAbout(center, from));
        faceVotes += delta < Math.PI ? 1 : -1;
      }
    }
    beltSign.set(`${axis}:${layer}`, Math.sign(beltVotes) * moveDir);
    faceSign.set(`${axis}:${layer}`, Math.sign(faceVotes) * moveDir);
  }
  return { centers, radius, slot, beltSign, faceSign };
}

/** For each belt sticker of `move`, the signed angular travel along its circle. Used by tests and drawing. */
export function beltTravel(layout: RingLayout, stickers: Sticker[], move: Move) {
  const { axis, layer, angle } = moveGeometry(move);
  const after = applyMove(stickers, move);
  const dir = layout.beltSign.get(`${axis}:${layer}`)! * Math.sign(angle);
  const c = layout.centers[axis];
  return stickers.flatMap((s, i) => {
    if (s.pos[axis] !== layer || s.normal[axis] !== 0) return [];
    const from = angleAbout(c, layout.slot.get(locKey(s.pos, s.normal))!);
    const to = angleAbout(c, layout.slot.get(locKey(after[i].pos, after[i].normal))!);
    const travel = dir > 0 ? wrapPositive(to - from) : -wrapPositive(from - to);
    return [{ id: s.id, from, travel }];
  });
}

export const RING_COLORS: Record<CubeColor, string> = {
  white: "#f6f5f1", yellow: "#f4b63b", green: "#2f7d4c",
  blue: "#1f4c9a", red: "#d93a30", orange: "#ee872e",
};

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export type RingTurn = { move: Move; t: number } | null;

export function drawRings(
  ctx: CanvasRenderingContext2D, width: number, height: number,
  layout: RingLayout, stickers: Sticker[], turn: RingTurn, zoom = 0.7,
) {
  ctx.clearRect(0, 0, width, height);
  // bounding box of the drawing is about 3.4 wide by 3.3 tall, centered 0.15 above the origin
  const scale = Math.min(width / 3.55, height / 3.45) * zoom;
  const ox = width / 2, oy = height / 2 + scale * 0.15;
  const P = (p: Point) => ({ x: ox + p.x * scale, y: oy + p.y * scale });

  const geo = turn ? moveGeometry(turn.move) : null;
  const t = turn ? easeInOut(Math.min(1, Math.max(0, turn.t))) : 0;

  // circles
  ctx.lineCap = "round";
  for (let axis = 0; axis < 3; axis += 1) {
    const c = P(layout.centers[axis]);
    for (const layer of [-1, 0, 1]) {
      const active = geo && geo.axis === axis && geo.layer === layer;
      ctx.beginPath();
      ctx.arc(c.x, c.y, layout.radius(axis, layer) * scale, 0, Math.PI * 2);
      ctx.strokeStyle = active ? "#8d877d" : "#b8b2a8";
      ctx.lineWidth = Math.max(1.6, scale * (active ? 0.017 : 0.013));
      ctx.stroke();
    }
  }

  const dotR = scale * 0.062;
  type Dot = { x: number; y: number; color: string; moving: boolean };
  const dots: Dot[] = [];
  const trails: { cx: number; cy: number; r: number; from: number; to: number; color: string }[] = [];

  let travelById: Map<string, { from: number; travel: number }> | null = null;
  if (turn && geo) {
    travelById = new Map(beltTravel(layout, stickers, turn.move).map((b) => [b.id, b]));
  }
  const after = turn ? applyMove(stickers, turn.move) : null;

  stickers.forEach((s, i) => {
    const color = RING_COLORS[s.color];
    const home = layout.slot.get(locKey(s.pos, s.normal))!;
    if (!turn || !geo || !after || s.pos[geo.axis] !== geo.layer) {
      dots.push({ ...P(home), color, moving: false });
      return;
    }
    const belt = travelById!.get(s.id);
    if (belt) {
      const c = layout.centers[geo.axis];
      const r = layout.radius(geo.axis, geo.layer);
      const a = belt.from + belt.travel * t;
      const pt = P({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
      dots.push({ ...pt, color, moving: true });
      const pc = P(c);
      trails.push({ cx: pc.x, cy: pc.y, r: r * scale, from: belt.from + belt.travel * Math.max(0, t - 0.45), to: a, color });
      return;
    }
    // sticker on the turning face itself: spin around the face center
    const centerLoc = [0, 0, 0].map((_, k) => (k === geo.axis ? geo.layer : 0)) as Vec3;
    const center = layout.slot.get(locKey(centerLoc, s.normal))!;
    const to = layout.slot.get(locKey(after[i].pos, after[i].normal))!;
    if (to === home) { dots.push({ ...P(home), color, moving: false }); return; }
    const dir = layout.faceSign.get(`${geo.axis}:${geo.layer}`)! * Math.sign(geo.angle);
    const a0 = angleAbout(center, home), a1 = angleAbout(center, to);
    const sweep = dir > 0 ? wrapPositive(a1 - a0) : -wrapPositive(a0 - a1);
    const r0 = Math.hypot(home.x - center.x, home.y - center.y);
    const r1 = Math.hypot(to.x - center.x, to.y - center.y);
    const a = a0 + sweep * t, r = r0 + (r1 - r0) * t;
    dots.push({ ...P({ x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) }), color, moving: true });
  });

  // trails behind the sliding belt stickers
  for (const trail of trails) {
    const steps = 14;
    const span = trail.to - trail.from;
    if (Math.abs(span) < 1e-3) continue;
    for (let k = 0; k < steps; k += 1) {
      const a0 = trail.from + span * (k / steps), a1 = trail.from + span * ((k + 1) / steps);
      ctx.beginPath();
      ctx.arc(trail.cx, trail.cy, trail.r, Math.min(a0, a1), Math.max(a0, a1));
      ctx.strokeStyle = trail.color;
      ctx.globalAlpha = 0.55 * ((k + 1) / steps) ** 1.6;
      ctx.lineWidth = dotR * 0.9;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // dots: static first, moving on top
  dots.sort((a, b) => Number(a.moving) - Number(b.moving));
  for (const d of dots) {
    ctx.beginPath();
    ctx.arc(d.x, d.y, dotR, 0, Math.PI * 2);
    ctx.fillStyle = d.color;
    ctx.fill();
    ctx.lineWidth = Math.max(1.4, dotR * 0.24);
    ctx.strokeStyle = "#2b2a28";
    ctx.stroke();
  }
}
