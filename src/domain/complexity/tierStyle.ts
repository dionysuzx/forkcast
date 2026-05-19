import { type ComplexityTier } from './complexity';

const TIER_BADGE_CLASSES: Record<ComplexityTier, string> = {
  Low: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300',
  Medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300',
  High: 'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-300',
};

const TIER_EMOJI: Record<ComplexityTier, string> = {
  Low: '🟢',
  Medium: '🟡',
  High: '🔴',
};

export const tierBadgeClasses = (tier: ComplexityTier): string => TIER_BADGE_CLASSES[tier];

export const tierEmoji = (tier: ComplexityTier): string => TIER_EMOJI[tier];
