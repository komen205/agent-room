#!/usr/bin/env bash
# Optional helper: sync a group of related repos to their default branch before an agent run.
#
# Useful when the agents work across multiple repos matching a naming pattern
# (e.g. `myproject-*`, `service-*`). Skips repos with uncommitted changes.
#
# Usage:
#   SYNC_ROOT=/path/to/parent SYNC_PATTERN='myproject-*' bash sync-repos.sh
#
# Defaults: current directory, pattern `*` (every git repo in ROOT).

set -u

ROOT="${SYNC_ROOT:-$PWD}"
PATTERN="${SYNC_PATTERN:-*}"
cd "$ROOT" || { echo "cannot cd to $ROOT"; exit 1; }

ok=()
skipped=()
failed=()
no_default=()

shopt -s nullglob
for dir in $PATTERN/; do
  name="${dir%/}"
  pushd "$dir" > /dev/null || { failed+=("$name (pushd failed)"); continue; }

  if [ ! -d ".git" ]; then
    popd > /dev/null
    continue
  fi

  if [ -n "$(git status --porcelain)" ]; then
    skipped+=("$name (dirty working tree)")
    popd > /dev/null
    continue
  fi

  default=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')
  if [ -z "$default" ]; then
    if git show-ref --verify --quiet refs/remotes/origin/main; then
      default="main"
    elif git show-ref --verify --quiet refs/remotes/origin/master; then
      default="master"
    else
      no_default+=("$name")
      popd > /dev/null
      continue
    fi
  fi

  current=$(git symbolic-ref --short HEAD 2>/dev/null || echo "DETACHED")

  if ! git fetch --quiet origin "$default" 2>/dev/null; then
    failed+=("$name (fetch failed)")
    popd > /dev/null
    continue
  fi

  if [ "$current" != "$default" ]; then
    if ! git checkout --quiet "$default" 2>/dev/null; then
      failed+=("$name (checkout $default failed)")
      popd > /dev/null
      continue
    fi
  fi

  if git pull --rebase --quiet origin "$default" 2>/dev/null; then
    ok+=("$name -> $default")
  else
    git rebase --abort 2>/dev/null || true
    failed+=("$name (pull --rebase failed; aborted)")
  fi

  popd > /dev/null
done

echo ""
echo "==== sync-repos summary ===="
echo "Updated (${#ok[@]}):"
for r in "${ok[@]}"; do echo "  ✓ $r"; done
if [ ${#skipped[@]} -gt 0 ]; then
  echo ""
  echo "Skipped (${#skipped[@]}):"
  for r in "${skipped[@]}"; do echo "  - $r"; done
fi
if [ ${#no_default[@]} -gt 0 ]; then
  echo ""
  echo "No default branch (${#no_default[@]}):"
  for r in "${no_default[@]}"; do echo "  ? $r"; done
fi
if [ ${#failed[@]} -gt 0 ]; then
  echo ""
  echo "Failed (${#failed[@]}):"
  for r in "${failed[@]}"; do echo "  ✗ $r"; done
  exit 1
fi
