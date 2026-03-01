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

interface StoredRuntimeIndex {
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
  hash: string;
  docsHash: string;
  miniHash: string;
  docCount: number;
  callCount: number;
  fromDate: string;
  toDate: string;
}

interface SearchManifest {
  schemaVersion: number;
  indexVersion: string;
  shardStrategy: string;
  builtAt: string;
  appVersion: string;
  routingKey: string;
  shardCount: number;
  totalDocuments: number;
  totalCalls: number;
  shards: SearchManifestShard[];
}

interface StoredManifest {
  manifest: SearchManifest;
  savedAt: number;
}

interface StoredShard {
  cacheKey: string;
  indexVersion: string;
  shardId: string;
  hash: string;
  docs: IndexedContent[];
  miniSearch: AsPlainObject;
  savedAt: number;
}

interface LoadedSearchShard {
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

  private runtimeIndex: SearchIndex | null = null;
  private runtimeIndexPromise: Promise<SearchIndex> | null = null;

  private manifest: SearchManifest | null = null;
  private manifestPromise: Promise<SearchManifest | null> | null = null;

  private readonly loadedShards = new Map<string, LoadedSearchShard>();
  private readonly shardLoadPromises = new Map<string, Promise<LoadedSearchShard | null>>();
  private backgroundPreloadPromise: Promise<void> | null = null;

  private prebuiltDisabled = false;
  private bootstrapInitialized = false;

  private readonly DB_NAME = 'forkcast_search';
  private readonly DB_VERSION = 2;
  private readonly RUNTIME_STORE = 'runtime_index';
  private readonly META_STORE = 'search_meta';
  private readonly SHARD_STORE = 'search_shards';

  private readonly MANIFEST_KEY = 'prebuilt_manifest';
  private readonly RUNTIME_INDEX_KEY = 'runtime';

