# EIP Status History Backfill

## Summary

This PR backfills `forkRelationships[].statusHistory` for EIPs by exhaustively traversing git history.

- **78 EIP files** updated
- **258 status changes** extracted from git history
- **58 changes** (22%) correlated to specific calls

## Methodology

### Two-Source Approach

The EIP data has two historical sources that were both traversed:

1. **Pre-refactor (`src/data/eips.json`)**: 117 commits of history before the refactor in commit `b0c051f` (2025-12-01)
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

```
Status: Proposed
  Date: 2025-09-16
  Commit: 086ee23d47b2d6b7d79ff54561d71b33d8d86944
  Message: "add pfi'd eips for glamsterdam"
  Call: null (no matching call on this date)

Status: Considered
  Date: 2025-12-11
  Commit: af30185e9ccbc1e1836e6dcd5f147629f9fdb3ab
  Message: "CFI and DFI based on 226"
  Call: acde/226 (matched from commit message)
```

**Verification:**
```bash
git show 086ee23:src/data/eips.json | grep -A10 '"id": 7688'
git show af30185:src/data/eips.json | grep -A10 '"id": 7688'
```

### Sample 2: EIP 7702 (Pectra)

```
Status: Included
  Date: 2025-06-05
  Commit: 0a6bb8dfdc152e64690e21f8543d34eff3ce5505
  Message: "init"
  Call: null (initial data load)
```

**Verification:**
```bash
git show 0a6bb8d:src/data/eips.json | grep -A10 '"id": 7702'
```

### Sample 3: EIP 7934 (Fusaka)

```
Status: Scheduled
  Date: 2025-06-30
  Commit: 2d178dafb4cab72937727f06abd9e307f6b6b68f
  Message: "CFI -> SFI for 7907, 7934, 7951"
  Call: null (message describes status change, not call reference)
```

**Verification:**
```bash
git show 2d178da:src/data/eips.json | grep -A10 '"id": 7934'
```

## How to Verify

### Verify a specific status change
```bash
# See EIP state at a commit
git show {commit}:src/data/eips.json | python3 -c "
import json, sys
eips = json.load(sys.stdin)
for eip in eips:
    if eip['id'] == 7688:
        print(json.dumps(eip.get('forkRelationships'), indent=2))
"

# For post-refactor commits
git show {commit}:src/data/eips/7688.json
```

### Verify call exists
```bash
git log --oneline -S "path: 'acde/226'" -- src/data/calls.ts
```

### Re-run the backfill
```bash
python3 scripts/backfill_call_data.py
python3 scripts/backfill_status_data.py
python3 scripts/correlate_status_to_calls.py
python3 scripts/apply_status_history.py
npm run build
```

## Scripts Created

| Script | Purpose |
|--------|---------|
| `scripts/backfill_call_data.py` | Extract call→commit mapping from calls.ts history |
| `scripts/backfill_status_data.py` | Extract EIP status changes from git history |
| `scripts/correlate_status_to_calls.py` | Match status changes to calls |
| `scripts/apply_status_history.py` | Apply changes to EIP JSON files |

## Intermediate Data

All intermediate data is saved in `scripts/output/` (not committed, regenerable):
- `call_commits.json` - Call to commit mapping
- `status_changes.json` - Raw status changes from git
- `correlated_status.json` - Status changes with call attribution

To regenerate, run the scripts in order as shown in "How to Verify" section.

## Known Limitations

- **Fork name typos**: Historical typos in fork names (e.g., "Hekota" → "Hegota") mean some older status changes won't be applied, as the script only matches exact fork names. This is intentional to avoid incorrect attribution.
- **Unmatched early changes**: Status changes before calls.ts existed (pre-Sept 2025) cannot be correlated to calls.

## Validation Checklist

- [x] `npm run build` passes
- [x] No non-ASCII characters escaped (checked for `\u` in diffs)
- [x] Spot-checked 3+ EIPs against git history
- [x] All intermediate data in `scripts/output/`
