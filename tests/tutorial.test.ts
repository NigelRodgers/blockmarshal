import { describe, expect, it } from 'vitest';
import { reveal } from '../src/engine/game';
import { analyze } from '../src/engine/knowledge';
import { DEDUCE_FLAG, TUTORIAL } from '../src/tutorial';

describe('tutorial levels', () => {
  it('build, and no step starts already complete', () => {
    for (const level of TUTORIAL) {
      const lv = level.create();
      expect(level.steps[0].done(lv.state, lv)).toBe(false);
    }
  });

  it('level 2: the flag target is a real mine, provable from the opening, next to your land', () => {
    const lv = TUTORIAL[1].create();
    const s = lv.state;
    expect(s.mine[DEDUCE_FLAG]).toBe(1);
    expect(analyze(s, 0).mine[DEDUCE_FLAG]).toBe(1);
    expect(s.n4[DEDUCE_FLAG].some((j) => s.owner[j] === 0)).toBe(true);
  });

  it('level 2: the star is reachable by deduction alone', () => {
    const lv = TUTORIAL[1].create();
    const s = lv.state;
    for (let round = 0; round < 40 && s.owner[lv.goals[0]] !== 0; round++) {
      const k = analyze(s, 0);
      const next = new Set<number>();
      for (let i = 0; i < s.size; i++) {
        if (s.owner[i] !== 0) continue;
        for (const j of s.n4[i]) if (s.owner[j] !== 0 && s.terrain[j] !== 1 && k.safe[j]) next.add(j);
      }
      expect(next.size).toBeGreaterThan(0);
      for (const j of next) {
        expect(s.mine[j]).toBe(0);
        s.owner[j] = 0;
        reveal(s, 0, j);
      }
    }
    expect(s.owner[lv.goals[0]]).toBe(0);
  });
});
