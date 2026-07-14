import {
  buildComplexity,
  type ComplexityAnchor,
  type ComplexityTier,
  type EipComplexity,
} from './complexity';

export function parseComplexityAssessment(
  markdown: string,
  eipNumber: number
): EipComplexity | null {
  try {
    return buildComplexity({
      eipNumber,
      anchors: parseAnchorsFromTable(markdown),
      totalScoreOverride: parseTotalScore(markdown),
      tierOverride: parseTier(markdown) ?? undefined,
    });
  } catch {
    return null;
  }
}

const DASH_TOKENS = new Set(['', '-', '–', '—']);

function parseScore(scoreCell: string): number {
  const trimmed = scoreCell.trim();
  if (DASH_TOKENS.has(trimmed)) return 0;

  if (trimmed.includes('+')) {
    return trimmed.split('+').reduce((sum, part) => {
      const num = parseInt(part.trim(), 10);
      return sum + (Number.isNaN(num) ? 0 : num);
    }, 0);
  }

  const num = parseInt(trimmed, 10);
  return Number.isNaN(num) ? 0 : num;
}

function parseAnchorsFromTable(markdown: string): ComplexityAnchor[] {
  const checklistMatch = markdown.match(
    /### Checklist[\s\S]*?\|[\s\S]*?(?=\n\n|\*\*Total|\n###|\n##|$)/i
  );
  if (!checklistMatch) return [];

  const rowRegex = /\|\s*\*?\*?([^|*]+)\*?\*?\s*\|\s*([^|]*?)\s*\|\s*([^|]*)\|/g;
  const anchors: ComplexityAnchor[] = [];
  let match: RegExpExecArray | null;

  while ((match = rowRegex.exec(checklistMatch[0])) !== null) {
    const name = match[1].trim();
    if (isHeaderRow(name)) continue;

    anchors.push({
      name,
      score: parseScore(match[2]),
      notes: match[3].trim() || undefined,
    });
  }

  return anchors;
}

function isHeaderRow(name: string): boolean {
  return name.toLowerCase() === 'anchor' || name.includes('---');
}

const TOTAL_SCORE_PATTERNS: readonly RegExp[] = [
  /\*\*Total Score\*\*[^|]*\|[^|]*\|\s*[*`]*(\d+)[*`]*\s*\|/i,
  /\*\*Total[:\s]*(\d+)\*\*/i,
  /\*\*Total:?\*\*\s*(\d+)/i,
  /^Total:?\s*(\d+)/im,
];

function parseTotalScore(markdown: string): number | undefined {
  for (const pattern of TOTAL_SCORE_PATTERNS) {
    const match = markdown.match(pattern);
    if (match) return parseInt(match[1], 10);
  }
  return undefined;
}

const TIER_EMOJI_TO_TIER: Record<string, ComplexityTier> = {
  '🟢': 'Low',
  '🟡': 'Medium',
  '🔴': 'High',
};

function parseTier(markdown: string): ComplexityTier | null {
  const tierRowMatch = markdown.match(
    /\*\*Complexity Tier\*\*[^|]*\|[^|]*\|\s*(.+?)\s*\|/
  );
  if (!tierRowMatch) return null;

  const cell = tierRowMatch[1].trim();
  for (const [emoji, tier] of Object.entries(TIER_EMOJI_TO_TIER)) {
    if (cell.includes(emoji)) return tier;
  }
  return null;
}
