import type { Call } from '../data/calls';

type CallInfo = Pick<Call, 'type' | 'date' | 'number'>;

interface CorpusEntry extends CallInfo {
  transcript?: string;
  chat?: string;
  tldr?: TldrData;
}

interface TldrHighlightItem {
  timestamp: string;
  highlight: string;
}

interface TldrActionItem {
  timestamp: string;
  action: string;
  owner: string;
}

interface TldrData {
  meeting: string;
  highlights: { [category: string]: TldrHighlightItem[] };
  action_items: TldrActionItem[];
  decisions: { timestamp: string; decision: string }[];
  targets: { timestamp: string; target: string }[];
}

export interface IndexedContent {
  callType: string;
  callDate: string;
  callNumber: string;
  type: 'transcript' | 'chat' | 'agenda' | 'action';
  timestamp: string;
  speaker?: string;
  text: string;
  tokens: string[]; // Pre-processed tokens for faster searching
  normalizedText: string; // Lowercase text for case-insensitive search
}

export interface SearchIndex {
  documents: IndexedContent[];
  invertedIndex: Map<string, Set<number>>; // token -> document indices
  callIndex: Map<string, number[]>; // call identifier -> document indices
  lastUpdated: number;
}

interface StoredIndex {
  version: string;
  corpusHash?: string;
  documents: IndexedContent[];
  invertedIndex: Record<string, number[]>;
  callIndex: Record<string, number[]>;
  lastUpdated: number;
}

interface LoadedIndex {
  index: SearchIndex;
  corpusHash: string | null;
}

class SearchIndexService {
  private static instance: SearchIndexService;
  private index: SearchIndex | null = null;
  private indexCorpusHash: string | null = null;
  private indexPromise: Promise<SearchIndex> | null = null;
  private readonly DB_NAME = 'forkcast_search';
  private readonly DB_VERSION = 1;
  private readonly STORE_NAME = 'search_index';
  private readonly INDEX_VERSION = '2.0.0';
  private readonly MAX_INDEX_AGE = 24 * 60 * 60 * 1000; // 24-hour hard cap to recover from stale hash caches
  private readonly HASH_MISMATCH_RETRY_AGE = 10 * 60 * 1000; // Avoid tight rebuild loops when hash endpoint is cache-skewed

  private constructor() {}

  static getInstance(): SearchIndexService {
    if (!SearchIndexService.instance) {
      SearchIndexService.instance = new SearchIndexService();
    }
    return SearchIndexService.instance;
  }

