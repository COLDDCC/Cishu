// 分词结果 → 词表。浏览器和 Node（测试）共用。
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Analyzer = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // dict.json 每条：[词形, 其他写法(|分隔), 读音, 词性, JLPT(0-5), 中文, 英文]
  const F = { WORD: 0, ALT: 1, READING: 2, POS: 3, JLPT: 4, ZH: 5, EN: 6 };

  const KANJI_RE = /[㐀-鿿豈-﫿々〆ヵヶ]/;
  const KANA_ONLY_RE = /^[぀-ヿー]+$/;

  function kataToHira(s) {
    return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  }
  const hasKanji = (s) => KANJI_RE.test(s);
  const isKana = (s) => KANA_ONLY_RE.test(s);

  class Dictionary {
    constructor(rows) {
      this.rows = rows;
      this.byForm = new Map();
      this.byReading = new Map();
      rows.forEach((r, i) => {
        const forms = [r[F.WORD]].concat(r[F.ALT] ? r[F.ALT].split("|") : []);
        for (const f of forms) push(this.byForm, f, i);
        push(this.byReading, r[F.READING], i);
      });
    }

    // 给分词得到的原形找词条；reading 为原形的平假名读音（可能为空）
    lookup(base, reading) {
      const score = (i) => {
        const r = this.rows[i];
        let s = 0;
        if (reading && r[F.READING] === reading) s += 100;
        if (r[F.ZH]) s += 10;
        if (r[F.JLPT]) s += 5 + r[F.JLPT];
        return s;
      };
      const best = (ids) => ids.slice().sort((a, b) => score(b) - score(a))[0];

      let ids = this.byForm.get(base);
      if (ids) return best(ids);

      if (isKana(base)) {
        ids = this.byReading.get(kataToHira(base));
        if (ids) return best(ids);
        return -1;
      }
      // 写法不同（如「終る」对「終わる」）：同读音且共享汉字
      if (reading) {
        ids = (this.byReading.get(reading) || []).filter((i) => {
          const w = this.rows[i][F.WORD] + (this.rows[i][F.ALT] || "");
          return [...base].some((c) => hasKanji(c) && w.includes(c));
        });
        if (ids.length) return best(ids);
      }
      return -1;
    }
  }

  function push(map, k, v) {
    const a = map.get(k);
    if (a) a.push(v);
    else map.set(k, [v]);
  }

  // 不进入词表的词性
  function skipToken(t) {
    if (t.merged) return false;
    const p = t.pos, d1 = t.pos_detail_1, d2 = t.pos_detail_2;
    if (p === "記号" || p === "助詞" || p === "助動詞" || p === "フィラー" || p === "その他") return true;
    if (d1 === "数" || (d1 === "接尾" && p === "動詞")) return true;
    if (d1 === "非自立") {
      // わけ・はず・ところ・こと・もの・まま 这类非自立名词对学习者很重要，保留；
      // の・ん 和「よう・そう・みたい」这种助动词词干是语法成分，跳过；非自立的动词/形容词（ている的いる等）也跳过
      if (p !== "名詞" || d2 === "助動詞語幹" || t.surface_form === "の" || t.surface_form === "ん") return true;
    }
    if (!/[぀-ヿ㐀-鿿々]/.test(t.surface_form)) return true; // 纯英数、空白
    return false;
  }

  // 用分词器求原形的读音（缓存）
  function makeBaseReader(tokenizer) {
    const cache = new Map();
    return function baseReading(t) {
      const base = t.basic_form && t.basic_form !== "*" ? t.basic_form : t.surface_form;
      if (t.merged && base !== t.surface_form) return "";
      if (base === t.surface_form && t.reading) return kataToHira(t.reading);
      if (isKana(base)) return kataToHira(base);
      if (cache.has(base)) return cache.get(base);
      const toks = tokenizer.tokenize(base);
      let r = toks.every((x) => x.reading) ? kataToHira(toks.map((x) => x.reading).join("")) : "";
      cache.set(base, r);
      return r;
    };
  }

  // 相邻 2～3 个词拼起来是词典里的词就合并（分词器会把「とんでもない」切成「とんでも」+「ない」）。
  // 先试原文原样拼接，再试「前面原样 + 最后一个词的原形」（落ち着き+ました 这类不会命中，因为结尾是助动词）。
  const NO_MERGE_POS = new Set(["記号", "助詞", "助動詞", "フィラー", "その他"]);
  function mergeTokens(tokens, dict) {
    const out = [];
    for (let i = 0; i < tokens.length; i++) {
      let merged = null;
      // 第一个词不能是助词/助动词/数字/非自立成分（否则「上げてしまった」会被合成感叹词「しまった」）
      if (!NO_MERGE_POS.has(tokens[i].pos) && tokens[i].pos_detail_1 !== "数" && tokens[i].pos_detail_1 !== "非自立") {
        for (let len = 3; len >= 2 && !merged; len--) {
          const span = tokens.slice(i, i + len);
          if (span.length < len || span.some((t) => t.pos === "記号" || !t.surface_form.trim())) continue;
          // 中间夹助词的不合并（「雨が降る」应拆成 雨 / 降る），助词只允许在最后（こちらこそ、何でも）
          if (span.slice(1, -1).some((t) => t.pos === "助詞" || t.pos === "助動詞")) continue;
          const surface = span.map((t) => t.surface_form).join("");
          const last = span[len - 1];
          const lastBase = last.basic_form && last.basic_form !== "*" ? last.basic_form : last.surface_form;
          const base = span.slice(0, -1).map((t) => t.surface_form).join("") + lastBase;
          const hit = dict.byForm.has(surface) ? surface : (last.pos !== "助動詞" && last.pos !== "助詞" && dict.byForm.has(base)) ? base : null;
          if (hit) {
            merged = {
              surface_form: surface, basic_form: hit, merged: true,
              reading: span.every((t) => t.reading) ? span.map((t) => t.reading).join("") : "",
              pos: span[0].pos, pos_detail_1: "", pos_detail_2: "",
            };
            i += len - 1;
          }
        }
      }
      out.push(merged || tokens[i]);
    }
    return out;
  }

  // 主函数：文本 → { tokens: 原文分段, words: 去重后的词表 }
  function analyze(text, tokenizer, dict) {
    const baseReading = makeBaseReader(tokenizer);
    const tokens = mergeTokens(tokenizer.tokenize(text), dict);
    const words = new Map();
    const segs = [];

    for (const t of tokens) {
      const seg = { surface: t.surface_form, reading: t.reading ? kataToHira(t.reading) : "", key: null };
      segs.push(seg);
      if (skipToken(t)) continue;

      const base = t.basic_form && t.basic_form !== "*" ? t.basic_form : t.surface_form;
      const reading = baseReading(t);
      const idx = dict.lookup(base, reading);
      const key = idx >= 0 ? "#" + idx : base + "|" + reading;
      seg.key = key;

      let w = words.get(key);
      if (!w) {
        const row = idx >= 0 ? dict.rows[idx] : null;
        w = {
          key,
          order: words.size,
          word: row ? pickForm(row, base) : base,
          reading: row ? row[F.READING] : reading,
          otherForms: row ? formsOf(row).filter((f) => f !== pickForm(row, base)) : [],
          pos: row && row[F.POS] ? row[F.POS] : posZh(t),
          jlpt: row ? row[F.JLPT] : 0,
          zh: row ? row[F.ZH] : "",
          en: row ? row[F.EN] : "",
          proper: t.pos_detail_1 === "固有名詞",
          found: !!row,
          count: 0,
          surfaces: [],
        };
        words.set(key, w);
      }
      w.count++;
      if (!w.surfaces.includes(t.surface_form)) w.surfaces.push(t.surface_form);
    }
    return { segments: segs, words: [...words.values()] };
  }

  function formsOf(row) {
    return [row[F.WORD]].concat(row[F.ALT] ? row[F.ALT].split("|") : []);
  }

  // 词条主写法是假名、原文用了汉字时，优先显示原文的写法（すごい → 凄い）
  function pickForm(row, base) {
    const forms = formsOf(row);
    return forms.includes(base) ? base : forms[0];
  }

  const POS_MAP = {
    名詞: "名词", 動詞: "动词", 形容詞: "い形容词", 副詞: "副词", 連体詞: "连体词",
    接続詞: "接续词", 感動詞: "感叹词", 接頭詞: "前缀",
  };
  function posZh(t) {
    if (t.pos_detail_1 === "固有名詞") return "专有名词";
    if (t.pos === "名詞" && t.pos_detail_1 === "形容動詞語幹") return "な形容词";
    return POS_MAP[t.pos] || t.pos;
  }

  // 注音对齐：食べる/たべる → [["食","た"],["べる",""]]
  function furigana(word, reading) {
    if (!reading || !hasKanji(word)) return [[word, ""]];
    const parts = word.match(/[㐀-鿿豈-﫿々〆ヵヶ]+|[^㐀-鿿豈-﫿々〆ヵヶ]+/g);
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      "^" + parts.map((p) => (hasKanji(p) ? "(.+?)" : "(" + esc(kataToHira(p)) + ")")).join("") + "$"
    );
    const m = kataToHira(reading).match(re);
    if (!m) return [[word, reading]];
    return parts.map((p, i) => (hasKanji(p) ? [p, m[i + 1]] : [p, ""]));
  }

  return { Dictionary, analyze, furigana, kataToHira, hasKanji, F };
});
