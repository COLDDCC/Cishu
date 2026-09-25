"""把 public/index.html 转成 claude.ai Artifact 用的页面（发布时平台会自己包一层 <html><head><body>）。

Artifact 里浏览器不允许下载文件、也读不了剪贴板，所以隐藏「下载 CSV/TXT」和「粘贴」按钮
（导出对话框里的「复制」「复制 CSV」照常可用，输入框里直接 Ctrl+V 也照常可用）。
输出：artifact/index.html 和 artifact/kuromoji-dict/*.b64.txt（其余文件直接用 public/ 下的原文件发布）
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, "public", "index.html"), encoding="utf-8").read()

head = re.search(r"<head>(.*?)</head>", src, re.S).group(1)
body = re.search(r"<body>(.*?)</body>", src, re.S).group(1)
head = re.sub(r'\s*<meta charset="utf-8">|\s*<meta name="viewport"[^>]*>', "", head)
title = re.search(r"<title>.*?</title>", head, re.S).group(0)
head = head.replace(title, "")

body = body.replace('<a href="./">', '<a href="#">')
out = title + "\n" + head.strip() + """
<style>#downloadCsv, #downloadTxt, #pasteBtn { display: none !important; }</style>
<script>self.CISHU_DICT_SUFFIX = ".b64.txt";</script>
""" + body.strip() + "\n"

os.makedirs(os.path.join(ROOT, "artifact"), exist_ok=True)
with open(os.path.join(ROOT, "artifact", "index.html"), "w", encoding="utf-8") as f:
    f.write(out)
print("ok: artifact/index.html", len(out), "bytes")

# Artifact 不接受 .gz 文件：分词词典转成 base64 文本（kuromoji.js 里读到 CISHU_DICT_SUFFIX 会自动解码）
import base64
import glob
dic_dir = os.path.join(ROOT, "artifact", "kuromoji-dict")
os.makedirs(dic_dir, exist_ok=True)
for path in glob.glob(os.path.join(ROOT, "public", "vendor", "kuromoji-dict", "*.dat.gz")):
    with open(path, "rb") as f, open(os.path.join(dic_dir, os.path.basename(path) + ".b64.txt"), "w") as g:
        g.write(base64.b64encode(f.read()).decode())
print("ok: artifact/kuromoji-dict/*.b64.txt")
