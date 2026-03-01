import MiniSearch from 'minisearch';
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
  id: number;
  callType: string;
  callDate: string;
  callNumber: string;
  type: 'transcript' | 'chat' | 'agenda' | 'action';
  timestamp: string;
  speaker?: string;
  text: string;
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
  searchOptions: {
    boost: { text: 2 },
    prefix: true,
    fuzzy: 0.2,
  },
} as const;

class SearchIndexService {
  private static instance: SearchIndexService;
  private miniSearch: MiniSearch<IndexedContent> | null = null;
  private indexPromise: Promise<MiniSearch<IndexedContent>> | null = null;
  private lastUpdated: number = 0;
  private documentCount: number = 0;
  private readonly DB_NAME = 'forkcast_search';
  private readonly DB_VERSION = 1;
  private readonly STORE_NAME = 'search_index';
  private readonly INDEX_VERSION = '2.0.0'; // bumped for MiniSearch migration
  private readonly MAX_INDEX_AGE = 24 * 60 * 60 * 1000; // 24 hours

  private constructor() {}

  static getInstance(): SearchIndexService {
    if (!SearchIndexService.instance) {
      SearchIndexService.instance = new SearchIndexService();
    }
    return SearchIndexService.instance;
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
  private async loadFromStorage(): Promise<MiniSearch<IndexedContent> | null> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([this.STORE_NAME], 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);

      interface StoredIndex {
        version: string;
        miniSearchJSON: string;
        lastUpdated: number;
        documentCount: number;
      }
      const data = await new Promise<StoredIndex | undefined>(
        (resolve, reject) => {
          const request = store.get('index');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        }
      );

      db.close();

      if (!data) return null;

      // Check version and age
      if (data.version !== this.INDEX_VERSION) return null;
      if (Date.now() - data.lastUpdated > this.MAX_INDEX_AGE) return null;

      const miniSearch = MiniSearch.loadJSON<IndexedContent>(
        data.miniSearchJSON,
        MINISEARCH_OPTIONS
      );
      this.lastUpdated = data.lastUpdated;
      this.documentCount = data.documentCount;

      return miniSearch;
    } catch (error) {
      console.error('Error loading search index from storage:', error);
      return null;
    }
  }

  // Save index to IndexedDB
  private async saveToStorage(
    miniSearch: MiniSearch<IndexedContent>
  ): Promise<void> {
    try {
      const data = {
        version: this.INDEX_VERSION,
        miniSearchJSON: JSON.stringify(miniSearch),
        lastUpdated: this.lastUpdated,
        documentCount: this.documentCount,
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

  // Build the search index
  async buildIndex(
    onProgress?: (progress: number) => void
  ): Promise<MiniSearch<IndexedContent>> {
    const miniSearch = new MiniSearch<IndexedContent>(MINISEARCH_OPTIONS);
    let nextId = 0;

    const totalCalls = protocolCalls.length;
    let processedCalls = 0;

    for (const call of protocolCalls) {
      const callKey = `${call.type}_${call.date}_${call.number}`;

      try {
        const baseUrl = `/artifacts/${call.type}/${call.date}_${call.number}`;

        const [transcript, chat, tldr] = await Promise.all([
          fetch(`${baseUrl}/transcript_corrected.vtt`)
            .then((res) => (res.ok ? res.text() : null))
            .catch(() => null)
            .then(
              (corrected) =>
                corrected ??
                fetch(`${baseUrl}/transcript.vtt`)
                  .then((res) => (res.ok ? res.text() : null))
                  .catch(() => null)
            ),
          fetch(`${baseUrl}/chat.txt`)
            .then((res) => (res.ok ? res.text() : null))
            .catch(() => null),
          fetch(`${baseUrl}/tldr.json`)
            .then((res) => (res.ok ? res.json() : null))
            .catch(() => null),
        ]);

        // Collect all documents for this call, then bulk-add
        const docs: IndexedContent[] = [];

        if (transcript) {
          for (const entry of this.parseTranscriptForIndex(transcript, call)) {
            docs.push({ ...entry, id: nextId++ });
          }
        }

        if (chat) {
          for (const entry of this.parseChatForIndex(chat, call)) {
            docs.push({ ...entry, id: nextId++ });
          }
        }

        if (tldr) {
          for (const entry of this.parseTldrForIndex(tldr, call)) {
            docs.push({ ...entry, id: nextId++ });
          }
        }

        if (docs.length > 0) {
          miniSearch.addAll(docs);
        }
      } catch (error) {
        console.error(`Error indexing call ${callKey}:`, error);
      }

      processedCalls++;
      if (onProgress) {
        onProgress((processedCalls / totalCalls) * 100);
      }
    }

    this.lastUpdated = Date.now();
    this.documentCount = nextId;
    await this.saveToStorage(miniSearch);

    return miniSearch;
  }

  // Parse transcript for indexing
  private parseTranscriptForIndex(
    content: string,
    call: CallInfo
  ): Omit<IndexedContent, 'id'>[] {
    const lines = content.split('\n');
    const results: Omit<IndexedContent, 'id'>[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      const timestampMatch = line.match(
        /(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3})/
      );
      if (timestampMatch && i + 1 < lines.length) {
        const startTime = timestampMatch[1].split('.')[0];

        const contentLines: string[] = [];
        let j = i + 1;
        while (
          j < lines.length &&
          lines[j].trim() !== '' &&
          !lines[j].match(/^\d+$/)
        ) {
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
            });
          }
        }

        i = j;
      }
    }

    return results;
  }

  // Parse chat for indexing
  private parseChatForIndex(
    content: string,
    call: CallInfo
  ): Omit<IndexedContent, 'id'>[] {
    const lines = content.split('\n').filter((line) => line.trim());
    const results: Omit<IndexedContent, 'id'>[] = [];

    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split('\t');
      if (parts.length < 3) continue;

      const [timestamp, speaker, ...messageParts] = parts;
      let message = messageParts.join('\t');

      if (message.startsWith('Reacted to ')) continue;

      if (
        message.startsWith('Replying to "') ||
        message.startsWith('In reply to "')
      ) {
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
        });
      }
    }

    return results;
  }

  // Parse TLDR for indexing
  private parseTldrForIndex(
    tldrData: TldrData,
    call: CallInfo
  ): Omit<IndexedContent, 'id'>[] {
    const results: Omit<IndexedContent, 'id'>[] = [];

    if (tldrData.highlights) {
      const allHighlights: TldrHighlightItem[] = Object.values(
        tldrData.highlights
      ).flat();
      allHighlights.forEach((item) => {
        if (item.highlight) {
          results.push({
            callType: call.type,
            callDate: call.date,
            callNumber: call.number,
            type: 'agenda',
            timestamp: item.timestamp || '00:00:00',
            text: item.highlight,
          });
        }
      });
    }

    if (tldrData.action_items) {
      tldrData.action_items.forEach((item) => {
        if (item.action) {
          results.push({
            callType: call.type,
            callDate: call.date,
            callNumber: call.number,
            type: 'action',
            timestamp: item.timestamp || '00:00:00',
            speaker: item.owner,
            text: item.action,
          });
        }
      });
    }

    if (tldrData.decisions) {
      tldrData.decisions.forEach((item) => {
        if (item.decision) {
          results.push({
            callType: call.type,
            callDate: call.date,
            callNumber: call.number,
            type: 'agenda',
            timestamp: item.timestamp || '00:00:00',
            text: item.decision,
          });
        }
      });
    }

    if (tldrData.targets) {
      tldrData.targets.forEach((item) => {
        if (item.target) {
          results.push({
            callType: call.type,
            callDate: call.date,
            callNumber: call.number,
            type: 'agenda',
            timestamp: item.timestamp || '00:00:00',
            text: item.target,
          });
        }
      });
    }

    return results;
  }

  // Search the index
  async search(
    query: string,
    options: {
      callType?: 'all' | 'ACDC' | 'ACDE' | 'ACDT';
      contentType?: 'all' | 'transcript' | 'chat' | 'agenda' | 'action';
      limit?: number;
    } = {}
  ): Promise<IndexedContent[]> {
    const miniSearch = await this.getIndex();

    const results = miniSearch.search(query, {
      prefix: true,
      fuzzy: 0.2,
      boost: { text: 2 },
      filter: (result) => {
        if (
          options.callType &&
          options.callType !== 'all' &&
          (result.callType as string).toUpperCase() !== options.callType
        ) {
          return false;
        }
        if (
          options.contentType &&
          options.contentType !== 'all' &&
          result.type !== options.contentType
        ) {
          return false;
        }
        return true;
      },
    });

    const limit = options.limit || 100;
    return results.slice(0, limit).map((result) => ({
      id: result.id,
      callType: result.callType as string,
      callDate: result.callDate as string,
      callNumber: result.callNumber as string,
      type: result.type as IndexedContent['type'],
      timestamp: result.timestamp as string,
      speaker: result.speaker as string | undefined,
      text: result.text as string,
    }));
  }

  // Get or build the index
  async getIndex(): Promise<MiniSearch<IndexedContent>> {
    if (this.miniSearch) {
      return this.miniSearch;
    }

    if (this.indexPromise) {
      return this.indexPromise;
    }

    const storedIndex = await this.loadFromStorage();
    if (storedIndex) {
      this.miniSearch = storedIndex;
      return storedIndex;
    }

    this.indexPromise = this.buildIndex();
    this.miniSearch = await this.indexPromise;
    this.indexPromise = null;

    return this.miniSearch;
  }

  // Force rebuild the index
  async rebuildIndex(onProgress?: (progress: number) => void): Promise<void> {
    this.miniSearch = null;
    this.indexPromise = null;

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

    this.miniSearch = await this.buildIndex(onProgress);
  }

  // Check if index needs rebuilding
  needsRebuild(): boolean {
    if (!this.miniSearch) return true;
    return Date.now() - this.lastUpdated > this.MAX_INDEX_AGE;
  }

  // Get index statistics
  getStats(): {
    documentCount: number;
    lastUpdated: Date | null;
  } | null {
    if (!this.miniSearch) return null;

    return {
      documentCount: this.documentCount,
      lastUpdated: new Date(this.lastUpdated),
    };
  }
}

export const searchIndexService = SearchIndexService.getInstance();
