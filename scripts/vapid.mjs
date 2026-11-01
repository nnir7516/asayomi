// 合言葉（シークレット PUSH_SEED）から、通知用の鍵ペア（VAPID）を毎回同じ値で作る。
// 秘密鍵は GitHub Actions の中でだけ作られ、どこにも保存・表示されない。
import crypto from "node:crypto";

const N = BigInt("0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551"); // P-256 の位数
const b64u = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function vapidFromSeed(seed) {
  if (!seed || seed.length < 20) throw new Error("PUSH_SEED が短すぎます（20文字以上にしてください）");
  const h = crypto.createHash("sha256").update("asayomi-vapid-v1:" + seed).digest();
  const d = (BigInt("0x" + h.toString("hex")) % (N - 1n)) + 1n;
  const priv = Buffer.from(d.toString(16).padStart(64, "0"), "hex");
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(priv);
  return { privateKey: b64u(priv), publicKey: b64u(ecdh.getPublicKey()) };
}
