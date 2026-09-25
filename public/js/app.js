(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const el = {
    input: $("input"), analyze: $("analyze"), clear: $("clear"), status: $("status"),
    toolbar: $("toolbar"), level: $("level"), sort: $("sort"), furigana: $("furigana"),
    showKnown: $("showKnown"), exportBtn: $("export"), summary: $("summary"),
    sentence: $("sentence"), results: $("results"), dialog: $("exportDialog"),
    exportText: $("exportText"), copyExport: $("copyExport"),
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
  // 显示方式：list = 全部列出；focus = 一次只看一个词（Jisho 的做法：点原文里的词，下面只显示那一个）
  let viewMode = prefs.view === "focus" ? "focus" : "list";
  let focusKey = null;
  const savePrefs = () => store.set("cishu.prefs", {
    level: el.level.value, sort: el.sort.value,
    furigana: el.furigana.checked, showKnown: el.showKnown.checked, view: viewMode,
  });
  el.input.value = store.get("cishu.draft", "");

  // ---------- 主题：跟随系统 → 浅色 → 深色 ----------
  const themeBtn = $("themeBtn");
  const THEMES = { auto: "主题：自动", light: "主题：浅色", dark: "主题：深色" };
  function applyTheme(t) {
    if (t === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    themeBtn.textContent = THEMES[t];
    try { localStorage.setItem("cishu.theme", t); } catch (e) { /* 忽略 */ }
  }
  let theme = document.documentElement.dataset.theme || "auto";
  themeBtn.textContent = THEMES[theme];
  themeBtn.addEventListener("click", () => {
    theme = { auto: "light", light: "dark", dark: "auto" }[theme];
    applyTheme(theme);
  });

  // ---------- 字号：小 / 中 / 大（大 = 原来的尺寸），整页按比例缩放 ----------
  const sizeBtns = [...document.querySelectorAll("#sizeSwitch button")];
  function applySize(z) {
    if (z === "m") delete document.documentElement.dataset.size;
    else document.documentElement.dataset.size = z;
    sizeBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.size === z)));
    try { localStorage.setItem("cishu.size", z); } catch (e) { /* 忽略 */ }
  }
  applySize(document.documentElement.dataset.size || "m");
  // 切换后原文区域高度变了，重新判断要不要显示「展开全文」
  sizeBtns.forEach((b) => b.addEventListener("click", () => { applySize(b.dataset.size); updateZenToggle(); }));

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
    el.status.textContent = `就绪 · 词典 ${rows.length.toLocaleString()} 条 · 按 Enter 或点放大镜开始分析`;
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
    focusKey = null;
    if (location.hash.startsWith("#kanji/")) location.hash = ""; // 在汉字页里分析：回到生词表
    render();
    // 单行框里回到开头显示（Jisho 也是从第一句开始显示）
    if (document.activeElement !== el.input) { el.input.scrollTop = 0; el.input.scrollLeft = 0; }
  }

  el.analyze.addEventListener("click", run);
  // 输入框和 Jisho 一样是单行的：Enter 直接分析，Shift+Enter 才换行
  el.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); run(); }
  });

  // 搜索框左边的三个输入方式
  const setText = (t) => { el.input.value = t; run(); };
  $("pasteBtn").addEventListener("click", async () => {
    try { setText(await navigator.clipboard.readText()); }
    catch (e) { el.status.textContent = "浏览器不允许读取剪贴板，请直接在输入框里 Ctrl+V。"; el.input.focus(); }
  });
  $("sampleBtn").addEventListener("click", () => setText(
    "吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。" +
    "何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。"));
  $("fileInput").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    // 日文小说的 txt 常是 Shift-JIS 编码：先按 UTF-8 严格解码，失败再用 Shift-JIS
    f.arrayBuffer().then((buf) => {
      let text;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
      catch (err) { text = new TextDecoder("shift_jis").decode(buf); }
      setText(text.replace(/^\ufeff/, ""));
    });
    e.target.value = "";
  });
  el.input.addEventListener("paste", () => setTimeout(() => { if (tokenizer) { el.input.blur(); run(); } }, 0));
  el.input.addEventListener("blur", () => { el.input.scrollTop = 0; el.input.scrollLeft = 0; });
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
    el.sentence.hidden = !has || location.hash.startsWith("#kanji/");
    if (!has) {
      el.results.innerHTML = result ? `<p class="empty">没有找到日语词。</p>` : "";
      updateZenToggle();
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

    if (viewMode === "focus" && ws.length) {
      let i = ws.findIndex((w) => w.key === focusKey);
      if (i < 0) i = 0;
      focusKey = ws[i].key;
      el.results.innerHTML = `
        <nav class="focus-nav" aria-label="逐词浏览">
          <button type="button" class="button secondary-btn" data-step="-1" ${i === 0 ? "disabled" : ""}>‹ 上一个</button>
          <span class="focus-pos"><b>${i + 1}</b> / ${ws.length}</span>
          <button type="button" class="button secondary-btn" data-step="1" ${i === ws.length - 1 ? "disabled" : ""}>下一个 ›</button>
        </nav>` + wordHtml(ws[i]).replace('class="concept', 'class="concept focus');
      el.sentence.querySelectorAll("a[data-key]").forEach((a) => a.classList.toggle("current", a.dataset.key === focusKey));
    } else {
      el.results.innerHTML = ws.map(wordHtml).join("");
    }
    updateZenToggle();
  }

  // 原文太长时只显示约半屏，可展开
  const zenToggle = $("zenToggle");
  function updateZenToggle() {
    const tall = !el.sentence.hidden && (el.sentence.classList.contains("expanded") || el.sentence.scrollHeight > el.sentence.clientHeight + 4);
    zenToggle.hidden = !tall;
    zenToggle.textContent = el.sentence.classList.contains("expanded") ? "收起原文" : "展开全文";
  }
  zenToggle.addEventListener("click", () => {
    el.sentence.classList.toggle("expanded");
    updateZenToggle();
  });

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
          <div class="representation${w.word.length > 7 ? " longer" : w.word.length > 4 ? " long" : ""}" lang="ja">${rubyHtml(w.word, w.reading)}</div>
          <div class="status">
            ${tags.join(" ")}
            <a href="#" class="status-link know" data-id="${esc(knownId(w))}">${isKnown ? "撤销认识" : "✓ 认识"}</a>
            ${KanjiPage.kanjiOf(w.word).length ? `<span class="status-link">汉字详情：${KanjiPage.kanjiOf(w.word).map((c) => `<a lang="ja" href="${KanjiPage.link(c)}">${esc(c)}</a>`).join(" ")}</span>` : ""}
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
    if (viewMode === "focus" && !known.has(id) && !el.showKnown.checked) {
      // 逐词模式里勾掉当前词：自动跳到下一个
      const ws = visibleWords(), i = ws.findIndex((w) => w.key === focusKey);
      const next = ws[i + 1] || ws[i - 1];
      focusKey = next ? next.key : null;
    }
    if (known.has(id)) known.delete(id);
    else known.add(id);
    saveKnown();
    render();
  });

  function stepFocus(d) {
    const ws = visibleWords(), i = ws.findIndex((w) => w.key === focusKey);
    const next = ws[Math.min(ws.length - 1, Math.max(0, i + d))];
    if (next && next.key !== focusKey) { focusKey = next.key; render(); showKanjiSide(next.word); }
  }
  el.results.addEventListener("click", (e) => {
    const b = e.target.closest(".focus-nav button[data-step]");
    if (b) stepFocus(+b.dataset.step);
  });
  // 逐词模式：键盘左右键切换（在输入框里打字时不管）
  document.addEventListener("keydown", (e) => {
    if (viewMode !== "focus" || !result || e.altKey || e.ctrlKey || e.metaKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || el.dialog.open) return;
    if (e.key === "ArrowRight") { stepFocus(1); e.preventDefault(); }
    if (e.key === "ArrowLeft") { stepFocus(-1); e.preventDefault(); }
  });

  const viewBtns = [...document.querySelectorAll("#viewSwitch button")];
  function applyView(v) {
    viewMode = v;
    viewBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === v)));
  }
  applyView(viewMode);
  viewBtns.forEach((b) => b.addEventListener("click", () => { applyView(b.dataset.view); savePrefs(); render(); }));

  // 点原文里的词：跳到词条并高亮（Jisho 的 current）；逐词模式下直接换成这个词
  el.sentence.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-key]");
    if (!a) return;
    if (viewMode === "focus") {
      e.preventDefault();
      if (!visibleWords().some((w) => w.key === a.dataset.key)) return; // 被筛掉或已认识的词
      focusKey = a.dataset.key;
      render();
      showKanjiSide(a.textContent);
      return;
    }
    el.sentence.querySelectorAll("a.current").forEach((x) => x.classList.remove("current"));
    el.sentence.querySelectorAll(`a[data-key="${CSS.escape(a.dataset.key)}"]`).forEach((x) => x.classList.add("current"));
    el.results.querySelectorAll(".concept.current").forEach((x) => x.classList.remove("current"));
    const target = document.getElementById("w-" + encodeURIComponent(a.dataset.key));
    if (target) target.classList.add("current");
    showKanjiSide(a.textContent);
  });

  // ---------- 汉字：侧栏小卡片 + 详情页（#kanji/字） ----------
  const kanjiSide = $("kanjiSide"), kanjiView = $("kanjiView"), mainColumns = $("mainColumns");
  function showKanjiSide(text) {
    const chars = KanjiPage.kanjiOf(text.replace(/[\u3040-\u309f]/g, ""));
    if (!chars.length) { kanjiSide.hidden = true; return; }
    KanjiPage.load().then((data) => {
      kanjiSide.innerHTML = `<h4 class="block-title">汉字<span class="result-count"> — ${chars.length} 个</span></h4>` +
        chars.map((c) => KanjiPage.lightHtml(c, data[c]) || `<p class="minor">「${esc(c)}」不在常用汉字表里。</p>`).join("");
      kanjiSide.hidden = false;
    }).catch(() => (kanjiSide.hidden = true));
  }
  function route() {
    const m = location.hash.match(/^#kanji\/([^/]+)(?:\/(start|end))?$/);
    const inKanji = !!m;
    kanjiView.hidden = !inKanji;
    mainColumns.hidden = inKanji;
    el.sentence.hidden = inKanji || !(result && result.words.length);
    updateZenToggle();
    if (!inKanji) return;
    let c;
    try { c = decodeURIComponent(m[1]); } catch (e) { c = m[1]; }
    kanjiView.innerHTML = `<p class="minor">正在加载汉字数据…</p>`;
    window.scrollTo(0, 0);
    Promise.all([KanjiPage.load(), dictP.catch(() => null)]).then(([data, rows]) => {
      KanjiPage.render(kanjiView, c, data[c], rows, m[2] || "");
    }).catch((e) => (kanjiView.innerHTML = `<p class="empty">${esc(e.message || e)}</p>`));
  }
  window.addEventListener("hashchange", route);
  route();

  // ---------- 导出 ----------
  function exportRows() {
    return visibleWords().map((w) => ({
      word: w.word, reading: w.reading, pos: w.pos,
      jlpt: w.jlpt ? "N" + w.jlpt : "", meaning: w.zh || w.en || "", count: w.count,
      forms: w.otherForms.join("、"), surfaces: w.surfaces.filter((x) => x !== w.word).join("、"),
    }));
  }
  const HEAD = ["词", "读音", "词性", "JLPT", "释义", "出现次数", "其他写法", "原文写作"];
  const asRow = (r) => [r.word, r.reading, r.pos, r.jlpt, r.meaning, r.count, r.forms, r.surfaces];
  const csvCell = (s) => /[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s);
  const toCsv = (rows) => [HEAD].concat(rows.map(asRow)).map((r) => r.map(csvCell).join(",")).join("\r\n");
  const toTxt = (rows) => rows.map((r) => `${r.word}【${r.reading}】${r.jlpt ? " " + r.jlpt : ""}　${r.meaning}`).join("\n");
  // Anki 2.1.55+ 认得这几行文件头：正面「词＋读音」，背面「释义」，第三列当标签
  const tabSafe = (s) => String(s).replace(/[\t\n]/g, " ");
  const toAnki = (rows) => "#separator:tab\n#html:false\n#tags column:4\n" +
    rows.map((r) => [r.word, r.reading, r.meaning + (r.pos ? `（${r.pos}）` : ""), r.jlpt ? "JLPT_" + r.jlpt : ""].map(tabSafe).join("\t")).join("\n");
  const toXlsx = (rows) => Xlsx.make([HEAD].concat(rows.map(asRow)), { sheetName: "生词表", widths: [14, 16, 18, 7, 48, 9, 16, 16] });
  const stamp = () => new Date().toISOString().slice(0, 10);

  // 在 claude.ai 里打开时，页面不能自己下载文件，要走平台的保存确认；其他地方就用浏览器下载
  let platformDl = null;
  const getPlatformDownloads = () => (platformDl = platformDl ||
    (window.claude && typeof window.claude.use === "function" ? window.claude.use("downloads").catch(() => null) : Promise.resolve(null)));
  getPlatformDownloads();

  const exportStatus = $("exportStatus");
  async function saveFile(name, data, mime) {
    exportStatus.textContent = "";
    const dl = await getPlatformDownloads();
    if (dl) {
      try {
        await dl.save({ filename: name, data });
        exportStatus.textContent = `已保存：${name}`;
      } catch (e) {
        const code = e && e.code;
        if (code === "declined") exportStatus.textContent = "已取消保存。";
        else if (code === "rate_limited") exportStatus.textContent = "上一个保存确认还没关闭，稍等一下再试。";
        else exportStatus.textContent = "这里暂时不能保存文件，可以展开「预览 / 复制文字」复制后粘贴。";
      }
      return;
    }
    const blob = new Blob([data], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    exportStatus.textContent = `已下载：${name}`;
  }

  // 文件名用英文：部分浏览器会丢掉「中文名 + .xlsx」的文件名，只剩 download
  const FORMATS = {
    xlsx: () => [`Cishu-${stamp()}.xlsx`, toXlsx(exportRows()), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    csv: () => [`Cishu-${stamp()}.csv`, "\ufeff" + toCsv(exportRows()), "text/csv;charset=utf-8"],
    anki: () => [`Cishu-Anki-${stamp()}.txt`, toAnki(exportRows()), "text/plain;charset=utf-8"],
    txt: () => [`Cishu-${stamp()}.txt`, toTxt(exportRows()), "text/plain;charset=utf-8"],
  };
  document.querySelectorAll(".export-format").forEach((b) =>
    b.addEventListener("click", () => saveFile(...FORMATS[b.dataset.format]())));

  el.exportBtn.addEventListener("click", () => {
    const rows = exportRows();
    $("exportCount").textContent = rows.length;
    el.exportText.value = toTxt(rows);
    exportStatus.textContent = "";
    if (el.dialog.showModal) el.dialog.showModal();
    else el.dialog.setAttribute("open", "");
  });
  function copyText(btn, text, label) {
    const done = () => { btn.textContent = "已复制"; setTimeout(() => (btn.textContent = label), 1500); };
    const fallback = () => { el.exportText.value = text; el.exportText.select(); document.execCommand("copy"); done(); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }
  el.copyExport.addEventListener("click", () => copyText(el.copyExport, toTxt(exportRows()), "复制"));
  $("copyCsv").addEventListener("click", (e) => copyText(e.currentTarget, toCsv(exportRows()), "复制 CSV"));
})();
