import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Keep in sync with src/services/searchIndex.ts.
const INDEX_SCHEMA_VERSION = '3.0.0';

function getProtocolCalls() {
  const callsFilePath = path.join(__dirname, '..', 'src', 'data', 'protocol-calls.generated.json');
  const fileContent = fs.readFileSync(callsFilePath, 'utf-8');
  return JSON.parse(fileContent);
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash * 31) + value.charCodeAt(i)) >>> 0;
  }

  return hash.toString(16);
}

function getIndexVersion(payload) {
  const payloadString = JSON.stringify(payload);
  const payloadHash = hashString(payloadString);
  return `${INDEX_SCHEMA_VERSION}:${payloadHash}`;
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 1);
}

function parseTranscriptForIndex(content, call) {
  const lines = content.split('\n');
  const results = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const timestampMatch = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3})/);

    if (timestampMatch && i + 1 < lines.length) {
      const startTime = timestampMatch[1].split('.')[0];
      const contentLines = [];
      let j = i + 1;

      while (j < lines.length && lines[j].trim() !== '' && !lines[j].match(/^\d+$/)) {
        contentLines.push(lines[j]);
        j++;
      }

      if (contentLines.length > 0) {
        const blockContent = contentLines.join(' ');
        const speakerMatch = blockContent.match(/^([^:]+):\s*(.+)/);

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

function parseChatForIndex(content, call) {
  const lines = content.split('\n').filter(line => line.trim());
  const results = [];

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
        text: message.trim(),
      });
    }
  }

  return results;
}

function parseTldrForIndex(tldrData, call) {
  const results = [];

  if (tldrData.highlights) {
    const allHighlights = Object.values(tldrData.highlights).flat();
    allHighlights.forEach(item => {
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
          text: item.decision,
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
          text: item.target,
        });
      }
    });
  }

  return results;
}

function addEntriesToIndex(index, callKey, entries) {
  if (entries.length === 0) return;

  const callDocIndices = [];

  entries.forEach(entry => {
    const docIndex = index.documents.length;
    index.documents.push(entry);
    callDocIndices.push(docIndex);

    tokenize(`${entry.text} ${entry.speaker || ''}`).forEach(token => {
      if (!index.invertedIndex.has(token)) {
        index.invertedIndex.set(token, new Set());
      }
      index.invertedIndex.get(token).add(docIndex);
    });
  });

  index.callIndex.set(callKey, callDocIndices);
}

function buildSearchIndex(protocolCalls) {
  const index = {
    documents: [],
    invertedIndex: new Map(),
    callIndex: new Map(),
    lastUpdated: Date.now(),
  };

  for (const call of protocolCalls) {
    const callKey = `${call.type}_${call.date}_${call.number}`;
    const basePath = path.join(__dirname, '..', 'public', 'artifacts', call.type, `${call.date}_${call.number}`);
    const entries = [];

    const correctedTranscriptPath = path.join(basePath, 'transcript_corrected.vtt');
    const transcriptPath = fs.existsSync(correctedTranscriptPath)
      ? correctedTranscriptPath
      : path.join(basePath, 'transcript.vtt');

    if (fs.existsSync(transcriptPath)) {
      entries.push(...parseTranscriptForIndex(fs.readFileSync(transcriptPath, 'utf-8'), call));
    }

    const chatPath = path.join(basePath, 'chat.txt');
    if (fs.existsSync(chatPath)) {
      entries.push(...parseChatForIndex(fs.readFileSync(chatPath, 'utf-8'), call));
    }

    const tldrPath = path.join(basePath, 'tldr.json');
    if (fs.existsSync(tldrPath)) {
      entries.push(...parseTldrForIndex(JSON.parse(fs.readFileSync(tldrPath, 'utf-8')), call));
    }

    addEntriesToIndex(index, callKey, entries);
  }

  const stablePayload = {
    documents: index.documents,
    invertedIndex: Object.fromEntries(
      Array.from(index.invertedIndex.entries()).map(([key, value]) => [key, Array.from(value)])
    ),
    callIndex: Object.fromEntries(index.callIndex.entries()),
  };

  const version = getIndexVersion(stablePayload);

  return {
    version,
    generatedAt: new Date().toISOString(),
    ...stablePayload,
    lastUpdated: index.lastUpdated,
  };
}

function writeSearchIndex(storedIndex) {
  const distDir = path.join(__dirname, '..', 'dist');
  if (!fs.existsSync(distDir)) {
    console.error('Error: dist directory not found. Run "npm run build" first.');
    process.exit(1);
  }

  const outputPath = path.join(distDir, 'search-index.json');
  const json = JSON.stringify(storedIndex);
  fs.writeFileSync(outputPath, json);
  fs.writeFileSync(
    path.join(distDir, 'search-index-version.json'),
    JSON.stringify({
      version: storedIndex.version,
      generatedAt: storedIndex.generatedAt,
    })
  );

  const rawBytes = Buffer.byteLength(json);
  const gzipBytes = zlib.gzipSync(json).length;
  const brotliBytes = zlib.brotliCompressSync(json).length;

  console.log('\nGenerated static search index');
  console.log(`  - output: ${outputPath}`);
  console.log(`  - version manifest: ${path.join(distDir, 'search-index-version.json')}`);
  console.log(`  - version: ${storedIndex.version}`);
  console.log(`  - documents: ${storedIndex.documents.length.toLocaleString()}`);
  console.log(`  - tokens: ${Object.keys(storedIndex.invertedIndex).length.toLocaleString()}`);
  console.log(`  - raw size: ${(rawBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  - gzip size: ${(gzipBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  - brotli size: ${(brotliBytes / 1024 / 1024).toFixed(2)} MB`);
}

function main() {
  const protocolCalls = getProtocolCalls();
  const storedIndex = buildSearchIndex(protocolCalls);
  writeSearchIndex(storedIndex);
}

main();
