// 在 Node 里跑一遍分词+查词，检查词表是否合理。用法：node scripts/smoke_test.js ["日文"]
const path = require("path");
const kuromoji = require("kuromoji");
const A = require("../public/js/analyzer.js");
const rows = require("../public/dict/dict.json");

const text =
  process.argv[2] ||
  "吾輩は猫である。名前はまだ無い。やっぱり凄いと思ったけど、昨日は勉強していなかった。" +
    "彼女は駅で電車を待っている。終わったら、美味しいラーメンを食べに行こう！";

kuromoji.builder({ dicPath: path.join(__dirname, "../public/vendor/kuromoji-dict") }).build((err, tk) => {
  if (err) throw err;
  const dict = new A.Dictionary(rows);
  const { words } = A.analyze(text, tk, dict);
  let miss = 0;
  for (const w of words) {
    if (!w.zh) miss++;
    console.log(
      [w.word, w.reading, w.pos, w.jlpt ? "N" + w.jlpt : "-", "×" + w.count, w.surfaces.join("/"), w.zh || "(英)" + w.en]
        .join("\t")
    );
  }
  console.log(`\n${words.length} 词，缺中文 ${miss}`);
  console.log(JSON.stringify(A.furigana("食べる", "たべる")), JSON.stringify(A.furigana("お見舞い", "おみまい")));
});
