# EIP Status History Backfill

## Summary

This PR backfills `forkRelationships[].statusHistory` for EIPs by exhaustively traversing git history.

- **78 EIP files** updated
- **258 status changes** extracted from git history
- **58 changes** (22%) correlated to specific calls

## Methodology

### Two-Source Approach

The EIP data has two historical sources that were both traversed:

1. **Pre-refactor (`src/data/eips.json`)**: 117 commits of history before the refactor in commit [`b0c051f`](https://github.com/ethereum/forkcast/commit/b0c051f8fc4028bc914fdb1a2dbdb9a16097b861) (2025-12-01)
2. **Post-refactor (`src/data/eips/{id}.json`)**: Individual file history after the refactor

### Correlation Logic

Status changes are matched to calls using (in priority order):

1. **Commit message match**: Extract call reference from commit messages
   - Patterns: `ACDE 226`, `acdc/171`, `based on 226`
2. **Date match**: If no message match, check if commit date matches exactly one call date
3. **No match**: Leave `call: null` if cannot determine (avoid false attribution)

### Skip Rules

Migration/refactor commits are detected and skipped for call attribution:
- Commits with "refactor", "migrate", "fix json", "comma" in message

## Statistics

| Metric | Count |
|--------|-------|
| Total status changes found | 258 |
| Matched by commit message | 36 (14%) |
| Matched by date | 22 (9%) |
| Skipped (migration commits) | 52 (20%) |
| Unmatched (call=null) | 148 (57%) |

## Verification Evidence

### Sample 1: EIP 7688 (Glamsterdam)

| Status | Date | Commit | Message | Call |
|--------|------|--------|---------|------|
| Proposed | 2025-09-16 | [`086ee23`](https://github.com/ethereum/forkcast/commit/086ee23d47b2d6b7d79ff54561d71b33d8d86944) | "add pfi'd eips for glamsterdam" | null |
| Considered | 2025-12-11 | [`af30185`](https://github.com/ethereum/forkcast/commit/af30185e9ccbc1e1836e6dcd5f147629f9fdb3ab) | "CFI and DFI based on 226" | acde/226 |

**Verify:** [View EIP 7688 at commit 086ee23](https://github.com/ethereum/forkcast/blob/086ee23d47b2d6b7d79ff54561d71b33d8d86944/src/data/eips.json#L1) (search for `"id": 7688`)

### Sample 2: EIP 7702 (Pectra)

| Status | Date | Commit | Message | Call |
|--------|------|--------|---------|------|
| Included | 2025-06-05 | [`0a6bb8d`](https://github.com/ethereum/forkcast/commit/0a6bb8dfdc152e64690e21f8543d34eff3ce5505) | "init" | null |

**Verify:** [View EIP 7702 at commit 0a6bb8d](https://github.com/ethereum/forkcast/blob/0a6bb8dfdc152e64690e21f8543d34eff3ce5505/src/data/eips.json#L1) (search for `"id": 7702`)

### Sample 3: EIP 7934 (Fusaka)

| Status | Date | Commit | Message | Call |
|--------|------|--------|---------|------|
| Scheduled | 2025-06-30 | [`2d178da`](https://github.com/ethereum/forkcast/commit/2d178dafb4cab72937727f06abd9e307f6b6b68f) | "CFI -> SFI for 7907, 7934, 7951" | null |

**Verify:** [View EIP 7934 at commit 2d178da](https://github.com/ethereum/forkcast/blob/2d178dafb4cab72937727f06abd9e307f6b6b68f/src/data/eips.json#L1) (search for `"id": 7934`)

### Sample 4: ACDE 226 CFI/DFI Changes

Commit [`d330dec`](https://github.com/ethereum/forkcast/commit/d330dec3a1f356feb0cbb54bb1a1a65d3310f7ed) ("CFI and DFI decisions based on ACDE 226") updated 9 EIPs:

| EIP | Status Change | Correctly Extracted | Correctly Correlated |
|-----|---------------|---------------------|---------------------|
| 2780 | Proposed → Considered | ✅ | ✅ acde/226 |
| 2926 | Proposed → Declined | ✅ | ✅ acde/226 |
| 7686 | Proposed → Declined | ✅ | ✅ acde/226 |
| 7904 | Proposed → Considered | ✅ | ✅ acde/226 |
| 7923 | Proposed → Declined | ✅ | ✅ acde/226 |
| 7973 | Proposed → Declined | ✅ | ✅ acde/226 |
| 7976 | Proposed → Considered | ✅ | ✅ acde/226 |
| 7981 | Proposed → Considered | ✅ | ✅ acde/226 |
| 8038 | Proposed → Considered | ✅ | ✅ acde/226 |

## How to Verify

### Verify locally
```bash
# Clone and run the scripts
git clone https://github.com/dionysuzx/forkcast.git
cd forkcast
git checkout backfill-eips-spec-v2-claude-promptexec-v2

# Regenerate intermediate data
python3 scripts/backfill_call_data.py
python3 scripts/backfill_status_data.py
python3 scripts/correlate_status_to_calls.py

# Check a specific EIP in the intermediate data
cat scripts/output/correlated_status.json | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(json.dumps(data.get('7688', {}), indent=2))
"

# Re-apply and validate
python3 scripts/apply_status_history.py
npm run build
```

### Verify a specific commit's EIP state
```bash
git show {commit}:src/data/eips.json | python3 -c "
import json, sys
eips = json.load(sys.stdin)
for eip in eips:
    if eip['id'] == 7688:
        print(json.dumps(eip.get('forkRelationships'), indent=2))
"
```

### Verify call exists
```bash
git log --oneline -S "path: 'acde/226'" -- src/data/calls.ts
```

## Scripts Created

| Script | Purpose |
|--------|---------|
| [`scripts/backfill_call_data.py`](scripts/backfill_call_data.py) | Extract call→commit mapping from calls.ts history |
| [`scripts/backfill_status_data.py`](scripts/backfill_status_data.py) | Extract EIP status changes from git history |
| [`scripts/correlate_status_to_calls.py`](scripts/correlate_status_to_calls.py) | Match status changes to calls |
| [`scripts/apply_status_history.py`](scripts/apply_status_history.py) | Apply changes to EIP JSON files |

## Intermediate Data

All intermediate data is saved in `scripts/output/` (not committed, regenerable):
- `call_commits.json` - Call to commit mapping
- `status_changes.json` - Raw status changes from git
- `correlated_status.json` - Status changes with call attribution

To regenerate, run the scripts in order as shown in "How to Verify" section.

## Known Limitations

- **Fork name typos**: Historical typos in fork names (e.g., "Hekota" → "Hegota") mean some older status changes won't be applied, as the script only matches exact fork names. This is intentional to avoid incorrect attribution.
- **Unmatched early changes**: Status changes before calls.ts existed (pre-Sept 2025) cannot be correlated to calls.
- **Idempotent**: Running on a branch with existing manual backfills will show fewer file changes (correct data is preserved, not duplicated).

## Validation Checklist

- [x] `npm run build` passes
- [x] No non-ASCII characters escaped (checked for `\u` in diffs)
- [x] Spot-checked 3+ EIPs against git history
- [x] All intermediate data in `scripts/output/`
- [x] All 9 EIPs from ACDE 226 commit correctly extracted and correlated
