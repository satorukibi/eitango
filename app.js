// ============================================================
// 英単語ドリル ロジック
//  - 12個ずつ表示
//  - 単語/例文の読み上げ（Web Speech API）
//  - 例文・単語の和訳をタップで表示
//  - 「覚えた」で別の単語と入れ替え（進捗はローカル保存）
// ============================================================

const CARDS_PER_PAGE = 12;
const STORAGE_KEY = "eitango.learned.v1";

// ---- 重複(同じ英単語)を除いた単語プール ----
const WORDS = (() => {
  const seen = new Set();
  const list = [];
  for (const w of DEFAULT_WORDS) {
    const key = w.en.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(w);
  }
  return list;
})();

// ---- 状態 ----
let learned = loadLearned();          // 覚えた単語(en小文字)の集合
let visible = [];                     // 現在画面に出ている単語インデックスの配列

// ---- 要素 ----
const cardList = document.getElementById("cardList");
const emptyState = document.getElementById("emptyState");
const learnedCountEl = document.getElementById("learnedCount");
const remainCountEl = document.getElementById("remainCount");
const readAllBtn = document.getElementById("readAllBtn");
const stopBtn = document.getElementById("stopBtn");
const resetBtn = document.getElementById("resetBtn");
const restartBtn = document.getElementById("restartBtn");

// ---- 進捗の保存/読み込み ----
function loadLearned() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch (e) {
    return new Set();
  }
}
function saveLearned() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...learned]));
  } catch (e) {}
}

