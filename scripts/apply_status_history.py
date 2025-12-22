#!/usr/bin/env python3
"""
Phase 4: Apply correlated status history to EIP JSON files.

This script:
1. Loads correlated status data
2. For each EIP, builds statusHistory from the correlated data
3. Merges with existing statusHistory (preserving entries with call/date)
4. Writes updated EIP files, preserving non-ASCII characters
"""

import json
from pathlib import Path
from typing import Dict, List, Any

SCRIPTS_DIR = Path(__file__).parent
REPO_ROOT = SCRIPTS_DIR.parent
CORRELATED_FILE = SCRIPTS_DIR / "output" / "correlated_status.json"
EIPS_DIR = REPO_ROOT / "src" / "data" / "eips"


def load_json(path: Path) -> Dict:
    """Load a JSON file."""
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: Dict):
    """Save JSON file, preserving non-ASCII characters."""
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    # Add trailing newline
    with open(path, "a", encoding="utf-8") as f:
        f.write("\n")


def build_status_history(changes: List[Dict]) -> List[Dict]:
    """
    Build statusHistory array from correlated changes.

    Changes are already sorted by date (oldest first).
    Returns list of status entries with optional call/date fields.
    """
    history = []

    for change in changes:
        status = change.get("status")
        call = change.get("call")
        date = change.get("date")
        match_method = change.get("match_method")

        if not status:
            continue

        entry = {"status": status}

        # Only include call if we have a match
        if call:
            entry["call"] = call

        # Include date if we have call or if the change was tracked
        if call and date:
            entry["date"] = date

        history.append(entry)

    return history


def merge_status_history(existing: List[Dict], new: List[Dict]) -> List[Dict]:
    """
    Merge new status history with existing.

    Priority:
    1. Keep existing entries that have call/date info
    2. Use new entries to fill gaps
    3. Avoid duplicates
    """
    # If existing has meaningful data (call info), prefer it
    existing_has_calls = any(e.get("call") for e in existing)

    if existing_has_calls and not new:
        return existing

    if not existing:
        return new

    # Build a map of status to entry for deduplication
    # Prefer entries with call information
    merged = {}

    # First add new entries
    for entry in new:
        status = entry.get("status")
        if status:
            # Use (status) as key - we keep the entry with the most info
            if status not in merged or entry.get("call"):
                merged[status] = entry

    # Then overlay existing entries (they may have manually curated data)
    for entry in existing:
        status = entry.get("status")
        if status:
            # Keep existing if it has call info that new doesn't
            if status in merged:
                existing_call = entry.get("call")
                new_call = merged[status].get("call")
                if existing_call and not new_call:
                    merged[status] = entry
                elif existing_call:
                    # Both have calls - keep existing (curated)
                    merged[status] = entry
            else:
                merged[status] = entry

    # Convert back to list, ordered by typical status progression
    status_order = ["Proposed", "Considered", "Scheduled", "Included", "Declined"]
    result = []

    # First add in typical order
    for status in status_order:
        if status in merged:
            result.append(merged.pop(status))

    # Add any remaining statuses
    for status, entry in merged.items():
        result.append(entry)

    return result


def apply_to_eip(eip_path: Path, correlated_data: Dict) -> bool:
    """
    Apply status history to an EIP file.
    Returns True if file was modified.
    """
    eip_id = eip_path.stem

    if eip_id not in correlated_data:
        return False

    eip = load_json(eip_path)
    fork_changes = correlated_data[eip_id]

    modified = False

    for rel in eip.get("forkRelationships", []):
        fork_name = rel.get("forkName")

        if fork_name not in fork_changes:
            continue

        changes = fork_changes[fork_name]
        new_history = build_status_history(changes)

        if not new_history:
            continue

        existing_history = rel.get("statusHistory", [])
        merged_history = merge_status_history(existing_history, new_history)

        if merged_history != existing_history:
            rel["statusHistory"] = merged_history
            modified = True

    if modified:
        save_json(eip_path, eip)

    return modified


def main():
    print("Phase 4: Applying status history to EIP files...")
    print()

    # Load correlated data
    correlated = load_json(CORRELATED_FILE)
    print(f"  Loaded correlated data for {len(correlated)} EIPs")

    # Get all EIP files
    eip_files = list(EIPS_DIR.glob("*.json"))
    print(f"  Found {len(eip_files)} EIP files")
    print()

    # Apply changes
    modified_count = 0
    for eip_path in sorted(eip_files):
        if apply_to_eip(eip_path, correlated):
            print(f"    Updated: {eip_path.name}")
            modified_count += 1

    print()
    print(f"  Modified {modified_count} EIP files")
    print()
    print("  Run 'npm run build' to validate changes")


if __name__ == "__main__":
    main()