  // Tokenize text for indexing
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Remove punctuation
      .split(/\s+/)
      .filter(token => token.length > 1); // Filter out single characters
  }

  // Normalize text for searching
  private normalize(text: string): string {
    return text.toLowerCase().trim();
  }

  // Open IndexedDB
  private async openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME);
        }
      };
    });
  }

  // Fetch the current corpus hash from the deployed version file
  private async fetchCorpusHash(): Promise<string | null> {
    try {
      const res = await fetch('/search-corpus-version.json');
      if (!res.ok) return null;
      const { hash } = await res.json();
      return hash ?? null;
    } catch {
      return null;
    }
  }

  // Match scripts/compile-search-corpus.mjs: sha256(JSON payload).slice(0, 12)
  private async hashCorpusPayload(payload: string): Promise<string | null> {
    try {
      if (!globalThis.crypto?.subtle) return null;
      const bytes = new TextEncoder().encode(payload);
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      const hex = Array.from(new Uint8Array(digest))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
      return hex.slice(0, 12);
    } catch {
      return null;
    }
  }

  private isIndexExpired(lastUpdated: number): boolean {
    return Date.now() - lastUpdated > this.MAX_INDEX_AGE;
  }

  private shouldRetryAfterHashMismatch(lastUpdated: number): boolean {
    return Date.now() - lastUpdated > this.HASH_MISMATCH_RETRY_AGE;
  }

  // Use hash-based invalidation when available, otherwise fall back to TTL.
  private async shouldInvalidate(lastUpdated: number, storedCorpusHash: string | null): Promise<boolean> {
    const isExpired = this.isIndexExpired(lastUpdated);
    const currentHash = await this.fetchCorpusHash();
    if (currentHash !== null) {
      if (storedCorpusHash !== currentHash) {
        if (isExpired) return true;
        return this.shouldRetryAfterHashMismatch(lastUpdated);
      }
      return isExpired;
    }
    return isExpired;
  }

  // Load index from IndexedDB (validates INDEX_VERSION + corpus hash)
  private async loadFromStorage(options: { allowStale?: boolean } = {}): Promise<LoadedIndex | null> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([this.STORE_NAME], 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const data = await new Promise<StoredIndex | undefined>((resolve, reject) => {
        const request = store.get('index');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      db.close();

      if (!data) return null;

      // Check code version
      if (data.version !== this.INDEX_VERSION) return null;

      const storedCorpusHash = data.corpusHash ?? null;
      if (!options.allowStale && (await this.shouldInvalidate(data.lastUpdated, storedCorpusHash))) return null;

      // Reconstruct Maps from stored data
      return {
        corpusHash: storedCorpusHash,
        index: {
        documents: data.documents,
        invertedIndex: new Map(
          Object.entries(data.invertedIndex).map(([key, value]) => [key, new Set(value as number[])])
        ),
        callIndex: new Map(Object.entries(data.callIndex)),
        lastUpdated: data.lastUpdated
        }
      };
    } catch (error) {
      console.error('Error loading search index from storage:', error);
      return null;
    }
  }

  // Save index to IndexedDB
  private async saveToStorage(index: SearchIndex, corpusHash?: string): Promise<void> {
    try {
      const data = {
        version: this.INDEX_VERSION,
        corpusHash,
        documents: index.documents,
        invertedIndex: Object.fromEntries(
          Array.from(index.invertedIndex.entries()).map(([key, value]) => [key, Array.from(value)])
        ),
        callIndex: Object.fromEntries(index.callIndex.entries()),
        lastUpdated: index.lastUpdated
      };

      const db = await this.openDB();
      const transaction = db.transaction([this.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);

      await new Promise<void>((resolve, reject) => {
        const request = store.put(data, 'index');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      db.close();
    } catch (error) {
      console.error('Error saving search index to storage:', error);
    }
  }

  // Add entries to index, updating inverted index and call doc indices
  private addEntries(entries: IndexedContent[], index: SearchIndex, callDocIndices: number[]): void {
    entries.forEach(entry => {
      const docIndex = index.documents.length;
      index.documents.push(entry);
      callDocIndices.push(docIndex);

      entry.tokens.forEach(token => {
        if (!index.invertedIndex.has(token)) {
          index.invertedIndex.set(token, new Set());
        }
        index.invertedIndex.get(token)!.add(docIndex);
      });
    });
  }

  // Build the search index from the pre-compiled corpus
  private async buildIndex(): Promise<SearchIndex> {
    const index: SearchIndex = {
      documents: [],
      invertedIndex: new Map(),
      callIndex: new Map(),
      lastUpdated: Date.now()
    };

    let corpus: CorpusEntry[];
    let corpusPayload: string;
    try {
      const res = await fetch('/search-corpus.json');
      if (!res.ok) {
        throw new Error(`Failed to fetch search corpus: ${res.status}`);
      }
      corpusPayload = await res.text();
      corpus = JSON.parse(corpusPayload) as CorpusEntry[];
    } catch (error) {
      console.error('Search corpus fetch failed:', error);
      throw error;
    }

    for (const entry of corpus) {
      try {
        const call: CallInfo = { type: entry.type, date: entry.date, number: entry.number };
        const callKey = `${call.type}_${call.date}_${call.number}`;
        const callDocIndices: number[] = [];

        if (entry.transcript) {
          this.addEntries(this.parseTranscriptForIndex(entry.transcript, call), index, callDocIndices);
        }
        if (entry.chat) {
          this.addEntries(this.parseChatForIndex(entry.chat, call), index, callDocIndices);
        }
        if (entry.tldr) {
          this.addEntries(this.parseTldrForIndex(entry.tldr, call), index, callDocIndices);
        }

        if (callDocIndices.length > 0) {
          index.callIndex.set(callKey, callDocIndices);
        }
      } catch (error) {
        console.error(`Error indexing ${entry.type} ${entry.date} #${entry.number}:`, error);
      }
    }

    // Persist the hash for the exact corpus payload that was indexed.
    // Fall back to the deployed version hash when local digest APIs are unavailable.
    const corpusHash = (await this.hashCorpusPayload(corpusPayload)) ?? (await this.fetchCorpusHash());
    await this.saveToStorage(index, corpusHash ?? undefined);
    this.indexCorpusHash = corpusHash;

    return index;
  }

  // Parse transcript for indexing
  private parseTranscriptForIndex(content: string, call: CallInfo): IndexedContent[] {
    const lines = content.split('\n');
    const results: IndexedContent[] = [];

    // VTT format has entries like:
    // <cue number>
    // <timestamp> --> <timestamp>
    // <speaker>: <text>
    // <blank line>

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Look for timestamp line
      const timestampMatch = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3})/);
      if (timestampMatch && i + 1 < lines.length) {
        const startTime = timestampMatch[1].split('.')[0];

        // Next line(s) should be content
        const contentLines: string[] = [];
        let j = i + 1;
        while (j < lines.length && lines[j].trim() !== '' && !lines[j].match(/^\d+$/)) {
          contentLines.push(lines[j]);
          j++;
        }

        if (contentLines.length > 0) {
          const content = contentLines.join(' ');
          const speakerMatch = content.match(/^([^:]+):\s*(.+)/);

          if (speakerMatch) {
            const text = speakerMatch[2].trim();
            results.push({
              callType: call.type,
              callDate: call.date,
              callNumber: call.number,
              type: 'transcript',
              timestamp: startTime,
              speaker: speakerMatch[1].trim(),
              text: text,
              tokens: this.tokenize(text + ' ' + speakerMatch[1]),
              normalizedText: this.normalize(text)
            });
          }
        }

        // Skip ahead
        i = j;
      }
    }

    return results;
  }

  // Parse chat for indexing
  private parseChatForIndex(content: string, call: CallInfo): IndexedContent[] {
    const lines = content.split('\n').filter(line => line.trim());
    const results: IndexedContent[] = [];

    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split('\t');
      if (parts.length < 3) continue;

      const [timestamp, speaker, ...messageParts] = parts;
      let message = messageParts.join('\t');

      // Skip reactions (covers both "Reacted to "..." and "Reacted to ...")
      if (message.startsWith('Reacted to ')) continue;

      // Handle replies
      if (message.startsWith('Replying to "') || message.startsWith('In reply to "')) {
        if (i + 1 < lines.length && !lines[i + 1].includes('\t')) {
          message = lines[i + 1].trim();
          i++;
        }
      }

      if (message.trim()) {
        results.push({
          callType: call.type,
          callDate: call.date,
          callNumber: call.number,
          type: 'chat',
          timestamp,
          speaker: speaker.trim(),
          text: message.trim(),
          tokens: this.tokenize(message + ' ' + speaker),
          normalizedText: this.normalize(message)
        });
      }
    }

    return results;
  }

  // Parse TLDR for indexing (highlights, action items, decisions, targets)
  private parseTldrForIndex(tldrData: TldrData, call: CallInfo): IndexedContent[] {
    const results: IndexedContent[] = [];

    // Index highlights (categorized agenda items)
    if (tldrData.highlights) {
      const allHighlights: TldrHighlightItem[] = Object.values(tldrData.highlights).flat();
      allHighlights.forEach(item => {
        if (item.highlight) {
          results.push({
            callType: call.type,
            callDate: call.date,
            callNumber: call.number,
            type: 'agenda',
            timestamp: item.timestamp || '00:00:00',
            text: item.highlight,
            tokens: this.tokenize(item.highlight),
            normalizedText: this.normalize(item.highlight)
          });
        }
      });
    }

    // Index action items
    if (tldrData.action_items) {
      tldrData.action_items.forEach(item => {
        if (item.action) {
          results.push({
            callType: call.type,
            callDate: call.date,
            callNumber: call.number,
            type: 'action',
            timestamp: item.timestamp || '00:00:00',
            speaker: item.owner,
            text: item.action,
            tokens: this.tokenize(item.action + ' ' + (item.owner || '')),
            normalizedText: this.normalize(item.action)
          });
        }
      });
    }

    // Index decisions as agenda items
    if (tldrData.decisions) {
      tldrData.decisions.forEach(item => {
        if (item.decision) {
          results.push({
            callType: call.type,
            callDate: call.date,
            callNumber: call.number,
            type: 'agenda',
            timestamp: item.timestamp || '00:00:00',
            text: item.decision,
            tokens: this.tokenize(item.decision),
            normalizedText: this.normalize(item.decision)
          });
        }
      });
    }

    // Index targets as agenda items
    if (tldrData.targets) {
      tldrData.targets.forEach(item => {
        if (item.target) {
          results.push({
            callType: call.type,
            callDate: call.date,
            callNumber: call.number,
            type: 'agenda',
            timestamp: item.timestamp || '00:00:00',
            text: item.target,
            tokens: this.tokenize(item.target),
            normalizedText: this.normalize(item.target)
          });
        }
      });
    }

    return results;
  }

  // Search the index
  async search(query: string, options: {
    callType?: 'all' | 'ACDC' | 'ACDE' | 'ACDT';
    contentType?: 'all' | 'transcript' | 'chat' | 'agenda' | 'action';
    limit?: number;
  } = {}): Promise<IndexedContent[]> {
    // Ensure index is loaded
    const index = await this.getIndex();

    const queryTokens = this.tokenize(query);
    const queryNormalized = this.normalize(query);

    // Find documents containing query tokens
    const docScores = new Map<number, number>();

    // Score based on token matches
    queryTokens.forEach(token => {
      const docIndices = index.invertedIndex.get(token);
      if (docIndices) {
        docIndices.forEach(docIndex => {
          const currentScore = docScores.get(docIndex) || 0;
          docScores.set(docIndex, currentScore + 1);
        });
      }
    });

    // Get documents with scores
    const scoredDocs: Array<{ doc: IndexedContent; score: number }> = [];

    docScores.forEach((score, docIndex) => {
      const doc = index.documents[docIndex];

      // Apply filters
      if (options.callType && options.callType !== 'all' && doc.callType.toUpperCase() !== options.callType) {
        return;
      }
      if (options.contentType && options.contentType !== 'all' && doc.type !== options.contentType) {
        return;
      }

      // Calculate final score
      let finalScore = score;

      // Bonus for exact phrase match
      if (doc.normalizedText.includes(queryNormalized)) {
        finalScore += 10;
      }

      // Bonus for all tokens present
      const allTokensPresent = queryTokens.every(token =>
        doc.tokens.includes(token)
      );
      if (allTokensPresent) {
        finalScore += 5;
      }

      // Type bonuses
      if (doc.type === 'action') finalScore += 3;
      if (doc.type === 'agenda') finalScore += 2;

      scoredDocs.push({ doc, score: finalScore });
    });

    // Sort by score and date
    scoredDocs.sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (Math.abs(scoreDiff) > 1) return scoreDiff;

      // For similar scores, sort by date (newest first)
      return b.doc.callDate.localeCompare(a.doc.callDate);
    });

    // Apply limit
    const limit = options.limit || 100;
    return scoredDocs.slice(0, limit).map(item => item.doc);
  }

  // Get or build the index
  async getIndex(options: { revalidate?: boolean } = {}): Promise<SearchIndex> {
    if (this.indexPromise) return this.indexPromise;
    if (this.index && !options.revalidate) return this.index;

    this.indexPromise = (async () => {
      const previousIndex = this.index;
      const previousCorpusHash = this.indexCorpusHash;

      if (previousIndex && options.revalidate) {
        const shouldInvalidateInMemory = await this.shouldInvalidate(previousIndex.lastUpdated, previousCorpusHash);
        if (!shouldInvalidateInMemory) {
          return previousIndex;
        }
      }

      try {
        const loadedIndex = await this.loadFromStorage();
        if (loadedIndex) {
          this.index = loadedIndex.index;
          this.indexCorpusHash = loadedIndex.corpusHash;
          return this.index;
        }

        this.index = await this.buildIndex();
        return this.index;
      } catch (error) {
        if (previousIndex) {
          this.index = previousIndex;
          this.indexCorpusHash = previousCorpusHash;
          console.error('Search index revalidation failed; keeping previous in-memory index:', error);
          return previousIndex;
        }

        const staleIndex = await this.loadFromStorage({ allowStale: true });
        if (staleIndex) {
          this.index = staleIndex.index;
          this.indexCorpusHash = staleIndex.corpusHash;
          console.error('Search index refresh failed; falling back to stale cached index:', error);
          return this.index;
        }

        throw error;
      }
    })();

    try {
      return await this.indexPromise;
    } finally {
      this.indexPromise = null;
    }
  }

  // Preload index in the background (fire-and-forget)
  preload(): void {
    this.getIndex().catch(err => console.error('Search index preload failed:', err));
  }
}

export const searchIndexService = SearchIndexService.getInstance();
