import { EIP, Champion } from '../types/eip';
import eipsDataRaw from './eips.json';

// Normalize data to support both old `champion` (singular) and new `champions` (array) formats
interface RawForkRelationship {
  forkName: string;
  statusHistory: Array<{
    status: 'Proposed' | 'Considered' | 'Scheduled' | 'Declined' | 'Included' | 'Withdrawn';
    call: `${'acdc' | 'acde' | 'acdt'}/${number}` | null;
    date: string | null;
    timestamp?: number;
  }>;
  isHeadliner?: boolean;
  wasHeadlinerCandidate?: boolean;
  champion?: Champion;
  champions?: Champion[];
  presentationHistory?: Array<{
    type: 'headliner_proposal' | 'headliner_presentation' | 'presentation' | 'debate';
    call?: `${'acdc' | 'acde' | 'acdt'}/${number}`;
    link?: string;
    date: string;
    timestamp?: number;
  }>;
}

interface RawEIP extends Omit<EIP, 'forkRelationships'> {
  forkRelationships: RawForkRelationship[];
}

function normalizeEipData(rawData: RawEIP[]): EIP[] {
  return rawData.map(eip => ({
    ...eip,
    forkRelationships: eip.forkRelationships.map(fr => {
      const { champion, champions, ...rest } = fr;
      // Prefer non-empty champions array, otherwise fall back to singular champion
      const normalizedChampions = (champions && champions.length > 0)
        ? champions
        : (champion ? [champion] : undefined);
      return {
        ...rest,
        champions: normalizedChampions,
      };
    }),
  }));
}

export const eipsData = normalizeEipData(eipsDataRaw as RawEIP[]);