// ---- 未学習の単語インデックス一覧（出題順をシャッフル） ----
function unlearnedIndexes() {
  const arr = [];
  for (let i = 0; i < WORDS.length; i++) {
    if (!learned.has(WORDS[i].en.toLowerCase())) arr.push(i);
  }
  return arr;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 画面に出ていない未学習の単語を1つ取得（入れ替え用）
function pickReplacement() {
  const candidates = unlearnedIndexes().filter((i) => !visible.includes(i));
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ---- 読み上げ ----
const synth = window.speechSynthesis;

// 端末の音声一覧から「英語の声」を選ぶ。
// （日本語の声で英語を読むとローマ字読みになるため、英語ボイスを明示する）
let enVoice = null;
function pickEnglishVoice() {
  if (!synth) return;
  const voices = synth.getVoices();
  if (!voices || voices.length === 0) return;
  enVoice =
    // en-US を最優先
    voices.find((v) => /^en[-_]US$/i.test(v.lang)) ||
    // 次に en-GB
    voices.find((v) => /^en[-_]GB$/i.test(v.lang)) ||
    // それ以外の英語ボイス全般
    voices.find((v) => /^en([-_]|$)/i.test(v.lang)) ||
    // 名前に English を含むもの（保険）
    voices.find((v) => /english/i.test(v.name)) ||
    null;
}
pickEnglishVoice();
if (synth) {
  // 音声リストは非同期で読み込まれるため、更新時に選び直す
  synth.onvoiceschanged = pickEnglishVoice;
}

// 英語読み上げ用のUtteranceを作る
function makeEnUtterance(text) {
  const u = new SpeechSynthesisUtterance(text);
  if (!enVoice) pickEnglishVoice();
  if (enVoice) u.voice = enVoice;
  u.lang = (enVoice && enVoice.lang) || "en-US";
  u.rate = 0.95;
  return u;
}

function speak(text, btn) {
  if (!synth) return;
  synth.cancel();
  const u = makeEnUtterance(text);
  if (btn) {
    btn.classList.add("speaking");
    u.onend = u.onerror = () => btn.classList.remove("speaking");
  }
  synth.speak(u);
}

// 例文を全部読む（順番に）
function speakAll() {
  if (!synth) return;
  synth.cancel();
  const sentences = visible.map((i) => WORDS[i].ex);
  stopBtn.hidden = false;
  let idx = 0;
  const next = () => {
    if (idx >= sentences.length) {
      stopBtn.hidden = true;
      return;
    }
    const u = makeEnUtterance(sentences[idx]);
    u.onend = () => { idx++; next(); };
    u.onerror = () => { idx++; next(); };
    synth.speak(u);
  };
  next();
}

function stopSpeaking() {
  if (synth) synth.cancel();
  stopBtn.hidden = true;
}

// ---- カードの生成 ----
function createCard(wordIndex, displayNum) {
  const w = WORDS[wordIndex];
  const card = document.createElement("section");
  card.className = "word-card";
  card.dataset.index = wordIndex;

  card.innerHTML = `
    <div class="card-top">
      <span class="num-badge">${displayNum}</span>
      <span class="word-en">${escapeHtml(w.en)}</span>
      <span class="word-pos">${escapeHtml(w.pos)}</span>
      <button class="read-btn" data-read="word">🔊 読む</button>
    </div>
    <div class="word-kana">${escapeHtml(w.kana)}</div>

    <div class="example">
      <span class="example-en">${escapeHtml(w.ex)}</span>
      <button class="read-btn" data-read="ex">🔊 読む</button>
    </div>

    <div class="reveal" data-reveal="ex"><span class="label">例文の和訳</span>${escapeHtml(w.exJa)}</div>
    <div class="reveal" data-reveal="word"><span class="label">単語の意味</span>${escapeHtml(w.ja)}</div>

    <div class="actions">
      <button class="reveal-btn" data-toggle="ex">英文を和訳する</button>
      <button class="reveal-btn" data-toggle="word">単語を和訳する</button>
      <button class="learned-btn" data-learned>覚えた</button>
    </div>
  `;

  // 単語の読み上げ
  card.querySelector('[data-read="word"]').addEventListener("click", (e) => {
    speak(w.en, e.currentTarget);
  });
  // 例文の読み上げ
  card.querySelector('[data-read="ex"]').addEventListener("click", (e) => {
    speak(w.ex, e.currentTarget);
  });
  // 英文を和訳する
  card.querySelector('[data-toggle="ex"]').addEventListener("click", (e) => {
    toggleReveal(card, "ex", e.currentTarget);
  });
  // 単語を和訳する
  card.querySelector('[data-toggle="word"]').addEventListener("click", (e) => {
    toggleReveal(card, "word", e.currentTarget);
  });
  // 覚えた → 入れ替え
  card.querySelector("[data-learned]").addEventListener("click", () => {
    markLearned(card, wordIndex);
  });

  return card;
}

function toggleReveal(card, type, btn) {
  const target = card.querySelector(`[data-reveal="${type}"]`);
  const show = !target.classList.contains("show");
  target.classList.toggle("show", show);
  btn.classList.toggle("done", show);
}

// ---- 「覚えた」処理：その単語を学習済みにして別の単語と入れ替える ----
function markLearned(card, wordIndex) {
  learned.add(WORDS[wordIndex].en.toLowerCase());
  saveLearned();

  const pos = visible.indexOf(wordIndex);
  const replacement = pickReplacement();

  if (replacement === null) {
    // 入れ替える単語がもう無い → カードを取り除く
    if (pos !== -1) visible.splice(pos, 1);
    card.remove();
  } else {
    // 同じ位置に新しい単語のカードを差し込む
    visible[pos] = replacement;
    const newCard = createCard(replacement, pos + 1);
    card.replaceWith(newCard);
  }
  renumber();
  updateStats();
  if (visible.length === 0) showEmpty();
}

// 表示番号を振り直す
function renumber() {
  [...cardList.querySelectorAll(".word-card")].forEach((c, i) => {
    c.querySelector(".num-badge").textContent = i + 1;
  });
}

function updateStats() {
  learnedCountEl.textContent = `覚えた: ${learned.size}`;
  remainCountEl.textContent = `残り: ${WORDS.length - learned.size}`;
}

function showEmpty() {
  cardList.hidden = true;
  emptyState.hidden = false;
}

// ---- 初期描画 ----
function render() {
  cardList.hidden = false;
  emptyState.hidden = true;
  cardList.innerHTML = "";

  const pool = shuffle(unlearnedIndexes());
  visible = pool.slice(0, CARDS_PER_PAGE);

  if (visible.length === 0) {
    showEmpty();
    updateStats();
    return;
  }
  visible.forEach((wi, i) => cardList.appendChild(createCard(wi, i + 1)));
  updateStats();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---- イベント ----
readAllBtn.addEventListener("click", speakAll);
stopBtn.addEventListener("click", stopSpeaking);
restartBtn.addEventListener("click", () => {
  learned = new Set();
  saveLearned();
  render();
});
resetBtn.addEventListener("click", () => {
  if (confirm("学習の進捗をリセットしますか？")) {
    learned = new Set();
    saveLearned();
    render();
  }
});

// ---- 音声情報パネル（発音トラブルの診断用） ----
const voiceInfoBtn = document.getElementById("voiceInfoBtn");
const voicePanel = document.getElementById("voicePanel");

function renderVoicePanel() {
  pickEnglishVoice();
  const voices = synth ? synth.getVoices() : [];
  const enVoices = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));

  let html = "";
  if (!synth) {
    html = '<span class="ng">この端末は読み上げ(speechSynthesis)に対応していません。</span>';
  } else if (voices.length === 0) {
    html = '<span class="ng">音声がまだ読み込まれていません。少し待って再度押してください。</span>';
  } else {
    if (enVoice) {
      html += `<span class="ok">✓ 使用中の英語ボイス: ${escapeHtml(enVoice.name)} (${escapeHtml(enVoice.lang)})</span>\n\n`;
    } else {
      html += '<span class="ng">✗ 英語のボイスが見つかりません。日本語ボイスで読むためローマ字読みになります。\nWindowsの「設定 → 時刻と言語 → 言語と地域 → 英語を追加」で英語音声を入れてください。</span>\n\n';
    }
    html += `英語ボイス: ${enVoices.length}個 / 全${voices.length}個\n`;
    html += "----- 端末の音声一覧 -----\n";
    html += voices
      .map((v) => {
        const mark = /^en([-_]|$)/i.test(v.lang) ? '<span class="hit">●</span> ' : "  ";
        return `${mark}${escapeHtml(v.lang)}  |  ${escapeHtml(v.name)}`;
      })
      .join("\n");
  }
  voicePanel.innerHTML = html;
}

voiceInfoBtn.addEventListener("click", () => {
  const show = voicePanel.hidden;
  voicePanel.hidden = !show;
  if (show) renderVoicePanel();
});

// 画面を離れる時に読み上げを止める
window.addEventListener("pagehide", stopSpeaking);

render();

// ---- PWA: Service Worker 登録 ----
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
