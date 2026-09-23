"""解析 lxl66566/Japanese-Chinese-thesaurus 的 final.json。

原始值格式很杂，例如：
  （たべる）②【他动2】吃
  (そうい0) 名词 不同，相异
  (あたります4) 动1 【自】中（彩），抽中
  ①【副·自动3】潮湿，湿润
返回 {词: [(读音 or None, 中文释义, 是否由ます形还原), ...]}，并把「～ます」形还原成辞书形。
"""
import json
import re

KANA = r"぀-ヿー"
PITCH = "⓪①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬"

HEAD_RE = re.compile(r"^[\(（]([^)）]*)[\)）]\s*")
POS_WORDS = [
    "连接词", "接续助词", "终助词", "副助词", "格助词", "名词", "动1", "动2", "动3", "动词", "形容词", "形容动词", "一类形", "二类形",
    "副词", "连体词", "接续词", "感叹词", "惯用语", "代词", "数词", "助词",
    "助数词", "接尾词", "接头词", "疑问词", "词组", "量词", "连语", "叹词",
]

# 五段动词 い段→う段
I_TO_U = dict(zip("いきぎしちにびみり", "うくぐすつぬぶむる"))


def _strip_pos(s):
    s = s.strip()
    changed = True
    pos = ""
    while changed:
        changed = False
        s = s.lstrip(PITCH + "0123456789 　")
        m = re.match(r"^【([^】]*)】", s)
        if m:
            pos += m.group(1)
            s = s[m.end():]
            changed = True
            continue
        for w in POS_WORDS:
            if s.startswith(w):
                pos += w
                s = s[len(w):]
                changed = True
                break
    return pos, s.strip(" 　:：")


def masu_to_dict(word, reading, pos):
    """当たります -> 当たる。无法确定时返回 None。"""
    if not word.endswith("ます"):
        return None
    stem = word[:-2]
    rstem = reading[:-2] if reading and reading.endswith("ます") else None
    if not stem:
        return None
    if stem.endswith("し") and ("3" in pos or "する" in pos or stem == "し"):
        return stem[:-1] + "する", (rstem[:-1] + "する" if rstem else None)
    if stem in ("来", "き"):
        return stem + "る", (rstem + "る" if rstem else None)
    if "2" in pos:
        return stem + "る", (rstem + "る" if rstem else None)
    if "1" in pos and stem[-1] in I_TO_U:
        u = I_TO_U[stem[-1]]
        return stem[:-1] + u, (rstem[:-1] + u if rstem and rstem[-1] in I_TO_U else None)
    return None


def load(path):
    raw = json.load(open(path, encoding="utf-8"))
    out = {}
    for key, val in raw.items():
        word = key.strip()
        if not word or word.startswith(("(", "（", "[")) or re.search(r"[～~/／]", word):
            continue  # 语法条目，跳过
        val = val.strip()
        reading = None
        m = HEAD_RE.match(val)
        if m:
            inner = m.group(1).strip()
            inner = re.sub(r"[0-9" + PITCH + r"]+$", "", inner).strip()
            if re.fullmatch(r"[" + KANA + r"・]+", inner):
                reading = inner.replace("・", "")
            val = val[m.end():]
        pos, gloss = _strip_pos(val)
        gloss = re.sub(r"^(?:名|形[12]?|动[123]?|副|连体|接续|叹)\s+", "", gloss)  # 残留的词性缩写「形1 热乎」
        gloss = re.sub(r"［[^］]*］", "", gloss)  # 去掉「［コーヒーが～］」这类例句
        gloss = re.sub(r"\s+", " ", gloss).strip()
        if not gloss:
            continue
        if re.fullmatch(r"[" + KANA + r"]+", word) and reading is None:
            reading = word
        conv = masu_to_dict(word, reading, pos)
        if conv:
            word, reading = conv
        # 第三项：是否由「～ます」形还原而来（这类释义往往只对应教材里的某个用法，优先级低）
        out.setdefault(word, []).append((reading, gloss, bool(conv)))
    return out


if __name__ == "__main__":
    import sys
    d = load(sys.argv[1])
    print(len(d))
    for w in ["食べる", "当たる", "包む", "通う", "相違", "じめじめ", "日光", "幸せ", "勉強する"]:
        print(w, d.get(w))
