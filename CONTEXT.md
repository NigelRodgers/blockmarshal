# Blockmarshal

A real-time territory war on a hidden minefield: players grow armies, take land and hunt each other's general while reading mine-border clues to avoid (or capture) mines.

## Match

**Match**:
One game from lobby to result, with a fixed set of seats filled by humans and bots.
_Avoid_: Room, session, round

**Mode**:
The kind of match: **free-for-all** (six seats, larger board) or **1 vs 1** (two seats, smaller board).
_Avoid_: Variant, ruleset

**1 vs 1**:
The two-seat mode; the current focus, mostly played against a bot.
_Avoid_: Duel (fine in code, not in player-facing text), 1v1, head-to-head

**Lobby**:
The countdown before a match starts, where humans gather and empty seats are later filled by bots.
_Avoid_: Queue, waiting room

**Solo handoff**:
When a lobby ends with only one human, the match moves to that player's browser and runs there against bots.

**Browser game**:
A match against bots that runs entirely in the player's browser (solo handoff, offline play, quick start).
_Avoid_: Local game, offline match

**Turn**:
The unit players count time in: two ticks. Rules and the help speak in turns.
_Avoid_: Round, second

**Tick**:
The engine's smallest time step (half a turn); each player's next queued move runs once per tick.

## Board

**Tile**:
One square of the board.
_Avoid_: Cell, block, square

**Plain**:
An ordinary open tile (not terrain): the only kind that can hold a mine or a moved building.

**Terrain**:
An impassable tile, drawn dark grey with stripes. (`Terrain.Mountain` in code.)
_Avoid_: Mountain, wall, rock

**Land**:
The tiles a player owns.
_Avoid_: Territory (fine in prose), area

**Island**:
One connected stretch of a player's land (sides only). Buildings and mines only move within one island.
_Avoid_: Region, cluster

**Fog**:
Everything a player cannot currently see; they only see tiles next to their land.
_Avoid_: Fog of war (fine in prose), darkness

## Armies and buildings

**General**:
A player's capital, shown as a crown. Losing it eliminates the player; taking an enemy's wins their land.
_Avoid_: King, capital, crown (the icon, not the piece)

**City**:
A building that produces troops for whoever holds it.
_Avoid_: Town, castle

**Building**:
A general or city.

**Stack**:
The troops on one tile.
_Avoid_: Army (when one tile is meant), unit

**Relocate**:
Moving a building to another plain on the same island; it then can't move again for a while.
_Avoid_: Teleport, move (ambiguous with troop moves)

**Cooldown**:
The wait after a building or mine is moved or planted before it may move again.

## Mines

**Mine**:
A hidden explosive on a plain. Walking onto it unflagged sets it off.
_Avoid_: Bomb, trap (a trap is a use, not a piece)

**Natural mine**:
A mine placed by the map at the start; it belongs to nobody.

**Planted mine**:
A mine a player put on their own land from their stock.

**Blast**:
A mine going off: it destroys troops, halves the stacks around it and stuns the mover.
_Avoid_: Explosion (fine in prose), trip, detonation

**Crater**:
The public mark a blast leaves for a few turns.

**Mine border**:
The clue on a player's tile: a red border on each side that faces a neighbouring mine (a corner mark for a diagonal one); white for a locked mine.
_Avoid_: Numbers, hints, dots (the old drawing; still `dots` in code)

**Flag**:
A private marker a player puts on a tile they believe holds a mine; walking onto a flagged mine captures it (or crosses it) instead of setting it off.
_Avoid_: Mark, pin

**Capture**:
Walking onto a flagged mine with room in stock: the mine leaves the board and joins the stock.
_Avoid_: Defuse, collect (collect is fine for kept mines)

**Stock**:
The unplanted mines a player holds, up to a cap. It starts full and refills over time.
_Avoid_: Inventory, ammo, quota (the design idea, not the term)

**Refill**:
One mine added to a stock that is below its cap, on a fixed countdown.

**Kept mine**:
A flagged mine a player crossed with a full stock: it stays on the board, under their land, still flagged, until they collect it.
_Avoid_: Disarmed mine (the old rule deleted it)

**Locked mine**:
A freshly planted mine during its cooldown: enemies can't capture it even with a flag.
_Avoid_: Armed mine, fresh mine

**Pick up**:
A player taking one of their own planted mines back into stock.
_Avoid_: Lift, remove

## Players and records

**Bot**:
A computer player that sees exactly what a human in its seat would see.
_Avoid_: AI (fine in prose), CPU, NPC

**Replay**:
The record of a finished match (seed, settings, human inputs, build) from which the whole game is rebuilt.
_Avoid_: Recording (that's the owner's video capture), demo

**Replay link**:
A URL that opens one replay for anyone who has it, for 60 days after the game.
_Avoid_: Share code

**Recording**:
An owner-only video capture of the board, turned into an MP4.

**Build**:
The short git hash of the code that served a game; shown on the start screen and stamped on replays.
_Avoid_: Version
