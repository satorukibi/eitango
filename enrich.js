#!/usr/bin/env node
// ============================================================
// enrich.js — 英単語データ一括リッチ化スクリプト
// ------------------------------------------------------------
// words.js / words_extra.js / words_extra2.js の各エントリに
//   - etym（語源 or コアイメージ）を追加
//   - 必要なら ex / exJa（例文）を書き直し
// を Anthropic API（既定: Haiku）でバッチ処理する。
//
// 使い方:
//   export ANTHROPIC_API_KEY=sk-ant-...
//   node enrich.js words_extra.js                 # etym追加のみ
//   node enrich.js words_extra.js --rewrite-ex    # 例文も書き直す
//   node enrich.js words.js --dry-run             # API呼ばず対象を確認
//
// 出力: 元ファイルは触らず words_extra.enriched.js を生成。
//       中身を確認して問題なければ元ファイルに上書きする。
//
// 再実行可能: etym が既にある行はスキップするので、
//       途中で止めても .enriched.js を入力にして続きから再開できる。
// ============================================================

const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ---------------- 設定 ----------------
const MODEL = "claude-haiku-4-5-20251001"; // 品質を上げたい場合は "claude-sonnet-4-6"
const BATCH_SIZE = 15;      // 1リクエストあたりの単語数
const MAX_TOKENS = 4000;
const API_URL = "https://api.anthropic.com/v1/messages";

// トーンの見本（このスタイルに寄せて生成される。自由に差し替え可）
const STYLE_EXAMPLES = `
【語源の見本（ニュース・技術系の単語）】
- algorithm → "9世紀バグダッドの数学者アル＝フワーリズミー（al-Khwārizmī）の名がラテン語化したもの。「代数 algebra」も彼の著書名に由来"
- robot → "チェコ語 robota（強制労働・賦役）。1920年のチェコの戯曲『R.U.R.』で作られたSF由来の単語"
- predict → "ラテン語 prae（前もって）+ dicere（言う）→「先に言う」。dictionary・dictator と同根の dict"

【コアイメージの見本（日常会話の句動詞・チャンク）】
- figure out → "コアイメージ: figure（形）を out（外に出す）→ もやもやをはっきりした形にする。目的語は figure it out と間に挟むのが自然"
- swamped → "コアイメージ: swamp（沼）に沈められる → 仕事の沼に浸かって身動きできない。busy より切迫感が強い"

【類義語の見本（ニュアンスの違いを添える）】
- ambassador → "envoy（特使・臨時の使節）, diplomat（外交官・総称）, emissary（密使・非公式の使者）"
- swamped → "busy（普通に忙しい）, overwhelmed（精神的にいっぱいいっぱい）, snowed under（仕事に埋もれて・英国寄り）"

【例文の見本（--rewrite-ex 時）】
- ニュース系: 実際の報道・解説で見る文脈。 "U.S. intelligence suggests the missile program is further along than previously believed."
- 日常会話系: A/Bの会話一往復。 "A: I'm starving. / B: Wanna grab a bite before the movie?"
`;

// ---------------- 引数 ----------------
const args = process.argv.slice(2);
const inputFile = args.find((a) => !a.startsWith("--"));
const REWRITE_EX = args.includes("--rewrite-ex");
const DRY_RUN = args.includes("--dry-run");

if (!inputFile) {
  console.error("使い方: node enrich.js <words.js> [--rewrite-ex] [--dry-run]");
  process.exit(1);
}
if (!DRY_RUN && !process.env.ANTHROPIC_API_KEY) {
  console.error("環境変数 ANTHROPIC_API_KEY を設定してください。");
  process.exit(1);
}

// ---------------- ファイル読み込み・行解析 ----------------
const src = fs.readFileSync(inputFile, "utf8");
const lines = src.split(/\r?\n/);
const eol = src.includes("\r\n") ? "\r\n" : "\n";

// 「1行 = 1エントリ」形式の行を検出してオブジェクトとして解釈する
function parseEntryLine(line) {
  const t = line.trim();
  if (!t.startsWith("{") || !t.includes('en:')) return null;
  const body = t.replace(/,\s*$/, ""); // 行末カンマを除去
  try {
    return vm.runInNewContext("(" + body + ")");
  } catch {
    return null;
  }
}

// テンプレ流用のダメ例文を検出（words_extra.js に多数ある）
function isTemplateExample(ex) {
  return /^The briefing highlighted /.test(ex || "") ||
         /^I checked the .* before leaving for work\.$/.test(ex || "");
}

const targets = []; // { lineIndex, entry, needsEx }
lines.forEach((line, i) => {
  const entry = parseEntryLine(line);
  if (!entry) return;
  const needsEtym = !entry.etym;
  const needsSyn = !entry.syn;
  const needsEx = REWRITE_EX || isTemplateExample(entry.ex);
  if (needsEtym || needsSyn || needsEx) targets.push({ lineIndex: i, entry, needsEtym, needsSyn, needsEx });
});

