"""生成浏览器用的词典 public/dict/dict.json。

数据来源（见 README 的「数据来源与许可」）：
  data-src/kotobako-static.json  JMdict 常用词子集（CC BY-SA 4.0），由 scripts/fetch_sources.sh 下载
  data-src/ja-zh-thesaurus.json  lxl66566/Japanese-Chinese-thesaurus（Unlicense）中文释义
  data-src/n1.csv … n5.csv       jamsinclair/open-anki-jlpt-decks（MIT）JLPT 等级
  data-src/zh-extra.tsv          本项目补译的中文释义（词\t读音\t释义[\t词性]），也可新增词条

另输出 public/dict/kanji.json（汉字详情页，按需加载）。
输出每条为数组：[词形, 其他写法(|分隔), 读音(平假名), 词性, JLPT(0-5, 0=无), 中文释义, 英文释义]
用法：python3 scripts/build_dict.py [--missing 输出缺中文释义的词表路径]
"""
import argparse
import csv
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
import zh_thesaurus  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data-src")
OUT = os.path.join(ROOT, "public", "dict", "dict.json")

POS_ZH = {
    "noun": "名词",
    "suru verb": "サ变动词",
    "vs-s": "サ变动词",
    "vs-c": "サ变动词",
    "vz": "サ变动词",
    "godan verb": "五段动词",
    "v5aru": "五段动词",
    "ichidan verb": "一段动词",
    "v1-s": "一段动词",
    "kuru verb": "カ变动词",
    "transitive verb": "他动词",
    "intransitive verb": "自动词",
    "i-adjective": "い形容词",
    "adj-ix": "い形容词",
    "adj-ku": "い形容词",
    "na-adjective": "な形容词",
    "no-adjective": "の形容词",
    "taru-adjective": "タルト形容词",
    "adj-f": "连体修饰",
    "adj-pn": "连体词",
    "adverb": "副词",
    "adverb (to)": "副词(と)",
    "expression": "惯用语",
    "interjection": "感叹词",
    "conjunction": "接续词",
    "particle": "助词",
    "suffix": "后缀",
    "n-suf": "后缀",
    "prefix": "前缀",
    "n-pref": "前缀",
    "pronoun": "代词",
    "numeric": "数词",
    "counter": "量词",
    "auxiliary verb": "助动词",
    "aux": "助动词",
    "aux-adj": "助动词",
    "cop": "判断词",
    "v2a-s": "动词",
}


def kata_to_hira(s):
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


def is_kana(s):
    return bool(re.fullmatch(r"[぀-ヿー]+", s))


def pos_zh(pos):
    if not pos:
        return ""
    out = []
    for p in pos.split(" · "):
        z = POS_ZH.get(p.strip())
        if z and z not in out:
            out.append(z)
    return "·".join(out)


def split_forms(expr):
    expr = re.sub(r"\s*[(（][^)）]*[)）]", "", expr)  # 去掉「(かん)」「(な)」之类的注释
    return [f.strip() for f in re.split(r"[;；,、]", expr) if f.strip() and not re.search(r"[～〜]", f)]


def load_jlpt():
    """返回 {(词形, 读音): 等级}，同一词取最简单的等级。"""
    lv = {}
    extra = []
    for n in (5, 4, 3, 2, 1):
        with open(os.path.join(SRC, f"n{n}.csv"), encoding="utf-8") as f:
            for row in csv.DictReader(f):
                forms = split_forms(row["expression"])
                readings = [kata_to_hira(r) for r in split_forms(row["reading"])]
                if not forms:
                    continue
                for fm in forms:
                    for r in readings:
                        lv.setdefault((fm, r), n)
                extra.append((forms, readings, n, row["meaning"]))
    return lv, extra


