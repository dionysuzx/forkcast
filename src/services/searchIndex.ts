import { protocolCalls } from '../data/calls';

interface CallInfo {
  type: string;
  date: string;
  number: string;
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
}

export interface SearchIndex {
  documents: IndexedContent[];
  invertedIndex: Map<string, Set<number>>; // token -> document indices
  callIndex: Map<string, number[]>; // call identifier -> document indices
  lastUpdated: number;
}

interface StoredIndex {
  version: string;
  source?: 'static' | 'runtime';
  generatedAt?: string;
  documents: IndexedContent[];
  invertedIndex: Record<string, number[]>;
  callIndex?: Record<string, number[]>;
  lastUpdated: number;
}

interface SearchIndexVersionManifest {
  version: string;
  generatedAt?: string;
}

class SearchIndexService {
  private static instance: SearchIndexService;
  private index: SearchIndex | null = null;
  private indexPromise: Promise<SearchIndex> | null = null;
  private indexVersionPromise: Promise<string> | null = null;
  private hasManifestVersion = false;
  private readonly DB_NAME = 'forkcast_search';
  private readonly DB_VERSION = 1;
  private readonly STORE_NAME = 'search_index';
  // Keep in sync with scripts/generate-search-index.mjs.
  private readonly INDEX_SCHEMA_VERSION = '3.0.0';
  private readonly INDEX_BUILD_CONCURRENCY = 8;
  private readonly VERSION_MANIFEST_TIMEOUT_MS = 1200;
  private readonly LOCAL_INDEX_VERSION = this.getIndexVersion();
  private readonly RUNTIME_FALLBACK_VERSION = `${this.LOCAL_INDEX_VERSION}:runtime`;
  private indexVersion = this.LOCAL_INDEX_VERSION;
  private readonly STATIC_INDEX_PATH = `${import.meta.env.BASE_URL}search-index.json`;
  private readonly STATIC_INDEX_VERSION_PATH = `${import.meta.env.BASE_URL}search-index-version.json`;

  private constructor() {}

  static getInstance(): SearchIndexService {
    if (!SearchIndexService.instance) {
      SearchIndexService.instance = new SearchIndexService();
    }
    return SearchIndexService.instance;
  }

  private getIndexVersion(): string {
    // Local fallback when the static version manifest is unavailable.
    const signature = protocolCalls
      .map(call => `${call.type}:${call.date}:${call.number}`)
      .join('|');
    let hash = 0;
    for (let i = 0; i < signature.length; i++) {
      hash = ((hash * 31) + signature.charCodeAt(i)) >>> 0;
    }

    return `${this.INDEX_SCHEMA_VERSION}:${hash.toString(16)}`;
  }

