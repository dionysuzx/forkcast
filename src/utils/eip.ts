import { protocolCalls, type Call } from '../data/calls';
import { EIP, ForkRelationship, InclusionStage, ProposalType, ForkInclusionStatus } from '../types/eip';

export interface ForkDecisionEvent {
  status: ForkInclusionStatus;
  callPath: string;
  callType: Call['type'];
  callNumber: string;
  callDate: string;
  reason?: string;
}

/**
 * Collect call-linked decisions for an EIP within a fork ordered oldest -> newest.
 */
export const getForkDecisionHistory = (
  eip: EIP,
  forkName?: string,
  calls: Call[] = protocolCalls
): ForkDecisionEvent[] => {
  if (!forkName) return [];

  const normalizedFork = forkName.toLowerCase();
  const events: ForkDecisionEvent[] = [];

  calls.forEach(call => {
    const decisions = call.eipDecisions?.filter(
      decision =>
        decision.eip === eip.id &&
        decision.fork.toLowerCase() === normalizedFork
    ) ?? [];

    decisions.forEach(decision => {
      events.push({
        status: decision.status,
        callPath: call.path,
        callType: call.type,
        callNumber: call.number,
        callDate: call.date,
        reason: decision.reason,
      });
    });
  });

  return events.sort((a, b) => a.callDate.localeCompare(b.callDate));
};

/**
 * Get the latest status value for a fork relationship.
 * Prefers the newest entry derived from call decisions, falling back to the legacy status field.
 */
export const getLatestForkStatus = (
  eip: EIP,
  forkName?: string,
  calls: Call[] = protocolCalls
): ForkInclusionStatus | string | undefined => {
  if (!forkName) return undefined;

  const forkRelationship = eip.forkRelationships.find(fork =>
    fork.forkName.toLowerCase() === forkName.toLowerCase()
  );

  const statusFromRelationship = forkRelationship?.status;
  const history = getForkDecisionHistory(eip, forkName, calls);
  const historyStatus = history.length > 0 ? history[history.length - 1]?.status : undefined;

  if (!historyStatus) {
    return statusFromRelationship;
  }

  if (!statusFromRelationship) {
    return historyStatus;
  }

  const statusRankings: Record<ForkInclusionStatus, number> = {
    Proposed: 1,
    Considered: 2,
    Scheduled: 3,
    Included: 4,
    Declined: 4,
  };

  const getStatusRank = (status?: string): number | null => {
    if (!status) return null;
    const rank = statusRankings[status as ForkInclusionStatus];
    return typeof rank === 'number' ? rank : null;
  };

  const relationshipRank = getStatusRank(statusFromRelationship);
  const historyRank = getStatusRank(historyStatus);

  if (relationshipRank === null || historyRank === null) {
    // Fall back to the legacy status to avoid regressions when ranks are unknown
    return statusFromRelationship || historyStatus;
  }

  return historyRank >= relationshipRank ? historyStatus : statusFromRelationship;
};

/**
 * Get the inclusion stage for an EIP in a specific fork
 */
export const getInclusionStage = (eip: EIP, forkName?: string): InclusionStage => {
  if (!forkName) return 'Unknown';

  const forkRelationship = eip.forkRelationships.find(fork =>
    fork.forkName.toLowerCase() === forkName.toLowerCase()
  );

  if (!forkRelationship) return 'Unknown';

  const status = getLatestForkStatus(eip, forkName);

  switch (status) {
    case 'Proposed':
      return 'Proposed for Inclusion';
    case 'Considered':
      return 'Considered for Inclusion';
    case 'Scheduled':
      return 'Scheduled for Inclusion';
    case 'Declined':
      return 'Declined for Inclusion';
    case 'Included':
      return 'Included';
    default:
      return 'Unknown';
  }
};

/**
 * Get the headliner discussion link for an EIP in a specific fork
 */
export const getHeadlinerDiscussionLink = (eip: EIP, forkName?: string): string | null => {
  if (!forkName) return null;

  const forkRelationship = eip.forkRelationships.find(fork =>
    fork.forkName.toLowerCase() === forkName.toLowerCase()
  );
  return forkRelationship?.headlinerDiscussionLink || null;
};

/**
 * Check if an EIP is a headliner for a specific fork
 */
export const isHeadliner = (eip: EIP, forkName?: string): boolean => {
  if (!forkName) return false;

  const forkRelationship = eip.forkRelationships.find(fork =>
    fork.forkName.toLowerCase() === forkName.toLowerCase()
  );
  return forkRelationship?.isHeadliner || false;
};

/**
 * Get the layer (EL/CL) for a headliner EIP in a specific fork
 */
export const getHeadlinerLayer = (eip: EIP, forkName?: string): string | null => {
  if (!forkName) return null;

  const forkRelationship = eip.forkRelationships.find(fork =>
    fork.forkName.toLowerCase() === forkName.toLowerCase()
  );
  return forkRelationship?.layer || null;
};

/**
 * Get the layer (EL/CL) for any EIP in a specific fork
 */
export const getEipLayer = (eip: EIP, forkName?: string): 'EL' | 'CL' | null => {
  if (!forkName) return null;

  const forkRelationship = eip.forkRelationships.find(fork =>
    fork.forkName.toLowerCase() === forkName.toLowerCase()
  );
  return forkRelationship?.layer as 'EL' | 'CL' | null || null;
};

/**
 * Get the layman title (remove EIP/RIP prefix)
 */
export const getLaymanTitle = (eip: EIP): string => {
  return eip.title.replace(/^(EIP|RIP)-\d+:\s*/, '');
};

/**
 * Get the proposal prefix (EIP or RIP)
 */
export const getProposalPrefix = (eip: EIP): ProposalType => {
  if (eip.title.startsWith('RIP-')) {
    return 'RIP';
  }
  return 'EIP';
};

/**
 * Get the specification URL for an EIP
 */
export const getSpecificationUrl = (eip: EIP): string => {
  if (eip.title.startsWith('RIP-')) {
    return `https://github.com/ethereum/RIPs/blob/master/RIPS/rip-${eip.id}.md`;
  }
  return `https://eips.ethereum.org/EIPS/eip-${eip.id}`;
};

/**
 * Check if an EIP was a headliner candidate for a specific fork
 */
export const wasHeadlinerCandidate = (eip: EIP, forkName?: string): boolean => {
  if (!forkName) return false;

  const forkRelationship = eip.forkRelationships.find(fork =>
    fork.forkName.toLowerCase() === forkName.toLowerCase()
  );
  return forkRelationship?.wasHeadlinerCandidate || false;
};

/**
 * Get the fork relationship for an EIP in a specific fork
 */
export const getForkRelationship = (eip: EIP, forkName?: string): ForkRelationship | undefined => {
  if (!forkName) return undefined;

  return eip.forkRelationships.find(fork =>
    fork.forkName.toLowerCase() === forkName.toLowerCase()
  );
};
