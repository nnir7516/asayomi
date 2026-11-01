// 合言葉から公開鍵を求めて push-config.json に書く（公開鍵は公開してよい値）。
import fs from "node:fs";
import { vapidFromSeed } from "./vapid.mjs";

const seed = process.env.PUSH_SEED;
if (!seed) {
  console.log("シークレット PUSH_SEED が未登録です。登録後にもう一度実行してください。");
  process.exit(0);
}
const { publicKey } = vapidFromSeed(seed);
const path = "push-config.json";
const cur = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : {};
if (cur.vapidPublicKey === publicKey) {
  console.log("公開鍵は設定済みです。");
  fs.writeFileSync(process.env.GITHUB_OUTPUT || "/dev/null", "changed=false\n", { flag: "a" });
} else {
  fs.writeFileSync(path, JSON.stringify({ vapidPublicKey: publicKey }, null, 2) + "\n");
  console.log("公開鍵を push-config.json に書き込みました。");
  fs.writeFileSync(process.env.GITHUB_OUTPUT || "/dev/null", "changed=true\n", { flag: "a" });
}
