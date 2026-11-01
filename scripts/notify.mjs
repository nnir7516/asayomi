// 新しい号が保存されたら、登録済みの端末へプッシュ通知を送る（GitHub Actions から実行）
import fs from "node:fs";
import { execSync } from "node:child_process";
import webpush from "web-push";
import { vapidFromSeed } from "./vapid.mjs";

const { PUSH_SEED, PUSH_SUBSCRIPTION, GITHUB_REPOSITORY, GITHUB_EVENT_NAME, BEFORE_SHA, NEW_ISSUE_IDS } = process.env;
const keys = PUSH_SEED ? vapidFromSeed(PUSH_SEED) : null;
const configured = JSON.parse(fs.readFileSync("push-config.json", "utf8")).vapidPublicKey;
if (keys && configured !== keys.publicKey) {
  console.log("push-config.json の公開鍵が合言葉と一致しません。push-setup を実行してください。");
  process.exit(0);
}

// 宛先は push/subscriptions.json（リポジトリ内）と、シークレット PUSH_SUBSCRIPTION（任意）の両方から読む。
// 宛先だけでは通知を送れない（送信には合言葉 PUSH_SEED から作る秘密鍵が必要）ため、宛先はリポジトリに置いてよい。
let subs = [];
function addSubs(raw, where) {
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const s of list) if (s && s.endpoint && s.keys) subs.push(s);
  } catch {
    console.error(`${where} をJSONとして読めません。アプリの「宛先をコピー」で取得した文字列をそのまま使ってください。`);
  }
}
if (fs.existsSync("push/subscriptions.json")) addSubs(fs.readFileSync("push/subscriptions.json", "utf8"), "push/subscriptions.json");
if (PUSH_SUBSCRIPTION) addSubs(PUSH_SUBSCRIPTION, "シークレット PUSH_SUBSCRIPTION");
subs = subs.filter((s, i) => subs.findIndex((t) => t.endpoint === s.endpoint) === i);

if (!keys || !subs.length) {
  console.log(!keys ? "シークレット PUSH_SEED が未登録のため、通知を送りません。" : "通知の宛先が未登録のため、通知を送りません。");
  process.exit(0);
}

const [owner, name] = GITHUB_REPOSITORY.split("/");
const host = `${owner.toLowerCase()}.github.io`;
const pagesBase = name.toLowerCase() === host ? `https://${host}/` : `https://${host}/${name}/`;
webpush.setVapidDetails(pagesBase, keys.publicKey, keys.privateKey);

function jsonAt(ref, path, fallback) {
  try { return JSON.parse(execSync(`git show ${ref}:${path}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); }
  catch { return fallback; }
}
const hasBefore = BEFORE_SHA && !/^0+$/.test(BEFORE_SHA);

function issueMessage(i) {
  return {
    title: i.series === "ai" ? "AIニュース" : "熱流体リサーチ",
    body: [i.title, Array.isArray(i.lead) ? i.lead[0] : ""].filter(Boolean).join("\n"),
    hash: `#issue-${i.id}`,
    tag: i.id,
    waitFor: `data/issues/${i.id}.json`,
  };
}

let messages = [];
if (NEW_ISSUE_IDS && NEW_ISSUE_IDS.trim()) {
  // ingest ワークフローから：取り込んだ号だけを通知する
  const want = new Set(NEW_ISSUE_IDS.trim().split(/\s+/));
  const cur = JSON.parse(fs.readFileSync("data/index.json", "utf8"));
  messages = (cur.issues || []).filter((i) => want.has(i.id)).map(issueMessage);
} else if (GITHUB_EVENT_NAME === "workflow_dispatch") {
  messages = [{ title: "朝読みログ", body: "テスト通知です。これが届けば通知の設定は完了です。", hash: "#settings", tag: "test" }];
} else {
  // 新しく登録された端末には、登録完了の通知を送る
  const prevSubs = hasBefore ? jsonAt(BEFORE_SHA, "push/subscriptions.json", []) : [];
  const prevEndpoints = new Set((Array.isArray(prevSubs) ? prevSubs : [prevSubs]).map((s) => s && s.endpoint));
  const fresh = subs.filter((s) => !prevEndpoints.has(s.endpoint));
  if (fresh.length) messages.push({ title: "朝読みログ", body: "通知の登録が完了しました。新しい記事が届くと、ここでお知らせします。", hash: "#home", tag: "welcome", only: fresh });

  const prev = hasBefore ? jsonAt(BEFORE_SHA, "data/index.json", { issues: [] }) : { issues: [] };
  const cur = JSON.parse(fs.readFileSync("data/index.json", "utf8"));
  const prevIds = new Set((prev.issues || []).map((i) => i.id));
  for (const i of (cur.issues || []).filter((i) => !prevIds.has(i.id))) messages.push(issueMessage(i));
}

if (!messages.length) {
  console.log("送る通知はありません。");
  process.exit(0);
}

// GitHub Pages への反映を待ってから通知する（通知を開いたときに記事が表示されるように）
async function waitForPages(path) {
  const url = `${pagesBase}${path}`;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
      if (r.ok) return true;
    } catch {}
    await new Promise((res) => setTimeout(res, 15000));
  }
  console.warn(`10分待っても ${url} が公開されませんでした。通知はそのまま送ります。`);
  return false;
}

let failed = 0;
for (const m of messages) {
  if (m.waitFor) await waitForPages(m.waitFor);
  const payload = JSON.stringify({ title: m.title, body: m.body, hash: m.hash, tag: m.tag });
  for (const sub of m.only || subs) {
    try {
      await webpush.sendNotification(sub, payload, { TTL: 6 * 3600, urgency: "normal" });
      console.log(`送信しました: ${m.tag}`);
    } catch (e) {
      failed++;
      if (e.statusCode === 404 || e.statusCode === 410) {
        console.error("この宛先は無効になっています。アプリの「通知と設定」で通知を有効にし直し、PUSH_SUBSCRIPTION を新しい宛先に更新してください。");
      } else {
        console.error(`送信に失敗しました（${e.statusCode || ""}）: ${e.body || e.message}`);
      }
    }
  }
}
process.exit(failed ? 1 : 0);
