#!/usr/bin/env python3
"""号（1回分の配信）を検証して data/issues/<id>.json に保存し、data/index.json を作り直す。

使い方:
  python3 tools/publish_issue.py /path/to/issue.json          # 新しい号を追加
  python3 tools/publish_issue.py --rebuild-index               # 索引だけ作り直す
  python3 tools/publish_issue.py --check /path/to/issue.json   # 検証だけ行う

issue.json の形式は README.md の「記事データの形式」を参照。
"""
import json
import re
import sys
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
ISSUES = DATA / "issues"
FIGURES = DATA / "figures"
INDEX = DATA / "index.json"
JST = timezone(timedelta(hours=9))

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"
ET.register_namespace("", SVG_NS)
ET.register_namespace("xlink", XLINK_NS)
# 図に使ってよい要素（スクリプトや外部読み込みにつながる要素は除く）
SVG_ALLOWED = {
    "svg", "g", "defs", "title", "desc", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
    "text", "tspan", "marker", "linearGradient", "radialGradient", "stop", "clipPath", "pattern", "use", "symbol",
}
FIG_REQUIRED = {"ai": (0, 3), "thermal": (1, 3)}  # （最小枚数, 最大枚数）

CATS = {
    "ai": ["モデル・製品", "研究", "規制・政策", "半導体・データセンター", "ビジネス・投資", "日本の動き"],
    "thermal": ["液冷・コールドプレート", "流路・製造", "半導体装置の熱", "シミュレーション", "熱材料"],
}
QUIZ_COUNT = {"ai": 1, "thermal": 3}
MAX_ITEMS = {"ai": 7, "thermal": 1}


class Invalid(Exception):
    pass


def need(cond, msg):
    if not cond:
        raise Invalid(msg)


def nonempty_str(v):
    return isinstance(v, str) and v.strip() != ""


def sanitize_svg(src, where):
    """SVG を検証し、スクリプト・イベント属性・外部参照を取り除いた文字列を返す。"""
    need(isinstance(src, str) and src.lstrip().startswith("<svg"), f"{where}.svg は <svg で始まる文字列にしてください")
    need(len(src.encode("utf-8")) <= 200_000, f"{where}.svg が大きすぎます（200KBまで）")
    try:
        root = ET.fromstring(src)
    except ET.ParseError as e:
        raise Invalid(f"{where}.svg をXMLとして読めません: {e}")
    need(root.tag in ("svg", f"{{{SVG_NS}}}svg"), f"{where}.svg の最上位は <svg> にしてください")
    need(root.get("viewBox"), f"{where}.svg に viewBox を付けてください（スマホ幅で縮むように）")

    def local(tag):
        return tag.split("}", 1)[-1] if isinstance(tag, str) else ""

    def clean(el):
        for child in list(el):
            if local(child.tag) not in SVG_ALLOWED:
                el.remove(child)
                continue
            clean(child)
        for k in list(el.attrib):
            name = local(k).lower()
            v = el.attrib[k]
            if name.startswith("on") or name == "style" and ("url(" in v and "url(#" not in v):
                del el.attrib[k]
            elif name == "href" and not v.startswith("#"):
                del el.attrib[k]
    clean(root)
    if root.tag == "svg":
        root.tag = f"{{{SVG_NS}}}svg"
        for el in root.iter():
            if isinstance(el.tag, str) and "}" not in el.tag:
                el.tag = f"{{{SVG_NS}}}{el.tag}"
    return ET.tostring(root, encoding="unicode")


def validate_figures(issue):
    figs = issue.get("figures", [])
    lo, hi = FIG_REQUIRED[issue["series"]]
    need(isinstance(figs, list) and lo <= len(figs) <= hi, f"figures（図）は{lo}〜{hi}枚にしてください")
    ids = set()
    for n, f in enumerate(figs):
        where = f"figures[{n}]"
        need(isinstance(f, dict), f"{where} がオブジェクトではありません")
        need(isinstance(f.get("id"), str) and re.fullmatch(r"fig[1-9]", f["id"]), f"{where}.id は fig1〜fig9 にしてください")
        need(f["id"] not in ids, f"{where}.id が重複しています")
        ids.add(f["id"])
        need(nonempty_str(f.get("caption")), f"{where}.caption（図の説明）が空です")
        f["svg"] = sanitize_svg(f.get("svg"), where)
        need(f"(fig:{f['id']})" in issue["body"], f"本文に ![説明](fig:{f['id']}) を入れて、{f['id']} を表示する位置を指定してください")


