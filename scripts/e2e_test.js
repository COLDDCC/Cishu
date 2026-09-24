// 浏览器端到端测试：把页面上所有按钮和交互跑一遍。
// 需要 Playwright：先 `npm run serve`（或任意静态服务器指向 public/），再
//   BASE=http://localhost:8000/ node scripts/e2e_test.js
const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = process.env.BASE || "http://localhost:8000/";
let failed = 0;
const ok = (cond, name, extra = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
};

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => { errors.push("unexpected dialog: " + d.message()); d.dismiss(); });

  const ready = () => page.waitForFunction(() => !document.getElementById("analyze").disabled, null, { timeout: 60000 });
  const analyze = async (text) => {
    await page.fill("#input", text);
    await page.press("#input", "Enter");
    await page.waitForTimeout(150);
  };
  const count = (sel) => page.locator(sel).count();
  // 词条的词形（去掉振假名）
  const heads = () => page.$$eval(".concept .representation", (els) => els.map((e) => {
    const c = e.cloneNode(true);
    c.querySelectorAll("rt").forEach((r) => r.remove());
    return c.textContent.trim();
  }));
  const entryOf = async (word) => page.locator(".concept").nth((await heads()).indexOf(word));

  await page.goto(BASE);
  await ready();
  ok(true, "页面加载、分词器和词典就绪");

  // 分析 + 合并原形
  await analyze("食べた。食べて、また食べる。猫が好き。\n二行目です。");
  const n = await count(".concept");
  ok(n >= 4, "Enter 键分析出词条", `${n} 个`);
  const hs = await heads();
  ok(hs.filter((h) => h === "食べる").length === 1 && !hs.includes("食べ"), "食べた/食べて/食べる 合并成一条原形", hs.join(" "));
  ok((await (await entryOf("食べる")).innerText()).includes("出现 3 次"), "合并后出现次数为 3");
  ok(await count("#sentence ul") === 2, "换行在原文词块条里另起一行");
  ok(await page.inputValue("#input") !== "", "分析后输入框内容保留");

  // 勾掉认识的词
  const before = await count(".concept");
  await page.locator(".concept .know").first().click();
  ok(await count(".concept") === before - 1, "✓ 认识 后词条隐藏");
  ok((await page.innerText("#summary")).includes("1 个已认识"), "标题里显示已认识数量");
  await page.check("#showKnown");
  ok(await count(".concept.known") === 1, "勾「显示已认识的词」能找回来");
  await page.locator(".concept.known .know").click();
  ok(await count(".concept.known") === 0, "撤销认识");
  await page.uncheck("#showKnown");

  // 等级筛选
  await analyze("私は毎日学校へ行きます。政府は予算の削減と措置の維持について妥協した。");
  const all = await count(".concept");
  await page.selectOption("#level", "2");
  const labels = await page.locator(".concept .label").allInnerTexts();
  const shown = await count(".concept");
  ok(shown > 0 && shown < all && !labels.some((l) => /N[345]/.test(l)), "N2 及以上：只剩 N2/N1/无等级的词", `${shown}/${all}`);
  await page.selectOption("#level", "0");
  ok(await count(".concept") === all, "等级改回全部");

  // 排序
  await analyze("猫猫猫。犬犬。鳥。");
  await page.selectOption("#sort", "count");
  ok((await heads())[0] === "猫", "按出现次数排序：猫排第一", (await heads()).join(" "));
  await page.selectOption("#sort", "order");

  // 振假名
  await page.uncheck("#furigana");
  ok(await page.evaluate(() => document.body.classList.contains("no-furigana")), "隐藏振假名");
  const rtVis = await page.locator("#sentence rt").first().evaluate((e) => getComputedStyle(e).visibility);
  ok(rtVis === "hidden", "原文里的振假名被隐藏");
  await page.check("#furigana");

  // 导出
  await page.click("#export");
  ok(await page.locator("#exportDialog").evaluate((d) => d.open), "导出对话框打开");
  const txt = await page.inputValue("#exportText");
  ok(txt.split("\n").length === await count(".concept"), "导出行数 = 词条数");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#downloadCsv")]);
  const csvPath = await dl.path();
  const csv = fs.readFileSync(csvPath, "utf8");
  ok(csv.charCodeAt(0) === 0xfeff && csv.includes("词,读音,词性,JLPT,释义,出现次数"), "CSV 带 BOM 和表头");
  await page.click("#exportDialog button[value=close]");

  // 例文、文件（UTF-8 BOM / Shift-JIS）
  await page.click("#sampleBtn");
  await page.waitForTimeout(150);
  ok((await page.inputValue("#input")).startsWith("吾輩は猫"), "例文按钮");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cishu-"));
  const sjis = path.join(tmp, "sjis.txt");
  fs.writeFileSync(sjis, Buffer.from([0x8c, 0xe1, 0x94, 0x79, 0x82, 0xcd, 0x94, 0x4c])); // 吾輩は猫（Shift-JIS）
  await page.setInputFiles("#fileInput", sjis);
  await page.waitForTimeout(300);
  ok(await page.inputValue("#input") === "吾輩は猫", "打开 Shift-JIS 编码的 txt 不乱码");
  const bom = path.join(tmp, "bom.txt");
  fs.writeFileSync(bom, "﻿猫が好き");
  await page.setInputFiles("#fileInput", bom);
  await page.waitForTimeout(300);
  ok(await page.inputValue("#input") === "猫が好き", "UTF-8（带 BOM）txt 正常，BOM 被去掉");

  // 点原文里的词：高亮 + 侧栏汉字卡片
  await analyze("必要なときは言ってください。");
  await page.locator("#sentence a[data-key]").first().click();
  ok(await count(".concept.current") === 1, "点原文里的词：对应词条高亮");
  await page.waitForSelector(".kanji-light", { timeout: 10000 });
  ok(await count(".kanji-light") === 2, "侧栏显示「必要」的两个汉字卡片");

  // 汉字详情页
  await page.locator(".status-link a[href^='#kanji/']").first().click();
  await page.waitForSelector(".stroke-order");
  ok(await page.locator("#mainColumns").isHidden(), "进入汉字页时隐藏生词表");
  const strokes = await count(".stroke-box");
  ok(strokes === 5, "「必」笔顺 5 格", String(strokes));
  await page.click(".kd-play");
  ok(await page.locator(".kd-play").isHidden(), "播放笔顺动画");
  await page.click(".kd-links a:has-text('开头')");
  await page.waitForTimeout(200);
  const comps = await page.locator(".compounds li").allInnerTexts();
  ok(comps.length > 0 && comps.every((c) => c.startsWith("必")), "「以必开头的词」筛选", `${comps.length} 条`);
  await page.fill("#input", "猫が好き");
  await page.press("#input", "Enter");
  await page.waitForTimeout(200);
  ok(await page.locator("#kanjiView").isHidden() && await count(".concept") > 0, "在汉字页里按 Enter：回到生词表并显示结果");
  await page.evaluate(() => { location.hash = "#kanji/%E0"; });
  await page.waitForTimeout(200);
  ok(!errors.some((e) => /URI/.test(e)), "畸形的 #kanji/ 地址不报错");
  await page.evaluate(() => { location.hash = "#kanji/" + encodeURIComponent("龘"); });
  await page.waitForTimeout(300);
  ok((await page.innerText("#kanjiView")).includes("不在常用汉字表里"), "非常用汉字给出提示");
  await page.click("#kanjiView .back a");
  await page.waitForTimeout(200);
  ok(await page.locator("#mainColumns").isVisible(), "返回生词表");

  // 输入内容不能被当成 HTML 执行
  await analyze('<img src=x onerror="alert(1)">猫<script>alert(2)</script>');
  ok(await count("#sentence img, #results img, #sentence script") === 0, "输入里的 HTML 被转义");

  // 主题
  await page.click("#themeBtn");
  ok(await page.evaluate(() => document.documentElement.dataset.theme) === "light", "主题：自动 → 浅色");
  await page.click("#themeBtn");
  ok(await page.evaluate(() => document.documentElement.dataset.theme) === "dark", "主题：浅色 → 深色");
  await page.reload();
  await ready();
  ok(await page.evaluate(() => document.documentElement.dataset.theme) === "dark", "刷新后记住主题");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bg !== "rgb(255, 255, 255)", "深色主题背景不是白色", bg);
  await page.click("#themeBtn");
  ok(await page.evaluate(() => !("theme" in document.documentElement.dataset)), "主题：深色 → 自动");
  ok((await page.inputValue("#input")).length > 0 && await count(".concept") > 0, "刷新后恢复上次输入并自动分析");

  // 清空
  await page.click("#clear");
  ok(await count(".concept") === 0 && await page.locator("#toolbar").isHidden(), "清空");

  // 手机宽度不横向滚动
  await page.setViewportSize({ width: 375, height: 800 });
  await analyze("夢ならばどれほどよかったでしょう。未だにあなたのことを夢にみる。");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 0, "手机宽度下没有横向滚动", `溢出 ${overflow}px`);
  await page.evaluate(() => { location.hash = "#kanji/" + encodeURIComponent("夢"); });
  await page.waitForSelector(".stroke-order");
  const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow2 <= 0, "手机宽度下汉字页没有横向滚动", `溢出 ${overflow2}px`);

  ok(errors.length === 0, "全程没有脚本错误", errors.join(" | "));
  await browser.close();
  console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
  process.exit(failed ? 1 : 0);
})();
