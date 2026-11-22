// sokoban-solver-01 — a push-optimal Sokoban solver built for make.fun.
//
// Idea: the levels this contest draws are a hallway with independent rooms
// off it, and a box can never leave its room, so a level's push optimum is
// the sum of its rooms' optima. The solver therefore
//   1. splits the level into rooms (the hallway's dead squares are cut out
//      of the floor; each remaining part that holds boxes is one room),
//   2. solves each room on its own with a breadth-first search over pushes
//      (uniform push cost, so the first solution found is push-optimal),
//      pruning boxes that land on dead squares or in frozen 2x2 blocks,
//   3. stitches the rooms' move strings together, the player walking on
//      from wherever the previous room left them.
// If a level does not split into rooms, the same push search runs on the
// whole board. Everything is budgeted by state counts, never by the clock,
// and ties break by a fixed direction order, so two runs write the same
// bytes.
//
// Local run: mkdir -p out && MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Directions in a fixed order: up, down, left, right.
const DX = [0, 0, -1, 1];
const DY = [-1, 1, 0, 0];
const WALK_CH = ['u', 'd', 'l', 'r'];
const PUSH_CH = ['U', 'D', 'L', 'R'];

/** A parsed level: walls as a 0/1 grid (the outer frame is always wall), goal and box squares, the player's square. */
function parseLevel(text) {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals = [];
  const boxes = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  for (let x = 0; x < w; x++) {
    wall[x] = 1;
    wall[(h - 1) * w + x] = 1;
  }
  for (let y = 0; y < h; y++) {
    wall[y * w] = 1;
    wall[y * w + w - 1] = 1;
  }
  boxes.sort((a, b) => a - b);
  goals.sort((a, b) => a - b);
  return { w, h, wall, goals, boxes, player };
}

/**
 * The squares a lone box can still reach a goal from: start at the goals and
 * pull backwards — a box on square s can be pushed to a neighbouring square t
 * when t is open and the square behind s (where the player stands) is open.
 * A box on any other square is dead and can be pruned.
 */
function liveSquares(w, h, wall, goals) {
  const live = new Uint8Array(w * h);
  const queue = [];
  for (const g of goals) {
    live[g] = 1;
    queue.push(g);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const t = queue[qi];
    const tx = t % w;
    const ty = (t / w) | 0;
    for (let d = 0; d < 4; d++) {
      // The box came from s = t - dir; the player stood at s - dir.
      const sx = tx - DX[d];
      const sy = ty - DY[d];
      const px = sx - DX[d];
      const py = sy - DY[d];
      if (sx < 0 || sy < 0 || sx >= w || sy >= h || px < 0 || py < 0 || px >= w || py >= h) continue;
      const s = sy * w + sx;
      const p = py * w + px;
      if (!wall[s] && !wall[p] && !live[s]) {
        live[s] = 1;
        queue.push(s);
      }
    }
  }
  return live;
}

/** Flood fill of the squares the player can walk to; returns the visited set and its lowest square (the region's name). */
function walkRegion(w, h, wall, boxAt, from) {
  const seen = new Uint8Array(w * h);
  const stack = [from];
  seen[from] = 1;
  let low = from;
  while (stack.length > 0) {
    const p = stack.pop();
    if (p < low) low = p;
    const px = p % w;
    const py = (p / w) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = px + DX[d];
      const ny = py + DY[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = ny * w + nx;
      if (!wall[q] && !boxAt[q] && !seen[q]) {
        seen[q] = 1;
        stack.push(q);
      }
    }
  }
  return { seen, low };
}

/** The shortest walk from one square to another around walls and boxes, as lower-case LURD letters. */
function walkPath(w, h, wall, boxAt, from, to) {
  if (from === to) return '';
  const prev = new Int32Array(w * h).fill(-1);
  const via = new Array(w * h);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi];
    if (p === to) break;
    const px = p % w;
    const py = (p / w) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = px + DX[d];
      const ny = py + DY[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = ny * w + nx;
      if (wall[q] || boxAt[q] || prev[q] !== -1) continue;
      prev[q] = p;
      via[q] = WALK_CH[d];
      queue.push(q);
    }
  }
  if (prev[to] === -1) return null;
  let s = '';
  for (let p = to; p !== from; p = prev[p]) s = via[p] + s;
  return s;
}

