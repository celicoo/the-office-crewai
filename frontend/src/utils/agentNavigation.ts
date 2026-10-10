import * as THREE from 'three';
import { computeDeskPosition, type OfficeDimensions } from './officeLayout';

export type FloorObstacle = { minX: number; maxX: number; minZ: number; maxZ: number };

export type AgentBlocker = { x: number; z: number; radius: number };

export function loungeOrigin(dims: { width: number; depth: number }) {
  return { x: -dims.width / 2 + 3.2, z: dims.depth / 2 - 1.6 };
}

function boxAround(x: number, z: number, halfW: number, halfD: number): FloorObstacle {
  return {
    minX: x - halfW,
    maxX: x + halfW,
    minZ: z - halfD,
    maxZ: z + halfD,
  };
}

/** Furniture footprints for pathfinding (leave aisles between desk pods). */
export function buildFloorObstacles(dims: OfficeDimensions, agentCount = 0): FloorObstacle[] {
  const lounge = loungeOrigin(dims);
  const obstacles: FloorObstacle[] = [];

  // Coffee table — match visual radius so paths go around it
  obstacles.push(boxAround(lounge.x, lounge.z, 0.34, 0.34));

  // Credenza
  obstacles.push(boxAround(dims.coffeePos[0], dims.coffeePos[2], 0.8, 0.3));

  // Cabinets / plant / whiteboard
  obstacles.push(boxAround(dims.filingCabinetsPos[0], dims.filingCabinetsPos[2], 0.45, 0.3));
  obstacles.push(boxAround(-dims.width / 2 + 1.1, dims.depth / 2 - 4.4, 0.22, 0.22));
  obstacles.push(boxAround(dims.whiteboardPos[0], dims.whiteboardPos[2], 0.14, 0.9));

  // Desk tops only (chairs stay walkable so seats are reachable)
  const n = Math.max(0, agentCount);
  for (let i = 0; i < n; i++) {
    const t = computeDeskPosition(i, n);
    const [dx, , dz] = t.pos;
    const halfAlongX = 0.34;
    const halfAlongZ = 0.13;
    const c = Math.abs(Math.cos(t.rotationY));
    const s = Math.abs(Math.sin(t.rotationY));
    const hw = halfAlongX * c + halfAlongZ * s;
    const hd = halfAlongX * s + halfAlongZ * c;
    const nudgeX = Math.sin(t.rotationY) * 0.1;
    const nudgeZ = Math.cos(t.rotationY) * 0.1;
    obstacles.push(boxAround(dx + nudgeX, dz + nudgeZ, hw, hd));
  }

  return obstacles;
}

export function clampToRoom(pos: THREE.Vector3, dims: OfficeDimensions, margin = 0.35) {
  pos.x = Math.max(-dims.width / 2 + margin, Math.min(dims.width / 2 - margin, pos.x));
  pos.z = Math.max(-dims.depth / 2 + margin, Math.min(dims.depth / 2 - margin, pos.z));
  pos.y = 0;
}

export function positionHitsObstacle(
  x: number,
  z: number,
  obstacles: FloorObstacle[],
  radius: number,
): FloorObstacle | null {
  for (const box of obstacles) {
    const nearestX = Math.max(box.minX, Math.min(x, box.maxX));
    const nearestZ = Math.max(box.minZ, Math.min(z, box.maxZ));
    const dx = x - nearestX;
    const dz = z - nearestZ;
    if (dx * dx + dz * dz < radius * radius) return box;
  }
  return null;
}

/** No-op resolve kept for callers that only need room clamp. */
export function resolveFloorPosition(
  pos: THREE.Vector3,
  dims: OfficeDimensions,
  _obstacles: FloorObstacle[],
  _radius = 0.1,
  _collideFurniture = true,
) {
  clampToRoom(pos, dims);
}

function cellBlocked(
  x: number,
  z: number,
  obstacles: FloorObstacle[],
  pad: number,
): boolean {
  return positionHitsObstacle(x, z, obstacles, pad) !== null;
}

/**
 * Grid A* from `from` → `to`. Returns intermediate waypoints (goal included, start omitted).
 * Start/goal cells are forced walkable so desk seats next to furniture stay reachable.
 */