def validate(issue):
    need(isinstance(issue, dict), "号はJSONオブジェクトにしてください")
    series = issue.get("series")
    need(series in CATS, "series は ai か thermal にしてください")
    d = issue.get("date")
    need(isinstance(d, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", d), "date は YYYY-MM-DD にしてください")
    date.fromisoformat(d)
    need(issue.get("id") == f"{d}-{series}", f"id は {d}-{series} にしてください")
    need(nonempty_str(issue.get("title")), "title（号の見出し）が空です")
    need(not issue["title"].startswith("【"), "title に【AIニュース】などの接頭辞や日付は入れないでください")
    lead = issue.get("lead")
    need(isinstance(lead, list) and 1 <= len(lead) <= 3 and all(nonempty_str(x) for x in lead), "lead は1〜3個の文字列の配列にしてください")
    body = issue.get("body")
    need(nonempty_str(body) and len(body) >= 300, "body（本文Markdown）が短すぎます")
    need("|" not in "".join(l for l in body.splitlines() if l.strip().startswith("|")), "body に表（| 区切り）は使わないでください")
    items = issue.get("items")
    need(isinstance(items, list) and 1 <= len(items) <= MAX_ITEMS[series], f"items は1〜{MAX_ITEMS[series]}件にしてください")
    compact = d.replace("-", "")
    seen_ids = set()
    for n, it in enumerate(items, 1):
        where = f"items[{n - 1}]"
        need(isinstance(it, dict), f"{where} がオブジェクトではありません")
        need(re.fullmatch(rf"{compact}-{series}-\d{{2}}", str(it.get("id", ""))), f"{where}.id は {compact}-{series}-01 の形にしてください")
        need(it["id"] not in seen_ids, f"{where}.id が重複しています")
        seen_ids.add(it["id"])
        need(it.get("category") in CATS[series], f"{where}.category は次のいずれか: {'、'.join(CATS[series])}")
        for k in ("title", "summary", "why", "source"):
            need(nonempty_str(it.get(k)), f"{where}.{k} が空です")
        need(isinstance(it.get("url"), str) and re.match(r"^https?://", it["url"]), f"{where}.url は http(s) のURLにしてください")
        kws = it.get("keywords")
        need(isinstance(kws, list) and 3 <= len(kws) <= 6 and all(nonempty_str(k) for k in kws), f"{where}.keywords は3〜6個の文字列にしてください")
        if series == "thermal":
            need(nonempty_str(it.get("paperId")), f"{where}.paperId（DOI・arXiv ID・URL）が空です")
            need(nonempty_str(it.get("titleOriginal")), f"{where}.titleOriginal（原題）が空です")
        cred = it.get("credibility")
        if series == "thermal" or cred is not None:
            need(isinstance(cred, dict), f"{where}.credibility（信ぴょう性の評価）がありません")
            need(cred.get("level") in ("高", "中", "低"), f"{where}.credibility.level は「高」「中」「低」のいずれかにしてください")
            need(nonempty_str(cred.get("summary")), f"{where}.credibility.summary（評価の理由）が空です")
            ck = cred.get("checks", [])
            need(isinstance(ck, list) and (series != "thermal" or 3 <= len(ck) <= 8) and len(ck) <= 8 and all(nonempty_str(c) for c in ck),
                 f"{where}.credibility.checks は観点ごとの文字列の配列にしてください（熱流体は3〜8行）")
        quiz = it.get("quiz")
        need(isinstance(quiz, list) and len(quiz) == QUIZ_COUNT[series], f"{where}.quiz は{QUIZ_COUNT[series]}問にしてください")
        for qi, q in enumerate(quiz):
            qw = f"{where}.quiz[{qi}]"
            need(isinstance(q, dict) and nonempty_str(q.get("q")), f"{qw}.q が空です")
            ch = q.get("choices")
            need(isinstance(ch, list) and len(ch) == 4 and all(nonempty_str(c) for c in ch), f"{qw}.choices は4つの文字列にしてください")
            need(isinstance(q.get("answer"), int) and 0 <= q["answer"] <= 3, f"{qw}.answer は0〜3の整数にしてください")
            need(nonempty_str(q.get("explain")), f"{qw}.explain が空です")
    validate_figures(issue)


def load_issues():
    out = []
    if ISSUES.exists():
        for p in sorted(ISSUES.glob("*.json")):
            try:
                out.append(json.loads(p.read_text(encoding="utf-8")))
            except Exception as e:  # 壊れたファイルは索引から外して知らせる
                print(f"警告: {p.name} を読めません: {e}", file=sys.stderr)
    return out


def check_duplicates(issue, existing):
    """既出チェック: AIは過去45日の同一URL、熱流体は全期間の同一paperId・原題。"""
    d = date.fromisoformat(issue["date"])
    norm = lambda s: re.sub(r"[\s\W_]+", "", str(s).lower())
    for other in existing:
        if other.get("id") == issue["id"]:
            continue
        if other.get("series") != issue["series"]:
            continue
        try:
            od = date.fromisoformat(other.get("date", ""))
        except ValueError:
            continue
        for a in issue["items"]:
            for b in other.get("items", []):
                if issue["series"] == "ai":
                    if abs((d - od).days) <= 45 and a["url"].rstrip("/") == str(b.get("url", "")).rstrip("/"):
                        raise Invalid(f"既出のニュースです（{other['id']}「{b.get('title')}」と同じURL）")
                else:
                    if norm(a["paperId"]) == norm(b.get("paperId", "")) or norm(a["titleOriginal"]) == norm(b.get("titleOriginal", "")):
                        raise Invalid(f"既出の研究です（{other['id']}「{b.get('title')}」）")


def build_index(issues):
    metas = []
    for iss in issues:
        if not isinstance(iss, dict) or not iss.get("id"):
            continue
        items = []
        for it in iss.get("items", []):
            m = {k: it.get(k) for k in ("id", "category", "title", "url", "keywords") if it.get(k) is not None}
            if iss.get("series") == "thermal":
                for k in ("paperId", "titleOriginal"):
                    if it.get(k):
                        m[k] = it[k]
            items.append(m)
        metas.append({k: iss.get(k) for k in ("id", "date", "series", "title", "lead")} | {"items": items})
    metas.sort(key=lambda m: (m.get("date") or "", 0 if m.get("series") == "ai" else 1), reverse=True)
    idx = {"version": 1, "updated": datetime.now(JST).isoformat(timespec="seconds"), "issues": metas}
    INDEX.write_text(json.dumps(idx, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return idx


def main(argv):
    if argv[1:] == ["--rebuild-index"]:
        idx = build_index(load_issues())
        print(f"索引を作り直しました（{len(idx['issues'])}号）")
        return 0
    check_only = len(argv) == 3 and argv[1] == "--check"
    if len(argv) != 2 and not check_only:
        print(__doc__)
        return 2
    src = Path(argv[-1])
    try:
        issue = json.loads(src.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"エラー: {src} をJSONとして読めません: {e}", file=sys.stderr)
        return 1
    try:
        validate(issue)
        existing = load_issues()
        dest = ISSUES / f"{issue['id']}.json"
        if dest.exists():
            raise Invalid(f"{dest.name} はすでにあります（同じ日の同じシリーズは1号だけです）")
        check_duplicates(issue, existing)
    except Invalid as e:
        print(f"エラー: {e}", file=sys.stderr)
        return 1
    if check_only:
        print("検証OK")
        return 0
    ISSUES.mkdir(parents=True, exist_ok=True)
    figs = issue.get("figures", [])
    if figs:
        FIGURES.mkdir(parents=True, exist_ok=True)
        for f in figs:
            fname = f"{issue['id']}-{f['id']}.svg"
            (FIGURES / fname).write_text(f.pop("svg") + "\n", encoding="utf-8")
            f["file"] = f"data/figures/{fname}"
    dest.write_text(json.dumps(issue, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    idx = build_index(existing + [issue])
    print(f"保存しました: data/issues/{dest.name}（索引 {len(idx['issues'])}号）")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
