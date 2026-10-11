# Players bring their own mines; board mines never respawn

Long wars of attrition used to run out of mines, since every blast removed one for good. Rather than respawning mines on the board, every player starts with a full stock of 5 and gets +1 every 30 turns while below 5; a flagged mine crossed with a full stock stays where it is (a kept mine) instead of being wasted. The 1 vs 1 board starts with half the natural mines it had, with half of the removed ones turned into mountains. Decided in a grilling session on 2026-10-10.

## Considered Options

- **Respawn at the old spot:** predictable, so players could camp it or loop mines through one position.
- **Top up to a floor (60% of the starting count) at a random, contested, unclaimed tile:** fair placement got murky when one player held most of the board (they'd see new mines first) or the whole board was claimed.

## Consequences

- The rules apply in every mode, but only the 1 vs 1 board was rebalanced; free-for-all's board needs tuning once there's data (6 players x 5 mines on top of its natural mines).
- A mine can now sit under a player's land without being theirs (a kept mine); views and bots handle that case explicitly.
