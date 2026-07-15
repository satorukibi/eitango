// ============================================================
// 英単語ドリル ロジック
//  - 12個ずつ表示
//  - 単語/例文の読み上げ（Web Speech API）
//  - 例文・単語の和訳をタップで表示
//  - 「覚えた」で別の単語と入れ替え（進捗はローカル保存）
// ============================================================

const APP_VERSION = "32";
const INSTALLED_VER_KEY = "eitango.installedVersion";
const CARDS_PER_PAGE = 12;
const WORD_TO_EXAMPLE_PAUSE_MS = 1000; // 英語：単語→例文の間
const WORD_READ_PAUSE_MS = 3000;       // 単語を読む：単語→単語の間（2秒→3秒）
const READ_PAUSE_MS = 2000;            // 和訳・例文など：次へ進む前の休み
const RANDOM_READ_PAUSE_MS = 3000;     // ランダム読み上げ：単語同士・和訳同士の間
const WORD_JA_PAUSE_MS = 3000;         // 単語→和訳の順で読む：間の休み
const STORAGE_KEY = "eitango.learned.v1";
const STORAGE_KEY_VISIBLE = "eitango.visible.v1";
const STORAGE_KEY_CATEGORY = "eitango.category.v1";

// ---- 属性（カテゴリ） ----
const WORD_CATEGORIES = [
  "すべて",
  "ニュース",
  "戦争",
  "生活",
  "日常会話",
  "学校",
  "家庭",
  "映画",
  "音楽",
  "美術・芸術",
  "歴史",
  "科学技術",
  "経済"
];

// ---- 語源ルート（簡易・自動判定用） ----
const ETYM_ROOTS = [
  { key: "econom", label: "ギリシャ語 oikos+nomos（家の管理）→ 経済" },
  { key: "techn", label: "ギリシャ語 techne（技）→ 技術" },
  { key: "struct", label: "ラテン語 struere（建てる）" },
  { key: "spect", label: "ラテン語 specere（見る）" },
  { key: "milit", label: "ラテン語 miles（兵士）" },
  { key: "sequ", label: "ラテン語 sequi（続く）" },
  { key: "press", label: "ラテン語 premere（押す）" },
  { key: "tract", label: "ラテン語 trahere（引く）" },
  { key: "port", label: "ラテン語 portare（運ぶ）" },
  { key: "dict", label: "ラテン語 dicere（言う）" },
  { key: "juris", label: "ラテン語 jus/juris（法）" },
  { key: "ject", label: "ラテン語 jacere（投げる）" },
  { key: "mit", label: "ラテン語 mittere（送る）" },
  { key: "form", label: "ラテン語 forma（形）" },
  { key: "fact", label: "ラテン語 facere（作る）" },
  { key: "fer", label: "ラテン語 ferre（運ぶ）" },
  { key: "duc", label: "ラテン語 ducere（導く）" },
  { key: "vis", label: "ラテン語 videre（見る）" },
  { key: "leg", label: "ラテン語 legere（読む・集める）" },
  { key: "cred", label: "ラテン語 credere（信じる）" },
  { key: "cap", label: "ラテン語 capere（取る）" },
  { key: "tain", label: "ラテン語 tenere（保つ）" },
  { key: "stat", label: "ラテン語 stare（立つ）" },
  { key: "vert", label: "ラテン語 vertere（曲げる）" },
  { key: "flu", label: "ラテン語 fluere（流れる）" },
  { key: "cur", label: "ラテン語 currere（走る）" },
  { key: "mob", label: "ラテン語 movere（動く）" },
  { key: "nov", label: "ラテン語 novus（新）" },
  { key: "fin", label: "ラテン語 finis（終わり・境界）" },
  { key: "merc", label: "ラテン語 merx（商品）" },
  { key: "terr", label: "ラテン語 terra（土地）" },
  { key: "bell", label: "ラテン語 bellum（戦争）" },
  { key: "bat", label: "ラテン語 battuere（打つ）" },
  { key: "graph", label: "ギリシャ語 grapho（書く）" },
  { key: "log", label: "ギリシャ語 logos（言葉・学問）" },
  { key: "gen", label: "ギリシャ語 genos（生）" },
  { key: "pol", label: "ギリシャ語 polis（都市）→ 政治" },
  { key: "crac", label: "ギリシャ語 kratos（力・支配）" },
  { key: "art", label: "ラテン語 ars（技・芸）" },
  { key: "act", label: "ラテン語 agere（動く・行う）" }
].sort((a, b) => b.key.length - a.key.length);

