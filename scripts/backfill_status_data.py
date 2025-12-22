#!/usr/bin/env python3
"""
Phase 2: Extract ALL EIP status changes from git history.

This script traverses TWO sources:
1. Pre-refactor: Old src/data/eips.json (before commit b0c051f)
2. Post-refactor: Individual src/data/eips/{id}.json files

It tracks status changes per EIP per fork by comparing consecutive commits.
"""

import json
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Any

REPO_ROOT = Path(__file__).parent.parent
OUTPUT_FILE = Path(__file__).parent / "output" / "status_changes.json"
REFACTOR_COMMIT = "b0c051f8fc4028bc914fdb1a2dbdb9a16097b861"


def run_git_command(args: List[str]) -> str:
    """Run a git command and return stdout."""
    result = subprocess.run(
        ["git"] + args,
        capture_output=True,
        text=True,
        cwd=REPO_ROOT
    )
    return result.stdout


def get_file_at_commit(commit: str, filepath: str) -> Optional[str]:
    """Get file contents at a specific commit."""
    result = subprocess.run(
        ["git", "show", f"{commit}:{filepath}"],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT
    )
    if result.returncode == 0:
        return result.stdout
    return None


def parse_eips_json(content: str) -> Optional[Dict[str, Dict[str, Any]]]:
    """
    Parse eips.json content and extract fork relationships.
    Returns: {eip_id: {fork_name: status}} or None if parsing fails
    """
    try:
        eips = json.loads(content)
    except json.JSONDecodeError:
        # Return None to indicate parse failure - caller should use previous state
        return None

    result = {}
    for eip in eips:
        eip_id = str(eip.get("id", ""))
        if not eip_id:
            continue

        fork_statuses = {}
        for rel in eip.get("forkRelationships", []):
            fork_name = rel.get("forkName", "")
            # Handle both old format (status) and new format (statusHistory)
            if "statusHistory" in rel:
                # New format: get the latest status from statusHistory
                history = rel.get("statusHistory", [])
                if history:
                    status = history[-1].get("status")
                else:
                    status = None
            else:
                # Old format: direct status field
                status = rel.get("status")

            if fork_name and status:
                fork_statuses[fork_name] = status

        if fork_statuses:
            result[eip_id] = fork_statuses

    return result


def parse_individual_eip_json(content: str) -> Optional[Dict[str, Any]]:
    """
    Parse individual EIP json content.
    Returns: {fork_name: status} or None if parsing fails
    """
    try:
        eip = json.loads(content)
    except json.JSONDecodeError:
        return None

    fork_statuses = {}
    for rel in eip.get("forkRelationships", []):
        fork_name = rel.get("forkName", "")
        # Handle both old format (status) and new format (statusHistory)
        if "statusHistory" in rel:
            history = rel.get("statusHistory", [])
            if history:
                status = history[-1].get("status")
            else:
                status = None
        else:
            status = rel.get("status")

        if fork_name and status:
            fork_statuses[fork_name] = status

    return fork_statuses


def get_commits_for_file(filepath: str, stop_at_commit: Optional[str] = None, branch: str = "origin/main") -> List[Dict]:
    """
    Get all commits that touched a file on a specific branch, in chronological order (oldest first).
    Returns list of {commit, date, message}
    """
    output = run_git_command([
        "log", branch, "--first-parent", "--reverse", "--format=%H %aI %s", "--", filepath
    ])

    commits = []
    for line in output.strip().split('\n'):
        if not line.strip():
            continue
        parts = line.split(' ', 2)
        if len(parts) >= 3:
            commit_hash = parts[0]
            commits.append({
                "commit": commit_hash,
                "date": parts[1][:10],
                "message": parts[2]
            })
            # Stop if we've reached the cutoff commit
            if stop_at_commit and commit_hash.startswith(stop_at_commit[:7]):
                break

    return commits


def extract_pre_refactor_changes() -> Dict[str, Dict[str, List[Dict]]]:
    """
    Extract status changes from old eips.json before refactor.
    Returns: {eip_id: {fork_name: [changes]}}
    """
    print("  Extracting pre-refactor changes from old eips.json...")

    commits = get_commits_for_file("src/data/eips.json")
    print(f"    Found {len(commits)} commits")

    # Track status changes
    all_changes = {}  # {eip_id: {fork_name: [changes]}}
    prev_statuses = {}  # {eip_id: {fork_name: status}}

    for commit_info in commits:
        commit = commit_info["commit"]
        date = commit_info["date"]
        message = commit_info["message"]

        # Skip commits after refactor (the file still appears in some commits after,
        # but we want individual file history for those)
        if commit.startswith(REFACTOR_COMMIT[:7]):
            # This is the refactor commit - process it but then stop
            pass

        content = get_file_at_commit(commit, "src/data/eips.json")
        if not content:
            continue

        curr_statuses = parse_eips_json(content)
        if curr_statuses is None:
            # JSON parsing failed (malformed JSON) - skip this commit
            continue

        # Compare with previous state
        all_eips = set(prev_statuses.keys()) | set(curr_statuses.keys())

        for eip_id in all_eips:
            prev_forks = prev_statuses.get(eip_id, {})
            curr_forks = curr_statuses.get(eip_id, {})

            all_forks = set(prev_forks.keys()) | set(curr_forks.keys())

            for fork_name in all_forks:
                old_status = prev_forks.get(fork_name)
                new_status = curr_forks.get(fork_name)

                if old_status != new_status and new_status:
                    # Status changed
                    if eip_id not in all_changes:
                        all_changes[eip_id] = {}
                    if fork_name not in all_changes[eip_id]:
                        all_changes[eip_id][fork_name] = []

                    all_changes[eip_id][fork_name].append({
                        "old_status": old_status,
                        "new_status": new_status,
                        "commit": commit,
                        "date": date,
                        "message": message
                    })

        prev_statuses = curr_statuses

        # Stop after refactor commit
        if commit.startswith(REFACTOR_COMMIT[:7]):
            break

    return all_changes


