(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const el = {
    input: $("input"), analyze: $("analyze"), clear: $("clear"), status: $("status"),
    toolbar: $("toolbar"), level: $("level"), sort: $("sort"), furigana: $("furigana"),
    showKnown: $("showKnown"), exportBtn: $("export"), summary: $("summary"),
    sentence: $("sentence"), results: $("results"), dialog: $("exportDialog"),
    exportText: $("exportText"), copyExport: $("copyExport"),
    downloadCsv: $("downloadCsv"), downloadTxt: $("downloadTxt"),
  };

  // ---------- 本地存储（读写都可能失败，失败就当没有） ----------
  const store = {
    get(k, d) {
      try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 忽略 */ }
    },
  };
  const known = new Set(store.get("cishu.known", []));
  const saveKnown = () => store.set("cishu.known", [...known]);
  const knownId = (w) => w.word + "|" + w.reading;

  const prefs = store.get("cishu.prefs", {});
  if (prefs.level) el.level.value = prefs.level;
  if (prefs.sort) el.sort.value = prefs.sort;
  if (prefs.furigana === false) el.furigana.checked = false;
  if (prefs.showKnown) el.showKnown.checked = true;
  const savePrefs = () => store.set("cishu.prefs", {
    level: el.level.value, sort: el.sort.value,
    furigana: el.furigana.checked, showKnown: el.showKnown.checked,
  });
  el.input.value = store.get("cishu.draft", "");

  // ---------- 加载分词器和词典 ----------
  let tokenizer = null, dict = null, result = null;

  el.status.textContent = "正在加载分词词典（约 18 MB，首次较慢，之后会被浏览器缓存）…";
  const tokP = new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: "vendor/kuromoji-dict/" }).build((err, t) => (err ? reject(err) : resolve(t)));
  });
  const dictP = fetch("dict/dict.json").then((r) => {
    if (!r.ok) throw new Error("词典加载失败：" + r.status);
    return r.json();
  });
  Promise.all([tokP, dictP]).then(([t, rows]) => {
    tokenizer = t;
    dict = new Analyzer.Dictionary(rows);
    el.analyze.disabled = false;
    el.analyze.textContent = "分析";
    el.status.textContent = `就绪 · 词典 ${rows.length.toLocaleString()} 条`;
    if (el.input.value.trim()) run();
  }).catch((e) => {
    el.analyze.textContent = "加载失败";
    el.status.textContent = String(e.message || e);
    console.error(e);
  });

  // ---------- 分析 ----------
  function run() {
    const text = el.input.value;
    store.set("cishu.draft", text);
    if (!tokenizer || !text.trim()) {
      result = null;
      render();
      return;
    }
    result = Analyzer.analyze(text, tokenizer, dict);
    render();
  }

  el.analyze.addEventListener("click", run);
  el.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run();
  });
  el.input.addEventListener("paste", () => setTimeout(() => tokenizer && run(), 0));
  el.clear.addEventListener("click", () => {
    el.input.value = "";
    run();
    el.input.focus();
  });

  [el.level, el.sort, el.furigana, el.showKnown].forEach((c) =>
    c.addEventListener("change", () => { savePrefs(); render(); })
  );

  // ---------- 渲染 ----------
  function visibleWords() {
    if (!result) return [];
    const lv = +el.level.value;
    let ws = result.words.filter((w) => {
      if (!el.showKnown.checked && known.has(knownId(w))) return false;
      // 「N3 及以上」= N3、N2、N1 以及没有等级的词（通常比 N1 更少见）
      if (lv && w.jlpt && w.jlpt > lv) return false;
      return true;
    });
    const s = el.sort.value;
    if (s === "count") ws = ws.slice().sort((a, b) => b.count - a.count || a.order - b.order);
    else if (s === "level") ws = ws.slice().sort((a, b) => (a.jlpt || 0) - (b.jlpt || 0) || a.order - b.order);
    return ws;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function rubyHtml(word, reading) {
    return Analyzer.furigana(word, reading)
      .map(([t, r]) => (r ? `<ruby>${esc(t)}<rt>${esc(r)}</rt></ruby>` : esc(t)))
      .join("");
  }

  function render() {
    document.body.classList.toggle("no-furigana", !el.furigana.checked);
    const has = !!(result && result.words.length);
    el.toolbar.hidden = !has;
    el.summary.hidden = !has;
    el.sentence.hidden = !has;
    if (!has) {
      el.results.innerHTML = result ? `<p class="empty">没有找到日语词。</p>` : "";
      return;
    }

    const ws = visibleWords();
    const knownCount = result.words.filter((w) => known.has(knownId(w))).length;
    el.summary.innerHTML =
      `共 <b>${result.words.length}</b> 个不同的词，当前显示 <b>${ws.length}</b> 个` +
      (knownCount ? `，其中 ${knownCount} 个已标为认识` + (el.showKnown.checked ? "" : "（已隐藏）") : "") +
      `。<span class="muted">点原文里的词可跳到对应词条。</span>`;

    // 原文：按词分段，带振假名
    const shown = new Set(ws.map((w) => w.key));
    el.sentence.innerHTML = result.segments.map((s) => {
      if (s.surface === "\n") return "<br>";
      const inner = s.key && Analyzer.hasKanji(s.surface) ? rubyHtml(s.surface, s.reading) : esc(s.surface);
      if (!s.key) return `<span class="seg">${inner}</span>`;
      const cls = shown.has(s.key) ? "seg word" : "seg word dim";
      return `<a class="${cls}" href="#w-${encodeURIComponent(s.key)}">${inner}</a>`;
    }).join("").replace(/\n/g, "<br>");

    el.results.innerHTML = ws.map(wordHtml).join("");
  }

  function wordHtml(w) {
    const isKnown = known.has(knownId(w));
    const tags = [];
    if (w.jlpt) tags.push(`<span class="tag jlpt">JLPT <b>N${w.jlpt}</b></span>`);
    if (w.proper) tags.push(`<span class="tag">专有名词</span>`);
    tags.push(`<span class="tag count">出现 <b>${w.count}</b> 次</span>`);

    let meaning;
    if (w.zh) meaning = `<div class="zh">${esc(w.zh).replace(/；/g, "<span class=\"sep\">；</span>")}</div>`;
    else if (w.en) meaning = `<div class="en"><span class="tag en-tag">暂无中文 · 英文释义</span> ${esc(w.en)}</div>`;
    else meaning = `<div class="none">词典未收录（可能是人名、地名或新词）</div>`;

    const surf = w.surfaces.filter((s) => s !== w.word);
    const extra = [];
    if (surf.length) extra.push(`原文写作：${surf.map(esc).join("、")}`);
    if (w.otherForms.length) extra.push(`其他写法：${w.otherForms.map(esc).join("、")}`);

    return `
      <article class="entry${isKnown ? " known" : ""}" id="w-${encodeURIComponent(w.key)}">
        <div class="entry-word">
          <div class="head" lang="ja">${rubyHtml(w.word, w.reading)}</div>
          ${Analyzer.hasKanji(w.word) ? `<div class="reading" lang="ja">${esc(w.reading)}</div>` : ""}
          <div class="tags">${tags.join("")}</div>
        </div>
        <div class="entry-meaning">
          ${w.pos ? `<div class="pos">${esc(w.pos)}</div>` : ""}
          ${meaning}
          ${extra.length ? `<div class="extra" lang="ja">${extra.join("　")}</div>` : ""}
          <div class="links">
            <a href="https://jisho.org/search/${encodeURIComponent(w.word)}" target="_blank" rel="noopener">Jisho</a>
            <a href="https://www.weblio.jp/content/${encodeURIComponent(w.word)}" target="_blank" rel="noopener">Weblio</a>
          </div>
        </div>
        <button class="know" data-id="${esc(knownId(w))}" title="${isKnown ? "取消认识" : "我认识这个词，勾掉它"}">
          ${isKnown ? "撤销" : "✓ 认识"}
        </button>
      </article>`;
  }

  el.results.addEventListener("click", (e) => {
    const b = e.target.closest("button.know");
    if (!b) return;
    const id = b.dataset.id;
    if (known.has(id)) known.delete(id);
    else known.add(id);
    saveKnown();
    render();
  });

  // ---------- 导出 ----------
  function exportRows() {
    return visibleWords().map((w) => ({
      word: w.word, reading: w.reading, pos: w.pos,
      jlpt: w.jlpt ? "N" + w.jlpt : "", meaning: w.zh || w.en || "", count: w.count,
    }));
  }
  const csvCell = (s) => /[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s);
  function toCsv(rows) {
    const head = ["词", "读音", "词性", "JLPT", "释义", "出现次数"];
    return [head].concat(rows.map((r) => [r.word, r.reading, r.pos, r.jlpt, r.meaning, r.count]))
      .map((r) => r.map(csvCell).join(",")).join("\r\n");
  }
  const toTxt = (rows) => rows.map((r) => `${r.word}【${r.reading}】${r.jlpt ? " " + r.jlpt : ""}　${r.meaning}`).join("\n");

  function download(name, text, type) {
    const blob = new Blob(["﻿" + text], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);

  el.exportBtn.addEventListener("click", () => {
    el.exportText.value = toTxt(exportRows());
    if (el.dialog.showModal) el.dialog.showModal();
    else el.dialog.setAttribute("open", "");
  });
  el.copyExport.addEventListener("click", () => {
    const done = () => { el.copyExport.textContent = "已复制"; setTimeout(() => (el.copyExport.textContent = "复制"), 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(el.exportText.value).then(done, () => { el.exportText.select(); document.execCommand("copy"); done(); });
    else { el.exportText.select(); document.execCommand("copy"); done(); }
  });
  el.downloadCsv.addEventListener("click", () => download(`生词表-${stamp()}.csv`, toCsv(exportRows()), "text/csv;charset=utf-8"));
  el.downloadTxt.addEventListener("click", () => download(`生词表-${stamp()}.txt`, toTxt(exportRows()), "text/plain;charset=utf-8"));
})();
