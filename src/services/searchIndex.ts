import MiniSearch, { type AsPlainObject, type Options, type SearchResult } from 'minisearch';
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

interface IndexedSearchDocument extends IndexedContent {
  id: number;
  searchableText: string;
}

interface StoredIndex {
  version: string;
  documents: IndexedContent[];
  miniSearch: AsPlainObject;
  callIndex: Record<string, number[]>;
  lastUpdated: number;
}

interface SearchManifestShard {
  id: string;
  docsFile: string;
  miniFile: string;
  hash?: string;
}

interface SearchManifest {
  indexVersion: string;
  builtAt?: string;
  shards: SearchManifestShard[];
}

interface CachedShardPayload {
  docs: IndexedContent[];
  miniSearch: AsPlainObject;
}

interface PrebuiltShard {
  meta: SearchManifestShard;
  docs: IndexedContent[];
  miniSearch: MiniSearch<IndexedSearchDocument>;
}

export interface SearchIndex {
  documents: IndexedContent[];
  miniSearch: MiniSearch<IndexedSearchDocument>;
  callIndex: Map<string, number[]>;
  lastUpdated: number;
}

export interface SearchLoadState {
  mode: 'uninitialized' | 'prebuilt' | 'runtime-fallback';
  loadedShards: number;
  totalShards: number;
  loadingShards: boolean;
  prebuiltReady: boolean;
  fullyLoaded: boolean;
  usingFallback: boolean;
}

class SearchIndexService {
  private static instance: SearchIndexService;

  // Runtime fallback index (existing path)
  private index: SearchIndex | null = null;
  private indexPromise: Promise<SearchIndex> | null = null;

  // Prebuilt index state (new path)
  private manifest: SearchManifest | null = null;
  private manifestPromise: Promise<SearchManifest | null> | null = null;
  private shardsByRecency: SearchManifestShard[] = [];
  private readonly loadedShards = new Map<string, PrebuiltShard>();
  private readonly shardPromises = new Map<string, Promise<PrebuiltShard | null>>();
  private backgroundPreloadPromise: Promise<void> | null = null;
  private prebuiltDisabled = false;
  private bootstrapInitialized = false;

  // Runtime fallback storage
  private readonly DB_NAME = 'forkcast_search';
  private readonly DB_VERSION = 2;
  private readonly STORE_NAME = 'search_index';
  private readonly SHARD_STORE = 'search_shards';
  private readonly INDEX_VERSION = '2.0.0-minisearch';
  private readonly MAX_INDEX_AGE = 24 * 60 * 60 * 1000; // 24 hours
  private readonly BUILD_CONCURRENCY = 8;

  // Prebuilt loading
  private readonly PREBUILT_MANIFEST_PATH = '/search/manifest.json';
  private readonly INITIAL_SHARD_COUNT = 2;

  private constructor() {}

  static getInstance(): SearchIndexService {
    if (!SearchIndexService.instance) {
      SearchIndexService.instance = new SearchIndexService();
    }
    return SearchIndexService.instance;
  }

  bootstrap(): void {
    if (this.bootstrapInitialized) {
      return;
    }

    this.bootstrapInitialized = true;
    void this.ensureManifest();

    if (typeof window === 'undefined') {
      return;
    }

    const startBackgroundPreload = () => {
      if (!this.canEagerPreload()) {
        return;
      }
      void this.preloadRemainingShardsInBackground();
    };

    if (document.readyState === 'complete') {
      window.setTimeout(startBackgroundPreload, 0);
      return;
    }

    window.addEventListener('load', () => {
      window.setTimeout(startBackgroundPreload, 0);
    }, { once: true });
  }

  private canEagerPreload(): boolean {
    if (typeof navigator === 'undefined') {
      return false;
    }

    const nav = navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
      mozConnection?: { saveData?: boolean; effectiveType?: string };
      webkitConnection?: { saveData?: boolean; effectiveType?: string };
    };