  private readonly RUNTIME_INDEX_VERSION = '3.0.0-runtime-fallback';
  private readonly MAX_RUNTIME_INDEX_AGE = 24 * 60 * 60 * 1000;
  private readonly BUILD_CONCURRENCY = 8;
  private readonly INITIAL_SHARD_COUNT = 2;
  private readonly PREBUILT_MANIFEST_PATH = '/search/manifest.json';

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
      return true;
    }

    if (connection.saveData) {
      return false;
    }

    return connection.effectiveType !== 'slow-2g' && connection.effectiveType !== '2g';
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
    if (!Array.isArray(manifest.shards)) {
      return false;
    }

    if (typeof manifest.indexVersion !== 'string' || !manifest.indexVersion) {
      return false;
    }

    return manifest.shards.every(shard => (
      shard
      && typeof shard.id === 'string'
      && typeof shard.docsFile === 'string'
      && typeof shard.miniFile === 'string'
      && typeof shard.hash === 'string'
    ));
  }

  private normalizeManifest(manifest: SearchManifest): SearchManifest {
    const sortedShards = [...manifest.shards].sort((a, b) => a.id.localeCompare(b.id));
    return {
      ...manifest,
      shards: sortedShards,
      shardCount: sortedShards.length
    };
  }

  private async fetchManifestFromNetwork(): Promise<SearchManifest | null> {
    try {
      const response = await fetch(this.PREBUILT_MANIFEST_PATH, { cache: 'no-store' });
      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      if (!this.isValidManifest(data)) {
        console.error('Invalid search manifest format.');
        return null;
      }

      return this.normalizeManifest(data);
    } catch {
      return null;
    }
  }

  private getShardsByRecency(manifest: SearchManifest): SearchManifestShard[] {
    return [...manifest.shards].sort((a, b) => b.id.localeCompare(a.id));
  }

  private getShardCacheKey(indexVersion: string, shard: SearchManifestShard): string {
    return `${indexVersion}:${shard.id}:${shard.hash}`;
  }

  private async openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.RUNTIME_STORE)) {
          db.createObjectStore(this.RUNTIME_STORE);
        }
        if (!db.objectStoreNames.contains(this.META_STORE)) {
          db.createObjectStore(this.META_STORE);
        }
        if (!db.objectStoreNames.contains(this.SHARD_STORE)) {
          db.createObjectStore(this.SHARD_STORE);
        }
      };
    });
  }

  private async getFromStore<T>(storeName: string, key: string): Promise<T | null> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);

      const result = await new Promise<T | undefined>((resolve, reject) => {
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      db.close();
      return result ?? null;
    } catch {
      return null;
    }
  }

  private async putToStore<T>(storeName: string, key: string, value: T): Promise<void> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);

      await new Promise<void>((resolve, reject) => {
        const request = store.put(value, key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      db.close();
    } catch (error) {
      console.error(`Error writing to ${storeName}:`, error);
    }
  }

  private async deleteFromStore(storeName: string, key: string): Promise<void> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);

      await new Promise<void>((resolve, reject) => {
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      db.close();
    } catch (error) {
      console.error(`Error deleting from ${storeName}:`, error);
    }
  }

  private async loadManifestFromStorage(): Promise<SearchManifest | null> {
    const stored = await this.getFromStore<StoredManifest>(this.META_STORE, this.MANIFEST_KEY);
    if (!stored || !this.isValidManifest(stored.manifest)) {
      return null;
    }

    return this.normalizeManifest(stored.manifest);
  }

  private async saveManifestToStorage(manifest: SearchManifest): Promise<void> {
    const payload: StoredManifest = {
      manifest,
      savedAt: Date.now()
    };

    await this.putToStore(this.META_STORE, this.MANIFEST_KEY, payload);
  }

  private async loadShardFromStorage(cacheKey: string): Promise<LoadedSearchShard | null> {
    const stored = await this.getFromStore<StoredShard>(this.SHARD_STORE, cacheKey);
    if (!stored) {
      return null;
    }

    try {
      const miniSearch = MiniSearch.loadJS<IndexedSearchDocument>(
        stored.miniSearch,
        this.getMiniSearchOptions()
      );

      return {
        meta: {
          id: stored.shardId,
          docsFile: '',
          miniFile: '',
          hash: stored.hash,
          docsHash: '',
          miniHash: '',
          docCount: stored.docs.length,
          callCount: 0,
          fromDate: '',
          toDate: ''
        },
        docs: stored.docs,
        miniSearch
      };
    } catch {
      await this.deleteFromStore(this.SHARD_STORE, cacheKey);
      return null;
    }
  }

  private async saveShardToStorage(
    cacheKey: string,
    indexVersion: string,
    shard: SearchManifestShard,
    docs: IndexedContent[],
    miniSearch: AsPlainObject
  ): Promise<void> {
    const payload: StoredShard = {
      cacheKey,
      indexVersion,
      shardId: shard.id,
      hash: shard.hash,
      docs,
      miniSearch,
      savedAt: Date.now()
    };

    await this.putToStore(this.SHARD_STORE, cacheKey, payload);
  }

  private async cleanupShardStorage(manifest: SearchManifest): Promise<void> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([this.SHARD_STORE], 'readwrite');
      const store = transaction.objectStore(this.SHARD_STORE);
      const allowedKeys = new Set(
        manifest.shards.map(shard => this.getShardCacheKey(manifest.indexVersion, shard))
      );

      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const request = store.getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      await Promise.all(keys.map((key) => {
        const keyString = String(key);
        if (allowedKeys.has(keyString)) {
          return Promise.resolve();
        }

        return new Promise<void>((resolve, reject) => {
          const deleteRequest = store.delete(key);
          deleteRequest.onsuccess = () => resolve();
          deleteRequest.onerror = () => reject(deleteRequest.error);
        });
      }));

      db.close();
    } catch (error) {
      console.error('Error cleaning stale shard cache:', error);
    }
  }

  private async ensureManifest(): Promise<SearchManifest | null> {
    if (this.prebuiltDisabled) {
      return null;
    }

    if (this.manifest) {
      return this.manifest;
    }

    if (this.manifestPromise) {
      return this.manifestPromise;
    }

    this.manifestPromise = (async () => {
      const networkManifest = await this.fetchManifestFromNetwork();
      if (networkManifest) {
        this.manifest = networkManifest;
        void this.saveManifestToStorage(networkManifest);
        void this.cleanupShardStorage(networkManifest);
        return networkManifest;
      }

      const storedManifest = await this.loadManifestFromStorage();
      if (storedManifest) {
        this.manifest = storedManifest;
        return storedManifest;
      }

      return null;
    })();

    try {
      return await this.manifestPromise;
    } finally {
      this.manifestPromise = null;
    }
  }

  private async fetchShardFromNetwork(shard: SearchManifestShard): Promise<{ docs: IndexedContent[]; miniSearch: AsPlainObject } | null> {
    try {
      const [docsResponse, miniResponse] = await Promise.all([
        fetch(`/search/${shard.docsFile}`),
        fetch(`/search/${shard.miniFile}`)
      ]);

      if (!docsResponse.ok || !miniResponse.ok) {
        return null;
      }

      const docs = await docsResponse.json();
      const miniSearch = await miniResponse.json();

      if (!Array.isArray(docs) || !miniSearch || typeof miniSearch !== 'object') {
        return null;
      }

      return {
        docs: docs as IndexedContent[],
        miniSearch: miniSearch as AsPlainObject
      };
    } catch {
      return null;
    }
  }

  private async loadShard(manifest: SearchManifest, shard: SearchManifestShard): Promise<LoadedSearchShard | null> {
    if (this.loadedShards.has(shard.id)) {
      return this.loadedShards.get(shard.id) ?? null;
    }

    const existingPromise = this.shardLoadPromises.get(shard.id);
    if (existingPromise) {
      return existingPromise;
    }

    const loadPromise = (async () => {
      const cacheKey = this.getShardCacheKey(manifest.indexVersion, shard);
      const cachedShard = await this.loadShardFromStorage(cacheKey);

      if (cachedShard) {
        const hydrated: LoadedSearchShard = {
          ...cachedShard,
          meta: shard
        };
        this.loadedShards.set(shard.id, hydrated);
        return hydrated;
      }

      const fetchedShard = await this.fetchShardFromNetwork(shard);
      if (!fetchedShard) {
        return null;
      }

      try {
        const miniSearch = MiniSearch.loadJS<IndexedSearchDocument>(
          fetchedShard.miniSearch,
          this.getMiniSearchOptions()
        );

        const loaded: LoadedSearchShard = {
          meta: shard,
          docs: fetchedShard.docs,
          miniSearch
        };

        this.loadedShards.set(shard.id, loaded);
        void this.saveShardToStorage(
          cacheKey,
          manifest.indexVersion,
          shard,
          fetchedShard.docs,
          fetchedShard.miniSearch
        );

        return loaded;
      } catch {
        return null;
      }
    })();

    this.shardLoadPromises.set(shard.id, loadPromise);

    try {
      return await loadPromise;
    } finally {
      this.shardLoadPromises.delete(shard.id);
    }
  }

  private async preloadShards(
    manifest: SearchManifest,
    shards: SearchManifestShard[],
    onProgress?: (progress: number) => void,
    concurrency: number = 2
  ): Promise<number> {
    if (shards.length === 0) {
      if (onProgress) {
        onProgress(100);
      }
      return 0;
    }

    let completed = 0;
    let loadedCount = 0;
    const queue = [...shards];

    const worker = async () => {
      while (true) {
        const shard = queue.shift();
        if (!shard) {
          return;
        }

        const loaded = await this.loadShard(manifest, shard);
        if (loaded) {
          loadedCount += 1;
        }

        completed += 1;
        if (onProgress) {
          onProgress((completed / shards.length) * 100);
        }
      }
    };

    const workerCount = Math.max(1, Math.min(concurrency, shards.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return loadedCount;
  }

  private async ensureInitialShards(onProgress?: (progress: number) => void): Promise<boolean> {
    const manifest = await this.ensureManifest();
    if (!manifest || manifest.shards.length === 0) {
      return false;
    }

    const recentShards = this.getShardsByRecency(manifest)
      .slice(0, Math.min(this.INITIAL_SHARD_COUNT, manifest.shards.length));

    const missingShards = recentShards.filter(shard => !this.loadedShards.has(shard.id));
    if (missingShards.length === 0) {
      if (onProgress) {
        onProgress(100);
      }
      return true;
    }

    const loadedCount = await this.preloadShards(manifest, missingShards, onProgress);
    return loadedCount === missingShards.length;
  }

  private async preloadRemainingShardsInBackground(): Promise<void> {
    if (this.backgroundPreloadPromise || this.prebuiltDisabled) {
      return;
    }

    this.backgroundPreloadPromise = (async () => {
      const manifest = await this.ensureManifest();
      if (!manifest || manifest.shards.length === 0) {
        return;
      }

      const remainingShards = this.getShardsByRecency(manifest)
        .filter(shard => !this.loadedShards.has(shard.id));

      if (remainingShards.length === 0) {
        return;
      }

      const loadedCount = await this.preloadShards(manifest, remainingShards, undefined, 2);
      if (loadedCount !== remainingShards.length) {
        this.useRuntimeFallback();
      }
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
    this.loadedShards.clear();
    this.shardLoadPromises.clear();
  }

  private async loadRuntimeFromStorage(): Promise<SearchIndex | null> {
    try {
      const data = await this.getFromStore<StoredRuntimeIndex>(this.RUNTIME_STORE, this.RUNTIME_INDEX_KEY);
      if (!data) return null;

      if (data.version !== this.RUNTIME_INDEX_VERSION) return null;
      if (Date.now() - data.lastUpdated > this.MAX_RUNTIME_INDEX_AGE) return null;

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
      console.error('Error loading fallback runtime index from storage:', error);
      return null;
    }
  }

  private async saveRuntimeToStorage(index: SearchIndex): Promise<void> {
    const data: StoredRuntimeIndex = {
      version: this.RUNTIME_INDEX_VERSION,
      documents: index.documents,
      miniSearch: index.miniSearch.toJSON(),
      callIndex: Object.fromEntries(index.callIndex.entries()),
      lastUpdated: index.lastUpdated
    };

    await this.putToStore(this.RUNTIME_STORE, this.RUNTIME_INDEX_KEY, data);
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
      return response.json() as Promise<T>;
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

  private async buildRuntimeIndex(onProgress?: (progress: number) => void): Promise<SearchIndex> {
    const index: SearchIndex = {
      documents: [],
      miniSearch: this.createMiniSearch(),
      callIndex: new Map(),
      lastUpdated: Date.now()
    };

    const totalCalls = protocolCalls.length;
    if (totalCalls === 0) {
      await this.saveRuntimeToStorage(index);
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

    await this.saveRuntimeToStorage(index);
    return index;
  }

  private async getRuntimeIndex(onProgress?: (progress: number) => void): Promise<SearchIndex> {
    if (this.runtimeIndex && !this.needsRuntimeRebuild()) {
      return this.runtimeIndex;
    }

    if (this.runtimeIndex && this.needsRuntimeRebuild()) {
      this.runtimeIndex = null;
    }

    if (this.runtimeIndexPromise) {
      return this.runtimeIndexPromise;
    }

    const storedIndex = await this.loadRuntimeFromStorage();
    if (storedIndex) {
      this.runtimeIndex = storedIndex;
      return storedIndex;
    }

    this.runtimeIndexPromise = this.buildRuntimeIndex(onProgress);
    try {
      this.runtimeIndex = await this.runtimeIndexPromise;
      return this.runtimeIndex;
    } finally {
      this.runtimeIndexPromise = null;
    }
  }

  private needsRuntimeRebuild(): boolean {
    if (!this.runtimeIndex) {
      return true;
    }

    return Date.now() - this.runtimeIndex.lastUpdated > this.MAX_RUNTIME_INDEX_AGE;
  }

  private scoreAndFilterResults(
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

    if (this.loadedShards.size === 0) {
      const ready = await this.ensureInitialShards();
      if (!ready) {
        return null;
      }
    }

    void this.preloadRemainingShardsInBackground();

    const rawResults: Array<{ doc: IndexedContent; score: number }> = [];

    for (const shard of this.loadedShards.values()) {
      const shardResults = shard.miniSearch.search(queryNormalized, { combineWith: 'OR' });

      for (const result of shardResults) {
        const doc = this.getDocumentFromResult(shard.docs, result);
        if (!doc) {
          continue;
        }

        rawResults.push({ doc, score: result.score });
      }
    }

    return this.scoreAndFilterResults(rawResults, queryNormalized, queryTokens, options);
  }

  private async searchRuntime(
    queryNormalized: string,
    queryTokens: string[],
    options: {
      callType?: 'all' | 'ACDC' | 'ACDE' | 'ACDT';
      contentType?: 'all' | 'transcript' | 'chat' | 'agenda' | 'action';
      limit?: number;
    }
  ): Promise<IndexedContent[]> {
    const runtimeIndex = await this.getRuntimeIndex();
    const miniSearchResults = runtimeIndex.miniSearch.search(queryNormalized, {
      combineWith: 'OR'
    });

    const rawResults: Array<{ doc: IndexedContent; score: number }> = [];

    for (const result of miniSearchResults) {
      const doc = this.getDocumentFromResult(runtimeIndex.documents, result);
      if (!doc) {
        continue;
      }

      rawResults.push({ doc, score: result.score });
    }

    return this.scoreAndFilterResults(rawResults, queryNormalized, queryTokens, options);
  }

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
      if (prebuiltResults) {
        return prebuiltResults;
      }

      this.useRuntimeFallback();
    }

    return this.searchRuntime(queryNormalized, queryTokens, options);
  }

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

  async rebuildIndex(onProgress?: (progress: number) => void): Promise<void> {
    this.runtimeIndex = null;
    this.runtimeIndexPromise = null;

    this.prebuiltDisabled = false;
    this.manifest = null;
    this.manifestPromise = null;

    this.loadedShards.clear();
    this.shardLoadPromises.clear();

    await this.deleteFromStore(this.RUNTIME_STORE, this.RUNTIME_INDEX_KEY);
    await this.deleteFromStore(this.META_STORE, this.MANIFEST_KEY);

    try {
      const db = await this.openDB();
      const transaction = db.transaction([this.SHARD_STORE], 'readwrite');
      const store = transaction.objectStore(this.SHARD_STORE);
      await new Promise<void>((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      db.close();
    } catch (error) {
      console.error('Error clearing cached shards:', error);
    }

    await this.getIndex(onProgress);
  }

  getLoadState(): SearchLoadState {
    const totalShards = this.manifest?.shards.length ?? 0;
    const loadedShards = this.loadedShards.size;

    const usingFallback = this.prebuiltDisabled || !!this.runtimeIndex;
    const mode: SearchLoadState['mode'] = usingFallback
      ? 'runtime-fallback'
      : this.manifest
        ? 'prebuilt'
        : 'uninitialized';

    const prebuiltReady = loadedShards > 0;
    const loadingShards = this.shardLoadPromises.size > 0 || !!this.backgroundPreloadPromise;

    const fullyLoaded = mode === 'prebuilt'
      ? totalShards > 0 && loadedShards >= totalShards
      : !!this.runtimeIndex;

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

  needsRebuild(): boolean {
    const state = this.getLoadState();
    if (state.mode === 'runtime-fallback') {
      return this.needsRuntimeRebuild();
    }

    return !state.prebuiltReady;
  }

  getStats(): { documentCount: number; tokenCount: number; callCount: number; lastUpdated: Date | null } | null {
    const state = this.getLoadState();

    if (state.mode === 'runtime-fallback' && this.runtimeIndex) {
      return {
        documentCount: this.runtimeIndex.documents.length,
        tokenCount: this.runtimeIndex.miniSearch.termCount,
        callCount: this.runtimeIndex.callIndex.size,
        lastUpdated: new Date(this.runtimeIndex.lastUpdated)
      };
    }

    if (state.mode !== 'prebuilt' || this.loadedShards.size === 0) {
      return null;
    }

    const docsCount = Array.from(this.loadedShards.values())
      .reduce((sum, shard) => sum + shard.docs.length, 0);

    const tokenCount = Array.from(this.loadedShards.values())
      .reduce((sum, shard) => sum + shard.miniSearch.termCount, 0);

    const callKeys = new Set<string>();
    this.loadedShards.forEach(shard => {
      shard.docs.forEach(doc => {
        callKeys.add(`${doc.callType}_${doc.callDate}_${doc.callNumber}`);
      });
    });

    const builtAt = this.manifest ? new Date(this.manifest.builtAt) : null;

    return {
      documentCount: docsCount,
      tokenCount,
      callCount: callKeys.size,
      lastUpdated: builtAt
    };
  }

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
}

export const searchIndexService = SearchIndexService.getInstance();