export function findPath(
  from: THREE.Vector3,
  to: THREE.Vector3,
  dims: OfficeDimensions,
  obstacles: FloorObstacle[],
  agentRadius = 0.12,
): THREE.Vector3[] {
  const cell = 0.22;
  const margin = 0.4;
  const pad = agentRadius + 0.04;

  const minX = -dims.width / 2 + margin;
  const maxX = dims.width / 2 - margin;
  const minZ = -dims.depth / 2 + margin;
  const maxZ = dims.depth / 2 - margin;

  const cols = Math.max(2, Math.ceil((maxX - minX) / cell) + 1);
  const rows = Math.max(2, Math.ceil((maxZ - minZ) / cell) + 1);

  const idx = (c: number, r: number) => r * cols + c;
  const worldX = (c: number) => minX + c * cell;
  const worldZ = (r: number) => minZ + r * cell;

  const clampC = (c: number) => Math.max(0, Math.min(cols - 1, c));
  const clampR = (r: number) => Math.max(0, Math.min(rows - 1, r));

  const toCell = (x: number, z: number) => ({
    c: clampC(Math.round((x - minX) / cell)),
    r: clampR(Math.round((z - minZ) / cell)),
  });

  const start = toCell(from.x, from.z);
  const goal = toCell(to.x, to.z);

  // Straight line if clear
  if (!segmentBlocked(from.x, from.z, to.x, to.z, obstacles, pad)) {
    return [to.clone()];
  }

  const blocked = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (cellBlocked(worldX(c), worldZ(r), obstacles, pad)) {
        blocked[idx(c, r)] = 1;
      }
    }
  }
  // Force start + goal walkable (seats / POIs sit beside furniture)
  blocked[idx(start.c, start.r)] = 0;
  blocked[idx(goal.c, goal.r)] = 0;

  if (start.c === goal.c && start.r === goal.r) {
    return [to.clone()];
  }

  type Node = { c: number; r: number; g: number; f: number; parent: number };
  const open: Node[] = [];
  const came = new Int32Array(cols * rows).fill(-1);
  const gScore = new Float32Array(cols * rows).fill(Infinity);
  const closed = new Uint8Array(cols * rows);

  const h = (c: number, r: number) => {
    const dc = Math.abs(c - goal.c);
    const dr = Math.abs(r - goal.r);
    return Math.max(dc, dr) + Math.min(dc, dr) * 0.414; // octile
  };

  const startI = idx(start.c, start.r);
  gScore[startI] = 0;
  open.push({ c: start.c, r: start.r, g: 0, f: h(start.c, start.r), parent: -1 });

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  let found = -1;
  const maxIters = cols * rows * 2;
  let iters = 0;

  while (open.length && iters++ < maxIters) {
    // Pop lowest f (small grid — linear scan is fine)
    let best = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[best].f) best = i;
    }
    const cur = open[best];
    open[best] = open[open.length - 1];
    open.pop();

    const ci = idx(cur.c, cur.r);
    if (closed[ci]) continue;
    closed[ci] = 1;
    came[ci] = cur.parent;

    if (cur.c === goal.c && cur.r === goal.r) {
      found = ci;
      break;
    }

    for (const [dc, dr] of dirs) {
      const nc = cur.c + dc;
      const nr = cur.r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = idx(nc, nr);
      if (closed[ni] || blocked[ni]) continue;
      // No corner-cutting through blocked diagonals
      if (dc !== 0 && dr !== 0) {
        if (blocked[idx(cur.c + dc, cur.r)] || blocked[idx(cur.c, cur.r + dr)]) continue;
      }
      const stepCost = dc !== 0 && dr !== 0 ? 1.414 : 1;
      const ng = cur.g + stepCost;
      if (ng >= gScore[ni]) continue;
      gScore[ni] = ng;
      open.push({ c: nc, r: nr, g: ng, f: ng + h(nc, nr), parent: ci });
    }
  }

  if (found < 0) {
    // No path — still return the goal; walker will go straight as a fallback
    return [to.clone()];
  }

  // Reconstruct cell path
  const cells: Array<{ c: number; r: number }> = [];
  let walk = found;
  while (walk >= 0) {
    cells.push({ c: walk % cols, r: Math.floor(walk / cols) });
    walk = came[walk];
  }
  cells.reverse();

  // Convert to world points, then string-pull (skip intermediates when line of sight is clear)
  const raw: THREE.Vector3[] = cells.map(
    ({ c, r }) => new THREE.Vector3(worldX(c), 0, worldZ(r)),
  );
  // Snap last to exact goal
  if (raw.length) raw[raw.length - 1].copy(to);
  else raw.push(to.clone());

  const pulled: THREE.Vector3[] = [];
  let i = 0;
  while (i < raw.length - 1) {
    let furthest = i + 1;
    for (let j = raw.length - 1; j > i + 1; j--) {
      if (!segmentBlocked(raw[i].x, raw[i].z, raw[j].x, raw[j].z, obstacles, pad * 0.9)) {
        furthest = j;
        break;
      }
    }
    pulled.push(raw[furthest].clone());
    i = furthest;
  }
  if (!pulled.length) pulled.push(to.clone());
  // Ensure exact goal
  pulled[pulled.length - 1].copy(to);
  return pulled;
}

