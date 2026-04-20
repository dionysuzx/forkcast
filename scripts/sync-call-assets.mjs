#!/usr/bin/env node
/**
 * Sync call assets from ethereum/pm repository.
 * Fetches manifest.json and downloads new/updated assets.
 */

import { writeFileSync, readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const PM_REPO = process.env.PM_REPO || 'ethereum/pm';
const PM_REF = process.env.PM_REF || 'master';
const RAW_BASE_URL = `https://raw.githubusercontent.com/${PM_REPO}/${PM_REF}/.github/ACDbot/artifacts`;
const MANIFEST_URL = `${RAW_BASE_URL}/manifest.json`;
const ASSETS_BASE_URL = RAW_BASE_URL;
const LOCAL_ASSETS_DIR = join(ROOT, 'public/artifacts');
const DENYLIST = new Set([
  // Placeholder: 'series'
]);

const GENERATED_JSON_PATH = join(ROOT, 'src/data/protocol-calls.generated.json');
const KNOWN_TYPES = new Set(['acdc', 'acde', 'acdt', 'epbs', 'bal', 'focil', 'price', 'tli', 'pqts', 'rpc', 'zkevm', 'etm', 'awd', 'pqi', 'fcr']);

// Map pm series names to forkcast type names (for folder paths)
const SERIES_TO_TYPE = {
  glamsterdamrepricings: 'price',
  trustlesslogindex: 'tli',
  pqtransactionsignatures: 'pqts',
  rpcstandards: 'rpc',
  encryptthemempool: 'etm',
  allwalletdevs: 'awd',
  pqinterop: 'pqi',
};

function getLocalType(series) {
  return SERIES_TO_TYPE[series] || series;
}

async function fetchManifest() {
  console.log(`Fetching manifest from ${MANIFEST_URL}`);
  const response = await fetch(MANIFEST_URL);
  if (!response.ok) throw new Error(`Failed to fetch manifest: ${response.status}`);
  return response.json();
}

function normalizeManifest(manifest) {
  if (manifest?.series && typeof manifest.series === 'object') {
    const normalized = {};
    for (const [series, seriesData] of Object.entries(manifest.series)) {
      const calls = {};
      for (const call of seriesData.calls || []) {
        const callId = call?.path?.split('/')?.[1];
        if (!callId) continue;
        const resources = call.resources || {};
        calls[callId] = {
          has_tldr: Boolean(resources.tldr),
          has_transcript: Boolean(resources.transcript),
          has_corrected_transcript: Boolean(resources.transcript_corrected),
          has_chat: Boolean(resources.chat),
          has_transcript_changelog: Boolean(resources.changelog),
          last_updated: call.updated || call.date || null,
          // Metadata for config.json generation
          issue: call.issue || null,
          name: call.name || null,
          parent: call.parent || null,
          videoUrl: call.videoUrl || null
        };
      }
      normalized[series] = calls;
    }
    return normalized;
  }

  return manifest.calls || {};
}

const LIVESTREAMED_TYPES = new Set(['acdc', 'acde', 'acdt']);

// Pull the Call-shaped metadata (issue, name, parentPath) out of either a manifest entry
// or a local config.json. Returns only the fields that are populated, so it composes via
// Object.assign / spread without clobbering existing values with undefined.
function callMetadataFields(source) {
  const fields = {};
  if (source.issue) fields.issue = source.issue;
  if (source.name) fields.name = source.name;
  const parent = source.parent;
  if (parent?.series && parent?.number != null) {
    fields.parentPath = `${getLocalType(parent.series)}/${String(parent.number).padStart(3, '0')}`;
  }
  return fields;
}

function generateConfig(callData, localType) {
  const needsManualSync = LIVESTREAMED_TYPES.has(localType);
  return {
    issue: callData.issue,
    name: callData.name,
    parent: callData.parent,
    videoUrl: callData.videoUrl,
    sync: {
      transcriptStartTime: needsManualSync ? null : '00:00:00',
      videoStartTime: needsManualSync ? null : '00:00:00'
    }
  };
}

async function downloadFile(url, destPath) {
  console.log(`  Downloading ${destPath.split('/').pop()}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const dir = dirname(destPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(destPath, buffer);
}

async function syncCall(remoteSeries, localType, callId, callData, force = false) {
  const localDir = join(LOCAL_ASSETS_DIR, localType, callId);
  const filesToSync = [];

  if (callData.has_tldr) {
    filesToSync.push({ remote: 'tldr.json', local: 'tldr.json' });
  }

  if (callData.has_chat) {
    filesToSync.push({ remote: 'chat.txt', local: 'chat.txt' });
  }

  if (callData.has_transcript_changelog) {
    filesToSync.push({ remote: 'transcript_changelog.tsv', local: 'transcript_changelog.tsv' });
  }

  // Prefer corrected transcript, fall back to original
  if (callData.has_corrected_transcript) {
    filesToSync.push({ remote: 'transcript_corrected.vtt', local: 'transcript_corrected.vtt' });
  } else if (callData.has_transcript) {
    filesToSync.push({ remote: 'transcript.vtt', local: 'transcript.vtt' });
  }

  if (filesToSync.length === 0) return false;

  // Ensure directory exists
  if (!existsSync(localDir)) mkdirSync(localDir, { recursive: true });

  let changesMade = false;

  // Handle config.json
  const configPath = join(localDir, 'config.json');
  const desiredConfig = generateConfig(callData, localType);
  if (!existsSync(configPath)) {
    // Create new config from manifest data
    console.log('  Generating config.json');
    writeFileSync(configPath, JSON.stringify(desiredConfig, null, 2));
    changesMade = true;
  } else {
    // Merge manifest metadata into existing config while preserving local sync offsets
    try {
      const existingConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
      const mergedConfig = {
        ...existingConfig,
        sync: existingConfig.sync || desiredConfig.sync,
      };

      for (const field of ['issue', 'name', 'parent', 'videoUrl']) {
        if (desiredConfig[field] !== undefined && desiredConfig[field] !== null) {
          mergedConfig[field] = desiredConfig[field];
        }
      }

      if (JSON.stringify(existingConfig) !== JSON.stringify(mergedConfig)) {
        console.log('  Updating config.json metadata');
        writeFileSync(configPath, JSON.stringify(mergedConfig, null, 2));
        changesMade = true;
      }
    } catch (e) {
      console.log(`  Warning: Could not update config.json: ${e.message}`);
    }
  }

  // Download remote files
  for (const { remote, local } of filesToSync) {
    const remoteUrl = `${ASSETS_BASE_URL}/${remoteSeries}/${callId}/${remote}`;
    const localPath = join(localDir, local);

    // Skip if file exists and not forcing
    if (existsSync(localPath) && !force) continue;

    try {
      await downloadFile(remoteUrl, localPath);
      changesMade = true;
    } catch (e) {
      console.log(`  Warning: Could not download ${remote}: ${e.message}`);
    }
  }

  return changesMade;
}

function generateProtocolCallsJson(callsBySeries) {
  // Load existing generated calls to preserve history
  let existing = [];
  if (existsSync(GENERATED_JSON_PATH)) {
    try {
      existing = JSON.parse(readFileSync(GENERATED_JSON_PATH, 'utf-8'));
    } catch (e) {
      console.log(`Warning: Could not read existing generated JSON: ${e.message}`);
    }
  }

  const existingPaths = new Set(existing.map(c => c.path));
  let added = 0;

  for (const [series, seriesCalls] of Object.entries(callsBySeries)) {
    if (DENYLIST.has(series)) continue;

    const localType = getLocalType(series);

    const isOneOff = localType.startsWith('one-off-');
    if (!KNOWN_TYPES.has(localType) && !isOneOff) {
      console.log(`Warning: Unknown series "${series}" (resolved type: "${localType}"). Skipping.`);
      continue;
    }

    for (const [callId, callData] of Object.entries(seriesCalls)) {
      // Same filters as asset syncing
      if (!callData.has_tldr && !callData.has_transcript && !callData.has_corrected_transcript && !callData.has_chat) {
        continue;
      }

      // Parse callId: "2026-02-05_174" -> date "2026-02-05", number "174"
      const sepIndex = callId.lastIndexOf('_');
      if (sepIndex === -1) continue;

      const date = callId.substring(0, sepIndex);
      const number = callId.substring(sepIndex + 1).padStart(3, '0');
      const path = `${localType}/${number}`;

      if (!existingPaths.has(path)) {
        const entry = { type: localType, date, number, path, ...callMetadataFields(callData) };

        // For one-off calls, read local tldr.json to extract the meeting name
        if (isOneOff && !entry.name) {
          const tldrPath = join(LOCAL_ASSETS_DIR, localType, callId, 'tldr.json');
          if (existsSync(tldrPath)) {
            try {
              const tldr = JSON.parse(readFileSync(tldrPath, 'utf-8'));
              if (tldr.meeting) {
                // Strip trailing date suffix like " - March 5, 2026"
                entry.name = tldr.meeting.replace(/\s*-\s*[A-Z][a-z]+\s+\d{1,2},\s*\d{4}$/, '');
              }
            } catch (e) {
              console.log(`Warning: Could not read tldr.json for ${localType}/${callId}: ${e.message}`);
            }
          }
        }

        existing.push(entry);
        existingPaths.add(path);
        added++;
      }
    }
  }

  // Backfill metadata onto pre-existing entries — manifest takes precedence over local config.
  const manifestByPath = new Map();
  for (const [series, seriesCalls] of Object.entries(callsBySeries)) {
    const localType = getLocalType(series);
    for (const [callId, callData] of Object.entries(seriesCalls)) {
      const sepIndex = callId.lastIndexOf('_');
      if (sepIndex === -1) continue;
      const number = callId.substring(sepIndex + 1).padStart(3, '0');
      manifestByPath.set(`${localType}/${number}`, callMetadataFields(callData));
    }
  }
  for (const entry of existing) {
    const fromManifest = manifestByPath.get(entry.path);
    if (fromManifest) {
      Object.assign(entry, fromManifest);
      continue;
    }
    if (entry.issue) continue;

    // Fall back to local config.json — try both padded and unpadded number forms
    const unpadded = entry.number.replace(/^0+/, '') || '0';
    const candidates = [
      join(LOCAL_ASSETS_DIR, entry.type, `${entry.date}_${entry.number}`, 'config.json'),
      join(LOCAL_ASSETS_DIR, entry.type, `${entry.date}_${unpadded}`, 'config.json'),
    ];
    for (const configPath of candidates) {
      if (!existsSync(configPath)) continue;
      try {
        Object.assign(entry, callMetadataFields(JSON.parse(readFileSync(configPath, 'utf-8'))));
        break;
      } catch (_) {}
    }
  }

  // Sort by type (alpha) then date (ascending)
  existing.sort((a, b) => a.type.localeCompare(b.type) || a.date.localeCompare(b.date));

  writeFileSync(GENERATED_JSON_PATH, JSON.stringify(existing, null, 2) + '\n');
  console.log(`\nGenerated ${GENERATED_JSON_PATH}: ${existing.length} total calls (${added} new).`);
}

async function main() {
  const force = process.argv.includes('--force');

  const manifest = await fetchManifest();
  const callsBySeries = normalizeManifest(manifest);

  const syncedPaths = [];

  for (const [series, calls] of Object.entries(callsBySeries)) {
    if (DENYLIST.has(series)) continue;

    const localType = getLocalType(series);
    console.log(`\nProcessing ${series}${localType !== series ? ` (as ${localType})` : ''}...`);

    for (const [callId, callData] of Object.entries(calls)) {
      // Skip if no useful assets
      if (!callData.has_tldr && !callData.has_transcript && !callData.has_corrected_transcript && !callData.has_chat) {
        continue;
      }

      if (await syncCall(series, localType, callId, callData, force)) {
        const number = callId.substring(callId.lastIndexOf('_') + 1);
        syncedPaths.push(`${localType}/${number}`);
        console.log(`  Synced ${callId}`);
      }
    }
  }

  generateProtocolCallsJson(callsBySeries);

  // Emit synced paths for CI commit message (via $GITHUB_OUTPUT)
  if (syncedPaths.length > 0 && process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `synced_paths=${syncedPaths.join(', ')}\n`);
  }

  console.log(`\nSync complete. ${syncedPaths.length} calls updated.`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
