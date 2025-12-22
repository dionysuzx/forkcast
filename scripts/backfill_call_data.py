#!/usr/bin/env python3
"""
Phase 1: Extract call → commit mapping from git history of src/data/calls.ts

This script parses the calls.ts file to extract all calls (type, number, date, path),
then finds the first commit where each call was added.
"""

import json
import re
import subprocess
from pathlib import Path
from typing import Dict, List, Optional

REPO_ROOT = Path(__file__).parent.parent
CALLS_FILE = REPO_ROOT / "src" / "data" / "calls.ts"
OUTPUT_FILE = Path(__file__).parent / "output" / "call_commits.json"


def parse_calls_ts() -> List[Dict]:
    """Parse calls.ts to extract all calls."""
    content = CALLS_FILE.read_text()

    # Match call entries like: { type: 'acdc', date: '2025-04-03', number: '154', path: 'acdc/154' }
    pattern = r"\{\s*type:\s*'(\w+)',\s*date:\s*'([^']+)',\s*number:\s*'([^']+)',\s*path:\s*'([^']+)'\s*\}"

    calls = []
    for match in re.finditer(pattern, content):
        calls.append({
            "type": match.group(1),
            "date": match.group(2),
            "number": match.group(3),
            "path": match.group(4)
        })

    return calls


def find_first_commit_for_call(call_path: str) -> Optional[Dict]:
    """Find the first commit where this call was added."""
    try:
        # Use -S to find commits that added/removed this string
        result = subprocess.run(
            ["git", "log", "--all", "--reverse", "--format=%H %aI %s", "-S", f"path: '{call_path}'", "--", "src/data/calls.ts"],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT
        )

        if result.returncode != 0 or not result.stdout.strip():
            return None

        # Get the first line (first commit that introduced this call)
        first_line = result.stdout.strip().split('\n')[0]
        parts = first_line.split(' ', 2)

        if len(parts) >= 3:
            return {
                "commit": parts[0],
                "date": parts[1][:10],  # Just the date part of ISO format
                "message": parts[2]
            }

    except Exception as e:
        print(f"Error finding commit for {call_path}: {e}")

    return None


def main():
    print("Phase 1: Extracting call → commit mapping...")

    calls = parse_calls_ts()
    print(f"Found {len(calls)} calls in calls.ts")

    call_commits = {}

    for call in calls:
        path = call["path"]
        print(f"  Finding commit for {path}...")

        commit_info = find_first_commit_for_call(path)

        if commit_info:
            call_commits[path] = commit_info
            print(f"    → {commit_info['commit'][:7]} ({commit_info['date']}): {commit_info['message'][:50]}")
        else:
            # If we can't find it with git -S, the call may have been in the initial commit
            # or added with a different syntax
            call_commits[path] = {
                "commit": None,
                "date": call["date"],  # Use the call's date as fallback
                "message": "Unable to find source commit"
            }
            print(f"    → No commit found, using call date: {call['date']}")

    # Save output
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(call_commits, f, indent=2, ensure_ascii=False)

    print(f"\nSaved call commits to {OUTPUT_FILE}")
    print(f"Total calls: {len(call_commits)}")
    print(f"With commit info: {sum(1 for c in call_commits.values() if c['commit'])}")


if __name__ == "__main__":
    main()
