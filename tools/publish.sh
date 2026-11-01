#!/usr/bin/env bash
# 号を検証してGitHubへ送る。
# main へは直接送らず、号ごとのブランチ（claude/issue-<id>）へ送る。
# GitHub Actions（ingest）がそれを main に取り込み、アプリへの通知を送る。
#   bash tools/publish.sh /path/to/issue.json
set -euo pipefail
ISSUE_JSON="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
cd "$(dirname "$0")/.."

git config user.name  >/dev/null 2>&1 || git config user.name  "asayomi-bot"
git config user.email >/dev/null 2>&1 || git config user.email "asayomi-bot@users.noreply.github.com"

ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' "$ISSUE_JSON")"
BRANCH="claude/issue-${ID}-$(date +%H%M%S)"

echo "[1/3] 最新の main を取得"
git fetch -q origin main
git checkout -q -B "$BRANCH" origin/main

echo "[2/3] 検証して保存"
python3 tools/publish_issue.py "$ISSUE_JSON"
git add data
git commit -q -m "記事を追加: $ID"

echo "[3/3] ブランチ $BRANCH へ送信"
for attempt in 1 2 3; do
  if git push -q origin "HEAD:refs/heads/$BRANCH"; then
    echo "送信しました: $ID（数分以内に main へ取り込まれ、アプリに通知が届きます）"
    exit 0
  fi
  echo "送信に失敗しました（${attempt}回目）。少し待って再試行します" >&2
  sleep $((attempt * 5))
done
echo "エラー: GitHub へ送信できませんでした（ブランチ $BRANCH）" >&2
exit 1