  private async resolveIndexVersion(): Promise<string> {
    if (this.indexVersionPromise) {
      return this.indexVersionPromise;
    }

    this.indexVersionPromise = (async () => {
      if (typeof window === 'undefined') {
        return this.indexVersion;
      }

      try {
        const cacheBustedUrl = `${this.STATIC_INDEX_VERSION_PATH}?v=${encodeURIComponent(this.LOCAL_INDEX_VERSION)}`;
        const response = await fetch(cacheBustedUrl, { cache: 'no-cache' });
        if (!response.ok) {
          return this.indexVersion;
        }

        const manifest = await response.json() as SearchIndexVersionManifest;
        if (!manifest.version) {
          return this.indexVersion;
        }

        this.indexVersion = manifest.version;
        this.hasManifestVersion = true;
        return manifest.version;
      } catch (error) {
        console.error('Error loading search index version manifest:', error);
        return this.indexVersion;
      }
    })().finally(() => {
      this.indexVersionPromise = null;
    });

    return this.indexVersionPromise;
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

  private buildEntryTokens(entry: IndexedContent): string[] {
    return this.tokenize(`${entry.text} ${entry.speaker ?? ''}`);
  }

  private toStoredIndex(
    index: SearchIndex,
    options?: { version?: string; source?: 'static' | 'runtime' }
  ): StoredIndex {
    return {
      version: options?.version ?? this.indexVersion,
      source: options?.source ?? 'runtime',
      generatedAt: new Date().toISOString(),
      documents: index.documents,
      invertedIndex: Object.fromEntries(
        Array.from(index.invertedIndex.entries()).map(([key, value]) => [key, Array.from(value)])
      ),
      callIndex: Object.fromEntries(index.callIndex.entries()),
      lastUpdated: index.lastUpdated
    };
  }

  private toRuntimeIndex(data: StoredIndex): SearchIndex {
    return {
      documents: data.documents,
      invertedIndex: new Map(
        Object.entries(data.invertedIndex).map(([key, value]) => [key, new Set(value)])
      ),
      callIndex: new Map(Object.entries(data.callIndex ?? {})),
      lastUpdated: data.lastUpdated
    };
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

  // Load index from IndexedDB
  private async loadFromStorage(options?: { allowRuntimeFallback?: boolean }): Promise<SearchIndex | null> {
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
      const source = data.source ?? 'runtime';

      // Check version strictly when manifest/static version is known.
      if (this.hasManifestVersion) {
        if (data.version === this.indexVersion && source === 'static') {
          return this.toRuntimeIndex(data);
        }

        if (options?.allowRuntimeFallback) {
          const schemaPrefix = `${this.INDEX_SCHEMA_VERSION}:`;
          if (source === 'runtime' && data.version?.startsWith(schemaPrefix)) {
            return this.toRuntimeIndex(data);
          }
        }

        return null;
      } else {
        // If manifest lookup failed (offline/transient), allow same-schema cache.
        const schemaPrefix = `${this.INDEX_SCHEMA_VERSION}:`;
        if (!data.version?.startsWith(schemaPrefix)) return null;
      }

      return this.toRuntimeIndex(data);
    } catch (error) {
      console.error('Error loading search index from storage:', error);
      return null;
    }
  }

  // Save index to IndexedDB
  private async saveToStorage(
    index: SearchIndex,
    options?: { version?: string; source?: 'static' | 'runtime' }
  ): Promise<void> {
    try {
      const data = this.toStoredIndex(index, options);

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

  private async loadFromStaticFile(onProgress?: (progress: number) => void): Promise<SearchIndex | null> {
    try {
      if (onProgress) {
        onProgress(5);
      }

      const cacheBustedUrl = `${this.STATIC_INDEX_PATH}?v=${encodeURIComponent(this.indexVersion)}`;
      const response = await fetch(cacheBustedUrl, { cache: 'force-cache' });
      if (!response.ok) return null;

      const data = await response.json() as StoredIndex;
      if (data.version !== this.indexVersion) {
        if (this.indexVersion === this.LOCAL_INDEX_VERSION) {
          this.indexVersion = data.version;
          this.hasManifestVersion = true;
        } else {
          return null;
        }
      }

      const index = this.toRuntimeIndex(data);
      await this.saveToStorage(index, { version: this.indexVersion, source: 'static' });

      if (onProgress) {
        onProgress(100);
      }

      return index;
    } catch (error) {
      console.error('Error loading static search index:', error);
      return null;
    }
  }

  private async loadCanonicalIndex(onProgress?: (progress: number) => void): Promise<SearchIndex | null> {
    // Canonical means either manifest-matching static cache or static file.
    const storedIndex = await this.loadFromStorage();
    if (storedIndex) {
      return storedIndex;
    }

    return this.loadFromStaticFile(onProgress);
  }

  private addEntriesToIndex(index: SearchIndex, callKey: string, entries: IndexedContent[]): void {
    if (entries.length === 0) return;

    const callDocIndices: number[] = [];

    entries.forEach(entry => {
      const docIndex = index.documents.length;
      index.documents.push(entry);
      callDocIndices.push(docIndex);

      this.buildEntryTokens(entry).forEach(token => {
        if (!index.invertedIndex.has(token)) {
          index.invertedIndex.set(token, new Set());
        }
        index.invertedIndex.get(token)!.add(docIndex);
      });
    });

    index.callIndex.set(callKey, callDocIndices);
  }

  private async fetchAndParseCall(call: CallInfo): Promise<IndexedContent[]> {
    const baseUrl = `/artifacts/${call.type}/${call.date}_${call.number}`;

    const [transcript, chat, tldr] = await Promise.all([
      // Prefer corrected transcript if available
      fetch(`${baseUrl}/transcript_corrected.vtt`).then(res => res.ok ? res.text() : null).catch(() => null)
        .then(corrected => corrected ?? fetch(`${baseUrl}/transcript.vtt`).then(res => res.ok ? res.text() : null).catch(() => null)),
      fetch(`${baseUrl}/chat.txt`).then(res => res.ok ? res.text() : null).catch(() => null),
      fetch(`${baseUrl}/tldr.json`).then(res => res.ok ? res.json() as Promise<TldrData> : null).catch(() => null)
    ]);

    const entries: IndexedContent[] = [];

    if (transcript) {
      entries.push(...this.parseTranscriptForIndex(transcript, call));
    }
    if (chat) {
      entries.push(...this.parseChatForIndex(chat, call));
    }
    if (tldr) {
      entries.push(...this.parseTldrForIndex(tldr, call));
    }

    return entries;
  }

  // Build the search index
  async buildIndex(onProgress?: (progress: number) => void): Promise<SearchIndex> {
    const index: SearchIndex = {
      documents: [],
      invertedIndex: new Map(),
      callIndex: new Map(),
      lastUpdated: Date.now()
    };

    const totalCalls = protocolCalls.length;
    let processedCalls = 0;
    let nextCallIndex = 0;

    const worker = async (): Promise<void> => {
      while (nextCallIndex < totalCalls) {
        const call = protocolCalls[nextCallIndex];
        nextCallIndex++;
        const callKey = `${call.type}_${call.date}_${call.number}`;

        try {
          const entries = await this.fetchAndParseCall(call);
          this.addEntriesToIndex(index, callKey, entries);
        } catch (error) {
          console.error(`Error indexing call ${callKey}:`, error);
        }

        processedCalls++;
        if (onProgress) {
          onProgress((processedCalls / totalCalls) * 100);
        }
      }
    };

    const concurrency = Math.min(this.INDEX_BUILD_CONCURRENCY, totalCalls);
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    // Runtime-built indexes are explicitly marked as fallback so they
    // never masquerade as canonical static indexes.
    await this.saveToStorage(index, { version: this.RUNTIME_FALLBACK_VERSION, source: 'runtime' });

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
              text: text
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
          text: message.trim()
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
            text: item.highlight
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
            text: item.action
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
            text: item.decision
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
            text: item.target
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
      const searchableText = this.normalize(`${doc.speaker ? `${doc.speaker} ` : ''}${doc.text}`);

      // Bonus for exact phrase match
      if (searchableText.includes(queryNormalized)) {
        finalScore += 10;
      }

      // Bonus for all tokens present
      const allTokensPresent = queryTokens.every(token =>
        index.invertedIndex.get(token)?.has(docIndex) ?? false
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
  async getIndex(onProgress?: (progress: number) => void): Promise<SearchIndex> {
    // Return existing index if available
    if (this.index) {
      return this.index;
    }

    // Return ongoing index build if in progress
    if (this.indexPromise) {
      return this.indexPromise;
    }

    this.indexPromise = (async () => {
      const versionResolution = this.resolveIndexVersion();
      const manifestResolvedQuickly = await Promise.race([
        versionResolution.then(() => true).catch(() => true),
        new Promise<boolean>(resolve => {
          setTimeout(() => resolve(false), this.VERSION_MANIFEST_TIMEOUT_MS);
        })
      ]);

      if (manifestResolvedQuickly) {
        const canonicalIndex = await this.loadCanonicalIndex(onProgress);
        if (canonicalIndex) {
          return canonicalIndex;
        }

        // If static fetch fails, use cached runtime fallback (if present)
        // before doing another runtime rebuild.
        const runtimeFallbackIndex = await this.loadFromStorage({ allowRuntimeFallback: true });
        if (runtimeFallbackIndex) {
          return runtimeFallbackIndex;
        }

        // Build new index as fallback (e.g. local dev)
        return this.buildIndex(onProgress);
      }

      // Manifest resolution is slow/hanging: avoid blocking the UI if a cache exists.
      const cachedIndex = await this.loadFromStorage({ allowRuntimeFallback: true });
      if (cachedIndex) {
        // Finish strict canonical refresh in the background once manifest resolves.
        void versionResolution
          .then(async () => {
            const canonicalIndex = await this.loadCanonicalIndex();
            if (canonicalIndex) {
              this.index = canonicalIndex;
            }
          })
          .catch(() => undefined);

        return cachedIndex;
      }

      // No cache available: wait for manifest resolution and continue with canonical flow.
      await versionResolution.catch(() => undefined);

      const canonicalAfterWait = await this.loadCanonicalIndex(onProgress);
      if (canonicalAfterWait) {
        return canonicalAfterWait;
      }

      return this.buildIndex(onProgress);
    })()
      .then(builtIndex => {
        this.index = builtIndex;
        return builtIndex;
      })
      .finally(() => {
        this.indexPromise = null;
      });

    return this.indexPromise;
  }

  // Force rebuild the index
  async rebuildIndex(onProgress?: (progress: number) => void): Promise<void> {
    this.index = null;
    this.indexPromise = null;
    await this.resolveIndexVersion();

    // Clear IndexedDB
    try {
      const db = await this.openDB();
      const transaction = db.transaction([this.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      await new Promise<void>((resolve, reject) => {
        const request = store.delete('index');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      db.close();
    } catch (error) {
      console.error('Error clearing index:', error);
    }

    this.index = await this.buildIndex(onProgress);
  }

  // Warm index in the background (used on /calls page to hide modal latency).
  async warmup(): Promise<void> {
    await this.getIndex();
  }

  // Get index statistics
  getStats(): { documentCount: number; tokenCount: number; callCount: number; lastUpdated: Date | null } | null {
    if (!this.index) return null;

    return {
      documentCount: this.index.documents.length,
      tokenCount: this.index.invertedIndex.size,
      callCount: this.index.callIndex.size,
      lastUpdated: new Date(this.index.lastUpdated)
    };
  }
}

export const searchIndexService = SearchIndexService.getInstance();