def extract_post_refactor_changes() -> Dict[str, Dict[str, List[Dict]]]:
    """
    Extract status changes from individual EIP files after refactor.
    Returns: {eip_id: {fork_name: [changes]}}
    """
    print("  Extracting post-refactor changes from individual files...")

    eip_files = list((REPO_ROOT / "src" / "data" / "eips").glob("*.json"))
    print(f"    Found {len(eip_files)} EIP files")

    all_changes = {}

    for eip_file in eip_files:
        eip_id = eip_file.stem
        relative_path = f"src/data/eips/{eip_file.name}"

        commits = get_commits_for_file(relative_path)

        # Skip commits that are the refactor commit or earlier
        # (those changes are captured by pre-refactor extraction)
        post_refactor_commits = []
        found_refactor = False
        for c in commits:
            if c["commit"].startswith(REFACTOR_COMMIT[:7]):
                found_refactor = True
                continue
            if found_refactor:
                post_refactor_commits.append(c)

        if not post_refactor_commits:
            continue

        # Get state at refactor commit as baseline
        prev_statuses = {}
        refactor_content = get_file_at_commit(REFACTOR_COMMIT, relative_path)
        if refactor_content:
            parsed = parse_individual_eip_json(refactor_content)
            if parsed is not None:
                prev_statuses = parsed

        # Track changes in post-refactor commits
        for commit_info in post_refactor_commits:
            commit = commit_info["commit"]
            date = commit_info["date"]
            message = commit_info["message"]

            content = get_file_at_commit(commit, relative_path)
            if not content:
                continue

            curr_statuses = parse_individual_eip_json(content)
            if curr_statuses is None:
                # JSON parsing failed - skip this commit
                continue

            # Compare with previous
            all_forks = set(prev_statuses.keys()) | set(curr_statuses.keys())

            for fork_name in all_forks:
                old_status = prev_statuses.get(fork_name)
                new_status = curr_statuses.get(fork_name)

                if old_status != new_status and new_status:
                    if eip_id not in all_changes:
                        all_changes[eip_id] = {}
                    if fork_name not in all_changes[eip_id]:
                        all_changes[eip_id][fork_name] = []

                    all_changes[eip_id][fork_name].append({
                        "old_status": old_status,
                        "new_status": new_status,
                        "commit": commit,
                        "date": date,
                        "message": message
                    })

            prev_statuses = curr_statuses

    return all_changes


def merge_changes(pre: Dict, post: Dict) -> Dict:
    """Merge pre-refactor and post-refactor changes."""
    merged = {}

    # Add all pre-refactor changes
    for eip_id, forks in pre.items():
        if eip_id not in merged:
            merged[eip_id] = {}
        for fork_name, changes in forks.items():
            if fork_name not in merged[eip_id]:
                merged[eip_id][fork_name] = []
            merged[eip_id][fork_name].extend(changes)

    # Add all post-refactor changes
    for eip_id, forks in post.items():
        if eip_id not in merged:
            merged[eip_id] = {}
        for fork_name, changes in forks.items():
            if fork_name not in merged[eip_id]:
                merged[eip_id][fork_name] = []
            merged[eip_id][fork_name].extend(changes)

    # Sort changes by date within each fork
    for eip_id in merged:
        for fork_name in merged[eip_id]:
            merged[eip_id][fork_name].sort(key=lambda x: x["date"])

    return merged


def main():
    print("Phase 2: Extracting EIP status changes from git history...")
    print()

    # Extract changes from both sources
    pre_changes = extract_pre_refactor_changes()
    print(f"    Pre-refactor: {sum(len(f) for e in pre_changes.values() for f in e.values())} status changes found")
    print()

    post_changes = extract_post_refactor_changes()
    print(f"    Post-refactor: {sum(len(f) for e in post_changes.values() for f in e.values())} status changes found")
    print()

    # Merge the two sources
    merged = merge_changes(pre_changes, post_changes)

    total_changes = sum(len(f) for e in merged.values() for f in e.values())
    total_eips = len(merged)
    print(f"  Total: {total_changes} status changes across {total_eips} EIPs")

    # Save output
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2, ensure_ascii=False)

    print(f"\nSaved status changes to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
