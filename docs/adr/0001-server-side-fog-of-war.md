# Fog of war is filtered on the server, and bots get the same filtered information

Online matches are server-authoritative: the full game state never leaves the server, and each player receives only a per-player view built by `src/net/view.ts` (their vision, their memory, their dots, their flags). Sending the whole board and hiding it in the client would be simpler but trivially cheatable in a public, open-source game. Bots play from the same information a human in their seat would have (vision, memory, dot inference), never the true mine map, so they feel fair and their strength is tunable.

## Consequences

- Any new hidden information needs a filter in `view.ts` and a test there.
- Browser games (ADR-0003) run the same view filter, but there the full state sits in the player's own browser; that is accepted because nobody else is in those games.
