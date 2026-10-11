# Replays rebuild the game from its seed and the humans' inputs

A replay stores the map seed, the mode, the players, every human input with its tick, and the build that played it, not snapshots of the board. Bots are deterministic for a given seed, so re-running the engine reproduces the game exactly. This keeps a long game around 20-100 KB (snapshots would be megabytes) and doubles as a regression test that the engine stays deterministic.

## Consequences

- Any change to bot behaviour, map generation or rules makes older replays play out differently. Replays carry a `build` stamp, and the viewer warns when a rebuilt game doesn't end the way the recorded one did; `summary.csv` can be split by build.
- The engine must stay deterministic: no `Math.random`, wall-clock time or iteration-order dependence in `src/engine` or `src/ai`.
