import { describe, expect, it } from 'vitest';
import {
  buildComplexity,
  classifyTier,
  findComplexityByEip,
  sumAnchorScores,
  type ComplexityAnchor,
  type ComplexitySnapshot,
} from './complexity';

const anchor = (overrides: Partial<ComplexityAnchor> = {}): ComplexityAnchor => ({
  name: 'Edge/boundary conditions',
  score: 2,
  ...overrides,
});

describe('classifyTier', () => {
  it('treats <10 as Low, [10,20) as Medium, and >=20 as High', () => {
    expect(classifyTier(0)).toBe('Low');
    expect(classifyTier(9)).toBe('Low');
    expect(classifyTier(10)).toBe('Medium');
    expect(classifyTier(19)).toBe('Medium');
    expect(classifyTier(20)).toBe('High');
    expect(classifyTier(99)).toBe('High');
  });
});

describe('sumAnchorScores', () => {
  it('sums anchor scores', () => {
    expect(sumAnchorScores([anchor({ score: 3 }), anchor({ score: 4 })])).toBe(7);
  });

  it('returns 0 for no anchors', () => {
    expect(sumAnchorScores([])).toBe(0);
  });
});

describe('buildComplexity', () => {
  it('derives total score and tier from anchors when no overrides are supplied', () => {
    const complexity = buildComplexity({
      eipNumber: 7702,
      anchors: [anchor({ score: 5 }), anchor({ score: 6 })],
    });

    expect(complexity.totalScore).toBe(11);
    expect(complexity.tier).toBe('Medium');
  });

  it('honors a totalScoreOverride supplied by the parser', () => {
    const complexity = buildComplexity({
      eipNumber: 7702,
      anchors: [anchor({ score: 1 })],
      totalScoreOverride: 22,
    });

    expect(complexity.totalScore).toBe(22);
    expect(complexity.tier).toBe('High');
  });

  it('honors a tierOverride independently of the total score', () => {
    const complexity = buildComplexity({
      eipNumber: 7702,
      anchors: [anchor({ score: 1 })],
      tierOverride: 'High',
    });

    expect(complexity.tier).toBe('High');
    expect(complexity.totalScore).toBe(1);
  });

  it('builds a stable assessment URL keyed by EIP number', () => {
    const complexity = buildComplexity({ eipNumber: 1234, anchors: [] });
    expect(complexity.assessmentUrl).toBe(
      'https://github.com/ethsteel/pm/blob/main/complexity_assessments/EIPs/EIP-1234.md'
    );
  });
});

describe('findComplexityByEip', () => {
  it('returns the complexity record when present and null otherwise', () => {
    const built = buildComplexity({ eipNumber: 42, anchors: [anchor({ score: 3 })] });
    const snapshot: ComplexitySnapshot = {
      byEipNumber: new Map([[42, built]]),
      availableEipNumbers: [42],
    };

    expect(findComplexityByEip(snapshot, 42)).toBe(built);
    expect(findComplexityByEip(snapshot, 99)).toBeNull();
  });
});
