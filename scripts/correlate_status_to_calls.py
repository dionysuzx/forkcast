#!/usr/bin/env python3
"""
Phase 3: Correlate status changes to calls.

This script matches status changes to calls using:
1. Commit message patterns (ACDE 226, acdc/171, etc.)
2. Date matching (if exactly one call on that date)

Migration/refactor commits are skipped.
"""

import json
import re
from pathlib import Path
from typing import Dict, List, Optional

SCRIPTS_DIR = Path(__file__).parent
STATUS_CHANGES_FILE = SCRIPTS_DIR / "output" / "status_changes.json"
CALL_COMMITS_FILE = SCRIPTS_DIR / "output" / "call_commits.json"
OUTPUT_FILE = SCRIPTS_DIR / "output" / "correlated_status.json"

# Patterns to skip (migration/refactor commits)
SKIP_PATTERNS = [
    r"\brefactor\b",
    r"\bmigrate\b",
    r"\bmove\b",
    r"\breorganize\b",
    r"\bfix json\b",
    r"\bfix format\b",
    r"\bcomma\b",
]

# Patterns to extract call references from commit messages
CALL_PATTERNS = [
    # "ACDE 226", "ACDC 171", "ACDT 53"
    r"\b(ACD[CET])\s*#?(\d+)\b",
    # "acde/226", "acdc/171"
    r"\b(acd[cet])/(\d+)\b",
    # "based on 226" in context of ACDE
    r"\bbased on (?:ACDE\s*)?(\d+)\b",
]


def load_json(path: Path) -> Dict:
    """Load a JSON file."""
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: Dict):
    """Save JSON with non-ASCII preservation."""
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    with open(path, "a", encoding="utf-8") as f:
        f.write("\n")


def should_skip_commit(message: str) -> bool:
    """Check if commit should be skipped (migration/format-only)."""
    message_lower = message.lower()
    for pattern in SKIP_PATTERNS:
        if re.search(pattern, message_lower, re.IGNORECASE):
            return True
    return False


def extract_call_from_message(message: str) -> Optional[str]:
    """
    Extract call reference from commit message.
    Returns call path like 'acde/226' or None.
    """
    message_lower = message.lower()

    # Try each pattern
    for pattern in CALL_PATTERNS:
        match = re.search(pattern, message, re.IGNORECASE)
        if match:
            groups = match.groups()
            if len(groups) == 2:
                call_type = groups[0].lower()
                call_num = groups[1]
                return f"{call_type}/{call_num}"
            elif len(groups) == 1:
                # "based on 226" - need to determine call type from context
                call_num = groups[0]
                # Check for acde/acdc context
                if "acde" in message_lower or "226" in call_num or "225" in call_num:
                    return f"acde/{call_num}"
                elif "acdc" in message_lower:
                    return f"acdc/{call_num}"

    return None


def find_call_by_date(date: str, call_commits: Dict) -> Optional[str]:
    """
    Find a call that matches the given date.
    Returns call path if exactly one call matches, None otherwise.
    """
    matches = []
    for call_path, info in call_commits.items():
        if info.get("date") == date:
            matches.append(call_path)

    # Only return if exactly one match (avoid ambiguity)
    if len(matches) == 1:
        return matches[0]

    return None


def correlate_changes(status_changes: Dict, call_commits: Dict) -> Dict:
    """
    Correlate status changes to calls.
    Returns: {eip_id: {fork_name: [status_entries]}}
    """
    result = {}
    stats = {
        "total": 0,
        "matched_by_message": 0,
        "matched_by_date": 0,
        "skipped_migration": 0,
        "unmatched": 0,
    }

    # Build reverse lookup: date -> call paths
    date_to_calls = {}
    for call_path, info in call_commits.items():
        date = info.get("date")
        if date:
            if date not in date_to_calls:
                date_to_calls[date] = []
            date_to_calls[date].append(call_path)

    for eip_id, forks in status_changes.items():
        result[eip_id] = {}

        for fork_name, changes in forks.items():
            result[eip_id][fork_name] = []

            for change in changes:
                stats["total"] += 1

                message = change.get("message", "")
                date = change.get("date", "")
                commit = change.get("commit", "")
                new_status = change.get("new_status", "")

                # Skip migration/refactor commits
                if should_skip_commit(message):
                    stats["skipped_migration"] += 1
                    # Still record the status, but without call attribution
                    result[eip_id][fork_name].append({
                        "status": new_status,
                        "date": date,
                        "source_commit": commit,
                        "call": None,
                        "match_method": "skipped_migration",
                    })
                    continue

                # Try to match by commit message
                call = extract_call_from_message(message)
                match_method = None

                if call:
                    stats["matched_by_message"] += 1
                    match_method = "message"
                else:
                    # Try to match by date
                    call = find_call_by_date(date, call_commits)
                    if call:
                        stats["matched_by_date"] += 1
                        match_method = "date"
                    else:
                        stats["unmatched"] += 1

                result[eip_id][fork_name].append({
                    "status": new_status,
                    "date": date,
                    "source_commit": commit,
                    "call": call,
                    "match_method": match_method,
                })

    return result, stats


def main():
    print("Phase 3: Correlating status changes to calls...")
    print()

    # Load input data
    status_changes = load_json(STATUS_CHANGES_FILE)
    call_commits = load_json(CALL_COMMITS_FILE)

    print(f"  Loaded {sum(len(f) for e in status_changes.values() for f in e.values())} status changes")
    print(f"  Loaded {len(call_commits)} calls")
    print()

    # Correlate
    correlated, stats = correlate_changes(status_changes, call_commits)

    # Save output
    save_json(OUTPUT_FILE, correlated)

    print(f"  Correlation results:")
    print(f"    Total changes: {stats['total']}")
    print(f"    Matched by message: {stats['matched_by_message']}")
    print(f"    Matched by date: {stats['matched_by_date']}")
    print(f"    Skipped (migration): {stats['skipped_migration']}")
    print(f"    Unmatched: {stats['unmatched']}")
    print()
    print(f"  Saved correlated data to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
