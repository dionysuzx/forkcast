import { useCallback, useEffect, useState } from 'react';
import {
  EMPTY_COMPLEXITY_SNAPSHOT,
  type ComplexitySnapshot,
} from './complexity';
import {
  getCachedComplexitySnapshot,
  invalidateComplexitySnapshot,
  loadComplexitySnapshot,
} from './loadComplexity';

interface UseComplexityDataResult {
  snapshot: ComplexitySnapshot;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useComplexityData(): UseComplexityDataResult {
  const [snapshot, setSnapshot] = useState<ComplexitySnapshot>(
    () => getCachedComplexitySnapshot() ?? EMPTY_COMPLEXITY_SNAPSHOT
  );
  const [loading, setLoading] = useState(() => getCachedComplexitySnapshot() === null);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await loadComplexitySnapshot());
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (getCachedComplexitySnapshot()) return;
    void load();
  }, [load]);

  const refetch = useCallback(() => {
    invalidateComplexitySnapshot();
    void load();
  }, [load]);

  return { snapshot, loading, error, refetch };
}
