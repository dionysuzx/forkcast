export type ComplexityTier = 'Low' | 'Medium' | 'High';

export interface ComplexityAnchor {
  readonly name: string;
  readonly score: number;
  readonly notes?: string;
}

export interface EipComplexity {
  readonly eipNumber: number;
  readonly totalScore: number;
  readonly tier: ComplexityTier;
  readonly anchors: readonly ComplexityAnchor[];
  readonly assessmentUrl: string;
}

export interface ComplexitySnapshot {
  readonly byEipNumber: ReadonlyMap<number, EipComplexity>;
  readonly availableEipNumbers: readonly number[];
}

export const EMPTY_COMPLEXITY_SNAPSHOT: ComplexitySnapshot = {
  byEipNumber: new Map(),
  availableEipNumbers: [],
};

const TIER_MEDIUM_THRESHOLD = 10;
const TIER_HIGH_THRESHOLD = 20;

export function classifyTier(totalScore: number): ComplexityTier {
  if (totalScore < TIER_MEDIUM_THRESHOLD) return 'Low';
  if (totalScore < TIER_HIGH_THRESHOLD) return 'Medium';
  return 'High';
}

export function sumAnchorScores(anchors: readonly ComplexityAnchor[]): number {
  return anchors.reduce((sum, anchor) => sum + anchor.score, 0);
}

const ASSESSMENT_URL_BASE =
  'https://github.com/ethsteel/pm/blob/main/complexity_assessments/EIPs';

export interface ComplexityDraft {
  readonly eipNumber: number;
  readonly anchors: readonly ComplexityAnchor[];
  readonly totalScoreOverride?: number;
  readonly tierOverride?: ComplexityTier;
}

export function buildComplexity(draft: ComplexityDraft): EipComplexity {
  const totalScore = draft.totalScoreOverride ?? sumAnchorScores(draft.anchors);
  const tier = draft.tierOverride ?? classifyTier(totalScore);

  return {
    eipNumber: draft.eipNumber,
    totalScore,
    tier,
    anchors: draft.anchors,
    assessmentUrl: `${ASSESSMENT_URL_BASE}/EIP-${draft.eipNumber}.md`,
  };
}

export function findComplexityByEip(
  snapshot: ComplexitySnapshot,
  eipNumber: number
): EipComplexity | null {
  return snapshot.byEipNumber.get(eipNumber) ?? null;
}
