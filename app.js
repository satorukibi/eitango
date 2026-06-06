// ============================================================
// 英単語ドリル ロジック
//  - 12個ずつ表示
//  - 単語/例文の読み上げ（Web Speech API）
//  - 例文・単語の和訳をタップで表示
//  - 「覚えた」で別の単語と入れ替え（進捗はローカル保存）
// ============================================================

const APP_VERSION = "13";
const CARDS_PER_PAGE = 12;
const WORD_READ_PAUSE_MS = 1000; // 「単語を全部読む」：各語の後に休む時間（1秒）
const STORAGE_KEY = "eitango.learned.v1";
const STORAGE_KEY_VISIBLE = "eitango.visible.v1";

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
const readWordsBtn = document.getElementById("readWordsBtn");
const readAllBtn = document.getElementById("readAllBtn");
const stopBtn = document.getElementById("stopBtn");
const showAllBtn = document.getElementById("showAllBtn");
const hideAllBtn = document.getElementById("hideAllBtn");
const shuffleBtn = document.getElementById("shuffleBtn");
const learnedListBtn = document.getElementById("learnedListBtn");
const learnedPanel = document.getElementById("learnedPanel");
const resetBtn = document.getElementById("resetBtn");
const restartBtn = document.getElementById("restartBtn");
const progressPctEl = document.getElementById("progressPct");
const progressFillEl = document.getElementById("progressFill");
const appVersionEl = document.getElementById("appVersion");
const updateBtn = document.getElementById("updateBtn");

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

// 画面に出ている単語を保存/復元（開き直しても同じ単語を維持）
function loadVisible() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_VISIBLE);
    if (!raw) return null;
    const keys = JSON.parse(raw);
    if (!Array.isArray(keys)) return null;
    const indexes = [];
    for (const key of keys) {
      const idx = WORDS.findIndex((w) => w.en.toLowerCase() === key);
      if (idx !== -1 && !learned.has(key)) indexes.push(idx);
    }
    return indexes.length > 0 ? indexes : null;
  } catch (e) {
    return null;
  }
}

function saveVisible() {
  try {
    const keys = visible.map((i) => WORDS[i].en.toLowerCase());
    localStorage.setItem(STORAGE_KEY_VISIBLE, JSON.stringify(keys));
  } catch (e) {}
}

