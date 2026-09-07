#!/usr/bin/env bash
# Publish this complete source distribution without rewriting remote history.
set -euo pipefail
REPO="${1:-wieslawsoltes/Frameforge}"
if [[ ! "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  printf 'Usage: bash publish-github.sh [owner/repository]\n' >&2
  exit 2
fi
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
for command in git gh node npm tar; do
  command -v "$command" >/dev/null || { printf 'Required command missing: %s\n' "$command" >&2; exit 1; }
done
[[ -f "$ROOT/src/media.js" && -f "$ROOT/assets/weightless.wav" ]] || {
  echo 'Run this script from the complete Frameforge distribution.' >&2; exit 1;
}
gh auth status --hostname github.com
(cd "$ROOT" && npm test && npm run build)
TMP="$(mktemp -d "${TMPDIR:-/tmp}/frameforge-publish.XXXXXX")"
cleanup() {
  local result=$?
  if [[ "$result" -eq 0 ]]; then
    rm -rf -- "$TMP"
  else
    printf 'Publication stopped. Working files retained at: %s\n' "$TMP" >&2
  fi
}
trap cleanup EXIT
CHECKOUT="$TMP/repository"
git clone --branch main "https://github.com/$REPO.git" "$CHECKOUT"
# Source is copied over the current main branch; existing unrelated files survive.
tar --exclude=.git --exclude=node_modules --exclude=test-output --exclude=.DS_Store --exclude=_site -C "$ROOT" -cf - . | tar -C "$CHECKOUT" -xf -

# Set up Pages before pushing so the deployment can start immediately.
printf '{"build_type":"workflow"}\n' > "$TMP/pages.json"
if gh api "repos/$REPO/pages" > "$TMP/pages-before.json" 2> "$TMP/pages-error.txt"; then
  gh api --method PUT "repos/$REPO/pages" --input "$TMP/pages.json" > /dev/null
elif grep -q 'HTTP 404' "$TMP/pages-error.txt"; then
  gh api --method POST "repos/$REPO/pages" --input "$TMP/pages.json" > /dev/null
else
  cat "$TMP/pages-error.txt" >&2
  exit 1
fi

cd "$CHECKOUT"
if ! git var GIT_AUTHOR_IDENT >/dev/null 2>&1; then
  LOGIN="$(gh api user --jq .login)"
  USER_ID="$(gh api user --jq .id)"
  git config user.name "$LOGIN"
  git config user.email "$USER_ID+$LOGIN@users.noreply.github.com"
fi
git add --all
if ! git diff --cached --quiet; then
  git commit -m "Import Frameforge v1 editor, demo media, tests, and GitHub Pages deployment"
  git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push origin HEAD:main
else
  echo 'The remote repository already contains this distribution.'
fi
printf '\nRepository: https://github.com/%s\n' "$REPO"
printf 'Deployment workflow: https://github.com/%s/actions/workflows/pages.yml\n' "$REPO"
printf 'Pages URL after successful deployment: https://%s.github.io/%s/\n' "${REPO%/*}" "${REPO#*/}"
