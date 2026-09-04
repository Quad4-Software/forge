#!/usr/bin/env bash
# Add your own remote so you can push the smart fork.
# Usage: contrib/quad4/add-origin.sh git@host:you/quad4-forge.git
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <git-url>" >&2
  exit 1
fi

url="$1"
if git remote get-url origin >/dev/null 2>&1; then
  echo "origin already set to $(git remote get-url origin)" >&2
  exit 1
fi

git remote add origin "$url"
git push -u origin quad4
echo "origin set. push other branches with: git push origin forgejo"
