import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import MiniSearch from 'minisearch';
import { fileURLToPath } from 'url';

const SEARCH_SCHEMA_VERSION = 1;
const INDEX_VERSION = 'prebuilt-minisearch-v1';
const SHARD_STRATEGY = 'monthly';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');

const callsPath = path.join(repoRoot, 'src', 'data', 'protocol-calls.generated.json');
const artifactsDir = path.join(repoRoot, 'public', 'artifacts');
const searchOutputDir = path.join(repoRoot, 'public', 'search');
const packageJsonPath = path.join(repoRoot, 'package.json');

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length > 1);
}

function createMiniSearch() {
  return new MiniSearch({
    idField: 'id',
    fields: ['searchableText'],
    tokenize,
    processTerm: (term) => {
      const normalized = term.toLowerCase().trim();
      return normalized.length > 1 ? normalized : null;
    }
  });
}

function toSearchDocument(content, id) {
  const searchableText = content.speaker
    ? `${content.speaker} ${content.text}`
    : content.text;

  return {
    ...content,
    id,
    searchableText
  };
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function readTextIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function readJsonIfExists(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
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
        j += 1;
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

function parseChatForIndex(content, call) {
  const lines = content.split('\n').filter(line => line.trim());
  const results = [];

  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split('\t');
    if (parts.length < 3) {
      continue;
    }

    const [timestamp, speaker, ...messageParts] = parts;
    let message = messageParts.join('\t');

    if (message.startsWith('Reacted to ')) {
      continue;
    }

    if (message.startsWith('Replying to "') || message.startsWith('In reply to "')) {
      if (i + 1 < lines.length && !lines[i + 1].includes('\t')) {
        message = lines[i + 1].trim();
        i += 1;
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

function parseTldrForIndex(tldrData, call) {
  const results = [];

  if (tldrData && tldrData.highlights && typeof tldrData.highlights === 'object') {
    const allHighlights = Object.values(tldrData.highlights).flat();
    allHighlights.forEach(item => {
      if (item && item.highlight) {
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

  if (tldrData && Array.isArray(tldrData.action_items)) {
    tldrData.action_items.forEach(item => {
      if (item && item.action) {
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

  if (tldrData && Array.isArray(tldrData.decisions)) {
    tldrData.decisions.forEach(item => {
      if (item && item.decision) {
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

  if (tldrData && Array.isArray(tldrData.targets)) {
    tldrData.targets.forEach(item => {
      if (item && item.target) {
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

function loadCallEntries(call) {
  const basePath = path.join(artifactsDir, call.type, `${call.date}_${call.number}`);
  const transcriptCorrectedPath = path.join(basePath, 'transcript_corrected.vtt');
  const transcriptPath = path.join(basePath, 'transcript.vtt');
  const chatPath = path.join(basePath, 'chat.txt');
  const tldrPath = path.join(basePath, 'tldr.json');

  const transcript = readTextIfExists(transcriptCorrectedPath) ?? readTextIfExists(transcriptPath);
  const chat = readTextIfExists(chatPath);
  const tldr = readJsonIfExists(tldrPath);

  const entries = [];
  if (transcript) {
    entries.push(...parseTranscriptForIndex(transcript, call));
  }
  if (chat) {
    entries.push(...parseChatForIndex(chat, call));
  }
  if (tldr) {
    entries.push(...parseTldrForIndex(tldr, call));
  }

  return entries;
}

function prepareOutputDirectory() {
  if (!fs.existsSync(searchOutputDir)) {
    fs.mkdirSync(searchOutputDir, { recursive: true });
    return;
  }

  const files = fs.readdirSync(searchOutputDir);
  files.forEach(file => {
    if (file === 'manifest.json' || file.startsWith('docs-') || file.startsWith('mini-')) {
      fs.rmSync(path.join(searchOutputDir, file), { recursive: true, force: true });
    }
  });
}

function generatePrebuiltSearchIndex() {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  const protocolCalls = JSON.parse(fs.readFileSync(callsPath, 'utf-8'));

  const sortedCalls = [...protocolCalls].sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;

    const byType = a.type.localeCompare(b.type);
    if (byType !== 0) return byType;

    return Number(a.number) - Number(b.number);
  });

  const shards = new Map();

  let totalCallsWithEntries = 0;
  let totalDocuments = 0;

  for (const call of sortedCalls) {
    const entries = loadCallEntries(call);
    if (entries.length === 0) {
      continue;
    }

    totalCallsWithEntries += 1;
    totalDocuments += entries.length;

    const shardId = call.date.slice(0, 7);
    if (!shards.has(shardId)) {
      shards.set(shardId, {
        docs: [],
        callKeys: new Set(),
        fromDate: call.date,
        toDate: call.date
      });
    }

    const shard = shards.get(shardId);
    shard.docs.push(...entries);
    shard.callKeys.add(`${call.type}_${call.date}_${call.number}`);

    if (call.date < shard.fromDate) shard.fromDate = call.date;
    if (call.date > shard.toDate) shard.toDate = call.date;
  }

  prepareOutputDirectory();

  const shardEntries = [];

  const sortedShardIds = [...shards.keys()].sort((a, b) => a.localeCompare(b));
  sortedShardIds.forEach(shardId => {
    const shard = shards.get(shardId);
    const docs = shard.docs;

    const miniSearch = createMiniSearch();
    const searchDocs = docs.map((doc, idx) => toSearchDocument(doc, idx));
    miniSearch.addAll(searchDocs);

    const docsFilename = `docs-${shardId}.json`;
    const miniFilename = `mini-${shardId}.json`;

    const docsJson = JSON.stringify(docs);
    const miniJson = JSON.stringify(miniSearch.toJSON());

    fs.writeFileSync(path.join(searchOutputDir, docsFilename), docsJson);
    fs.writeFileSync(path.join(searchOutputDir, miniFilename), miniJson);

    const docsHash = sha256(docsJson);
    const miniHash = sha256(miniJson);
    const hash = sha256(`${docsHash}:${miniHash}`);

    shardEntries.push({
      id: shardId,
      docsFile: docsFilename,
      miniFile: miniFilename,
      hash,
      docsHash,
      miniHash,
      docCount: docs.length,
      callCount: shard.callKeys.size,
      fromDate: shard.fromDate,
      toDate: shard.toDate
    });
  });

  const manifest = {
    schemaVersion: SEARCH_SCHEMA_VERSION,
    indexVersion: INDEX_VERSION,
    shardStrategy: SHARD_STRATEGY,
    builtAt: new Date().toISOString(),
    appVersion: packageJson.version,
    routingKey: 'callDateMonth',
    shardCount: shardEntries.length,
    totalDocuments,
    totalCalls: totalCallsWithEntries,
    shards: shardEntries
  };

  fs.writeFileSync(
    path.join(searchOutputDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  console.log('Generated prebuilt search index');
  console.log(`- Shards: ${shardEntries.length}`);
  console.log(`- Calls indexed: ${totalCallsWithEntries}`);
  console.log(`- Documents indexed: ${totalDocuments}`);
}

generatePrebuiltSearchIndex();