const CAT_OVERRIDES = {
  war: "戦争", peace: "ニュース", treaty: "歴史", alliance: "戦争",
  market: "経済", trade: "経済", inflation: "経済", recession: "経済",
  economy: "経済", economic: "経済", stock: "経済", profit: "経済",
  budget: "経済", tax: "経済", debt: "経済", bank: "経済",
  school: "学校", student: "学校", education: "学校",
  family: "家庭", home: "家庭", parent: "家庭",
  film: "映画", movie: "映画", music: "音楽", song: "音楽",
  art: "美術・芸術", museum: "美術・芸術", history: "歴史", historical: "歴史",
  food: "生活", health: "生活", weather: "生活", travel: "生活"
};

function detectEtymKey(en) {
  const l = en.toLowerCase();
  for (const r of ETYM_ROOTS) {
    if (l.includes(r.key)) return r.key;
  }
  return "";
}

function etymLabel(en, manual) {
  if (manual) return manual;
  const key = detectEtymKey(en);
  if (!key) return "";
  const r = ETYM_ROOTS.find((x) => x.key === key);
  return r ? r.label : "";
}

function catForWord(en) {
  const l = en.toLowerCase();
  if (CAT_OVERRIDES[l]) return CAT_OVERRIDES[l];
  const rules = [
    [/milit|weapon|missile|nuclear|invad|troop|soldier|combat|defen|sanction|regime|border|ceasefire|hostage|casualty|refugee|insurg|deter|annex|siege|offensive|atrocity|arsenal|warfare|^war$|battle|raid|airstrike|artillery/, "戦争"],
    [/algorithm|digital|robot|software|network|cyber|data|tech|comput|autom|device|platform|innov|virtual|neural|chip|internet|encrypt|database|server|cloud|api|model|generate|code/, "科学技術"],
    [/econom|market|trade|inflation|recess|stock|invest|profit|budget|tax|debt|financ|currency|fiscal|monet|bank|loan|deficit|subsid|revenue|tariff|export|import|commerce/, "経済"],
    [/school|student|teacher|education|univers|college|classroom|exam|curriculum|academic/, "学校"],
    [/family|parent|child|marriage|household|domestic|relative/, "家庭"],
    [/film|movie|cinema|actor|director|screenplay|hollywood/, "映画"],
    [/music|song|concert|orchestra|melody|album|singer|band/, "音楽"],
    [/museum|gallery|sculpt|paint|aesthetic|design|artist|architect/, "美術・芸術"],
    [/histor|ancient|century|colonial|empire|archaeolog|medieval|dynasty/, "歴史"],
    [/food|daily|life|health|exercise|sleep|hobby|lifestyle|recipe|fitness/, "生活"]
  ];
  for (const [re, cat] of rules) {
    if (re.test(l)) return cat;
  }
  return "ニュース";
}

function enrichWord(w) {
  return {
    ...w,
    cat: w.cat || catForWord(w.en),
    etymKey: w.etymKey || detectEtymKey(w.en),
    etym: w.etym || etymLabel(w.en, w.etym)
  };
}

function matchesCategory(wordIndex) {
  if (selectedCategory === "すべて") return true;
  return WORDS[wordIndex].cat === selectedCategory;
}

// ---- 重複(同じ英単語)を除いた単語プール ----
const WORDS = (() => {
  const seen = new Set();
  const list = [];
  for (const w of DEFAULT_WORDS) {
    const key = w.en.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(enrichWord(w));
  }
  return list;
})();

// ---- 状態 ----
let learned = loadLearned();
let visible = [];
let selectedCategory = loadCategory();

