#!/usr/bin/env python3
"""重複チェック用に、これまでの記事を一覧表示する。

  python3 tools/recent.py ai          # AIニュース：過去45日分
  python3 tools/recent.py thermal     # 熱流体：全期間＋カテゴリ別の掲載数と直近のカテゴリ
"""
import json
import sys
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

INDEX = Path(__file__).resolve().parent.parent / "data" / "index.json"


def main(argv):
    series = argv[1] if len(argv) > 1 else ""
    if series not in ("ai", "thermal"):
        print(__doc__)
        return 2
    try:
        idx = json.loads(INDEX.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print("記事はまだありません")
        return 0
    issues = [i for i in idx.get("issues", []) if i.get("series") == series]
    if series == "ai":
        since = (date.today() - timedelta(days=45)).isoformat()
        issues = [i for i in issues if (i.get("date") or "") >= since]
        print(f"# AIニュース 過去45日（{len(issues)}号）: 日付 | カテゴリ | 見出し | URL | キーワード")
        for iss in issues:
            for it in iss.get("items", []):
                print(f"{iss['date']} | {it.get('category')} | {it.get('title')} | {it.get('url')} | {'、'.join(it.get('keywords', []))}")
    else:
        print(f"# 熱流体リサーチ 全期間（{len(issues)}号）: 日付 | カテゴリ | paperId | 和訳タイトル | 原題")
        cats = Counter()
        for iss in issues:
            for it in iss.get("items", []):
                cats[it.get("category")] += 1
                print(f"{iss['date']} | {it.get('category')} | {it.get('paperId')} | {it.get('title')} | {it.get('titleOriginal')}")
        order = ["液冷・コールドプレート", "流路・製造", "半導体装置の熱", "シミュレーション", "熱材料"]
        print("\n# カテゴリ別の掲載数: " + "、".join(f"{c} {cats.get(c, 0)}" for c in order))
        last = [it.get("category") for iss in issues[:2] for it in iss.get("items", [])]
        print("# 直近2回のカテゴリ: " + ("、".join(last) if last else "なし"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
