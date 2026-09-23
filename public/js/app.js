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
    el.status.textContent = `就绪 · 词典 ${rows.length.toLocaleString()} 条 · Ctrl+Enter 或点放大镜开始分析`;
    if (el.input.value.trim()) run();
  }).catch((e) => {
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
  // 输入框随内容自动长高（像 Jisho 的单行搜索框，粘贴长文时再展开）
  function autosize() {
    el.input.style.height = "auto";
    el.input.style.height = Math.min(el.input.scrollHeight, window.innerHeight * 0.4) + "px";
  }
  el.input.addEventListener("input", autosize);
  autosize();
  el.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run();
  });
  el.input.addEventListener("paste", () => setTimeout(() => tokenizer && run(), 0));
  el.clear.addEventListener("click", () => {
    el.input.value = "";
    autosize();
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
      `词语<span class="result-count"> — 共 ${result.words.length} 个，显示 ${ws.length} 个` +
      (knownCount ? `，${knownCount} 个已认识` + (el.showKnown.checked ? "" : "（已隐藏）") : "") + `</span>`;

    // 原文：按词分段，带振假名
    const shown = new Set(ws.map((w) => w.key));
    // 原文拆成一个个词块（Jisho 的 zen bar）：振假名在上，词在下；换行另起一行
    const lines = [[]];
    for (const s of result.segments) {
      const parts = s.surface.split("\n");
      parts.forEach((p, i) => {
        if (i > 0) lines.push([]);
        if (p.trim()) lines[lines.length - 1].push({ ...s, surface: p });
      });
    }
    el.sentence.innerHTML = lines.filter((l) => l.length).map((line) => "<ul>" + line.map((s) => {
      const inner = s.key && Analyzer.hasKanji(s.surface) ? rubyHtml(s.surface, s.reading) : esc(s.surface);
      if (!s.key) return `<li class="jw">${inner}</li>`;
      const cls = shown.has(s.key) ? "jw" : "jw dim";
      return `<li class="${cls}"><a href="#w-${encodeURIComponent(s.key)}" data-key="${esc(s.key)}">${inner}</a></li>`;
    }).join("") + "</ul>").join("");

    el.results.innerHTML = ws.map(wordHtml).join("");
  }

  function wordHtml(w) {
    const isKnown = known.has(knownId(w));
    const tags = [];
    if (w.jlpt) tags.push(`<span class="label">JLPT N${w.jlpt}</span>`);
    if (w.proper) tags.push(`<span class="label">专有名词</span>`);
    tags.push(`<span class="label label-count">出现 ${w.count} 次</span>`);

    // 释义按「；」拆成编号义项，和 Jisho 一样 1. 2. 3.
    let meanings;
    if (w.zh) {
      meanings = w.zh.split("；").filter(Boolean).map((m, i) =>
        `<div class="meaning"><span class="divider">${i + 1}. </span><span class="meaning-text">${esc(m)}</span></div>`).join("");
    } else if (w.en) {
      meanings = `<div class="meaning"><span class="divider">1. </span><span class="meaning-text" lang="en">${esc(w.en)}</span>` +
        `<span class="supplemental">暂无中文释义，以上为英文</span></div>`;
    } else {
      meanings = `<div class="meaning"><span class="meaning-text muted">词典未收录（可能是人名、地名或新词）</span></div>`;
    }

    const surf = w.surfaces.filter((s) => s !== w.word);
    return `
      <article class="concept${isKnown ? " known" : ""}" id="w-${encodeURIComponent(w.key)}">
        <div class="concept-word">
          <div class="representation" lang="ja">${rubyHtml(w.word, w.reading)}</div>
          <div class="status">
            ${tags.join(" ")}
            <a href="#" class="status-link know" data-id="${esc(knownId(w))}">${isKnown ? "撤销认识" : "✓ 认识"}</a>
            <a class="status-link" href="https://www.weblio.jp/content/${encodeURIComponent(w.word)}" target="_blank" rel="noopener">Weblio</a>
          </div>
        </div>
        <div class="concept-meanings">
          ${w.pos ? `<div class="meaning-tags">${esc(w.pos)}</div>` : ""}
          ${meanings}
          ${w.otherForms.length ? `<div class="meaning-tags">其他写法</div><div class="meaning" lang="ja"><span class="meaning-text">${w.otherForms.map((f) => `${esc(f)} 【${esc(w.reading)}】`).join("、")}</span></div>` : ""}
          ${surf.length ? `<div class="meaning-tags">原文写作</div><div class="meaning" lang="ja"><span class="meaning-text">${surf.map(esc).join("、")}</span></div>` : ""}
        </div>
        <a class="details-link" href="https://jisho.org/search/${encodeURIComponent(w.word)}" target="_blank" rel="noopener">Jisho ▸</a>
      </article>`;
  }

  el.results.addEventListener("click", (e) => {
    const b = e.target.closest(".know");
    if (!b) return;
    e.preventDefault();
    const id = b.dataset.id;
    if (known.has(id)) known.delete(id);
    else known.add(id);
    saveKnown();
    render();
  });

  // 点原文里的词：跳到词条并高亮（Jisho 的 current）
  el.sentence.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-key]");
    if (!a) return;
    el.sentence.querySelectorAll("a.current").forEach((x) => x.classList.remove("current"));
    el.sentence.querySelectorAll(`a[data-key="${CSS.escape(a.dataset.key)}"]`).forEach((x) => x.classList.add("current"));
    el.results.querySelectorAll(".concept.current").forEach((x) => x.classList.remove("current"));
    const target = document.getElementById("w-" + encodeURIComponent(a.dataset.key));
    if (target) target.classList.add("current");
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
