import { createFromLayout, type LayoutGame } from './engine/layout';
import { Memory, Terrain, type GameState } from './engine/types';

export interface TutorialStep {
  text: string;
  done(s: GameState, lv: LayoutGame): boolean;
  /** Tiles to ring on the board while this step is active. */
  highlight?(s: GameState, lv: LayoutGame): number[];
}

export interface TutorialLevel {
  title: string;
  create(): LayoutGame;
  steps: TutorialStep[];
}

const YOU = { name: 'You', isBot: false };
const owned = (s: GameState) => s.owner.reduce((n, o) => n + (o === 0 ? 1 : 0), 0);
const tileOf = (s: GameState, t: number) => s.terrain.findIndex((v) => v === t);

/** Level 2's provable mine at (2,6) on its 7-wide board. */
export const DEDUCE_FLAG = 6 * 7 + 2;

export const TUTORIAL: TutorialLevel[] = [
  {
    title: 'Expand',
    create: () =>
      createFromLayout(['..*...', '......', '....*.', '......', '.*....', '......', '..G...'], {
        players: [YOU],
        generalArmy: [10],
      }),
    steps: [
      {
        text: 'This crown is your general. It makes a troop every turn. Drag from it onto a neighbouring tile to move your troops (or tap it, then tap a neighbour).',
        done: (s) => owned(s) >= 2,
        highlight: (s) => [s.players[0].general],
      },
      {
        text: 'Every tile you take shows a number: how many of its 8 neighbours hide a mine. Blank means zero, and zeros open up the area. Grow to 10 tiles.',
        done: (s) => owned(s) >= 10,
      },
    ],
  },
  {
    title: 'Deduce',
    // Searched layout: two mines are provable from the opening numbers, and the
    // star can be reached by logic alone (see tests/tutorial.test.ts).
    create: () =>
      createFromLayout(['##.@.##', '#..*..#', '#*....#', '#....*#', '#*.*..#', '#.....#', '#.*..*#', 'ooooooo', 'oooGooo'], {
        players: [YOU],
        generalArmy: [40],
      }),
    steps: [
      {
        text: "The numbers on your border can only add up one way: the ringed tile must be a mine. Long-press it (right-click on desktop) to flag it.",
        done: (s) => s.players[0].flags[DEDUCE_FLAG] === 1,
        highlight: () => [DEDUCE_FLAG],
      },
      {
        text: 'Flags are just notes. To see what a mine does, move some troops onto your flag.',
        done: (s) => s.crater[DEDUCE_FLAG] === 1,
        highlight: () => [DEDUCE_FLAG],
      },
      {
        text: 'Boom: up to 15 troops lost, armies next to it halved, and you are stunned for 3 turns. Now read the numbers and reach the ringed star without another blast.',
        done: (s, lv) => s.owner[lv.goals[0]] === 0,
        highlight: (_s, lv) => lv.goals,
      },
    ],
  },
  {
    title: 'Conquer',
    create: () => {
      const lv = createFromLayout(
        [
          '#...E...#',
          '#.......#',
          '#..*..*.#',
          '##.....##',
          '#...#...#',
          '#*..T..*#',
          '#...#...#',
          '##.*...##',
          '#.......#',
          '#..*..*.#',
          '#.......#',
          '#...G...#',
        ],
        { players: [YOU, { name: 'Blue', isBot: true }], generalArmy: [25, 1], towerGarrison: 10 },
      );
      // Already scouted: the coach talks about the tower and Blue's crown, so draw them in the fog.
      const s = lv.state;
      s.players[0].memory[tileOf(s, Terrain.Tower)] = Memory.Tower;
      s.players[0].memory[s.players[1].general] = Memory.General;
      return lv;
    },
    steps: [
      {
        text: 'The eye is a watchtower. Hold it and you see 3 tiles around it, and learn every number there. It has 10 defenders: bring more than 10 troops.',
        done: (s) => s.owner[tileOf(s, Terrain.Tower)] === 0,
        highlight: (s) => [tileOf(s, Terrain.Tower)],
      },
      {
        text: "Blue's general is to the north. Gather your troops into one big stack and capture their crown to win.",
        done: (s) => s.winner === 0,
        highlight: (s) => [s.players[1].general],
      },
    ],
  },
];