// ---- 要素 ----
const cardList = document.getElementById("cardList");
const emptyState = document.getElementById("emptyState");
const learnedCountEl = document.getElementById("learnedCount");
const remainCountEl = document.getElementById("remainCount");
const readWordsBtn = document.getElementById("readWordsBtn");
const readWordsRandomBtn = document.getElementById("readWordsRandomBtn");
const readWordExBtn = document.getElementById("readWordExBtn");
const readWordJaBtn = document.getElementById("readWordJaBtn");
const readAllBtn = document.getElementById("readAllBtn");
const readJaBtn = document.getElementById("readJaBtn");
const readJaRandomBtn = document.getElementById("readJaRandomBtn");
const readExJaBtn = document.getElementById("readExJaBtn");
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
const catSelect = document.getElementById("catSelect");
const catCountEl = document.getElementById("catCount");

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

function loadCategory() {
  try {
    const c = localStorage.getItem(STORAGE_KEY_CATEGORY);
    return WORD_CATEGORIES.includes(c) ? c : "すべて";
  } catch (e) {
    return "すべて";
  }
}

function saveCategory() {
  try {
    localStorage.setItem(STORAGE_KEY_CATEGORY, selectedCategory);
  } catch (e) {}
}

function poolWords() {
  if (selectedCategory === "すべて") return WORDS;
  return WORDS.filter((w) => w.cat === selectedCategory);
}

function initCategorySelect() {
  if (!catSelect) return;
  catSelect.innerHTML = WORD_CATEGORIES.map((c) => {
    const n = c === "すべて" ? WORDS.length : WORDS.filter((w) => w.cat === c).length;
    return `<option value="${c}">${c}（${n}語）</option>`;
  }).join("");
  catSelect.value = selectedCategory;
  updateCatCount();
  catSelect.addEventListener("change", () => {
    selectedCategory = catSelect.value;
    saveCategory();
    updateCatCount();
    stopSpeaking();
    render(true);
  });
}

