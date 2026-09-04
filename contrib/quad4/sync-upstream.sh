#!/usr/bin/env bash
# Merge latest Forgejo into the quad4 smart-fork branch.
# Usage: contrib/quad4/sync-upstream.sh
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

branch="$(git branch --show-current)"
if [[ "$branch" != "quad4" ]]; then
  echo "checkout quad4 before syncing (on ${branch})" >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "working tree dirty. commit or stash first." >&2
  exit 1
fi

echo "fetching upstream/forgejo"
git fetch upstream forgejo

echo "merging upstream/forgejo into quad4"
git merge --no-ff upstream/forgejo -m "merge: upstream/forgejo into quad4"

echo "done. resolve conflicts if any, then build and test."
