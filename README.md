# 朝読みログ

毎朝のAIニュースと、月・木・土・日の熱流体リサーチを読むための Android 向けアプリ（PWA）です。

- 記事は Claude のスケジュールタスクが毎朝作成し、このリポジトリの `data/` に保存します。
- 保存されると GitHub Actions（`notify`）が、登録した端末へプッシュ通知を送ります。
- 興味・理解度・クイズの結果は端末の中だけに保存されます。リポジトリには送られません。

## 初回の設定

1. **GitHub Pages を有効にする**
   リポジトリの Settings → Pages →「Build and deployment」で、Source を「Deploy from a branch」、Branch を `main` と `/ (root)` にして Save。
   1〜2分後、`https://<ユーザー名>.github.io/<リポジトリ名>/` でアプリが開けるようになります。
2. **通知用の合言葉を登録する**
   Settings → Secrets and variables → Actions →「New repository secret」。
   Name は `PUSH_SEED`、Secret には自分で決めた40文字以上のでたらめな文字列を入れます（覚える必要はありません）。
   GitHub Actions がこの合言葉から通知用の鍵を作ります。秘密鍵はどこにも保存・表示されません。
   登録後、`push/setup-request` を書き換えて送信するか、Actions → push-setup →「Run workflow」で、公開鍵が `push-config.json` に書き込まれます。
3. **スマホにインストールする**
   Android の Chrome で上のURLを開き、メニュー（⋮）→「アプリをインストール」（または「ホーム画面に追加」）。
4. **通知を受け取る端末を登録する**
   インストールしたアプリの「通知と設定」→「通知を有効にする」→「宛先をコピー」。
   コピーした文字列を Claude との会話に貼り付けると、`push/subscriptions.json` に登録されます。
   （宛先だけでは通知を送れず、送信には手順2の合言葉から作る秘密鍵が必要なので、宛先は公開リポジトリに置いて問題ありません）
5. **テストする**
   Actions タブ → notify →「Run workflow」。数十秒でテスト通知が届けば完了です。

機種変更したときは、新しい端末で手順3〜4をやり直してください（古い宛先は通知の送信時に無効と表示されるので、`push/subscriptions.json` から外します）。
評価データは、アプリの「通知と設定」→「書き出す」で保存し、新しい端末で「読み込む」で戻せます。

## ファイル構成

| パス | 内容 |
|---|---|
| `index.html` `app.js` `app.css` | アプリ本体 |
| `sw.js` | オフライン表示と通知の受信 |
| `manifest.webmanifest` `icons/` | インストール用の情報とアイコン |
| `push-config.json` | 通知の公開鍵（push-setup が書き込む） |
| `push/subscriptions.json` | 通知を受け取る端末の宛先 |
| `scripts/vapid.mjs` `scripts/push-setup.mjs` | 合言葉から鍵を作る処理 |
| `data/index.json` | 号の一覧（`tools/publish_issue.py` が自動で作り直す） |
| `data/issues/<日付>-<ai/thermal>.json` | 号ごとの本文・記事・クイズ |
| `tools/` | 配信タスクが使う保存・重複確認のスクリプト |
| `scripts/notify.mjs` `.github/workflows/notify.yml` | 通知の送信 |

## 記事データの形式

1回の配信（号）を1つのJSONにまとめ、`bash tools/publish.sh <ファイル>` で保存・送信します。
配信タスクは main に直接書き込まず、号ごとのブランチ（`claude/issue-<id>-<時刻>`）へ送ります。
GitHub Actions の `ingest` がそれを main に取り込み、ブランチを消して、アプリへ通知を送ります。

```json
{
  "id": "2026-11-02-ai",
  "date": "2026-11-02",
  "series": "ai",
  "title": "号の見出し（シリーズ名や日付は入れない）",
  "lead": ["3行まとめ1", "3行まとめ2", "3行まとめ3"],
  "body": "本文（Markdown。見出し・段落・箇条書き・リンク・太字が使える。表は使わない）",
  "items": [
    {
      "id": "20261102-ai-01",
      "category": "モデル・製品",
      "title": "記事の見出し",
      "summary": "要約2〜3文",
      "why": "なぜ重要か（熱流体は設計への示唆）",
      "url": "https://...",
      "source": "出典名",
      "keywords": ["キーワード", "3〜6個"],
      "quiz": [{ "q": "問題文", "choices": ["A", "B", "C", "D"], "answer": 0, "explain": "解説" }]
    }
  ]
}
```

- `series`: `ai` または `thermal`
- `category`
  - AI: モデル・製品／研究／規制・政策／半導体・データセンター／ビジネス・投資／日本の動き
  - 熱流体: 液冷・コールドプレート／流路・製造／半導体装置の熱／シミュレーション／熱材料
- クイズの問題数: AIは記事ごとに1問、熱流体は3問
- 熱流体の記事には `paperId`（DOI・arXiv ID・URL）と `titleOriginal`（原題）も入れる
- 図：号に `figures`（熱流体は1〜3枚必須、AIは任意）を入れ、本文の表示したい位置に `![説明](fig:fig1)` を置く。
  各図は `{"id": "fig1", "caption": "説明", "svg": "<svg viewBox=...>...</svg>"}`。保存時にスクリプトや外部参照を取り除き、`data/figures/<号のid>-fig1.svg` に書き出す
- 既出のURL（AI、45日以内）や既出の論文（熱流体、全期間）は保存時にエラーになる