/** Whether the box just pushed to t froze a 2x2 block of walls and boxes that holds a box off its goal. */
function frozenBlock(w, h, wall, boxAt, goalAt, t) {
  const tx = t % w;
  const ty = (t / w) | 0;
  for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
    const ax = tx + ox;
    const ay = ty + oy;
    if (ax < 0 || ay < 0 || ax + 1 >= w || ay + 1 >= h) continue;
    const cells = [ay * w + ax, ay * w + ax + 1, (ay + 1) * w + ax, (ay + 1) * w + ax + 1];
    if (!cells.every((c) => wall[c] || boxAt[c])) continue;
    if (cells.some((c) => boxAt[c] && !goalAt[c])) return true;
  }
  return false;
}

/**
 * Push-optimal search on one board. A state is the sorted box squares plus
 * the canonical name of the player's reachable region, so states that differ
 * only by walks merge. Breadth-first over pushes: the first solved state met
 * is push-optimal. Gives up (null) past maxStates states — a work budget,
 * never a clock.
 */
function solvePushes(board, startBoxes, startPlayer, maxStates) {
  const { w, h, wall, goals } = board;
  const size = w * h;
  const goalAt = new Uint8Array(size);
  for (const g of goals) goalAt[g] = 1;
  const live = liveSquares(w, h, wall, goals);
  const isSolved = (bs) => bs.every((b) => goalAt[b]);
  if (startBoxes.some((b) => !live[b])) return null;
  if (isSolved(startBoxes)) return { pushes: 0, moves: '' };

  const boxAt = new Uint8Array(size);
  const keyOf = (bs, low) => low + '|' + bs.join(',');
  // Parallel arrays per state: boxes, the square the player stood on when the
  // state was made, the parent state, and the push (box-from square + direction).
  const stBoxes = [startBoxes.slice()];
  const stPlayer = [startPlayer];
  const stParent = [-1];
  const stFrom = [-1];
  const stDir = [-1];
  const index = new Map();
  for (const b of startBoxes) boxAt[b] = 1;
  index.set(keyOf(startBoxes, walkRegion(w, h, wall, boxAt, startPlayer).low), 0);
  for (const b of startBoxes) boxAt[b] = 0;

  let found = -1;
  for (let head = 0; head < stBoxes.length && found < 0; head++) {
    const bs = stBoxes[head];
    for (const b of bs) boxAt[b] = 1;
    const region = walkRegion(w, h, wall, boxAt, stPlayer[head]);
    for (let bi = 0; bi < bs.length && found < 0; bi++) {
      const b = bs[bi];
      const bx = b % w;
      const by = (b / w) | 0;
      for (let d = 0; d < 4; d++) {
        const stand = (by - DY[d]) * w + (bx - DX[d]);
        const target = (by + DY[d]) * w + (bx + DX[d]);
        if (stand < 0 || target < 0 || stand >= size || target >= size) continue;
        if (!region.seen[stand] || wall[target] || boxAt[target] || !live[target]) continue;
        boxAt[b] = 0;
        boxAt[target] = 1;
        const frozen = frozenBlock(w, h, wall, boxAt, goalAt, target);
        let key = null;
        let next = null;
        if (!frozen) {
          next = bs.slice();
          next[bi] = target;
          next.sort((a, b2) => a - b2);
          key = keyOf(next, walkRegion(w, h, wall, boxAt, b).low);
        }
        boxAt[target] = 0;
        boxAt[b] = 1;
        if (frozen || index.has(key)) continue;
        if (stBoxes.length >= maxStates) {
          for (const x of bs) boxAt[x] = 0;
          return null;
        }
        index.set(key, stBoxes.length);
        stBoxes.push(next);
        stPlayer.push(b);
        stParent.push(head);
        stFrom.push(b);
        stDir.push(d);
        if (isSolved(next)) found = stBoxes.length - 1;
      }
    }
    for (const b of bs) boxAt[b] = 0;
  }
  if (found < 0) return null;

  // Rebuild the moves: walk to each push's stand square, then push.
  const chain = [];
  for (let s = found; s > 0; s = stParent[s]) chain.push(s);
  chain.reverse();
  let moves = '';
  let player = startPlayer;
  let boxes = startBoxes.slice();
  for (const s of chain) {
    const from = stFrom[s];
    const d = stDir[s];
    const fx = from % w;
    const fy = (from / w) | 0;
    const stand = (fy - DY[d]) * w + (fx - DX[d]);
    for (const b of boxes) boxAt[b] = 1;
    const walk = walkPath(w, h, wall, boxAt, player, stand);
    for (const b of boxes) boxAt[b] = 0;
    if (walk === null) return null;
    moves += walk + PUSH_CH[d];
    player = from;
    boxes = stBoxes[s];
  }
  return { pushes: chain.length, moves };
}

