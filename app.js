(function () {
  "use strict";

  var SERIES = {
    ai: { tag: "AI", name: "AIニュース" },
    thermal: { tag: "熱流体", name: "熱流体リサーチ" }
  };
  var CATS = {
    ai: ["モデル・製品", "研究", "規制・政策", "半導体・データセンター", "ビジネス・投資", "日本の動き"],
    thermal: ["液冷・コールドプレート", "流路・製造", "半導体装置の熱", "シミュレーション", "熱材料"]
  };
  var UND = ["難しい", "だいたい", "よく分かった"];
  var WD = ["日", "月", "火", "水", "木", "金", "土"];
  var LS_RATINGS = "asayomi:ratings:v1";
  var LS_SEEN = "asayomi:seen:v1";

  var main = document.getElementById("main");
  var toastEl = document.getElementById("toast");
  var refreshBtn = document.getElementById("refresh");
  var updatedEl = document.getElementById("updated");

  var state = { index: null, indexError: null, issues: {}, issueErrors: {}, filter: "all", loading: false, route: "" };
  var ratings = readLS(LS_RATINGS, {});
  var seen = readLS(LS_SEEN, {});

  /* ---------- 小物 ---------- */
  function readLS(k, def) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
  function writeLS(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { toast("端末に保存できませんでした。空き容量を確認してください。"); return false; }
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return (typeof u === "string" && /^https?:\/\//i.test(u)) ? u : ""; }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function parseDate(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function fmtDate(s) { var d = parseDate(s); return d ? (d.getMonth() + 1) + "月" + d.getDate() + "日（" + WD[d.getDay()] + "）" : (s || "日付なし"); }
  function mondayOf(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  function keyOf(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function mean(a) { return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : null; }
  function f1(v) { return v == null ? "–" : v.toFixed(1); }
  function pct(r) { return r == null ? "–" : Math.round(r * 100) + "%"; }

  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.hidden = true; }, 3200);
  }
  function spin(on) { refreshBtn.classList.toggle("spin", !!on); refreshBtn.disabled = !!on; }

  /* ---------- Markdown（本文表示用の小さな変換） ---------- */
  function inline(s) {
    var out = esc(s);
    out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    out = out.replace(/(^|[\s（(：:])(https?:\/\/[^\s<）)」]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    return out;
  }
  function md(text) {
    var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    var html = "", para = [], list = null;
    function flushPara() { if (para.length) { html += "<p>" + para.map(inline).join("<br>") + "</p>"; para = []; } }
    function flushList() { if (list) { html += "<" + list.tag + ">" + list.items.map(function (t) { return "<li>" + inline(t) + "</li>"; }).join("") + "</" + list.tag + ">"; list = null; } }
    lines.forEach(function (raw) {
      var line = raw.replace(/\s+$/, "");
      var m;
      if (!line.trim()) { flushPara(); flushList(); return; }
      if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
        flushPara(); flushList();
        var lv = Math.min(4, Math.max(2, m[1].length === 1 ? 2 : m[1].length));
        html += "<h" + lv + ">" + inline(m[2]) + "</h" + lv + ">"; return;
      }
      if (/^(-{3,}|\*{3,})$/.test(line.trim())) { flushPara(); flushList(); html += "<hr>"; return; }
      if ((m = /^\s*>\s?(.*)$/.exec(line))) { flushPara(); flushList(); html += "<blockquote>" + inline(m[1]) + "</blockquote>"; return; }
      if ((m = /^\s*[-*・]\s+(.*)$/.exec(line))) {
        flushPara(); if (!list || list.tag !== "ul") { flushList(); list = { tag: "ul", items: [] }; }
        list.items.push(m[1]); return;
      }
      if ((m = /^\s*\d+[.)．]\s+(.*)$/.exec(line))) {
        flushPara(); if (!list || list.tag !== "ol") { flushList(); list = { tag: "ol", items: [] }; }
        list.items.push(m[1]); return;
      }
      if (list && /^\s{2,}\S/.test(raw)) { list.items[list.items.length - 1] += " " + line.trim(); return; }
      flushList(); para.push(line);
    });
    flushPara(); flushList();
    return html;
  }

  /* ---------- データ ---------- */
  function normalizeIndex(j) {
    var issues = (j && Array.isArray(j.issues)) ? j.issues.filter(function (x) { return x && x.id && SERIES[x.series]; }) : [];
    issues.sort(function (a, b) {
      if ((a.date || "") !== (b.date || "")) return (a.date || "") < (b.date || "") ? 1 : -1;
      if (a.series !== b.series) return a.series === "ai" ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
    return { updated: j && j.updated, issues: issues };
  }
  function setUpdated() {
    var u = state.index && state.index.updated;
    var d = u ? new Date(u) : null;
    updatedEl.textContent = d && !isNaN(d) ? "更新 " + (d.getMonth() + 1) + "/" + d.getDate() + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") : "";
  }
  function loadIndex(manual) {
    if (state.loading) return Promise.resolve();
    state.loading = true; spin(true);
    return fetch("data/index.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) {
        var before = state.index ? state.index.issues.length : null;
        state.index = normalizeIndex(j); state.indexError = null; setUpdated();
        if (manual) {
          var diff = before == null ? 0 : state.index.issues.length - before;
          toast(diff > 0 ? "新しい号が" + diff + "件届きました" : "最新の状態です");
        }
      })
      .catch(function (e) {
        state.indexError = e;
        if (manual) toast("記事を取得できませんでした。通信状況を確認してください。");
      })
      .then(function () { state.loading = false; spin(false); route(true); });
  }
  function loadIssue(id) {
    if (state.issues[id] || state.issueErrors[id] === "loading") return;
    state.issueErrors[id] = "loading";
    fetch("data/issues/" + encodeURIComponent(id) + ".json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) { state.issues[id] = j; delete state.issueErrors[id]; })
      .catch(function () { state.issueErrors[id] = "error"; })
      .then(function () { if (state.route === "issue-" + id) route(true); });
  }
  function issueMeta(id) {
    var list = state.index ? state.index.issues : [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function itemsOfIssueMeta(meta) { return Array.isArray(meta.items) ? meta.items : []; }
  function isRated(id) { var r = ratings[id]; return !!(r && isNum(r.interest)); }

  /* すべての記事（一覧のメタ情報＋端末の評価） */
  function allItems() {
    var out = [], have = {};
    (state.index ? state.index.issues : []).forEach(function (iss) {
      itemsOfIssueMeta(iss).forEach(function (it) {
        if (!it || !it.id || have[it.id]) return;
        have[it.id] = true;
        out.push({ id: it.id, series: iss.series, date: iss.date, category: it.category, keywords: it.keywords || [], r: ratings[it.id] || null });
      });
    });
    Object.keys(ratings).forEach(function (id) {
      if (have[id]) return;
      var r = ratings[id];
      if (r && SERIES[r.series]) out.push({ id: id, series: r.series, date: r.date, category: r.category, keywords: r.keywords || [], r: r });
    });
    return out;
  }

  /* ---------- 記事一覧 ---------- */
  function renderHome() {
    if (!state.index) {
      main.innerHTML = state.indexError
        ? '<div class="empty"><h2>記事を読み込めません</h2><p>通信状況を確認して、右上の更新ボタンを押してください。</p></div>'
        : '<div class="empty"><h2>読み込み中</h2><p>記事の一覧を取得しています。</p></div>';
      return;
    }
    var issues = state.index.issues;
    var html = '<div class="page-h"><h1>記事</h1><p>読んだら、号の下にある評価とクイズに答えてください。</p></div>';
    if (!issues.length) {
      html += '<div class="empty"><h2>まだ記事がありません</h2><p>毎朝7:15のAIニュースと、月・木・土・日7:15の熱流体リサーチが届くと、ここに並びます。</p></div>';
      main.innerHTML = html; return;
    }
    var unratedIssues = issues.filter(function (iss) { return itemsOfIssueMeta(iss).some(function (it) { return !isRated(it.id); }); });
    var f = state.filter;
    var chips = [["all", "すべて", ""], ["ai", "AIニュース", ""], ["thermal", "熱流体", ""], ["unrated", "未評価あり", String(unratedIssues.length)]];
    html += '<div class="filters" role="group" aria-label="絞り込み">' + chips.map(function (c) {
      return '<button type="button" id="f-' + c[0] + '" data-act="filter" data-v="' + c[0] + '" aria-pressed="' + (f === c[0]) + '">' + c[1] + (c[2] ? '<span class="count">' + c[2] + '</span>' : '') + '</button>';
    }).join("") + '</div>';
    var shown = issues.filter(function (iss) {
      if (f === "ai" || f === "thermal") return iss.series === f;
      if (f === "unrated") return unratedIssues.indexOf(iss) >= 0;
      return true;
    });
    if (!shown.length) {
      html += '<div class="empty"><h2>' + (f === "unrated" ? "未評価の号はありません" : "該当する号はありません") + '</h2><p>' + (f === "unrated" ? "届いた記事はすべて評価済みです。" : "別の絞り込みを選んでください。") + '</p></div>';
      main.innerHTML = html; return;
    }
    var cur = null, recent = keyOf(new Date(Date.now() - 3 * 864e5));
    shown.forEach(function (iss) {
      if (iss.date !== cur) {
        if (cur !== null) html += '</div>';
        html += '<div class="day"><div class="day-h"><strong>' + esc(fmtDate(iss.date)) + '</strong><span class="line"></span></div>';
        cur = iss.date;
      }
      var its = itemsOfIssueMeta(iss), done = its.filter(function (it) { return isRated(it.id); }).length;
      var lead = Array.isArray(iss.lead) ? iss.lead.slice(0, 3) : [];
      var isNew = !seen[iss.id] && (iss.date || "") >= recent;
      html += '<a class="issue-row" href="#issue-' + esc(iss.id) + '">' +
        '<div class="top"><span class="tag ' + iss.series + '">' + SERIES[iss.series].tag + '</span>' +
        (isNew ? '<span class="new-dot" title="未読"></span><span class="dim" style="font-size:12px">未読</span>' : '') +
        (its.length ? '<span class="progress' + (done === its.length ? " done" : "") + '">評価 ' + done + '/' + its.length + '</span>' : '') + '</div>' +
        '<h2>' + esc(iss.title || SERIES[iss.series].name) + '</h2>' +
        (lead.length ? '<ul>' + lead.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join("") + '</ul>' : '') +
        '</a>';
    });
    html += '</div>';
    main.innerHTML = html;
  }

  /* ---------- 号の本文と評価 ---------- */
  function quizHTML(item) {
    var qs = Array.isArray(item.quiz) ? item.quiz : [];
    if (!qs.length) return "";
    var r = ratings[item.id] || {}, ans = Array.isArray(r.answers) ? r.answers : [];
    return '<div class="quiz"><div class="quiz-h">確認クイズ</div>' + qs.map(function (q, qi) {
      var picked = isNum(ans[qi]) ? ans[qi] : null, done = picked !== null;
      var opts = (Array.isArray(q.choices) ? q.choices : []).map(function (c, ci) {
        var cls = "";
        if (done) { if (ci === q.answer) cls = " correct"; else if (ci === picked) cls = " wrong"; }
        return '<button type="button" class="opt' + cls + '" data-act="quiz" data-q="' + qi + '" data-v="' + ci + '"' + (done ? " disabled" : "") + '><span class="k">' + ("ABCD".charAt(ci) || (ci + 1)) + '</span><span>' + esc(c) + '</span></button>';
      }).join("");
      var verdict = done ? '<p class="verdict ' + (picked === q.answer ? "ok" : "ng") + '"><b>' + (picked === q.answer ? "正解" : "不正解") + '</b>' + esc(q.explain || "") + '</p>' : "";
      return '<div class="q"><p class="q-text">Q' + (qi + 1) + '. ' + esc(q.q) + '</p><div class="opts">' + opts + '</div>' + verdict + '</div>';
    }).join("") + '</div>';
  }
  function cardHTML(item, issue) {
    var s = issue.series, r = ratings[item.id] || {}, url = safeUrl(item.url);
    var title = url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(item.title) + '</a>' : esc(item.title);
    var pips = [1, 2, 3, 4, 5].map(function (n) {
      return '<button type="button" class="pip' + (isNum(r.interest) && n < r.interest ? " fill" : "") + '" data-act="interest" data-v="' + n + '" aria-pressed="' + (r.interest === n) + '" aria-label="興味 ' + n + '">' + n + '</button>';
    }).join("");
    var seg = UND.map(function (t, i) {
      return '<button type="button" data-act="und" data-v="' + (i + 1) + '" aria-pressed="' + (r.understanding === i + 1) + '">' + t + '</button>';
    }).join("");
    return '<article class="card" data-id="' + esc(item.id) + '">' +
      '<div class="meta">' + (item.category ? '<span class="cat">' + esc(item.category) + '</span>' : '') + (item.source ? '<span>' + esc(item.source) + '</span>' : '') + '</div>' +
      '<h3>' + title + '</h3>' +
      (item.titleOriginal ? '<p class="why" style="margin-top:-6px">' + esc(item.titleOriginal) + '</p>' : '') +
      (item.summary ? '<p class="summary">' + esc(item.summary) + '</p>' : '') +
      (item.why ? '<p class="why"><span class="lbl">' + (s === "ai" ? "なぜ重要か" : "設計への示唆") + '</span>' + esc(item.why) + '</p>' : '') +
      quizHTML(item) +
      '<div class="rate">' +
        '<div class="rate-row"><span class="lbl">興味</span><div class="scale" role="group" aria-label="興味（1〜5）">' + pips + '</div></div>' +
        '<div class="rate-row"><span class="lbl">理解度</span><div class="seg" role="group" aria-label="理解度">' + seg + '</div></div>' +
      '</div></article>';
  }
  function renderIssue(id) {
    var meta = issueMeta(id), issue = state.issues[id];
    if (!seen[id]) { seen[id] = true; writeLS(LS_SEEN, seen); }
    var base = issue || meta;
    var html = '<a class="back" href="#home">← 記事一覧</a>';
    if (!base) {
      if (state.issueErrors[id] === "error") html += '<div class="empty"><h2>この号は見つかりません</h2><p>右上の更新ボタンを押すか、一覧に戻って別の号を選んでください。</p></div>';
      else { html += '<div class="empty"><h2>読み込み中</h2><p>記事を取得しています。</p></div>'; loadIssue(id); }
      main.innerHTML = html; return;
    }
    var series = SERIES[base.series] ? base.series : "ai";
    html += '<div class="issue-h"><div class="meta"><span class="tag ' + series + '">' + SERIES[series].name + '</span><span>' + esc(fmtDate(base.date)) + '</span></div>' +
      '<h1>' + esc(base.title || SERIES[series].name) + '</h1></div>';
    var lead = Array.isArray(base.lead) ? base.lead : [];
    if (lead.length) html += '<div class="lead"><span class="lbl">' + (series === "ai" ? "今日の3行まとめ" : "ひとことで") + '</span><ul>' + lead.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join("") + '</ul></div>';
    if (!issue) {
      if (state.issueErrors[id] === "error") html += '<div class="empty"><h2>本文を読み込めません</h2><p>通信状況を確認して、右上の更新ボタンを押してください。</p></div>';
      else { html += '<div class="empty"><h2>本文を読み込み中</h2><p>少しお待ちください。</p></div>'; loadIssue(id); }
      main.innerHTML = html; return;
    }
    html += '<article class="prose">' + md(issue.body) + '</article>';
    var items = Array.isArray(issue.items) ? issue.items : [];
    if (items.length) {
      html += '<div class="section-h"><h2>評価とクイズ</h2><p>' + items.length + '件</p></div><div class="cards">' +
        items.map(function (it) { return cardHTML(it, issue); }).join("") + '</div>';
    }
    main.innerHTML = html;
  }
  function findItem(issue, itemId) {
    var items = Array.isArray(issue.items) ? issue.items : [];
    for (var i = 0; i < items.length; i++) if (items[i].id === itemId) return items[i];
    return null;
  }
  function rate(issue, item, patch) {
    var r = Object.assign({}, ratings[item.id] || {}, patch);
    r.series = issue.series; r.date = issue.date; r.category = item.category; r.keywords = Array.isArray(item.keywords) ? item.keywords : [];
    r.title = item.title; r.ratedAt = new Date().toISOString();
    ratings[item.id] = r;
    writeLS(LS_RATINGS, ratings);
    var el = main.querySelector('article.card[data-id="' + CSS.escape(item.id) + '"]');
    if (el) el.outerHTML = cardHTML(item, issue);
  }

  /* ---------- 傾向 ---------- */
  function quizCounts(list) {
    var total = 0, ok = 0;
    list.forEach(function (it) { var c = it.r && Array.isArray(it.r.correct) ? it.r.correct : []; c.forEach(function (v) { if (v === true || v === false) { total++; if (v) ok++; } }); });
    return { total: total, ok: ok, rate: total ? ok / total : null };
  }
  function stats(list) {
    var ints = list.filter(function (i) { return i.r && isNum(i.r.interest); }).map(function (i) { return i.r.interest; });
    var unds = list.filter(function (i) { return i.r && isNum(i.r.understanding); }).map(function (i) { return i.r.understanding; });
    return { n: list.length, rated: ints.length, interest: mean(ints), und: mean(unds), quiz: quizCounts(list) };
  }
  function catTable(series, items) {
    var its = items.filter(function (i) { return i.series === series; });
    var cats = CATS[series].slice();
    its.forEach(function (i) { if (i.category && cats.indexOf(i.category) < 0) cats.push(i.category); });
    var rows = cats.map(function (c) {
      var st = stats(its.filter(function (i) { return i.category === c; }));
      var w = st.interest == null ? 0 : (st.interest / 5) * 100;
      return '<tr><td>' + esc(c) + '</td><td class="num">' + st.n + '</td>' +
        '<td class="num"><span class="bar ' + series + '"><i style="width:' + w.toFixed(0) + '%"></i></span>' + f1(st.interest) + '</td>' +
        '<td class="num">' + (st.und == null ? "–" : f1(st.und) + '<span class="dim"> / 3</span>') + '</td>' +
        '<td class="num">' + pct(st.quiz.rate) + (st.quiz.total ? '<span class="dim"> (' + st.quiz.ok + '/' + st.quiz.total + ')</span>' : '') + '</td></tr>';
    }).join("");
    return '<div class="tbl-wrap"><table><thead><tr><th>カテゴリ</th><th>件数</th><th>平均興味</th><th>理解度</th><th>クイズ正答率</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function weeklyChart(items, kind) {
    var weeks = [], start = mondayOf(new Date());
    for (var k = 7; k >= 0; k--) { var d = new Date(start); d.setDate(d.getDate() - 7 * k); weeks.push(d); }
    var W = 320, H = 150, L = 32, R = 6, T = 14, B = 22, max = kind === "interest" ? 5 : 100;
    var ticks = kind === "interest" ? [0, 1, 3, 5] : [0, 50, 100];
    var plotW = W - L - R, plotH = H - T - B, slot = plotW / weeks.length, bw = Math.min(12, slot / 2 - 3);
    function y(v) { return T + plotH - (v / max) * plotH; }
    var g = "";
    ticks.forEach(function (t) {
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '" stroke="var(--line)" stroke-width="1"/>';
      g += '<text x="' + (L - 6) + '" y="' + (y(t) + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--muted)" font-family="var(--font-mono)">' + t + (kind === "quiz" ? "%" : "") + '</text>';
    });
    weeks.forEach(function (ws, wi) {
      var we = new Date(ws); we.setDate(we.getDate() + 7);
      var a = keyOf(ws), b = keyOf(we), cx = L + slot * wi + slot / 2;
      ["ai", "thermal"].forEach(function (s, si) {
        var its = items.filter(function (i) { return i.series === s && (i.date || "") >= a && (i.date || "") < b; });
        var v;
        if (kind === "interest") v = stats(its).interest;
        else { var q = quizCounts(its); v = q.rate == null ? null : q.rate * 100; }
        if (v == null) return;
        var x = si === 0 ? cx - bw - 1 : cx + 1, top = y(v), h = Math.max(1, T + plotH - top);
        g += '<rect x="' + x.toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="var(--' + (s === "ai" ? "ai" : "heat") + ')"><title>' + SERIES[s].name + ' ' + (kind === "interest" ? v.toFixed(1) : Math.round(v) + "%") + '</title></rect>';
      });
      g += '<text x="' + cx.toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="10" fill="var(--muted)" font-family="var(--font-mono)">' + (ws.getMonth() + 1) + '/' + ws.getDate() + '</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + (kind === "interest" ? "週ごとの平均興味" : "週ごとのクイズ正答率") + '">' + g + '</svg>';
  }
  function renderTrends() {
    var items = allItems();
    var html = '<div class="page-h"><h1>傾向</h1><p>評価とクイズの結果は、この端末の中だけに保存されています。</p></div>';
    if (!items.length) {
      html += '<div class="empty"><h2>集計できる記録がまだありません</h2><p>記事に興味・理解度を付け、クイズに答えると、カテゴリ別の傾向と週ごとの推移がここに表示されます。</p></div>';
      main.innerHTML = html; return;
    }
    var all = stats(items);
    html += '<div class="tiles">' +
      '<div class="tile"><div class="v">' + all.rated + '<small> / ' + all.n + '</small></div><div class="k">評価済みの記事</div></div>' +
      '<div class="tile"><div class="v">' + f1(all.interest) + '<small> / 5</small></div><div class="k">平均興味</div></div>' +
      '<div class="tile"><div class="v">' + f1(all.und) + '<small> / 3</small></div><div class="k">理解度（自己評価）</div></div>' +
      '<div class="tile"><div class="v">' + pct(all.quiz.rate) + '</div><div class="k">クイズ正答率' + (all.quiz.total ? '（' + all.quiz.ok + '/' + all.quiz.total + '問）' : '') + '</div></div></div>';
    html += '<div class="block"><h2>週ごとの推移</h2><p class="note">直近8週。週は月曜始まりで、配信日で集計します。</p>' +
      '<div class="legend"><span style="--c:var(--ai)">AIニュース</span><span style="--c:var(--heat)">熱流体</span></div>' +
      '<div class="charts"><div class="chart"><h3>平均興味（1〜5）</h3>' + weeklyChart(items, "interest") + '</div>' +
      '<div class="chart"><h3>クイズ正答率</h3>' + weeklyChart(items, "quiz") + '</div></div></div>';
    ["ai", "thermal"].forEach(function (s) {
      var st = stats(items.filter(function (i) { return i.series === s; }));
      html += '<div class="block"><h2><span class="tag ' + s + '">' + SERIES[s].tag + '</span>' + SERIES[s].name + 'のカテゴリ別</h2>' +
        '<p class="note">' + st.n + '件中 ' + st.rated + '件を評価済み</p>' + catTable(s, items) + '</div>';
    });
    var counts = {};
    items.forEach(function (it) {
      if (!it.r || !isNum(it.r.interest) || it.r.interest < 4) return;
      (it.keywords || []).forEach(function (k) { k = String(k).trim(); if (k) counts[k] = (counts[k] || 0) + 1; });
    });
    var kw = Object.keys(counts).map(function (k) { return [k, counts[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 15);
    html += '<div class="block"><h2>興味が高かった記事のキーワード</h2><p class="note">興味4以上を付けた記事のキーワードを、多い順に表示します。</p>' +
      (kw.length ? '<div class="kw">' + kw.map(function (k) { return '<span>' + esc(k[0]) + '<b>' + k[1] + '</b></span>'; }).join("") + '</div>'
        : '<p class="dim" style="margin:0">興味4以上の記事はまだありません。</p>') + '</div>';
    main.innerHTML = html;
  }

  /* ---------- 通知と設定 ---------- */
  function repoInfo() {
    var h = location.hostname, m = /^([^.]+)\.github\.io$/i.exec(h);
    if (!m) return null;
    var owner = m[1], seg = location.pathname.split("/").filter(Boolean)[0];
    var repo = seg && !/\.html?$/.test(seg) ? seg : owner + ".github.io";
    return { owner: owner, repo: repo, url: "https://github.com/" + owner + "/" + repo };
  }
  function b64ToU8(s) {
    var pad = "=".repeat((4 - s.length % 4) % 4), b = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(b), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  var pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  function isInstalled() { return window.matchMedia && (matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: minimal-ui)").matches); }

  function renderSettings() {
    var info = repoInfo();
    var nRated = Object.keys(ratings).length;
    var html = '<div class="page-h"><h1>通知と設定</h1><p>通知の受け取りと、評価データのバックアップ。</p></div>';
    html += '<section class="panel" id="push-panel"><h2>新着通知</h2><div id="push-body"><p class="dim">確認中…</p></div></section>';
    html += '<section class="panel"><h2>評価データのバックアップ</h2>' +
      '<p>評価とクイズの結果（' + nRated + '件）はこの端末の中だけに保存されています。機種変更やブラウザのデータ削除の前に書き出してください。</p>' +
      '<div class="row"><button type="button" class="btn ghost" data-act="export">書き出す</button>' +
      '<label class="btn ghost" for="import-file">読み込む</label><input type="file" id="import-file" accept="application/json,.json" hidden></div></section>';
    var u = state.index && state.index.updated ? new Date(state.index.updated) : null;
    html += '<section class="panel"><h2>記事データ</h2>' +
      '<p>最終更新：' + (u && !isNaN(u) ? esc(u.toLocaleString("ja-JP")) : "–") + '　／　号の数：' + (state.index ? state.index.issues.length : "–") + '</p>' +
      '<div class="row"><button type="button" class="btn ghost" data-act="refresh">今すぐ更新</button>' +
      (info ? '<a class="btn ghost" href="' + esc(info.url) + '" target="_blank" rel="noopener">GitHubリポジトリを開く</a>' : '') + '</div></section>';
    html += '<section class="panel"><h2>このアプリについて</h2><p>記事は、毎朝のスケジュールタスクが作成してGitHubに保存します。通知は、記事が保存されたあとにGitHub Actionsから送られます。</p></section>';
    main.innerHTML = html;
    fillPushPanel();
  }
  function fillPushPanel() {
    var body = document.getElementById("push-body");
    if (!body) return;
    if (!pushSupported) { body.innerHTML = '<p><span class="state off">この端末は非対応</span></p><p>Android の Chrome でこのアプリを開いてください。</p>'; return; }
    var info = repoInfo();
    var installHint = isInstalled() ? "" : '<p class="dim">先にこのアプリをインストールしてください。Chrome のメニュー（⋮）→「アプリをインストール」または「ホーム画面に追加」。インストールしたアプリから通知を有効にすると、確実に届きます。</p>';
    var keyReady = false;
    fetch("push-config.json", { cache: "no-cache" }).then(function (r) { return r.json(); }).then(function (cfg) { keyReady = !!(cfg && cfg.vapidPublicKey); }).catch(function () {})
    .then(function () { return navigator.serviceWorker.ready; }).then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
      var perm = Notification.permission;
      if (!keyReady && !sub) {
        body.innerHTML = '<p><span class="state">準備中</span></p><p>通知を送る側（GitHub）の設定がまだ終わっていません。設定が済むと、ここに「通知を有効にする」ボタンが表示されます。</p>';
        return;
      }
      if (perm === "denied") {
        body.innerHTML = '<p><span class="state off">ブロック中</span></p><p>Android の「設定 → アプリ → 朝読み → 通知」で通知を許可してから、もう一度開いてください。</p>';
        return;
      }
      if (!sub) {
        body.innerHTML = '<p><span class="state">未設定</span></p>' + installHint +
          '<p>新しい号が届いたときに、この端末へ通知します。</p><div class="row"><button type="button" class="btn" data-act="push-on">通知を有効にする</button></div>';
        return;
      }
      var json = JSON.stringify(sub.toJSON());
      body.innerHTML = '<p><span class="state on">この端末は受信できます</span></p>' +
        '<p>通知を送る側に、この端末の宛先を一度だけ登録してください。</p>' +
        '<ol class="steps">' +
          '<li>下の「宛先をコピー」を押す</li>' +
          '<li>Claude との会話に貼り付けて送る（Claude が登録します）</li>' +
          '<li>登録が済むと、テスト通知が届きます</li>' +
        '</ol>' +
        '<textarea class="sub" id="sub-json" readonly aria-label="この端末の通知の宛先">' + esc(json) + '</textarea>' +
        '<div class="row"><button type="button" class="btn" data-act="copy-sub">宛先をコピー</button>' +
        '<button type="button" class="btn ghost" data-act="push-test">この端末で表示を試す</button>' +
        '<button type="button" class="btn ghost" data-act="push-off">通知を解除</button></div>';
    }).catch(function () {
      body.innerHTML = '<p><span class="state off">確認できません</span></p><p>アプリを開き直してください。</p>';
    });
  }
  function enablePush() {
    fetch("push-config.json", { cache: "no-cache" }).then(function (r) { return r.json(); }).then(function (cfg) {
      if (!cfg || !cfg.vapidPublicKey) throw new Error("no key");
      return Notification.requestPermission().then(function (perm) {
        if (perm !== "granted") { toast("通知が許可されませんでした"); return; }
        return navigator.serviceWorker.ready.then(function (reg) {
          return reg.pushManager.getSubscription().then(function (sub) {
            return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(cfg.vapidPublicKey) });
          });
        }).then(function () { toast("この端末で通知を受け取れるようになりました"); });
      });
    }).catch(function () { toast("通知を有効にできませんでした。アプリを開き直してください。"); })
      .then(fillPushPanel);
  }
  function disablePush() {
    navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); })
      .then(function (sub) { return sub && sub.unsubscribe(); })
      .then(function () { toast("通知を解除しました。GitHubのシークレットも削除してください。"); })
      .catch(function () { toast("解除できませんでした"); })
      .then(fillPushPanel);
  }
  function copySub() {
    var ta = document.getElementById("sub-json"); if (!ta) return;
    var text = ta.value;
    function fallback() { ta.focus(); ta.select(); toast("選択しました。長押しでコピーしてください。"); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast("宛先をコピーしました"); }, fallback);
    } else fallback();
  }
  function testLocal() {
    navigator.serviceWorker.ready.then(function (reg) {
      return reg.showNotification("朝読みログ", { body: "通知の表示テストです。", icon: "icons/icon-192.png", badge: "icons/badge-96.png", tag: "local-test", data: { url: "./#settings" } });
    }).catch(function () { toast("通知を表示できませんでした"); });
  }
  function exportRatings() {
    var data = { app: "asayomi", version: 1, exportedAt: new Date().toISOString(), ratings: ratings, seen: seen };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "asayomi-backup-" + keyOf(new Date()).replace(/-/g, "") + ".json";
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast("書き出しました");
  }
  function importRatings(file) {
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var j = JSON.parse(fr.result);
        if (!j || j.app !== "asayomi" || typeof j.ratings !== "object") throw new Error("format");
        var n = 0;
        Object.keys(j.ratings).forEach(function (id) {
          var inc = j.ratings[id], cur = ratings[id];
          if (!inc || typeof inc !== "object") return;
          if (!cur || String(inc.ratedAt || "") > String(cur.ratedAt || "")) { ratings[id] = inc; n++; }
        });
        if (j.seen && typeof j.seen === "object") Object.keys(j.seen).forEach(function (k) { seen[k] = true; });
        writeLS(LS_RATINGS, ratings); writeLS(LS_SEEN, seen);
        toast(n + "件の評価を読み込みました");
        renderSettings();
      } catch (e) { toast("このファイルは読み込めません。書き出したバックアップを選んでください。"); }
    };
    fr.readAsText(file);
  }

  /* ---------- 操作 ---------- */
  main.addEventListener("click", function (ev) {
    var btn = ev.target.closest("[data-act]");
    if (!btn || btn.disabled) return;
    var act = btn.getAttribute("data-act");
    if (act === "filter") { state.filter = btn.getAttribute("data-v"); renderHome(); return; }
    if (act === "refresh") { loadIndex(true); return; }
    if (act === "push-on") { enablePush(); return; }
    if (act === "push-off") { disablePush(); return; }
    if (act === "copy-sub") { copySub(); return; }
    if (act === "push-test") { testLocal(); return; }
    if (act === "export") { exportRatings(); return; }
    var card = btn.closest("article.card");
    var issueId = state.route.indexOf("issue-") === 0 ? state.route.slice(6) : null;
    var issue = issueId && state.issues[issueId];
    if (!card || !issue) return;
    var item = findItem(issue, card.getAttribute("data-id")); if (!item) return;
    var v = Number(btn.getAttribute("data-v")), r = ratings[item.id] || {};
    if (act === "interest") rate(issue, item, { interest: r.interest === v ? null : v });
    else if (act === "und") rate(issue, item, { understanding: r.understanding === v ? null : v });
    else if (act === "quiz") {
      var qs = Array.isArray(item.quiz) ? item.quiz : [], qi = Number(btn.getAttribute("data-q"));
      var ans = Array.isArray(r.answers) ? r.answers.slice() : [], cor = Array.isArray(r.correct) ? r.correct.slice() : [];
      while (ans.length < qs.length) ans.push(null);
      while (cor.length < qs.length) cor.push(null);
      if (isNum(ans[qi]) || !qs[qi]) return;
      ans[qi] = v; cor[qi] = v === qs[qi].answer;
      rate(issue, item, { answers: ans, correct: cor });
    }
  });
  main.addEventListener("change", function (ev) {
    if (ev.target && ev.target.id === "import-file" && ev.target.files && ev.target.files[0]) importRatings(ev.target.files[0]);
  });
  refreshBtn.addEventListener("click", function () { loadIndex(true); });

  /* ---------- 画面切り替え ---------- */
  function route(keepScroll) {
    var h = location.hash.replace(/^#/, "");
    var tab = "home";
    state.route = h;
    if (h.indexOf("issue-") === 0) renderIssue(h.slice(6));
    else if (h === "trends") { tab = "trends"; renderTrends(); }
    else if (h === "settings") { tab = "settings"; renderSettings(); }
    else renderHome();
    document.querySelectorAll(".tabbar a").forEach(function (a) {
      if (a.getAttribute("data-tab") === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    if (!keepScroll) window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", function () { route(false); });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && !state.loading) loadIndex(false);
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
    navigator.serviceWorker.addEventListener("message", function (ev) {
      var d = ev.data || {};
      if (d.type === "open" && typeof d.hash === "string") { location.hash = d.hash; loadIndex(false); }
    });
  }

  route(false);
  loadIndex(false);
})();