function updateCatCount() {
  if (!catCountEl) return;
  const remain = unlearnedIndexes().length;
  catCountEl.textContent =
    selectedCategory === "すべて" ? "" : `この属性の残り ${remain}語`;
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
      if (idx !== -1 && !learned.has(key) && matchesCategory(idx)) indexes.push(idx);
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
    if (learned.has(WORDS[i].en.toLowerCase())) continue;
    if (!matchesCategory(i)) continue;
    arr.push(i);
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
let jaVoice = null;

function pickEnglishVoice() {
  if (!synth) return;
  const voices = synth.getVoices();
  if (!voices || voices.length === 0) return;
  enVoice =
    voices.find((v) => /^en[-_]US$/i.test(v.lang)) ||
    voices.find((v) => /^en[-_]GB$/i.test(v.lang)) ||
    voices.find((v) => /^en([-_]|$)/i.test(v.lang)) ||
    voices.find((v) => /english/i.test(v.name)) ||
    null;
}

function pickJapaneseVoice() {
  if (!synth) return;
  const voices = synth.getVoices();
  if (!voices || voices.length === 0) return;
  jaVoice =
    voices.find((v) => /^ja[-_]JP$/i.test(v.lang)) ||
    voices.find((v) => /^ja([-_]|$)/i.test(v.lang)) ||
    voices.find((v) => /japanese|日本/i.test(v.name)) ||
    null;
}

function pickVoices() {
  pickEnglishVoice();
  pickJapaneseVoice();
}

pickVoices();
if (synth) {
  synth.onvoiceschanged = pickVoices;
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

function makeJaUtterance(text) {
  const u = new SpeechSynthesisUtterance(text);
  if (!jaVoice) pickJapaneseVoice();
  if (jaVoice) u.voice = jaVoice;
  u.lang = (jaVoice && jaVoice.lang) || "ja-JP";
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
function speakSequence(texts, cards, pauseMs = 0, makeUtterance = makeEnUtterance) {
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
    const u = makeUtterance(texts[idx], idx);
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

function visibleCards() {
  return [...cardList.querySelectorAll(".word-card")];
}

function speakAllWords() {
  const cards = visibleCards();
  speakSequence(
    cards.map((c) => WORDS[Number(c.dataset.index)].en),
    cards,
    WORD_READ_PAUSE_MS
  );
}

// 単語→例文を交互に全部読む
function speakAllWordsThenExamples() {
  const cards = visibleCards();
  const texts = [];
  const highlightCards = [];
  for (const c of cards) {
    const w = WORDS[Number(c.dataset.index)];
    texts.push(w.en, w.ex);
    highlightCards.push(c, c);
  }
  speakSequence(texts, highlightCards, WORD_TO_EXAMPLE_PAUSE_MS);
}

// 単語をランダムな順番で全部読む（単語同士の間は3秒）
function speakAllWordsRandom() {
  const cards = shuffle([...visibleCards()]);
  speakSequence(
    cards.map((c) => WORDS[Number(c.dataset.index)].en),
    cards,
    RANDOM_READ_PAUSE_MS
  );
}

// 単語→和訳の順で読む（間は3秒）
function speakWordThenJa() {
  const cards = visibleCards();
  const texts = [];
  const highlightCards = [];
  for (const c of cards) {
    const w = WORDS[Number(c.dataset.index)];
    texts.push(w.en, w.ja);
    highlightCards.push(c, c);
  }
  speakSequence(
    texts,
    highlightCards,
    WORD_JA_PAUSE_MS,
    (text, idx) => (idx % 2 === 0 ? makeEnUtterance(text) : makeJaUtterance(text))
  );
}

// 例文を全部読む
function speakAll() {
  const cards = visibleCards();
  speakSequence(
    cards.map((c) => WORDS[Number(c.dataset.index)].ex),
    cards,
    READ_PAUSE_MS
  );
}

// 単語の和訳を全部読む（日本語）
function speakAllJa() {
  const cards = visibleCards();
  speakSequence(
    cards.map((c) => WORDS[Number(c.dataset.index)].ja),
    cards,
    READ_PAUSE_MS,
    makeJaUtterance
  );
}

// 単語の和訳をランダムな順番で全部読む（間は3秒）
function speakAllJaRandom() {
  const cards = shuffle([...visibleCards()]);
  speakSequence(
    cards.map((c) => WORDS[Number(c.dataset.index)].ja),
    cards,
    RANDOM_READ_PAUSE_MS,
    makeJaUtterance
  );
}

// 例文の和訳を全部読む（日本語）
function speakAllExJa() {
  const cards = visibleCards();
  speakSequence(
    cards.map((c) => WORDS[Number(c.dataset.index)].exJa),
    cards,
    READ_PAUSE_MS,
    makeJaUtterance
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
    const w = WORDS[wordIndex];
    if (w.syn) {
      // 登録済みの類義語（ニュアンス付き）を優先表示
      target.innerHTML =
        '<span class="label">類語</span><div class="syn-item">' + escapeHtml(w.syn) + '</div>';
    } else {
      // 未登録の語は従来どおり登録語から自動検索
      target.innerHTML =
        '<span class="label">類語（登録語より）</span>' + formatSynonymHtml(findSimilarWords(wordIndex));
    }
  }
  target.classList.toggle("show", show);
  btn.classList.toggle("done", show);
}

// ---- 語源検索 ----
function findSimilarEtymology(wordIndex, limit = 8) {
  const target = WORDS[wordIndex];
  if (!target.etymKey) return [];
  const hits = [];
  for (let i = 0; i < WORDS.length; i++) {
    if (i === wordIndex) continue;
    if (WORDS[i].etymKey === target.etymKey) hits.push(WORDS[i]);
  }
  hits.sort((a, b) => a.en.localeCompare(b.en));
  return hits.slice(0, limit);
}

function formatEtymHtml(target, similar) {
  let html = "";
  if (target.etym) {
    html += `<p class="etym-self">語源: ${escapeHtml(target.etym)}</p>`;
  } else {
    html += '<p class="syn-none">この単語の語源は判定できませんでした。</p>';
    return html;
  }
  if (similar.length === 0) {
    html += '<p class="syn-none">同じ語源の他の登録語はまだありません。</p>';
    return html;
  }
  html += '<span class="label">同じ語源の単語</span>';
  html += similar
    .map(
      (w) =>
        `<div class="syn-item"><span class="syn-en">${escapeHtml(w.en)}</span>` +
        `<span class="syn-pos">${escapeHtml(w.pos)}</span>` +
        `<span class="syn-ja">${escapeHtml(w.ja)}</span></div>`
    )
    .join("");
  return html;
}

function toggleEtymology(card, wordIndex, btn) {
  const target = card.querySelector('[data-reveal="etym"]');
  const show = !target.classList.contains("show");
  if (show) {
    const w = WORDS[wordIndex];
    target.innerHTML = formatEtymHtml(w, findSimilarEtymology(wordIndex));
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
    <div class="card-line word-line">
      <span class="num-badge">${displayNum}</span>
      <span class="word-en">${escapeHtml(w.en)}</span>
      <span class="word-pos">${escapeHtml(w.pos)}</span>
      <span class="word-kana">${escapeHtml(w.kana)}</span>
      <button class="inline-btn" data-read="word">読む</button>
    </div>
    <div class="card-line btn-line">
      <button class="reveal-btn" data-toggle="word">和訳する</button>
      <button class="reveal-btn" data-synonym>類語を検索する</button>
      <button class="reveal-btn" data-etymology>語源を検索する</button>
    </div>
    <div class="reveal" data-reveal="word"><span class="label">単語の意味</span>${escapeHtml(w.ja)}</div>
    <div class="reveal reveal-syn" data-reveal="syn"></div>
    <div class="reveal reveal-etym" data-reveal="etym"></div>

    <div class="card-line ex-line">
      <span class="example-en">${highlightWord(w.en, w.ex)}</span>
      <button class="inline-btn" data-read="ex">読む</button>
    </div>
    <div class="card-line btn-line">
      <button class="reveal-btn" data-toggle="ex">和訳する</button>
    </div>
    <div class="reveal" data-reveal="ex"><span class="label">例文の和訳</span>${escapeHtml(w.exJa)}</div>

    <div class="card-line btn-line">
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
  // 類語を検索する
  card.querySelector("[data-synonym]").addEventListener("click", (e) => {
    toggleSynonyms(card, wordIndex, e.currentTarget);
  });
  // 語源を検索する
  card.querySelector("[data-etymology]").addEventListener("click", (e) => {
    toggleEtymology(card, wordIndex, e.currentTarget);
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
  const pool = poolWords();
  const poolKeys = new Set(pool.map((w) => w.en.toLowerCase()));
  const total = pool.length;
  const done = [...learned].filter((k) => poolKeys.has(k)).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  learnedCountEl.textContent = `覚えた: ${done}`;
  remainCountEl.textContent = `残り: ${total - done}`;
  progressPctEl.textContent = `${pct}%`;
  progressFillEl.style.width = `${pct}%`;
  updateCatCount();
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
    if (el.dataset.reveal === "syn" || el.dataset.reveal === "etym") {
      el.classList.remove("show");
      el.innerHTML = "";
      return;
    }
    el.classList.toggle("show", show);
  });
  cardList.querySelectorAll(".reveal-btn").forEach((btn) => {
    if (btn.hasAttribute("data-synonym") || btn.hasAttribute("data-etymology")) {
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
readWordsRandomBtn.addEventListener("click", speakAllWordsRandom);
readAllBtn.addEventListener("click", speakAll);
readWordExBtn.addEventListener("click", speakAllWordsThenExamples);
readWordJaBtn.addEventListener("click", speakWordThenJa);
readJaBtn.addEventListener("click", speakAllJa);
readJaRandomBtn.addEventListener("click", speakAllJaRandom);
readExJaBtn.addEventListener("click", speakAllExJa);
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
  pickVoices();
  const voices = synth ? synth.getVoices() : [];
  const enVoices = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
  const jaVoices = voices.filter((v) => /^ja([-_]|$)/i.test(v.lang));

  let html = "";
  if (!synth) {
    html = '<span class="ng">この端末は読み上げ(speechSynthesis)に対応していません。</span>';
  } else if (voices.length === 0) {
    html = '<span class="ng">音声がまだ読み込まれていません。少し待って再度押してください。</span>';
  } else {
    if (enVoice) {
      html += `<span class="ok">✓ 英語: ${escapeHtml(enVoice.name)} (${escapeHtml(enVoice.lang)})</span>\n`;
    } else {
      html += '<span class="ng">✗ 英語ボイスが見つかりません。</span>\n';
    }
    if (jaVoice) {
      html += `<span class="ok">✓ 日本語: ${escapeHtml(jaVoice.name)} (${escapeHtml(jaVoice.lang)})</span>\n\n`;
    } else {
      html += '<span class="ng">✗ 日本語ボイスが見つかりません（和訳読み上げが不自然になる場合があります）。</span>\n\n';
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

initCategorySelect();
render();

// ---- 最新版への更新（キャッシュ削除） ----
let swRefreshing = false;

async function fetchNoStore(path) {
  const bust = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const url = path.includes("?") ? `${path}&_=${bust}` : `${path}?_=${bust}`;
  return fetch(url, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" }
  });
}

async function fetchServerVersion() {
  try {
    const htmlRes = await fetchNoStore("index.html");
    const html = await htmlRes.text();
    const mHtml = html.match(/app\.js\?v=(\d+)/);
    if (mHtml) return mHtml[1];
  } catch (e) {}
  try {
    const jsRes = await fetchNoStore("app.js");
    const text = await jsRes.text();
    const m = text.match(/APP_VERSION\s*=\s*"(\d+)"/);
    if (m) return m[1];
  } catch (e) {}
  return APP_VERSION;
}

function indexHtmlUrl(serverVer) {
  const u = new URL(location.href);
  const base = u.pathname.replace(/\/?index\.html$/i, "").replace(/\/?$/, "/");
  u.pathname = `${base}index.html`;
  u.search = `_v=${serverVer}&_t=${Date.now()}`;
  u.hash = "";
  return u.href;
}

function isStandaloneApp() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    navigator.standalone === true
  );
}

function markVersionInstalled() {
  try {
    localStorage.setItem(INSTALLED_VER_KEY, APP_VERSION);
  } catch (e) {}
}

async function ensureLatestVersion(silent = false) {
  let serverVer = APP_VERSION;
  try {
    serverVer = await fetchServerVersion();
  } catch (e) {
    if (!navigator.onLine) return;
  }
  if (serverVer === APP_VERSION) {
    markVersionInstalled();
    return;
  }
  if (!silent && !isStandaloneApp()) return;
  await forceUpdate();
}

async function forceUpdate() {
  if (updateBtn) {
    updateBtn.disabled = true;
    updateBtn.textContent = "更新中...";
  }
  let serverVer = APP_VERSION;
  try {
    serverVer = await fetchServerVersion();
  } catch (e) {}
  try {
    sessionStorage.setItem("eitango.updateTarget", serverVer);
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) {}
  location.replace(indexHtmlUrl(serverVer));
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
    const serverVer = await fetchServerVersion();
    if (serverVer !== APP_VERSION) {
      showUpdateBanner(serverVer);
      if (updateBtn) updateBtn.textContent = `🔄 更新 (v${serverVer}あり)`;
      if (isStandaloneApp() && navigator.onLine) {
        await ensureLatestVersion(true);
      }
    } else {
      markVersionInstalled();
    }
  } catch (e) {}
}

(function showUpdateResult() {
  const target = sessionStorage.getItem("eitango.updateTarget");
  if (!target) return;
  sessionStorage.removeItem("eitango.updateTarget");
  if (target === APP_VERSION) {
    sessionStorage.removeItem("eitango.updateRetries");
    markVersionInstalled();
    return;
  }
  const retries = Number(sessionStorage.getItem("eitango.updateRetries") || 0);
  if (retries < 2) {
    sessionStorage.setItem("eitango.updateRetries", String(retries + 1));
    setTimeout(forceUpdate, 800);
    return;
  }
  sessionStorage.removeItem("eitango.updateRetries");
  alert(
    `更新が完了しませんでした。\n` +
      `現在: v${APP_VERSION}　最新: v${target}\n\n` +
      `もう一度「最新版に更新」を押すか、\n` +
      `スマホのブラウザで http://(PCのIP):8000/?hardreset=1 を開いてください。`
  );
})();

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
        if (reg.waiting) {
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
        }
      })
      .catch(() => {});
    setTimeout(checkForUpdate, 3000);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkForUpdate();
      if (isStandaloneApp()) ensureLatestVersion(true);
    }
  });

  if (isStandaloneApp()) {
    setTimeout(() => ensureLatestVersion(true), 1500);
  } else {
    markVersionInstalled();
  }
}