/**
 * The level's rooms, or null when it is not a set of rooms. The player's row
 * is the hallway; its dead squares (a box there reaches no goal) are cut out
 * of the floor, and each part left is a room or plain hallway. A part holding
 * boxes must hold as many goals, and no box may start in the hallway.
 */
function splitRooms(level) {
  const { w, h, wall, goals, boxes, player } = level;
  const live = liveSquares(w, h, wall, goals);
  const rowY = (player / w) | 0;
  const cut = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    const i = rowY * w + x;
    if (!wall[i] && !live[i]) cut[i] = 1;
  }
  if (boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(w * h).fill(-1);
  const rooms = [];
  for (let s = 0; s < w * h; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const id = rooms.length;
    const squares = [s];
    part[s] = id;
    for (let i = 0; i < squares.length; i++) {
      const p = squares[i];
      const px = p % w;
      const py = (p / w) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = px + DX[d];
        const ny = py + DY[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (!wall[q] && !cut[q] && part[q] < 0) {
          part[q] = id;
          squares.push(q);
        }
      }
    }
    rooms.push({ squares, boxes: [], goals: [] });
  }
  for (const b of boxes) rooms[part[b]].boxes.push(b);
  for (const g of goals) {
    if (part[g] < 0) return null;
    rooms[part[g]].goals.push(g);
  }
  if (rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

/** Where the player ends after a move string, and the boxes' final squares (a plain replay). */
function replay(level, moves) {
  const { w, wall } = level;
  const boxAt = new Set(level.boxes);
  let player = level.player;
  for (const ch of moves.toLowerCase()) {
    const d = WALK_CH.indexOf(ch);
    if (d < 0) continue;
    const px = player % w;
    const py = (player / w) | 0;
    const nx = px + DX[d];
    const ny = py + DY[d];
    const next = ny * w + nx;
    if (wall[next]) continue;
    if (boxAt.has(next)) {
      const beyond = (ny + DY[d]) * w + (nx + DX[d]);
      if (wall[beyond] || boxAt.has(beyond)) continue;
      boxAt.delete(next);
      boxAt.add(beyond);
    }
    player = next;
  }
  return { player, boxes: [...boxAt].sort((a, b) => a - b) };
}

/** Solve one level: room by room when it splits, else one whole-board search. */
function solveLevel(level) {
  const rooms = splitRooms(level);
  if (rooms === null) {
    const whole = solvePushes(level, level.boxes, level.player, 2_000_000);
    return whole === null ? '' : whole.moves;
  }
  let player = level.player;
  let moves = '';
  const done = new Set();
  for (const room of rooms) {
    // Other rooms' boxes stand as walls: at their starts before their room
    // is solved, on their goals after.
    const wall = level.wall.slice();
    for (const other of rooms) {
      if (other === room) continue;
      for (const b of done.has(other) ? other.goals : other.boxes) wall[b] = 1;
    }
    const sub = { w: level.w, h: level.h, wall, goals: room.goals, boxes: room.boxes };
    const solved = solvePushes(sub, room.boxes.slice().sort((a, b) => a - b), player, 1_000_000);
    if (solved === null) return '';
    moves += solved.moves;
    player = replay(level, moves).player;
    done.add(room);
  }
  return moves;
}

for (const id of readdirSync(INPUT_DIR).sort()) {
  const text = readFileSync(join(INPUT_DIR, id, 'level.txt'), 'utf8');
  const moves = solveLevel(parseLevel(text));
  mkdirSync(join(OUTPUT_DIR, id), { recursive: true });
  writeFileSync(join(OUTPUT_DIR, id, 'solution.txt'), `${moves}\n`);
}
