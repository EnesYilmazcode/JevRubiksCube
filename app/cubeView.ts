import { moveGeometry, type CubeColor, type Move, type Sticker } from "./cube.ts";

// Canvas cube: 27 cubies drawn with a small perspective camera. During a turn the cube splits into two
// convex blocks (the turning layer and the rest); each block's front faces never overlap, so drawing the
// block farther from the camera first is an exact painter's order.

export type CubeView = { yaw: number; pitch: number };
export type CubeTurn = { move: Move; t: number } | null;

export const CUBE_COLORS: Record<CubeColor, string> = {
  white: "#fbfbf8", yellow: "#f4b63b", green: "#2f7d4c",
  blue: "#1f4c9a", red: "#d93a30", orange: "#ee872e",
};
const BODY = "#e9e6df";
const BODY_EDGE = "#c9c5bc";
const CORE = "#cfcbc2";

type V = [number, number, number];
const DIRS: V[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const CAMERA_DISTANCE = 12;
const LIGHT: V = normalize([-0.45, 0.75, 0.55]);

function normalize(v: V): V { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; }
function rotate([x, y, z]: V, axis: number, angle: number): V {
  const c = Math.cos(angle), s = Math.sin(angle);
  if (axis === 0) return [x, y * c - z * s, y * s + z * c];
  if (axis === 1) return [x * c + z * s, y, -x * s + z * c];
  return [x * c - y * s, x * s + y * c, z];
}
const toCamera = (v: V, view: CubeView) => rotate(rotate(v, 1, view.yaw), 0, view.pitch);
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(Math.min(255, c * k));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// Rounded square in face-local (u, v) coordinates, as a polygon.
function roundedSquare(half: number, radius: number): [number, number][] {
  const pts: [number, number][] = [];
  const corners: [number, number, number][] = [[half - radius, half - radius, 0], [-half + radius, half - radius, 90], [-half + radius, -half + radius, 180], [half - radius, -half + radius, 270]];
  for (const [cx, cy, start] of corners) {
    for (let k = 0; k <= 5; k += 1) {
      const a = (start + k * 18) * Math.PI / 180;
      pts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
    }
  }
  return pts;
}
const STICKER_SHAPE = roundedSquare(0.425, 0.11);
const BODY_SHAPE: [number, number][] = [[0.5, 0.5], [-0.5, 0.5], [-0.5, -0.5], [0.5, -0.5]];

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function drawCube(
  ctx: CanvasRenderingContext2D, width: number, height: number,
  stickers: Sticker[], view: CubeView, turn: CubeTurn, zoom = 1,
) {
  ctx.clearRect(0, 0, width, height);
  const scale = Math.min(width * 0.9, height) * 0.165 * zoom;
  const focal = scale * CAMERA_DISTANCE;
  const cx = width / 2, cy = height / 2 - scale * 0.15;
  const project = (p: V): [number, number] => {
    const k = focal / (CAMERA_DISTANCE - p[2]);
    return [cx + p[0] * k, cy - p[1] * k];
  };

  // soft floor shadow
  const shadowY = cy + scale * 2.2;
  const grad = ctx.createRadialGradient(cx, shadowY, 0, cx, shadowY, scale * 2.1);
  grad.addColorStop(0, "rgba(60,50,35,0.16)");
  grad.addColorStop(1, "rgba(60,50,35,0)");
  ctx.save();
  ctx.translate(cx, shadowY); ctx.scale(1, 0.22); ctx.translate(-cx, -shadowY);
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(cx, shadowY, scale * 2.1, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  const colorAt = new Map<string, CubeColor>();
  for (const s of stickers) colorAt.set(`${s.pos.join(",")}|${s.normal.join(",")}`, s.color);

  const geo = turn ? moveGeometry(turn.move) : null;
  const angle = geo && turn ? geo.angle * easeInOut(Math.min(1, Math.max(0, turn.t))) : 0;
  const inMoving = (p: V) => !!geo && p[geo.axis] === geo.layer;

  type Face = { center: V; normal: V; u: V; v: V; color: CubeColor | null; moving: boolean };
  const faces: Face[] = [];
  for (let x = -1; x <= 1; x += 1) for (let y = -1; y <= 1; y += 1) for (let z = -1; z <= 1; z += 1) {
    const p: V = [x, y, z];
    const moving = inMoving(p);
    for (const d of DIRS) {
      const n: V = [x + d[0], y + d[1], z + d[2]];
      const outside = Math.max(...n.map(Math.abs)) > 1;
      if (!outside && inMoving(n) === moving) continue; // hidden face inside the same block
      const a = d.findIndex((c) => c !== 0);
      const u: V = a === 0 ? [0, 0, -d[0]] : a === 1 ? [1, 0, 0] : [d[2], 0, 0];
      const v: V = a === 1 ? [0, 0, -d[1]] : [0, 1, 0];
      faces.push({
        center: [x + d[0] * 0.5, y + d[1] * 0.5, z + d[2] * 0.5], normal: d, u, v, moving,
        color: outside ? colorAt.get(`${p.join(",")}|${d.join(",")}`) ?? null : null,
      });
    }
  }

  // Camera position in world space decides which block is nearer.
  let movingFirst = false;
  if (geo) {
    const camWorld = rotate(rotate([0, 0, CAMERA_DISTANCE], 0, -view.pitch), 1, -view.yaw);
    movingFirst = (camWorld[geo.axis] - geo.layer * 0.5) * geo.layer < 0;
  }
  const blocks = geo ? (movingFirst ? [true, false] : [false, true]) : [false];

  for (const block of blocks) {
    for (const f of faces) {
      if (f.moving !== block) continue;
      const tf = (w: V) => toCamera(f.moving && geo ? rotate(w, geo.axis, angle) : w, view);
      const n = tf(f.normal);
      const c = tf(f.center);
      // perspective back-face cull: the face must point toward the camera
      if (dot(n, [-c[0], -c[1], CAMERA_DISTANCE - c[2]]) <= 0) continue;
      const light = 0.8 + 0.2 * Math.max(0, dot(n, LIGHT));
      const toScreen = (shape: [number, number][], lift: number) => shape.map(([a, b]) => project(tf([
        f.center[0] + f.u[0] * a + f.v[0] * b + f.normal[0] * lift,
        f.center[1] + f.u[1] * a + f.v[1] * b + f.normal[1] * lift,
        f.center[2] + f.u[2] * a + f.v[2] * b + f.normal[2] * lift,
      ])));
      const body = toScreen(BODY_SHAPE, 0);
      ctx.beginPath();
      body.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath();
      ctx.fillStyle = shade(f.color ? BODY : CORE, light);
      ctx.fill();
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(1, scale * 0.012);
      ctx.strokeStyle = BODY_EDGE;
      ctx.stroke();
      if (!f.color) continue;
      const sticker = toScreen(STICKER_SHAPE, 0.002);
      ctx.beginPath();
      sticker.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath();
      ctx.fillStyle = shade(CUBE_COLORS[f.color], light);
      ctx.fill();
      ctx.lineWidth = Math.max(0.8, scale * 0.008);
      ctx.strokeStyle = f.color === "white" ? "rgba(90,84,74,0.35)" : "rgba(40,34,26,0.14)";
      ctx.stroke();
    }
  }
}

