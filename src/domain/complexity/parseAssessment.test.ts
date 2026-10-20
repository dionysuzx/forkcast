import { describe, expect, it } from 'vitest';
import { parseComplexityAssessment } from './parseAssessment';

const buildMarkdown = (sections: { checklist?: string; final?: string }): string => {
  const parts: string[] = [];
  if (sections.checklist) {
    parts.push('### Checklist', '', sections.checklist, '');
  }
  if (sections.final) {
    parts.push('### Final Assessment', '', sections.final, '');
  }
  return parts.join('\n');
};

describe('parseComplexityAssessment', () => {
  it('parses anchor rows including additive scores and dash placeholders', () => {
    const markdown = buildMarkdown({
      checklist: [
        '| Anchor | Score | Rationale |',
        '| --- | --- | --- |',
        '| **EVM Gas rule changes** | 3 | Adjusts pricing |',
        '| **Cryptography** | 2 + 2 + 3 + 1 | Multi-aspect |',
        '| **Performance risks** | — | Not assessed |',
      ].join('\n'),
    });

    const complexity = parseComplexityAssessment(markdown, 7702);
    expect(complexity).not.toBeNull();
    expect(complexity!.anchors).toEqual([
      { name: 'EVM Gas rule changes', score: 3, notes: 'Adjusts pricing' },
      { name: 'Cryptography', score: 8, notes: 'Multi-aspect' },
      { name: 'Performance risks', score: 0, notes: 'Not assessed' },
    ]);
  });

  it('reads the total score from the Final Assessment table', () => {
    const markdown = buildMarkdown({
      checklist: [
        '| Anchor | Score | Rationale |',
        '| --- | --- | --- |',
        '| **EVM Gas rule changes** | 3 | x |',
      ].join('\n'),
      final: [
        '| Metric | Description | Value |',
        '| --- | --- | --- |',
        '| **Total Score** | Sum of anchors | **`28`** |',
        '| **Complexity Tier** | Computed from total score | 🔴 |',
      ].join('\n'),
    });

    const complexity = parseComplexityAssessment(markdown, 1);
    expect(complexity!.totalScore).toBe(28);
    expect(complexity!.tier).toBe('High');
  });

  it('falls back to summing anchors when no total is given', () => {
    const markdown = buildMarkdown({
      checklist: [
        '| Anchor | Score | Rationale |',
        '| --- | --- | --- |',
        '| **EVM Gas rule changes** | 4 | x |',
        '| **Cryptography** | 7 | y |',
      ].join('\n'),
    });

    const complexity = parseComplexityAssessment(markdown, 2);
    expect(complexity!.totalScore).toBe(11);
    expect(complexity!.tier).toBe('Medium');
  });

  it('classifies tier from the total when the Final Assessment row is absent', () => {
    const markdown = buildMarkdown({
      checklist: [
        '| Anchor | Score | Rationale |',
        '| --- | --- | --- |',
        '| **EVM Gas rule changes** | 2 | x |',
      ].join('\n'),
    });

    const complexity = parseComplexityAssessment(markdown, 3);
    expect(complexity!.tier).toBe('Low');
  });

  it('parses **Total: N** style totals', () => {
    const markdown = '**Total: 15**';
    const complexity = parseComplexityAssessment(markdown, 4);
    expect(complexity!.totalScore).toBe(15);
    expect(complexity!.tier).toBe('Medium');
  });

  it('returns a record with no anchors when the checklist is missing', () => {
    const complexity = parseComplexityAssessment('# Nothing here', 5);
    expect(complexity).not.toBeNull();
    expect(complexity!.anchors).toEqual([]);
    expect(complexity!.totalScore).toBe(0);
    expect(complexity!.tier).toBe('Low');
  });
});