console.log(`入力: ${inputFile}`);
console.log(`エントリ検出: 対象 ${targets.length} 件（etym未登録 or 例文要修正）`);
const junk = targets.filter((t) => isTemplateExample(t.entry.ex)).length;
if (junk) console.log(`  うちテンプレ例文（"The briefing highlighted..."）: ${junk} 件 → 例文も自動で書き直します`);

if (DRY_RUN) {
  console.log("\n--dry-run: API は呼びません。対象の先頭10件:");
  targets.slice(0, 10).forEach((t) => console.log(`  L${t.lineIndex + 1}: ${t.entry.en}${t.needsEx ? "（例文も修正）" : ""}`));
  process.exit(0);
}

// ---------------- API 呼び出し ----------------
async function callApi(batch) {
  const wordList = batch.map((t) => ({
    en: t.entry.en,
    ja: t.entry.ja,
    cat: t.entry.cat || "",
    needEtym: t.needsEtym,
    needSyn: t.needsSyn,
    rewriteEx: t.needsEx,
  }));

  const prompt = `あなたは日本人向け英単語教材の執筆者です。以下の単語リストの各語について、JSONで返してください。

${STYLE_EXAMPLES}

【ルール】
- needEtym が true の語のみ etym を生成。上の見本のトーンで1〜2文。cat が「日常会話」の句動詞・口語表現なら語源ではなく「コアイメージ: ...」形式で。物語性・意外性を重視し、同根語があれば添える。
- rewriteEx が true の語のみ ex / exJa も生成。catが「日常会話」ならA/B会話一往復、それ以外は実際のニュース・解説で見るリアルな文脈の一文。中級学習者（高校〜TOEIC700）が読める難易度。
- needSyn が true の語のみ syn を生成。上の類義語の見本のように「英単語（ニュアンス・使い分けの一言）」を2〜3個、カンマ区切りの1つの文字列で。適切な類義語がない語（固有名詞的な語など）は syn を省略してよい。
- 出力は JSON 配列のみ。前置き・コードフェンス禁止。
- 形式: [{"en": "...", "etym": "...", "syn": "...", "ex": "...", "exJa": "..."}]（不要なフィールドは省略）

【単語リスト】
${JSON.stringify(wordList, null, 1)}`;

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data.content.filter((c) => c.type === "text").map((c) => c.text).join("");
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ---------------- 行の書き換え ----------------
function jsStr(s) {
  return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function updateLine(line, result, needsEx) {
  let out = line;
  if (needsEx && result.ex && result.exJa) {
    out = out.replace(/ex:\s*"(?:[^"\\]|\\.)*"/, "ex: " + jsStr(result.ex));
    out = out.replace(/exJa:\s*"(?:[^"\\]|\\.)*"/, "exJa: " + jsStr(result.exJa));
  }
  if (result.etym && !/etym:/.test(out)) {
    out = out.replace(/\s*}(,?)\s*$/, ", etym: " + jsStr(result.etym) + " }$1");
  }
  if (result.syn && !/syn:/.test(out)) {
    out = out.replace(/\s*}(,?)\s*$/, ", syn: " + jsStr(result.syn) + " }$1");
  }
  return out;
}

// ---------------- メイン ----------------
(async () => {
  const outFile = inputFile.replace(/\.js$/, ".enriched.js");
  let done = 0, failed = 0;

  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    const label = `[${i + 1}-${Math.min(i + BATCH_SIZE, targets.length)}/${targets.length}]`;
    try {
      const results = await callApi(batch);
      const byEn = new Map(results.map((r) => [r.en.toLowerCase(), r]));
      for (const t of batch) {
        const r = byEn.get(t.entry.en.toLowerCase());
        if (!r) { console.warn(`${label} 応答に ${t.entry.en} がありません。スキップ`); failed++; continue; }
        lines[t.lineIndex] = updateLine(lines[t.lineIndex], r, t.needsEx);
        done++;
      }
      console.log(`${label} OK（累計 ${done} 件）`);
    } catch (e) {
      console.error(`${label} 失敗: ${e.message} — このバッチをスキップして続行`);
      failed += batch.length;
    }
    // 途中経過を毎バッチ保存（中断してもここまでの成果は残る）
    fs.writeFileSync(outFile, lines.join(eol), "utf8");
    await new Promise((r) => setTimeout(r, 1000)); // レート制限に配慮
  }

  console.log(`\n完了: 成功 ${done} / 失敗 ${failed}`);
  console.log(`出力: ${outFile}`);
  console.log(`確認して問題なければ: mv ${outFile} ${inputFile}`);
  console.log(`失敗分がある場合は、出力ファイルを入力にして再実行すれば続きだけ処理されます:`);
  console.log(`  node enrich.js ${outFile}`);
})();
