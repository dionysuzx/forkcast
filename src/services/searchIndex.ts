import MiniSearch from 'minisearch';

export interface IndexedContent {
  callType: string;
  callDate: string;
  callNumber: string;
  type: 'transcript' | 'chat' | 'agenda' | 'action';
  timestamp: string;
  speaker?: string;
  text: string;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

const MINISEARCH_OPTIONS = {
  fields: ['text', 'speaker'],
  storeFields: [
    'callType',
    'callDate',
    'callNumber',
    'type',
    'timestamp',
    'speaker',
    'text',
  ],
  tokenize,
};

class SearchIndexService {
  private static instance: SearchIndexService;
  private miniSearch: MiniSearch | null = null;
  private loadPromise: Promise<void> | null = null;

  private constructor() {}

  static getInstance(): SearchIndexService {
    if (!SearchIndexService.instance) {
      SearchIndexService.instance = new SearchIndexService();
    }
    return SearchIndexService.instance;
  }

  async ensureLoaded(): Promise<void> {
    if (this.miniSearch) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}search-index.json`);
      const json = await res.text();
      this.miniSearch = MiniSearch.loadJSON(json, MINISEARCH_OPTIONS);
    })();

    await this.loadPromise;
    this.loadPromise = null;
  }

  async search(
    query: string,
    options: {
      callType?: 'ACDC' | 'ACDE' | 'ACDT';
      contentType?: 'transcript' | 'chat' | 'agenda' | 'action';
      limit?: number;
    } = {},
  ): Promise<IndexedContent[]> {
    await this.ensureLoaded();

    const results = this.miniSearch!.search(query, {
      prefix: true,
      fuzzy: 0.2,
      boost: { text: 2 },
      combineWith: 'AND',
      filter: (result) => {
        if (options.callType && result.callType.toUpperCase() !== options.callType) return false;
        if (options.contentType && result.type !== options.contentType) return false;
        return true;
      },
      boostDocument: (_id, _term, storedFields) => {
        if (!storedFields) return 1;
        if (storedFields.type === 'action') return 1.5;
        if (storedFields.type === 'agenda') return 1.3;
        return 1;
      },
    });

    const limit = options.limit || 100;
    return results.slice(0, limit).map((r) => ({
      callType: r.callType as string,
      callDate: r.callDate as string,
      callNumber: r.callNumber as string,
      type: r.type as IndexedContent['type'],
      timestamp: r.timestamp as string,
      speaker: r.speaker as string | undefined,
      text: r.text as string,
    }));
  }
}

export const searchIndexService = SearchIndexService.getInstance();
