#!/usr/bin/env bash
# 号を保存してGitHubへ送る。他のタスクと同時に送って衝突した場合は、最新を取り込んでやり直す。
#   bash tools/publish.sh /path/to/issue.json
set -euo pipefail
ISSUE_JSON="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
cd "$(dirname "$0")/.."

git config user.name  >/dev/null 2>&1 || git config user.name  "asayomi-bot"
git config user.email >/dev/null 2>&1 || git config user.email "asayomi-bot@users.noreply.github.com"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' "$ISSUE_JSON")"

git fetch -q origin "$BRANCH"
git reset -q --hard "origin/$BRANCH"

for attempt in 1 2 3 4 5; do
  python3 tools/publish_issue.py "$ISSUE_JSON"
  git add data
  git commit -q -m "記事を追加: $ID"
  if git push -q origin "HEAD:$BRANCH"; then
    echo "送信しました: $ID"
    exit 0
  fi
  echo "送信が衝突しました。最新を取り込んでやり直します（${attempt}回目）" >&2
  sleep $((attempt * 5))
  git fetch -q origin "$BRANCH"
  git reset -q --hard "origin/$BRANCH"
done
echo "エラー: 5回試しても送信できませんでした" >&2
exit 1
