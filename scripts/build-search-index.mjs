import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import MiniSearch from 'minisearch';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Load protocol calls
const callsPath = join(ROOT, 'src/data/protocol-calls.generated.json');
const calls = JSON.parse(readFileSync(callsPath, 'utf-8'));

// Tokenizer matching the runtime behavior: lowercase, remove punctuation, split whitespace, filter len>1
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

// Parse VTT transcript into documents
function parseTranscript(content, call) {
  const lines = content.split('\n');
  const results = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const timestampMatch = line.match(
      /(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3})/,
    );
    if (timestampMatch && i + 1 < lines.length) {
      const startTime = timestampMatch[1].split('.')[0];
      const contentLines = [];
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== '' && !lines[j].match(/^\d+$/)) {
        contentLines.push(lines[j]);
        j++;
      }

      if (contentLines.length > 0) {
        const text = contentLines.join(' ');
        const speakerMatch = text.match(/^([^:]+):\s*(.+)/);
        if (speakerMatch) {
          results.push({
            callType: call.type,
            callDate: call.date,
            callNumber: call.number,
            type: 'transcript',
            timestamp: startTime,
            speaker: speakerMatch[1].trim(),
            text: speakerMatch[2].trim(),
          });
        }
      }
      i = j;
    }
  }
  return results;
}

// Parse chat.txt into documents
function parseChat(content, call) {
  const lines = content.split('\n').filter((l) => l.trim());
  const results = [];

  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split('\t');
    if (parts.length < 3) continue;

    const [timestamp, speaker, ...messageParts] = parts;
    let message = messageParts.join('\t');

    // Skip reactions
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
      });
    }
  }
  return results;
}

// Parse tldr.json into documents
function parseTldr(tldrData, call) {
  const results = [];

  // Highlights -> agenda
  if (tldrData.highlights) {
    const allHighlights = Object.values(tldrData.highlights).flat();
    for (const item of allHighlights) {
      if (item.highlight) {
        results.push({
          callType: call.type,
          callDate: call.date,
          callNumber: call.number,
          type: 'agenda',
          timestamp: item.timestamp || '00:00:00',
          speaker: '',
          text: item.highlight,
        });
      }
    }
  }

  // Action items
  if (tldrData.action_items) {
    for (const item of tldrData.action_items) {
      if (item.action) {
        results.push({
          callType: call.type,
          callDate: call.date,
          callNumber: call.number,
          type: 'action',
          timestamp: item.timestamp || '00:00:00',
          speaker: item.owner || '',
          text: item.action,
        });
      }
    }
  }

  // Decisions -> agenda
  if (tldrData.decisions) {
    for (const item of tldrData.decisions) {
      if (item.decision) {
        results.push({
          callType: call.type,
          callDate: call.date,
          callNumber: call.number,
          type: 'agenda',
          timestamp: item.timestamp || '00:00:00',
          speaker: '',
          text: item.decision,
        });
      }
    }
  }

  // Targets -> agenda
  if (tldrData.targets) {
    for (const item of tldrData.targets) {
      if (item.target) {
        results.push({
          callType: call.type,
          callDate: call.date,
          callNumber: call.number,
          type: 'agenda',
          timestamp: item.timestamp || '00:00:00',
          speaker: '',
          text: item.target,
        });
      }
    }
  }

  return results;
}

// Read file if it exists, return null otherwise
function readIfExists(filePath) {
  if (existsSync(filePath)) {
    return readFileSync(filePath, 'utf-8');
  }
  return null;
}

// Main
console.log(`Building search index for ${calls.length} calls...`);

const documents = [];
let docId = 0;

for (const call of calls) {
  const baseDir = join(ROOT, 'public/artifacts', call.type, `${call.date}_${call.number}`);

  // Transcript: prefer corrected, fall back to original
  const transcriptContent =
    readIfExists(join(baseDir, 'transcript_corrected.vtt')) ||
    readIfExists(join(baseDir, 'transcript.vtt'));
  if (transcriptContent) {
    for (const doc of parseTranscript(transcriptContent, call)) {
      documents.push({ id: docId++, ...doc });
    }
  }

  // Chat
  const chatContent = readIfExists(join(baseDir, 'chat.txt'));
  if (chatContent) {
    for (const doc of parseChat(chatContent, call)) {
      documents.push({ id: docId++, ...doc });
    }
  }

  // TLDR
  const tldrContent = readIfExists(join(baseDir, 'tldr.json'));
  if (tldrContent) {
    try {
      const tldrData = JSON.parse(tldrContent);
      for (const doc of parseTldr(tldrData, call)) {
        documents.push({ id: docId++, ...doc });
      }
    } catch {
      console.warn(`  Warning: Failed to parse tldr.json for ${call.type}/${call.date}_${call.number}`);
    }
  }
}

// Create MiniSearch index
const miniSearch = new MiniSearch({
  fields: ['text', 'speaker'],
  storeFields: ['callType', 'callDate', 'callNumber', 'type', 'timestamp', 'speaker', 'text'],
  tokenize,
});

miniSearch.addAll(documents);

// Serialize and write
const outputPath = join(ROOT, 'public/search-index.json');
const serialized = JSON.stringify(miniSearch);
writeFileSync(outputPath, serialized);

const sizeMB = (Buffer.byteLength(serialized) / 1024 / 1024).toFixed(1);
console.log(`Done! ${documents.length} documents indexed.`);
console.log(`Output: public/search-index.json (${sizeMB} MB)`);
