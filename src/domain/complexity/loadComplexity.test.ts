import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCachedComplexitySnapshot,
  invalidateComplexitySnapshot,
  loadComplexitySnapshot,
} from './loadComplexity';

type FetchHandler = (url: string) => Promise<Response>;

const respondJson = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200 });

const respondText = (body: string): Response =>
  new Response(body, { status: 200 });

const installFetch = (handler: FetchHandler) => {
  vi.stubGlobal('fetch', vi.fn((url: string) => handler(url)));
};

beforeEach(() => {
  invalidateComplexitySnapshot();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadComplexitySnapshot', () => {
  it('caches the successful snapshot for synchronous reads on remount', async () => {
    installFetch(async (url) => {
      if (url.includes('contents/complexity_assessments')) {
        return respondJson([{ name: 'EIP-1.md' }]);
      }
      return respondText('**Total: 5**');
    });

    expect(getCachedComplexitySnapshot()).toBeNull();

    const snapshot = await loadComplexitySnapshot();

    expect(snapshot.availableEipNumbers).toEqual([1]);
    expect(getCachedComplexitySnapshot()).toBe(snapshot);
  });

  it('does not cache a rejected load — retries can succeed without invalidation', async () => {
    let directoryCalls = 0;
    installFetch(async (url) => {
      if (url.includes('contents/complexity_assessments')) {
        directoryCalls += 1;
        if (directoryCalls === 1) {
          return new Response('rate limited', { status: 429 });
        }
        return respondJson([{ name: 'EIP-1.md' }]);
      }
      return respondText('**Total: 5**');
    });

    await expect(loadComplexitySnapshot()).rejects.toThrow(/429/);
    expect(getCachedComplexitySnapshot()).toBeNull();

    const snapshot = await loadComplexitySnapshot();
    expect(snapshot.availableEipNumbers).toEqual([1]);
    expect(directoryCalls).toBe(2);
  });

  it('dedupes concurrent loads onto a single in-flight request', async () => {
    let directoryCalls = 0;
    installFetch(async (url) => {
      if (url.includes('contents/complexity_assessments')) {
        directoryCalls += 1;
        return respondJson([{ name: 'EIP-1.md' }]);
      }
      return respondText('**Total: 5**');
    });

    const [a, b] = await Promise.all([
      loadComplexitySnapshot(),
      loadComplexitySnapshot(),
    ]);

    expect(a).toBe(b);
    expect(directoryCalls).toBe(1);
  });

  it('keeps an in-flight load when invalidated so a fresh call joins the current request', async () => {
    let directoryCalls = 0;
    let releaseDirectory!: (response: Response) => void;
    const directoryGate = new Promise<Response>((resolve) => {
      releaseDirectory = resolve;
    });

    installFetch(async (url) => {
      if (url.includes('contents/complexity_assessments')) {
        directoryCalls += 1;
        return directoryGate;
      }
      return respondText('**Total: 5**');
    });

    const first = loadComplexitySnapshot();
    invalidateComplexitySnapshot();
    const second = loadComplexitySnapshot();

    releaseDirectory(respondJson([{ name: 'EIP-1.md' }]));

    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(directoryCalls).toBe(1);
  });
});
