# EIP Status History Backfill - Agent Prompt

## Goal

Backfill `forkRelationships[].statusHistory` for all EIPs in `src/data/eips/*.json` by exhaustively traversing git history.

The output must be **verifiably correct** - every status change must be traceable to a specific commit, and the PR must include evidence of correctness.

## Critical Context: File History Structure

**The EIP data has TWO historical sources that MUST both be traversed:**

1. **Before refactor (commit `b0c051f`)**: All EIP data lived in a single tracked file `src/data/eips.json`
   - This file has **117 commits** of history on origin/main
   - Contains the original "Proposed", "Considered", "Declined" status assignments
   - Many commits have meaningful messages like "add pfi'd eips for glamsterdam", "CFI and DFI decisions based on ACDE 226"

2. **After refactor**: Individual `src/data/eips/{id}.json` files
   - Created by commit `b0c051f refactor: eips to individual files` on 2025-12-01
   - The old `eips.json` is now gitignored (it's generated/compiled from individual files)
   - Only captures history from the refactor forward

**If you only traverse individual file history, you will miss all pre-refactor status changes and attribute them to the wrong dates/commits.**

## Philosophy

- **Git history is the source of truth** - not artifact files (tldr.json, chat.txt, etc.)
- **Better incomplete than incorrect** - only record what we can verify from commits
- **Verifiably correct** - every entry must be traceable to a specific commit
- **Preserve file integrity** - use `ensure_ascii=False` when writing JSON to preserve non-ASCII characters (ł, é, —, etc.)

## Phase 1: Create `scripts/backfill_call_data.py`

Extract call → commit mapping from git history of `src/data/calls.ts`.

**Logic:**
1. Parse current `src/data/calls.ts` to extract all calls (type, number, date, path)
2. For each call, find the first commit where it was added:
   ```bash
   git log --all --reverse --oneline -S "path: '{call_path}'" -- src/data/calls.ts
   ```
3. Extract commit hash, date, and message
4. Output to `scripts/output/call_commits.json`

**Output format:**
```json
{
  "acde/226": {
    "commit": "8f3253a646ec19fdd3cce2410304537c62eaa45f",
    "date": "2025-12-18",
    "message": "add acde 226"
  }
}
```

## Phase 2: Create `scripts/backfill_status_data.py`

Extract ALL EIP status changes from git history. **This is the critical phase.**

**You MUST traverse TWO sources:**

### Source 1: Old `src/data/eips.json` (pre-refactor)

1. Get full history of the old eips.json file:
   ```bash
   git log --all --reverse --format="%H %aI %s" -- src/data/eips.json
   ```

2. For each commit, extract the file and parse each EIP's forkRelationships:
   ```bash
   git show {commit}:src/data/eips.json
   ```

3. Track status changes per EIP per fork by comparing consecutive commits

4. Stop at the refactor commit (`b0c051f`) - after this, data moves to individual files

### Source 2: Individual `src/data/eips/{id}.json` files (post-refactor)

1. For each EIP file, get history from refactor forward:
   ```bash
   git log --all --reverse --format="%H %aI %s" -- src/data/eips/{id}.json
   ```

2. For each commit, extract and compare status

### Merge the histories

For each EIP, combine:
- Pre-refactor changes from old eips.json
- Post-refactor changes from individual file

**Output format:**
```json
{
  "7688": {
    "Glamsterdam": [
      {
        "old_status": null,
        "new_status": "Proposed",
        "commit": "086ee23d47b2d6b7d79ff54561d71b33d8d86944",
        "date": "2025-09-16",
        "message": "add pfi'd eips for glamsterdam"
      },
      {
        "old_status": "Proposed",
        "new_status": "Considered",
        "commit": "af30185e9ccbc1e1836e6dcd5f147629f9fdb3ab",
        "date": "2025-12-11",
        "message": "CFI and DFI based on 226"
      }
    ]
  }
}
```

## Phase 3: Create `scripts/correlate_status_to_calls.py`

Correlate status changes to calls.

**Matching logic (in priority order):**

1. **Commit message match**: Extract call reference from commit message
   - Pattern: `acdc/\d+`, `acde/\d+`, `acdt/\d+`
   - Also match: "ACDE 226", "ACDC #170", etc.
   - Example: "CFI and DFI decisions based on ACDE 226" → `acde/226`

2. **Date match**: If no message match, check if commit date matches exactly one call date
   - Only use if exactly one call on that date (avoid ambiguity)

3. **No match**: Leave `call: null` if cannot determine
   - Do NOT guess or force a match

**Skip attribution for migration/refactor commits:**
- Commits with messages containing: "refactor", "migrate", "move", "reorganize"
- These just moved data, they don't represent status decisions

**Output format:**
```json
{
  "7688": {
    "Glamsterdam": [
      {
        "status": "Proposed",
        "call": null,
        "date": "2025-09-16",
        "source_commit": "086ee23d..."
      },
      {
        "status": "Considered",
        "call": "acdc/171",
        "date": "2025-12-11",
        "source_commit": "af30185e..."
      }
    ]
  }
}
```

## Phase 4: Create `scripts/apply_status_history.py`

Apply the correlated data to EIP JSON files.

**Important - Preserve file integrity:**
```python
def save_json(path: Path, data: dict):
    """Save JSON file, preserving non-ASCII characters."""
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    with open(path, "a", encoding="utf-8") as f:
        f.write("\n")
```

**Logic:**
1. Load correlated status data
2. For each EIP file:
   - Read current file
   - Build `statusHistory` array from correlated data
   - Merge with existing statusHistory (preserve entries that already have call/date)
   - Order oldest → newest
   - Write updated file
3. Run `npm run build` to validate

**Target format:**
```json
"statusHistory": [
  {
    "status": "Proposed"
  },
  {
    "status": "Considered",
    "call": "acdc/171",
    "date": "2025-12-11"
  }
]
```

- Include `call` and `date` only when known
- First entry may have only `status` if original call unknown

## Phase 5: Create `PR.md`

Create a PR description that helps reviewers verify correctness.

**Required sections:**

### Summary
- Number of EIPs updated
- Number of status changes backfilled
- Match rate (how many correlated to calls)

### Methodology
- Explain the two-source approach (old eips.json + individual files)
- Explain correlation logic

### Verification Evidence
For 3-5 sample EIPs, show the full trace:
```
EIP 7688 Glamsterdam:
  Status: Proposed
  Date: 2025-09-16
  Commit: 086ee23
  Message: "add pfi'd eips for glamsterdam"
  Verification: git show 086ee23:src/data/eips.json | grep -A20 '"id": 7688'

  Status: Considered
  Date: 2025-12-11
  Commit: af30185
  Call: acdc/171 (matched by date)
  Message: "CFI and DFI based on 226"
  Verification: git show af30185:src/data/eips/7688.json
```

### How to Verify
Provide commands reviewers can run:
```bash
# Verify a specific status change
git show {commit}:{file} | python3 -c "..."

# Verify call correlation
git log --oneline -S "path: 'acdc/171'" -- src/data/calls.ts
```

### Statistics
- Total status changes found
- Matched by commit message: X
- Matched by date: X
- Unmatched (call=null): X

## Execution Order

```bash
# Run in order
python3 scripts/backfill_call_data.py
python3 scripts/backfill_status_data.py
python3 scripts/correlate_status_to_calls.py
python3 scripts/apply_status_history.py

# Validate
npm run build

# Review changes
git diff --stat src/data/eips/
```

## Validation Checklist

Before creating PR:

- [ ] `npm run build` passes
- [ ] No non-ASCII characters escaped (check for `\u` in diffs)
- [ ] Spot-checked 3+ EIPs against git history
- [ ] PR.md includes verification evidence
- [ ] All intermediate data in `scripts/output/` for transparency

## Edge Cases

1. **Batch commits**: Some commits modified multiple EIPs - each EIP gets the same commit/date
2. **Format-only commits**: Detect by comparing actual status values, not JSON structure
3. **Already has statusHistory**: Merge new findings with existing data
4. **Multiple status changes same day**: Preserve order from commit sequence
5. **Status reverted**: e.g., Declined → Proposed - record each transition

## Important Constraints

1. **DO NOT parse artifact files** (tldr.json, chat.txt, transcript.vtt)
2. **DO NOT guess or infer** - only record what git shows
3. **DO NOT attribute calls to migration commits**
4. **Preserve non-ASCII characters** - use `ensure_ascii=False`
5. **Track BOTH sources** - old eips.json AND individual files

## Expected Deliverables

1. Scripts in `scripts/` directory
2. Output data in `scripts/output/` (for transparency/debugging)
3. Updated `src/data/eips/*.json` files with complete `statusHistory`
4. `PR.md` with verification evidence
5. Clean PR ready for review