def load_extra_zh():
    """返回 ({(词形, 读音): 释义}, [(词形列表, 读音, 释义, 词性)])。"""
    path = os.path.join(SRC, "zh-extra.tsv")
    out = {}
    rows = []
    if not os.path.exists(path):
        return out, rows
    with open(path, encoding="utf-8") as f:
        for line in f:
            if not line.strip() or line.startswith("#"):
                continue
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3 or not parts[2].strip():
                continue
            forms = [f for fm in parts[0].split("|") for f in (split_forms(fm) or [fm.strip()]) if f]
            reading = kata_to_hira((split_forms(parts[1]) or [parts[1].strip()])[0])
            for fm in forms:
                out[(fm, reading)] = parts[2].strip()
            rows.append((forms, reading, parts[2].strip(), parts[3].strip() if len(parts) > 3 else ""))
    return out, rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--missing", help="把缺中文释义的词写到这个 TSV")
    args = ap.parse_args()

    vocab = json.load(open(os.path.join(SRC, "kotobako-static.json"), encoding="utf-8"))["datasets"]["vocab"]
    zh = zh_thesaurus.load(os.path.join(SRC, "ja-zh-thesaurus.json"))
    extra_zh, extra_rows = load_extra_zh()
    jlpt, jlpt_rows = load_jlpt()

    entries = []  # dict: forms, reading, pos, jlpt, en
    seen = {}
    for v in vocab:
        # 个别条目的词形写成「いい; よい」，拆成多个写法
        forms = split_forms(v["word"]) or [v["word"]]
        if v.get("altWord"):
            forms += [f for f in split_forms(v["altWord"]) if f not in forms]
        reading = kata_to_hira((split_forms(v["reading"]) or [v["reading"]])[0])
        key = (forms[0], reading)
        if key in seen:
            continue
        e = {"forms": forms, "reading": reading, "pos": pos_zh(v.get("pos")),
             "jlpt": int(v["jlpt"][1]) if v.get("jlpt") else 0,
             "en": "; ".join(v["meanings"][:4])}
        seen[key] = e
        entries.append(e)

    # JLPT 表里有但 JMdict 常用词里没有的，补进来
    index = {}
    for e in entries:
        for fm in e["forms"]:
            index.setdefault((fm, e["reading"]), e)
    for forms, readings, n, meaning in jlpt_rows:
        hit = None
        for fm in forms:
            for r in readings:
                hit = hit or index.get((fm, r))
        if hit is None:
            hit = {"forms": forms, "reading": readings[0] if readings else forms[0],
                   "pos": "", "jlpt": 0, "en": meaning}
            entries.append(hit)
            for fm in forms:
                for r in readings:
                    index.setdefault((fm, r), hit)
        else:
            for fm in forms:
                if fm not in hit["forms"]:
                    hit["forms"].append(fm)
        if not hit["jlpt"] or n > hit["jlpt"]:
            hit["jlpt"] = n  # 5=N5 最简单，取最简单的那档

    # zh-extra.tsv 里 JMdict 常用词没有的词（口语、网络用语等）作为新词条加入
    for forms, reading, _, pos in extra_rows:
        hit = next((index[(fm, reading)] for fm in forms if (fm, reading) in index), None)
        if hit:  # 已有词条：补上新写法（如「ヤバ」）
            for fm in forms:
                if fm not in hit["forms"]:
                    hit["forms"].append(fm)
                    index[(fm, reading)] = hit
        else:
            e = {"forms": forms, "reading": reading, "pos": pos, "jlpt": 0, "en": ""}
            entries.append(e)
            for fm in forms:
                index[(fm, reading)] = e

    missing = []
    out = []
    for e in entries:
        r = e["reading"]
        gloss = None
        for fm in e["forms"]:
            if (fm, r) in extra_zh:
                gloss = extra_zh[(fm, r)]
                break
        if gloss is None:
            cands = []
            for fm in e["forms"]:
                for zr, g, from_masu in zh.get(fm, []):
                    if zr is None or kata_to_hira(zr) == r:
                        cands.append((not from_masu, len(g), g))
            if cands:
                # 优先辞书形条目，其次取最长的（一般信息最全）
                gloss = max(cands)[2]
        if gloss is None:
            missing.append(e)
        out.append([e["forms"][0], "|".join(e["forms"][1:]), r, e["pos"], e["jlpt"], gloss or "", e["en"]])

    out.sort(key=lambda x: (-x[4] if x[4] else 0, x[2]))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    have = sum(1 for x in out if x[5])
    print(f"entries={len(out)} zh={have} missing={len(missing)} "
          f"jlpt_missing={sum(1 for e in missing if e['jlpt'])} -> {OUT} ({os.path.getsize(OUT)//1024} KB)")

    # 汉字详情页用：常用汉字的英文意思、音训读、笔画、年级、JLPT、笔顺路径（KanjiVG）
    kanji = {}
    for k in json.load(open(os.path.join(SRC, "kotobako-static.json"), encoding="utf-8"))["datasets"]["kanji"]:
        kanji[k["char"]] = [k["meanings"], k["onyomi"], k["kunyomi"], k["strokeCount"], k["grade"] or 0,
                            int(k["jlpt"][1]) if k.get("jlpt") else 0, k["strokes"]]
    kout = os.path.join(os.path.dirname(OUT), "kanji.json")
    with open(kout, "w", encoding="utf-8") as f:
        json.dump(kanji, f, ensure_ascii=False, separators=(",", ":"))
    print(f"kanji={len(kanji)} -> {kout} ({os.path.getsize(kout)//1024} KB)")

    if args.missing:
        missing.sort(key=lambda e: (-(e["jlpt"] or 0), e["reading"]))
        with open(args.missing, "w", encoding="utf-8") as f:
            for e in missing:
                f.write(f"{'|'.join(e['forms'])}\t{e['reading']}\t{e['pos']}\t{e['jlpt']}\t{e['en']}\n")


if __name__ == "__main__":
    main()
