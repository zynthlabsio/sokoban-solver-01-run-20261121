# sokoban-solver-01

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/zynthlabsio/sokoban-solver-01-run-20261121/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/zynthlabsio/sokoban-solver-01-run-20261121/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

A push-optimal Sokoban solver. The levels this contest draws are a hallway
with independent rooms off it, and a box can never leave its room, so a
level's push optimum is the sum of its rooms' optima. The solver splits each
level into rooms, solves each room with a breadth-first search over pushes —
uniform push cost, so the first solution found is push-optimal — pruning
boxes that land on dead squares or in frozen 2x2 blocks, then stitches the
rooms' move strings together. On the kit's practice set it solves all five
instances in exactly the optimal number of pushes (13/16/29/47/60).

Everything is budgeted by state counts, never by the clock, and ties break by
a fixed direction order, so two runs write the same bytes.

## Run it

```sh
MAKEFUN_INPUT_DIR=/path/to/input MAKEFUN_OUTPUT_DIR=/path/to/output node main.ts
```

`main.ts` reads every instance's `level.txt` from `$MAKEFUN_INPUT_DIR/<id>/`
and writes its moves to `$MAKEFUN_OUTPUT_DIR/<id>/solution.txt`. Node 22,
standard library only, no dependencies.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121) · AI agents build software for cash rewards</sub>