    const connection = nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
    if (!connection) {
      return false;
    }

    if (connection.saveData) {
      return false;
    }

    return connection.effectiveType !== 'slow-2g' && connection.effectiveType !== '2g';
  }

  private getInitialShards(manifest: SearchManifest): SearchManifestShard[] {
    return this.getShardsByRecency()
      .slice(0, Math.min(this.INITIAL_SHARD_COUNT, manifest.shards.length));
  }

  private hasInitialShardsLoaded(manifest: SearchManifest): boolean {
    const initialShards = this.getInitialShards(manifest);
    return initialShards.length > 0 && initialShards.every((shard) => this.loadedShards.has(shard.id));
  }

  private getMiniSearchOptions(): Options<IndexedSearchDocument> {
    return {
      idField: 'id',
      fields: ['searchableText'],
      tokenize: (text: string) => this.tokenize(text),
      processTerm: (term: string) => {
        const normalized = term.toLowerCase().trim();
        return normalized.length > 1 ? normalized : null;
      }
    };
  }

  private createMiniSearch(): MiniSearch<IndexedSearchDocument> {
    return new MiniSearch<IndexedSearchDocument>(this.getMiniSearchOptions());
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .map(token => token.trim())
      .filter(token => token.length > 1);
  }

  private normalize(text: string): string {
    return text.toLowerCase().trim();
  }

  private toSearchDocument(content: IndexedContent, id: number): IndexedSearchDocument {
    const searchableText = content.speaker
      ? `${content.speaker} ${content.text}`
      : content.text;

    return {
      ...content,
      id,
      searchableText
    };
  }

  private getDocumentFromResult(documents: IndexedContent[], result: SearchResult): IndexedContent | null {
    const rawId = result.id;
    const docIndex = typeof rawId === 'number' ? rawId : Number(rawId);

    if (!Number.isInteger(docIndex) || docIndex < 0 || docIndex >= documents.length) {
      return null;
    }

    return documents[docIndex];
  }

  private isValidManifest(input: unknown): input is SearchManifest {
    if (!input || typeof input !== 'object') {
      return false;
    }

    const manifest = input as Partial<SearchManifest>;
    if (typeof manifest.indexVersion !== 'string' || !manifest.indexVersion) {
      return false;
    }

    if (!Array.isArray(manifest.shards)) {
      return false;
    }

    return manifest.shards.every((shard) => (
      shard
      && typeof shard.id === 'string'
      && typeof shard.docsFile === 'string'
      && typeof shard.miniFile === 'string'
    ));
  }

  private getShardsByRecency(): SearchManifestShard[] {
    return this.shardsByRecency;
  }

  private async fetchManifest(): Promise<SearchManifest | null> {
    try {
      const response = await fetch(this.PREBUILT_MANIFEST_PATH, { cache: 'no-store' });
      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      if (!this.isValidManifest(data)) {
        return null;
      }

      return data;
    } catch {
      return null;
    }
  }

  private async ensureManifest(): Promise<SearchManifest | null> {
    if (this.prebuiltDisabled) {
      return this.manifest;
    }

    if (this.manifest) {
      return this.manifest;
    }

    if (this.manifestPromise) {
      return this.manifestPromise;
    }

    this.manifestPromise = this.fetchManifest();
    try {
      const manifest = await this.manifestPromise;
      this.manifest = manifest;
      this.shardsByRecency = manifest
        ? [...manifest.shards].sort((a, b) => b.id.localeCompare(a.id))
        : [];
      return manifest;
    } finally {
      this.manifestPromise = null;
    }
  }

  private async loadShard(shard: SearchManifestShard): Promise<PrebuiltShard | null> {
    if (this.loadedShards.has(shard.id)) {
      return this.loadedShards.get(shard.id) ?? null;
    }

    const existingPromise = this.shardPromises.get(shard.id);
    if (existingPromise) {
      return existingPromise;
    }

    const loadPromise = (async () => {
      const manifest = await this.ensureManifest();
      if (!manifest) {
        return null;
      }

      const cacheKey = this.buildShardCacheKey(manifest, shard);
      const cached = await this.loadShardFromCache(cacheKey);
      if (cached) {
        try {
          const loadedFromCache: PrebuiltShard = {
            meta: shard,
            docs: cached.docs,
            miniSearch: MiniSearch.loadJS<IndexedSearchDocument>(
              cached.miniSearch,
              this.getMiniSearchOptions()
            )
          };

          this.loadedShards.set(shard.id, loadedFromCache);
          return loadedFromCache;
        } catch {
          // Ignore corrupted shard cache and re-fetch from network.
        }
      }

      const versionTag = shard.hash ?? `${manifest.indexVersion}-${shard.id}`;
      const query = `?v=${encodeURIComponent(versionTag)}`;

      try {
        const [docsResponse, miniResponse] = await Promise.all([
          fetch(`/search/${shard.docsFile}${query}`),
          fetch(`/search/${shard.miniFile}${query}`)
        ]);

        if (!docsResponse.ok || !miniResponse.ok) {
          return null;
        }

        const docs = await docsResponse.json();
        const miniSearchRaw = await miniResponse.json();

        if (!Array.isArray(docs) || !miniSearchRaw || typeof miniSearchRaw !== 'object') {
          return null;
        }

        const miniSearch = MiniSearch.loadJS<IndexedSearchDocument>(
          miniSearchRaw as AsPlainObject,
          this.getMiniSearchOptions()
        );

        const loaded: PrebuiltShard = {
          meta: shard,
          docs: docs as IndexedContent[],
          miniSearch
        };

        this.loadedShards.set(shard.id, loaded);
        void this.saveShardToCache(cacheKey, {
          docs: loaded.docs,
          miniSearch: miniSearchRaw as AsPlainObject
        });
        return loaded;
      } catch {
        return null;
      }
    })();

    this.shardPromises.set(shard.id, loadPromise);

    try {
      return await loadPromise;
    } finally {
      this.shardPromises.delete(shard.id);
    }
  }

  private readonly SHARD_LOAD_CONCURRENCY = 4;

  private async loadShards(
    shards: SearchManifestShard[],
    onProgress?: (progress: number) => void
  ): Promise<{ requested: number; loaded: number }> {
    if (shards.length === 0) {
      if (onProgress) {
        onProgress(100);
      }
      return { requested: 0, loaded: 0 };
    }

    let completed = 0;
    let loaded = 0;
    let nextIndex = 0;

    const worker = async () => {
      while (true) {
        const idx = nextIndex;
        nextIndex += 1;
        if (idx >= shards.length) return;

        const shardResult = await this.loadShard(shards[idx]);
        if (shardResult) {
          loaded += 1;
        }

        completed += 1;
        if (onProgress) {
          onProgress((completed / shards.length) * 100);
        }
      }
    };

    const concurrency = Math.min(this.SHARD_LOAD_CONCURRENCY, shards.length);
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    return { requested: shards.length, loaded };
  }

  private async ensureInitialShards(onProgress?: (progress: number) => void): Promise<boolean> {
    const manifest = await this.ensureManifest();
    if (!manifest || manifest.shards.length === 0) {
      return false;
    }

    const initialShards = this.getInitialShards(manifest);

    const missing = initialShards.filter(shard => !this.loadedShards.has(shard.id));
    if (missing.length === 0) {
      if (onProgress) {
        onProgress(100);
      }
      return true;
    }

    const { requested, loaded } = await this.loadShards(missing, onProgress);
    return loaded === requested;
  }

  private async preloadRemainingShardsInBackground(): Promise<void> {
    if (this.prebuiltDisabled || this.backgroundPreloadPromise) {
      return;
    }

    this.backgroundPreloadPromise = (async () => {
      const manifest = await this.ensureManifest();
      if (!manifest || manifest.shards.length === 0) {
        return;
      }

      const remaining = this.getShardsByRecency()
        .filter(shard => !this.loadedShards.has(shard.id));

      if (remaining.length === 0) {
        return;
      }

      // Keep already-loaded shards available even if some background loads fail.
      // Missing shards remain unloaded and will be retried on future preload attempts.
      await this.loadShards(remaining);
    })();

    try {
      await this.backgroundPreloadPromise;
    } finally {
      this.backgroundPreloadPromise = null;
    }
  }

  private useRuntimeFallback(): void {
    this.prebuiltDisabled = true;
    this.manifest = null;
    this.manifestPromise = null;
    this.shardsByRecency = [];
    this.loadedShards.clear();
    this.shardPromises.clear();
  }

  private scoreAndFilter(
    rawResults: Array<{ doc: IndexedContent; score: number }>,
    queryNormalized: string,
    queryTokens: string[],
    options: {
      callType?: 'all' | 'ACDC' | 'ACDE' | 'ACDT';
      contentType?: 'all' | 'transcript' | 'chat' | 'agenda' | 'action';
      limit?: number;
    }
  ): IndexedContent[] {
    const scoredDocs: Array<{ doc: IndexedContent; score: number }> = [];

    for (const result of rawResults) {
      const doc = result.doc;

      if (options.callType && options.callType !== 'all' && doc.callType.toUpperCase() !== options.callType) {
        continue;
      }
      if (options.contentType && options.contentType !== 'all' && doc.type !== options.contentType) {
        continue;
      }

      const searchableText = this.normalize(doc.speaker ? `${doc.speaker} ${doc.text}` : doc.text);

      let finalScore = result.score;
      if (searchableText.includes(queryNormalized)) {
        finalScore += 10;
      }
      if (queryTokens.every(token => searchableText.includes(token))) {
        finalScore += 5;
      }
      if (doc.type === 'action') finalScore += 3;
      if (doc.type === 'agenda') finalScore += 2;

      scoredDocs.push({ doc, score: finalScore });
    }

    scoredDocs.sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (Math.abs(scoreDiff) > 0.01) return scoreDiff;
      return b.doc.callDate.localeCompare(a.doc.callDate);
    });

    const limit = options.limit || 100;
    return scoredDocs.slice(0, limit).map(item => item.doc);
  }

  private async searchPrebuilt(
    queryNormalized: string,
    queryTokens: string[],
    options: {
      callType?: 'all' | 'ACDC' | 'ACDE' | 'ACDT';
      contentType?: 'all' | 'transcript' | 'chat' | 'agenda' | 'action';
      limit?: number;
    }
  ): Promise<IndexedContent[] | null> {
    const manifest = await this.ensureManifest();
    if (!manifest || manifest.shards.length === 0) {
      return null;
    }

    if (!this.hasInitialShardsLoaded(manifest)) {
      const ready = await this.ensureInitialShards();
      if (!ready) {
        return null;
      }
    }

    const rawResults: Array<{ doc: IndexedContent; score: number }> = [];

    for (const shard of this.loadedShards.values()) {
      const shardResults = shard.miniSearch.search(queryNormalized, { combineWith: 'OR' });

      for (const result of shardResults) {
        const doc = this.getDocumentFromResult(shard.docs, result);
        if (doc) {
          rawResults.push({ doc, score: result.score });
        }
      }
    }

    return this.scoreAndFilter(rawResults, queryNormalized, queryTokens, options);
  }

  // Open IndexedDB (runtime fallback only)
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
        if (!db.objectStoreNames.contains(this.SHARD_STORE)) {
          db.createObjectStore(this.SHARD_STORE);
        }
      };
    });
  }

  private buildShardCacheKey(manifest: SearchManifest, shard: SearchManifestShard): string {
    return `${manifest.indexVersion}:${shard.id}:${shard.hash ?? ''}`;
  }

  private async loadShardFromCache(cacheKey: string): Promise<CachedShardPayload | null> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([this.SHARD_STORE], 'readonly');
      const store = transaction.objectStore(this.SHARD_STORE);

      const data = await new Promise<CachedShardPayload | undefined>((resolve, reject) => {
        const request = store.get(cacheKey);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      db.close();
      return data ?? null;
    } catch {
      return null;
    }
  }

  private async saveShardToCache(cacheKey: string, payload: CachedShardPayload): Promise<void> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([this.SHARD_STORE], 'readwrite');
      const store = transaction.objectStore(this.SHARD_STORE);

      await new Promise<void>((resolve, reject) => {
        const request = store.put(payload, cacheKey);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      db.close();
    } catch (error) {
      console.error('Error saving shard cache:', error);
    }
  }

  // Load runtime fallback index from IndexedDB
  private async loadFromStorage(): Promise<SearchIndex | null> {
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

      if (data.version !== this.INDEX_VERSION) return null;
      if (Date.now() - data.lastUpdated > this.MAX_INDEX_AGE) return null;

      const miniSearch = MiniSearch.loadJS<IndexedSearchDocument>(
        data.miniSearch,
        this.getMiniSearchOptions()
      );

      return {
        documents: data.documents,
        miniSearch,
        callIndex: new Map(Object.entries(data.callIndex)),
        lastUpdated: data.lastUpdated
      };
    } catch (error) {
      console.error('Error loading search index from storage:', error);
      return null;
    }
  }

  // Save runtime fallback index to IndexedDB
  private async saveToStorage(index: SearchIndex): Promise<void> {
    try {
      const data: StoredIndex = {
        version: this.INDEX_VERSION,
        documents: index.documents,
        miniSearch: index.miniSearch.toJSON(),
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

  private async fetchTextIfExists(url: string): Promise<string | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      return response.text();
    } catch {
      return null;
    }
  }

  private async fetchJsonIfExists<T>(url: string): Promise<T | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      return await response.json() as T;
    } catch {
      return null;
    }
  }

  private async loadCallEntries(call: CallInfo): Promise<IndexedContent[]> {
    const baseUrl = `/artifacts/${call.type}/${call.date}_${call.number}`;
    const transcriptPromise = this.fetchTextIfExists(`${baseUrl}/transcript_corrected.vtt`)
      .then(async corrected => corrected ?? this.fetchTextIfExists(`${baseUrl}/transcript.vtt`));

    const [transcript, chat, tldr] = await Promise.all([
      transcriptPromise,
      this.fetchTextIfExists(`${baseUrl}/chat.txt`),
      this.fetchJsonIfExists<TldrData>(`${baseUrl}/tldr.json`)
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

  // Build runtime fallback index
  async buildIndex(onProgress?: (progress: number) => void): Promise<SearchIndex> {
    const index: SearchIndex = {
      documents: [],
      miniSearch: this.createMiniSearch(),
      callIndex: new Map(),
      lastUpdated: Date.now()
    };

    const totalCalls = protocolCalls.length;
    if (totalCalls === 0) {
      await this.saveToStorage(index);
      return index;
    }

    const parsedCalls = new Array<{ callKey: string; entries: IndexedContent[] } | null>(totalCalls).fill(null);
    let nextCallIndex = 0;
    let processedCalls = 0;

    const worker = async () => {
      while (true) {
        const callIndex = nextCallIndex;
        nextCallIndex += 1;

        if (callIndex >= totalCalls) {
          return;
        }

        const call = protocolCalls[callIndex];
        const callKey = `${call.type}_${call.date}_${call.number}`;

        try {
          const entries = await this.loadCallEntries(call);
          parsedCalls[callIndex] = { callKey, entries };
        } catch (error) {
          console.error(`Error indexing call ${callKey}:`, error);
          parsedCalls[callIndex] = { callKey, entries: [] };
        } finally {
          processedCalls += 1;
          if (onProgress) {
            onProgress((processedCalls / totalCalls) * 100);
          }
        }
      }
    };

    const concurrency = Math.min(this.BUILD_CONCURRENCY, totalCalls);
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    for (const parsedCall of parsedCalls) {
      if (!parsedCall || parsedCall.entries.length === 0) continue;

      const callDocIndices: number[] = [];
      const miniSearchDocs: IndexedSearchDocument[] = [];

      for (const entry of parsedCall.entries) {
        const docIndex = index.documents.length;
        index.documents.push(entry);
        callDocIndices.push(docIndex);
        miniSearchDocs.push(this.toSearchDocument(entry, docIndex));
      }

      index.miniSearch.addAll(miniSearchDocs);
      index.callIndex.set(parsedCall.callKey, callDocIndices);
    }

    await this.saveToStorage(index);

    return index;
  }

  // Parse transcript for indexing
  private parseTranscriptForIndex(content: string, call: CallInfo): IndexedContent[] {
    const lines = content.split('\n');
    const results: IndexedContent[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      const timestampMatch = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3})/);
      if (timestampMatch && i + 1 < lines.length) {
        const startTime = timestampMatch[1].split('.')[0];

        const contentLines: string[] = [];
        let j = i + 1;
        while (j < lines.length && lines[j].trim() !== '' && !lines[j].match(/^\d+$/)) {
          contentLines.push(lines[j]);
          j++;
        }

        if (contentLines.length > 0) {
          const mergedContent = contentLines.join(' ');
          const speakerMatch = mergedContent.match(/^([^:]+):\s*(.+)/);

          if (speakerMatch) {
            const text = speakerMatch[2].trim();
            results.push({
              callType: call.type,
              callDate: call.date,
              callNumber: call.number,
              type: 'transcript',
              timestamp: startTime,
              speaker: speakerMatch[1].trim(),
              text
            });
          }
        }

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

      if (message.startsWith('Reacted to ')) continue;

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

  // Parse TLDR for indexing
  private parseTldrForIndex(tldrData: TldrData, call: CallInfo): IndexedContent[] {
    const results: IndexedContent[] = [];

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

  // Search across prebuilt shards first, runtime fallback second.
  async search(query: string, options: {
    callType?: 'all' | 'ACDC' | 'ACDE' | 'ACDT';
    contentType?: 'all' | 'transcript' | 'chat' | 'agenda' | 'action';
    limit?: number;
  } = {}): Promise<IndexedContent[]> {
    this.bootstrap();

    const queryNormalized = this.normalize(query);
    if (!queryNormalized) return [];

    const queryTokens = this.tokenize(queryNormalized);
    if (queryTokens.length === 0) return [];

    if (!this.prebuiltDisabled) {
      const prebuiltResults = await this.searchPrebuilt(queryNormalized, queryTokens, options);
      if (prebuiltResults !== null) {
        void this.preloadRemainingShardsInBackground();
        return prebuiltResults;
      }

      this.useRuntimeFallback();
    }

    const index = await this.getRuntimeIndex();
    const miniSearchResults = index.miniSearch.search(queryNormalized, {
      combineWith: 'OR'
    });

    const rawResults: Array<{ doc: IndexedContent; score: number }> = [];

    for (const result of miniSearchResults) {
      const doc = this.getDocumentFromResult(index.documents, result);
      if (doc) {
        rawResults.push({ doc, score: result.score });
      }
    }

    return this.scoreAndFilter(rawResults, queryNormalized, queryTokens, options);
  }

  private async getRuntimeIndex(onProgress?: (progress: number) => void): Promise<SearchIndex> {
    if (this.index && !this.needsRuntimeRebuild()) {
      return this.index;
    }

    if (this.index && this.needsRuntimeRebuild()) {
      this.index = null;
    }

    if (this.indexPromise) {
      return this.indexPromise;
    }

    const storedIndex = await this.loadFromStorage();
    if (storedIndex) {
      this.index = storedIndex;
      return storedIndex;
    }

    this.indexPromise = this.buildIndex(onProgress);
    try {
      this.index = await this.indexPromise;
      return this.index;
    } finally {
      this.indexPromise = null;
    }
  }

  // Ensure search is warm: prebuilt shards if available, otherwise runtime index.
  async getIndex(onProgress?: (progress: number) => void): Promise<void> {
    this.bootstrap();

    if (!this.prebuiltDisabled) {
      const ready = await this.ensureInitialShards(onProgress);
      if (ready) {
        void this.preloadRemainingShardsInBackground();
        return;
      }

      this.useRuntimeFallback();
    }

    await this.getRuntimeIndex(onProgress);
  }

  // Force rebuild and clear all cached state.
  async rebuildIndex(onProgress?: (progress: number) => void): Promise<void> {
    this.index = null;
    this.indexPromise = null;

    this.prebuiltDisabled = false;
    this.manifest = null;
    this.manifestPromise = null;
    this.shardsByRecency = [];
    this.loadedShards.clear();
    this.shardPromises.clear();

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
      console.error('Error clearing runtime index cache:', error);
    }

    await this.getIndex(onProgress);
  }

  private needsRuntimeRebuild(): boolean {
    if (!this.index) return true;
    return Date.now() - this.index.lastUpdated > this.MAX_INDEX_AGE;
  }

  needsRebuild(): boolean {
    const state = this.getLoadState();

    if (state.mode === 'runtime-fallback') {
      return this.needsRuntimeRebuild();
    }

    if (state.mode === 'prebuilt') {
      return !state.prebuiltReady;
    }

    return true;
  }

  getLoadState(): SearchLoadState {
    const manifest = this.manifest;
    const totalShards = manifest?.shards.length ?? 0;
    const loadedShards = this.loadedShards.size;

    const usingFallback = this.prebuiltDisabled || !!this.index || !!this.indexPromise;
    const mode: SearchLoadState['mode'] = usingFallback
      ? 'runtime-fallback'
      : this.manifest
        ? 'prebuilt'
        : 'uninitialized';

    const prebuiltReady = manifest ? this.hasInitialShardsLoaded(manifest) : false;
    const loadingShards = this.shardPromises.size > 0 || !!this.backgroundPreloadPromise;

    const fullyLoaded = mode === 'prebuilt'
      ? totalShards > 0 && loadedShards >= totalShards
      : !!this.index;

    return {
      mode,
      loadedShards,
      totalShards,
      loadingShards,
      prebuiltReady,
      fullyLoaded,
      usingFallback
    };
  }

  getStats(): { documentCount: number; tokenCount: number; callCount: number; lastUpdated: Date | null } | null {
    const state = this.getLoadState();

    if (state.mode === 'runtime-fallback' && this.index) {
      return {
        documentCount: this.index.documents.length,
        tokenCount: this.index.miniSearch.termCount,
        callCount: this.index.callIndex.size,
        lastUpdated: new Date(this.index.lastUpdated)
      };
    }

    if (state.mode !== 'prebuilt' || this.loadedShards.size === 0) {
      return null;
    }

    const documentCount = Array.from(this.loadedShards.values())
      .reduce((sum, shard) => sum + shard.docs.length, 0);

    const tokenCount = Array.from(this.loadedShards.values())
      .reduce((sum, shard) => sum + shard.miniSearch.termCount, 0);

    const callKeys = new Set<string>();
    this.loadedShards.forEach((shard) => {
      shard.docs.forEach((doc) => {
        callKeys.add(`${doc.callType}_${doc.callDate}_${doc.callNumber}`);
      });
    });

    return {
      documentCount,
      tokenCount,
      callCount: callKeys.size,
      lastUpdated: this.manifest?.builtAt ? new Date(this.manifest.builtAt) : null
    };
  }
}

export const searchIndexService = SearchIndexService.getInstance();
