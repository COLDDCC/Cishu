# 词书 Cishu

Jisho 的中文版：粘贴任意日文（小说、吐槽、歌词、新闻都行），下面列出里面所有的词：读音、原形、中文释义、JLPT 等级。

- **纯静态网页**：分词（kuromoji.js）和查词都在浏览器里完成，不上传任何内容，零服务器、零运营成本。
- **同一个词多次出现合并成一条原形**（食べた／食べて → 食べる），并显示原文里出现过的写法和次数。
- 布局暂时照着 Jisho：左边词形＋振假名＋标签，右边词性＋释义。

## 按钮（第一批）

| 按钮 | 作用 |
| --- | --- |
| ✓ 认识 | 勾掉认识的词。记在浏览器本地（localStorage），下次粘贴别的文章也会自动隐藏。勾「显示已认识的词」可以找回来撤销。 |
| 等级 | 只看某个 JLPT 等级及以上。例如「N3 及以上」= N3、N2、N1，以及没有 JLPT 等级的词（通常比 N1 更少见，所以也算在内）。 |
| 振假名 | 显示／隐藏振假名（原文和词表同时生效）。 |
| 导出生词表 | 导出当前显示的词（已应用筛选、不含认识的词），可复制、下载 CSV（Excel／Anki 可直接导入，带 BOM）或 TXT。 |

另外还有「排序」（出现顺序／出现次数／难度），点原文里的词会跳到对应词条。

## 本地运行

```bash
npm run serve        # 然后打开 http://localhost:8000
```

必须通过 HTTP 访问（直接双击 index.html 打不开词典文件）。

## 部署

`public/` 目录就是整个网站，丢到任何静态托管都行。仓库自带 GitHub Actions（`.github/workflows/pages.yml`）：推到 `main` 分支后自动发布到 GitHub Pages（需要在仓库 Settings → Pages 里把 Source 设为 GitHub Actions）。

> 注意：`public/vendor/kuromoji-dict/*.dat.gz` 必须按普通文件原样返回。如果托管服务给 `.gz` 文件加 `Content-Encoding: gzip` 头，浏览器会提前解压，分词器就会加载失败。GitHub Pages、Netlify、Vercel 默认都没问题。

## 目录

```
public/                 网站本体
  index.html
  css/style.css
  js/analyzer.js        分词结果 → 去重词表、查词、振假名对齐（浏览器和 Node 共用）
  js/app.js             页面交互：按钮、筛选、导出
  dict/dict.json        预先生成的中文词典（约 2.4 MB，传输时 gzip 后更小）
  vendor/               kuromoji.js 及其 IPADIC 词典
scripts/
  build_dict.py         合并各数据源 → public/dict/dict.json
  zh_thesaurus.py       解析日中词库的杂乱格式
  fetch_sources.sh      下载不放进仓库的大文件（JMdict 常用词子集）
  smoke_test.js         Node 里跑一遍分词+查词
data-src/               词典源数据
```

## 重新生成词典

```bash
npm install                 # 只有 smoke_test 需要（kuromoji）
npm run fetch               # 下载 data-src/kotobako-static.json
npm run build:dict          # 生成 public/dict/dict.json
npm test                    # 看看分词和释义对不对
```

`python3 scripts/build_dict.py --missing 缺释义.tsv` 会列出还没有中文释义的词。补好的释义按「词形⇥读音⇥释义」一行一条写进 `data-src/zh-extra.tsv`，重新 build 即可（优先级最高，也可以用来改正现有释义）。

## 数据来源与许可

| 数据 | 来源 | 许可 |
| --- | --- | --- |
| 分词器及 IPADIC 词典 | [kuromoji.js](https://github.com/takuyaa/kuromoji.js) | Apache-2.0（见 `public/vendor/kuromoji-NOTICE.md`） |
| 词条、读音、词性、英文释义 | [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) 常用词子集，经 npm 包 `kotobako-data` | CC BY-SA 4.0（EDRDG） |
| 中文释义 | [lxl66566/Japanese-Chinese-thesaurus](https://github.com/lxl66566/Japanese-Chinese-thesaurus) | Unlicense（公有领域） |
| 中文释义（补充） | 本项目补译，`data-src/zh-extra.tsv` | 随 `dict.json` 按 CC BY-SA 4.0 发布 |
| JLPT 等级 | [jamsinclair/open-anki-jlpt-decks](https://github.com/jamsinclair/open-anki-jlpt-decks) | MIT；JLPT 官方已不公布词表，等级仅供参考 |

由于 `public/dict/dict.json` 含 JMdict 数据，该文件按 CC BY-SA 4.0 发布；其余代码 MIT。

## 已知限制

- 中文释义覆盖 JMdict 常用词约 2.4 万条；不在其中的词（生僻词、人名、新词）会显示英文释义或「未收录」，并提供 Jisho／Weblio 链接。
- 补译部分由 AI 辅助翻译，可能有不准确的地方，发现了可以直接改 `zh-extra.tsv`。
- 分词基于 IPADIC，网络用语、口语缩略可能切得不理想。
