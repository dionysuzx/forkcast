import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CALLS_FILE = path.join(
  __dirname,
  "../src/data/protocol-calls.generated.json",
);
const ARTIFACTS_DIR = path.join(__dirname, "../public/artifacts");
const OUTPUT_FILE = path.join(__dirname, "../public/search-corpus.json");

function compileSearchCorpus() {
  console.log("Compiling search corpus...");

  const calls = JSON.parse(fs.readFileSync(CALLS_FILE, "utf8"));
  const corpus = [];

  for (const call of calls) {
    const dir = path.join(
      ARTIFACTS_DIR,
      call.type,
      `${call.date}_${call.number}`,
    );
    if (!fs.existsSync(dir)) continue;

    const entry = {
      type: call.type,
      date: call.date,
      number: call.number,
    };

    // Prefer corrected transcript
    const correctedPath = path.join(dir, "transcript_corrected.vtt");
    const transcriptPath = path.join(dir, "transcript.vtt");
    if (fs.existsSync(correctedPath)) {
      entry.transcript = fs.readFileSync(correctedPath, "utf8");
    } else if (fs.existsSync(transcriptPath)) {
      entry.transcript = fs.readFileSync(transcriptPath, "utf8");
    }

    const chatPath = path.join(dir, "chat.txt");
    if (fs.existsSync(chatPath)) {
      entry.chat = fs.readFileSync(chatPath, "utf8");
    }

    const tldrPath = path.join(dir, "tldr.json");
    if (fs.existsSync(tldrPath)) {
      try {
        entry.tldr = JSON.parse(fs.readFileSync(tldrPath, "utf8"));
      } catch (err) {
        console.warn(`⚠ Skipping malformed TLDR: ${tldrPath} (${err.message})`);
      }
    }

    // Only include calls that have at least one artifact
    if (entry.transcript || entry.chat || entry.tldr) {
      corpus.push(entry);
    }
  }

  // Compute a content fingerprint so the runtime can detect stale caches
  const corpusJson = JSON.stringify(corpus);
  const corpusHash = createHash("sha256").update(corpusJson).digest("hex").slice(0, 12);

  fs.writeFileSync(OUTPUT_FILE, corpusJson);
  fs.writeFileSync(
    path.join(path.dirname(OUTPUT_FILE), "search-corpus-version.json"),
    JSON.stringify({ hash: corpusHash }),
  );
  const sizeMB = (fs.statSync(OUTPUT_FILE).size / 1024 / 1024).toFixed(1);
  console.log(
    `✓ Compiled ${corpus.length} calls into ${OUTPUT_FILE} (${sizeMB} MB, hash: ${corpusHash})`,
  );
}

compileSearchCorpus();