function clearVisible() {
  try {
    localStorage.removeItem(STORAGE_KEY_VISIBLE);
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

// 連続読み上げ中にハイライトするカード
let speakingCard = null;
let speakPauseTimer = null;

function setSpeakingCard(card) {
  if (speakingCard) speakingCard.classList.remove("speaking-now");
  speakingCard = card || null;
  if (speakingCard) speakingCard.classList.add("speaking-now");
}

function clearSpeakPause() {
  if (speakPauseTimer !== null) {
    clearTimeout(speakPauseTimer);
    speakPauseTimer = null;
  }
}

// テキスト列を順番に読み上げ（カード連動）
function speakSequence(texts, cards, pauseMs = 0) {
  if (!synth) return;
  clearSpeakPause();
  synth.cancel();
  stopBtn.hidden = false;
  let idx = 0;
  const next = () => {
    if (idx >= texts.length) {
      setSpeakingCard(null);
      stopBtn.hidden = true;
      return;
    }
    setSpeakingCard(cards[idx] || null);
    const u = makeEnUtterance(texts[idx]);
    const advance = () => {
      idx++;
      if (idx >= texts.length) {
        setSpeakingCard(null);
        stopBtn.hidden = true;
        return;
      }
      if (pauseMs > 0) {
        speakPauseTimer = setTimeout(() => {
          speakPauseTimer = null;
          next();
        }, pauseMs);
      } else {
        next();
      }
    };
    u.onend = advance;
    u.onerror = advance;
    synth.speak(u);
  };
  next();
}

function speakAllWords() {
  const cards = [...cardList.querySelectorAll(".word-card")];
  speakSequence(
    cards.map((c) => WORDS[Number(c.dataset.index)].en),
    cards,
    WORD_READ_PAUSE_MS
  );
}

// 例文を全部読む（順番に）
function speakAll() {
  const cards = [...cardList.querySelectorAll(".word-card")];
  speakSequence(
    cards.map((c) => WORDS[Number(c.dataset.index)].ex),
    cards
  );
}

function stopSpeaking() {
  clearSpeakPause();
  if (synth) synth.cancel();
  setSpeakingCard(null);
  stopBtn.hidden = true;
}

// ---- 類語検索（登録語の日本語意味が近いものを紹介） ----
function jaTokens(ja) {
  return String(ja)
    .replace(/[（）()]/g, "")
    .split(/[・／、,/\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
}

function synonymScore(target, other) {
  if (target.en.toLowerCase() === other.en.toLowerCase()) return 0;

  const tParts = jaTokens(target.ja);
  const oParts = jaTokens(other.ja);
  let score = 0;

  for (const tp of tParts) {
    for (const op of oParts) {
      if (tp === op) score += tp.length * 3;
      else if (tp.includes(op) || op.includes(tp)) {
        score += Math.min(tp.length, op.length) * 2;
      }
    }
    if (other.ja.includes(tp)) score += tp.length;
  }

  return score;
}

function findSimilarWords(wordIndex, limit = 5) {
  const target = WORDS[wordIndex];
  const hits = [];
  for (let i = 0; i < WORDS.length; i++) {
    if (i === wordIndex) continue;
    const score = synonymScore(target, WORDS[i]);
    if (score >= 4) hits.push({ index: i, score });
  }
  hits.sort((a, b) => b.score - a.score || WORDS[a.index].en.localeCompare(WORDS[b.index].en));
  return hits.slice(0, limit).map((h) => WORDS[h.index]);
}

function formatSynonymHtml(similar) {
  if (similar.length === 0) {
    return '<p class="syn-none">登録語の中に近い意味の語は見つかりませんでした。</p>';
  }
  return similar
    .map(
      (w) =>
        `<div class="syn-item"><span class="syn-en">${escapeHtml(w.en)}</span>` +
        `<span class="syn-ja">${escapeHtml(w.ja)}</span></div>`
    )
    .join("");
}

function toggleSynonyms(card, wordIndex, btn) {
  const target = card.querySelector('[data-reveal="syn"]');
  const show = !target.classList.contains("show");
  if (show) {
    target.innerHTML =
      '<span class="label">類語（登録語より）</span>' + formatSynonymHtml(findSimilarWords(wordIndex));
  }
  target.classList.toggle("show", show);
  btn.classList.toggle("done", show);
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
      <span class="example-en">${highlightWord(w.en, w.ex)}</span>
      <button class="read-btn" data-read="ex">🔊 読む</button>
    </div>

    <div class="reveal" data-reveal="ex"><span class="label">例文の和訳</span>${escapeHtml(w.exJa)}</div>
    <div class="reveal" data-reveal="word"><span class="label">単語の意味</span>${escapeHtml(w.ja)}</div>
    <div class="reveal reveal-syn" data-reveal="syn"></div>

    <div class="actions">
      <div class="actions-row">
        <button class="reveal-btn" data-toggle="ex">英文を和訳する</button>
      </div>
      <div class="actions-row">
        <button class="reveal-btn" data-toggle="word">単語を和訳する</button>
        <button class="reveal-btn" data-synonym>類語を検索する</button>
        <button class="learned-btn" data-learned>覚えた</button>
      </div>
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
  // 類語を検索する
  card.querySelector("[data-synonym]").addEventListener("click", (e) => {
    toggleSynonyms(card, wordIndex, e.currentTarget);
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
  if (!learnedPanel.hidden) renderLearnedPanel();

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
  saveVisible();
  if (visible.length === 0) showEmpty();
}

// 表示番号を振り直す
function renumber() {
  [...cardList.querySelectorAll(".word-card")].forEach((c, i) => {
    c.querySelector(".num-badge").textContent = i + 1;
  });
}

function updateStats() {
  const total = WORDS.length;
  const done = learned.size;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  learnedCountEl.textContent = `覚えた: ${done}`;
  remainCountEl.textContent = `残り: ${total - done}`;
  progressPctEl.textContent = `${pct}%`;
  progressFillEl.style.width = `${pct}%`;
}

function showEmpty() {
  cardList.hidden = true;
  emptyState.hidden = false;
}

// ---- 初期描画 ----
function render(fresh = false) {
  cardList.hidden = false;
  emptyState.hidden = true;
  cardList.innerHTML = "";

  if (fresh) {
    clearVisible();
    const pool = shuffle(unlearnedIndexes());
    visible = pool.slice(0, CARDS_PER_PAGE);
  } else {
    const saved = loadVisible();
    if (saved) {
      visible = saved;
    } else {
      const pool = shuffle(unlearnedIndexes());
      visible = pool.slice(0, CARDS_PER_PAGE);
    }
  }

  if (visible.length === 0) {
    showEmpty();
    updateStats();
    return;
  }
  visible.forEach((wi, i) => cardList.appendChild(createCard(wi, i + 1)));
  updateStats();
  saveVisible();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// 例文中の対象単語をハイライト
function highlightWord(word, text) {
  const safe = escapeHtml(text);
  const escaped = String(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b(${escaped})\\b`, "gi");
  return safe.replace(re, '<mark class="word-hit">$1</mark>');
}

// 全カードの和訳を一括表示/非表示
function toggleAllReveals(show) {
  cardList.querySelectorAll(".reveal").forEach((el) => {
    if (el.dataset.reveal === "syn") {
      el.classList.remove("show");
      el.innerHTML = "";
      return;
    }
    el.classList.toggle("show", show);
  });
  cardList.querySelectorAll(".reveal-btn").forEach((btn) => {
    if (btn.hasAttribute("data-synonym")) {
      btn.classList.remove("done");
      return;
    }
    btn.classList.toggle("done", show);
  });
}

// 画面の12語を別の未学習単語に入れ替え（進捗は変えない）
function reshuffleVisible() {
  stopSpeaking();
  const pool = shuffle(unlearnedIndexes());
  visible = pool.slice(0, CARDS_PER_PAGE);
  if (visible.length === 0) {
    showEmpty();
    updateStats();
    return;
  }
  cardList.hidden = false;
  emptyState.hidden = true;
  cardList.innerHTML = "";
  visible.forEach((wi, i) => cardList.appendChild(createCard(wi, i + 1)));
  updateStats();
  saveVisible();
}

// 覚えた単語を取り消して再出題
function unlearnWord(enLower) {
  learned.delete(enLower);
  saveLearned();
  updateStats();
  renderLearnedPanel();
  if (cardList.hidden) render();
  else if (visible.length < CARDS_PER_PAGE) {
    const replacement = pickReplacement();
    if (replacement !== null) {
      visible.push(replacement);
      cardList.appendChild(createCard(replacement, visible.length));
      renumber();
      saveVisible();
    }
  }
}

function renderLearnedPanel() {
  const items = WORDS.filter((w) => learned.has(w.en.toLowerCase()));
  if (items.length === 0) {
    learnedPanel.innerHTML = '<p class="learned-panel-empty">まだ覚えた単語はありません。</p>';
    return;
  }
  learnedPanel.innerHTML = items
    .map((w) => {
      const key = w.en.toLowerCase();
      return `<div class="learned-item">
        <span class="learned-item-word">${escapeHtml(w.en)}</span>
        <span class="learned-item-ja">${escapeHtml(w.ja)}</span>
        <button class="unlearn-btn" data-unlearn="${escapeHtml(key)}">戻す</button>
      </div>`;
    })
    .join("");
  learnedPanel.querySelectorAll("[data-unlearn]").forEach((btn) => {
    btn.addEventListener("click", () => unlearnWord(btn.dataset.unlearn));
  });
}

// ---- イベント ----
readWordsBtn.addEventListener("click", speakAllWords);
readAllBtn.addEventListener("click", speakAll);
stopBtn.addEventListener("click", stopSpeaking);
showAllBtn.addEventListener("click", () => toggleAllReveals(true));
hideAllBtn.addEventListener("click", () => toggleAllReveals(false));
shuffleBtn.addEventListener("click", reshuffleVisible);
learnedListBtn.addEventListener("click", () => {
  const show = learnedPanel.hidden;
  learnedPanel.hidden = !show;
  voicePanel.hidden = true;
  if (show) renderLearnedPanel();
});
restartBtn.addEventListener("click", () => {
  learned = new Set();
  saveLearned();
  render(true);
});
resetBtn.addEventListener("click", () => {
  if (confirm("学習の進捗をリセットしますか？")) {
    learned = new Set();
    saveLearned();
    render(true);
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
  learnedPanel.hidden = true;
  if (show) renderVoicePanel();
});

// 画面を離れる時に読み上げを止める
window.addEventListener("pagehide", stopSpeaking);

if (appVersionEl) appVersionEl.textContent = `v${APP_VERSION}`;

render();

// ---- 最新版への更新（キャッシュ削除） ----
let swRefreshing = false;

async function forceUpdate() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) {}
  const base = location.href.split("?")[0];
  location.replace(`${base}?v=${APP_VERSION}&t=${Date.now()}`);
}

function showUpdateBanner(newVer) {
  if (document.getElementById("updateBanner")) return;
  const bar = document.createElement("div");
  bar.id = "updateBanner";
  bar.style.cssText =
    "position:fixed;top:0;left:0;right:0;background:#c05621;color:#fff;padding:14px;text-align:center;z-index:9999;font-size:17px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,.2)";
  bar.innerHTML =
    `新しい版 (v${newVer}) があります ` +
    `<button id="updateBannerBtn" style="margin-left:10px;padding:8px 16px;font-size:16px;font-weight:700;border:none;border-radius:8px;cursor:pointer">今すぐ更新</button>`;
  document.body.prepend(bar);
  document.getElementById("updateBannerBtn").addEventListener("click", forceUpdate);
}

async function checkForUpdate() {
  try {
    const res = await fetch(`app.js?check=${Date.now()}`, { cache: "no-store" });
    const text = await res.text();
    const m = text.match(/APP_VERSION\s*=\s*"(\d+)"/);
    if (m && m[1] !== APP_VERSION) showUpdateBanner(m[1]);
  } catch (e) {}
}

if (updateBtn) {
  updateBtn.addEventListener("click", () => {
    if (confirm("キャッシュを消して最新版を読み込みます。進捗（覚えた単語）は残ります。")) {
      forceUpdate();
    }
  });
}

// ---- PWA: Service Worker 登録・自動更新 ----
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (swRefreshing) return;
    swRefreshing = true;
    location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`sw.js?v=${APP_VERSION}`)
      .then((reg) => {
        reg.update();
        if (reg.waiting) forceUpdate();
      })
      .catch(() => {});
    setTimeout(checkForUpdate, 3000);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdate();
  });
}
