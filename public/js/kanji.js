// 汉字详情页（照 Jisho 的 kanji 页）+ 侧栏的汉字小卡片。数据按需加载 dict/kanji.json。
(function (root) {
  "use strict";

  // kanji.json：{字: [英文意思[], 音读[], 训读[], 笔画数, 年级, JLPT(0-5), 笔顺路径[]]}
  let dataP = null;
  const load = () => (dataP = dataP || fetch("dict/kanji.json").then((r) => {
    if (!r.ok) throw new Error("汉字数据加载失败：" + r.status);
    return r.json();
  }));

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const kataToHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const KANJI_RE = /[㐀-鿿豈-﫿々]/g;
  const kanjiOf = (word) => [...new Set(word.match(KANJI_RE) || [])];
  const link = (c) => `#kanji/${encodeURIComponent(c)}`;

  function gradeText(g) {
    if (g >= 1 && g <= 6) return `常用汉字，小学 <b>${g}</b> 年级学习`;
    if (g === 8) return `常用汉字，<b>初中</b>学习`;
    if (g === 9 || g === 10) return `<b>人名用</b>汉字`;
    return "";
  }

  const readings = (list) => list.map((r) => `<span class="kreading">${esc(r)}</span>`).join("、");

  // ---------- 侧栏小卡片（Jisho 搜索结果右侧的 Kanji 块） ----------
  function lightHtml(c, k) {
    if (!k) return "";
    const [en, on, kun, strokes, grade, jlpt] = k;
    return `
      <div class="kanji-light">
        <div class="kanji-light-info">${strokes} 画。${jlpt ? `JLPT N${jlpt}。` : ""}${gradeText(grade).replace(/<\/?b>/g, "")}</div>
        <a class="kanji-light-char" lang="ja" href="${link(c)}">${esc(c)}</a>
        <div class="kanji-light-body">
          <div class="kanji-light-en" lang="en">${esc(en.join(", "))}</div>
          ${kun.length ? `<div class="kanji-light-r"><span class="rtype">训：</span><span lang="ja">${kun.map(esc).join("、")}</span></div>` : ""}
          ${on.length ? `<div class="kanji-light-r"><span class="rtype">音：</span><span lang="ja">${on.map(esc).join("、")}</span></div>` : ""}
        </div>
        <a class="details-link" href="${link(c)}">详情 ▸</a>
      </div>`;
  }

  // ---------- 笔顺 ----------
  const startPoint = (d) => {
    const m = d.match(/M\s*([\d.]+)[ ,]([\d.]+)/);
    return m ? [+m[1], +m[2]] : null;
  };
  const GRID = `<path class="grid" d="M54.5 0V109M0 54.5H109"/>`;

  function strokeBoxes(paths) {
    return paths.map((_, i) => {
      const done = paths.slice(0, i).map((d) => `<path class="done" d="${d}"/>`).join("");
      const p = startPoint(paths[i]);
      return `<svg class="stroke-box" viewBox="0 0 109 109" aria-label="第 ${i + 1} 笔">${GRID}` +
        `${paths.map((d) => `<path class="ghost" d="${d}"/>`).join("")}${done}` +
        `<path class="now" d="${paths[i]}"/>${p ? `<circle class="dot" cx="${p[0]}" cy="${p[1]}" r="4"/>` : ""}</svg>`;
    }).join("");
  }

  function animate(svg, btn) {
    const ps = [...svg.querySelectorAll("path.anim")];
    btn.hidden = true;
    ps.forEach((p) => {
      const len = p.getTotalLength();
      p.style.transition = "none";
      p.style.strokeDasharray = len;
      p.style.strokeDashoffset = len;
    });
    let i = 0;
    const next = () => {
      if (i >= ps.length) { setTimeout(() => (btn.hidden = false), 600); return; }
      const p = ps[i++];
      const len = p.getTotalLength();
      p.getBoundingClientRect(); // 让浏览器先应用初始状态
      p.style.transition = `stroke-dashoffset ${Math.max(0.25, len / 160)}s linear`;
      p.style.strokeDashoffset = 0;
      setTimeout(next, Math.max(250, len / 160 * 1000) + 120);
    };
    next();
  }

  // ---------- 含这个字的词（从我们自己的词典里找） ----------
  // 音读在词里常发生浊化（しょう→じょう：誕生日）和促音化（がく→がっ：学校），一并算作音读
  const VOICED = { か: "が", き: "ぎ", く: "ぐ", け: "げ", こ: "ご", さ: "ざ", し: "じ", す: "ず", せ: "ぜ", そ: "ぞ",
    た: "だ", ち: "ぢ", つ: "づ", て: "で", と: "ど", は: "ば", ひ: "び", ふ: "ぶ", へ: "べ", ほ: "ぼ" };
  const HANDAKU = { は: "ぱ", ひ: "ぴ", ふ: "ぷ", へ: "ぺ", ほ: "ぽ" };
  function onVariants(on) {
    const out = new Set([on]);
    for (const v of [...out]) {
      if (VOICED[v[0]]) out.add(VOICED[v[0]] + v.slice(1));
      if (HANDAKU[v[0]]) out.add(HANDAKU[v[0]] + v.slice(1));
    }
    for (const v of [...out]) if (v.length > 1 && "つくちき".includes(v[v.length - 1])) out.add(v.slice(0, -1) + "っ");
    return [...out];
  }

  function compounds(c, k, rows, mode) {
    const onH = k[1].map(kataToHira).flatMap(onVariants);
    const out = { on: [], kun: [] };
    for (const r of rows) {
      // 跳过后缀条目（～日）和全角数字写法（５日）
      // 只看主写法：其他写法的读音可能对不上（高校/高等学校 共用「こうこう」）
      const w = r[0].includes(c) && !/[～〜０-９0-9]/.test(r[0]) ? r[0] : null;
      if (!w || !r[5]) continue;
      if (mode === "start" && !w.startsWith(c)) continue;
      if (mode === "end" && !w.endsWith(c)) continue;
      const item = { w, reading: r[2], jlpt: r[4], zh: r[5] };
      (onH.some((o) => o && r[2].includes(o)) ? out.on : out.kun).push(item);
    }
    const rank = (a, b) => (b.jlpt || 0) - (a.jlpt || 0) || a.w.length - b.w.length;
    out.on.sort(rank);
    out.kun.sort(rank);
    return out;
  }
  const compoundList = (list) => list.length
    ? `<ul class="compounds">${list.slice(0, 12).map((x) =>
      `<li><span lang="ja">${esc(x.w)} 【${esc(x.reading)}】</span> ${esc(x.zh.split("；").slice(0, 2).join("；"))}</li>`).join("")}</ul>`
    : `<p class="minor">词典里没有找到。</p>`;

  // ---------- 详情页 ----------
  function render(container, c, k, rows, mode) {
    if (!k) {
      container.innerHTML = `<p class="back"><a href="#">‹ 返回生词表</a></p>
        <p class="empty">「${esc(c)}」不在常用汉字表里，暂时没有详情。<a href="https://jisho.org/search/${encodeURIComponent(c)}%20%23kanji" target="_blank" rel="noopener">去 Jisho 查 ▸</a></p>`;
      return;
    }
    const [en, on, kun, strokes, grade, jlpt, paths] = k;
    const comp = rows ? compounds(c, k, rows, mode) : { on: [], kun: [] };
    const modeLink = (m, text) => `<a href="#kanji/${encodeURIComponent(c)}${m ? "/" + m : ""}"${mode === m ? ' class="active"' : ""}>${text}</a>`;
    container.innerHTML = `
      <p class="back"><a href="#">‹ 返回生词表</a></p>
      <div class="kanji-details">
        <div class="kd-left">
          <div class="kd-char" lang="ja">${esc(c)}</div>
          <div class="kd-meta"><b>${strokes}</b> 画</div>
          <div class="kd-anim">
            <svg viewBox="0 0 109 109">${paths.map((d) => `<path class="bg" d="${d}"/>`).join("")}${paths.map((d) => `<path class="anim" d="${d}"/>`).join("")}</svg>
            <button type="button" class="kd-play" aria-label="播放笔顺动画"><svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="26"/><path d="M24 18v24l19-12z"/></svg></button>
          </div>
        </div>
        <div class="kd-main">
          <div class="kd-en" lang="en">${esc(en.join(", "))}</div>
          ${kun.length ? `<div class="kd-readings"><span class="rtype">训：</span><span lang="ja">${readings(kun)}</span></div>` : ""}
          ${on.length ? `<div class="kd-readings"><span class="rtype">音：</span><span lang="ja">${readings(on)}</span></div>` : ""}
          <div class="kd-links">
            ${modeLink("start", `以${esc(c)}开头的词`)}
            ${modeLink("end", `以${esc(c)}结尾的词`)}
            ${modeLink("", `包含${esc(c)}的词`)}
            <a href="https://jisho.org/search/${encodeURIComponent(c)}%20%23kanji" target="_blank" rel="noopener">外部链接</a>
          </div>
        </div>
        <div class="kd-side">
          ${gradeText(grade) ? `<div>${gradeText(grade)}</div>` : ""}
          ${jlpt ? `<div>JLPT <b>N${jlpt}</b></div>` : ""}
        </div>
      </div>
      <h3 class="kd-h">笔顺</h3>
      <div class="stroke-order">${strokeBoxes(paths)}</div>
      <div class="kd-compounds">
        <div><h3 class="kd-h">音读词语</h3>${compoundList(comp.on)}</div>
        <div><h3 class="kd-h">训读词语</h3>${compoundList(comp.kun)}</div>
      </div>`;
    const anim = container.querySelector(".kd-anim svg");
    const btn = container.querySelector(".kd-play");
    btn.addEventListener("click", () => animate(anim, btn));
  }

  root.KanjiPage = { load, render, lightHtml, kanjiOf, link };
})(self);