function segmentBlocked(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  obstacles: FloorObstacle[],
  radius: number,
): boolean {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.sqrt(dx * dx + dz * dz);
  const steps = Math.max(2, Math.ceil(len / 0.12));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (positionHitsObstacle(x0 + dx * t, z0 + dz * t, obstacles, radius)) return true;
  }
  return false;
}

/**
 * Simple walk toward a point. Soft agent push only — no furniture pinning.
 * Furniture is handled by the precomputed path.
 */
export function stepToward(
  pos: THREE.Vector3,
  goal: THREE.Vector3,
  stepLen: number,
  dims: OfficeDimensions,
  agentBlockers: AgentBlocker[] = [],
  selfRadius = 0.14,
): number {
  const toGoal = new THREE.Vector3().subVectors(goal, pos);
  toGoal.y = 0;
  const dist = toGoal.length();
  if (dist < 1e-4) return 0;

  let dx = toGoal.x / dist;
  let dz = toGoal.z / dist;

  for (const b of agentBlockers) {
    const ax = pos.x - b.x;
    const az = pos.z - b.z;
    const d = Math.sqrt(ax * ax + az * az);
    const minD = selfRadius + b.radius;
    if (d > 1e-5 && d < minD + 0.15) {
      const s = ((minD + 0.15 - d) / (minD + 0.15)) ** 2;
      dx += (ax / d) * s * 0.7;
      dz += (az / d) * s * 0.7;
    }
  }

  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  const step = Math.min(dist, stepLen);
  pos.x += (dx / len) * step;
  pos.z += (dz / len) * step;
  clampToRoom(pos, dims);
  return Math.atan2(dx, dz);
}

/** @deprecated Use findPath + stepToward. Kept so older imports don't break mid-edit. */
export function stepTowardWithAvoidance(
  pos: THREE.Vector3,
  goal: THREE.Vector3,
  stepLen: number,
  dims: OfficeDimensions,
  _obstacles: FloorObstacle[],
  _radius: number,
  _collideFurniture: boolean,
  agentBlockers: AgentBlocker[] = [],
): number {
  return stepToward(pos, goal, stepLen, dims, agentBlockers);
}

export function bestDetourCorner(
  _from: THREE.Vector3,
  goal: THREE.Vector3,
): THREE.Vector3 {
  return goal.clone();
}

export function segmentHitsObstacle(
  from: THREE.Vector3,
  to: THREE.Vector3,
  obstacles: FloorObstacle[],
  radius: number,
): FloorObstacle | null {
  if (segmentBlocked(from.x, from.z, to.x, to.z, obstacles, radius)) {
    return positionHitsObstacle(
      (from.x + to.x) / 2,
      (from.z + to.z) / 2,
      obstacles,
      radius,
    );
  }
  return null;
}

export function unstickFromFurniture(
  pos: THREE.Vector3,
  goal: THREE.Vector3,
  dims: OfficeDimensions,
  obstacles: FloorObstacle[],
  radius: number,
): boolean {
  const path = findPath(pos, goal, dims, obstacles, radius);
  if (path.length) {
    pos.copy(path[0]);
    return true;
  }
  return false;
}
