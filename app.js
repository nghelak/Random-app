/* Đếm Tiền — voice-driven VND cash counter.
 * Walks through banknote denominations largest to smallest; for each one the
 * user speaks (or types) how many notes they have, confirms it, then the app
 * advances to the next denomination. Stopping early still shows a result for
 * whatever was confirmed so far.
 */
(() => {
"use strict";

const STORAGE_KEY = "demtien.v1";

// Largest to smallest, VND paper notes currently in circulation.
const DENOMINATIONS = [500000, 200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000];
const SHORT_LABEL = {
  500000: "500k", 200000: "200k", 100000: "100k", 50000: "50k", 20000: "20k",
  10000: "10k", 5000: "5k", 2000: "2k", 1000: "1k",
};

const STOP_WORDS = ["stop", "done", "finish", "end", "dừng", "xong", "kết thúc", "hoàn tất", "hoàn thành"];
const CONFIRM_WORDS = ["yes", "correct", "confirm", "next", "right", "yeah", "yep", "ok", "okay", "đúng", "vâng", "ừ"];
const REDO_WORDS = ["no", "wrong", "redo", "retry", "again", "nope", "sai", "lại"];

// ---------- state ----------

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        history: Array.isArray(parsed.history) ? parsed.history : [],
        settings: { lang: "vi-VN", ...parsed.settings },
        draft: parsed.draft && typeof parsed.draft === "object" ? parsed.draft : null,
      };
    }
  } catch (e) { /* corrupted storage -> start fresh */ }
  return { history: [], settings: { lang: "vi-VN" }, draft: null };
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function newSession() {
  state.draft = { idx: 0, counts: {}, pending: null, finished: false };
  save();
}

if (!state.draft) newSession();

function computeTotal(counts) {
  return DENOMINATIONS.reduce((sum, v) => sum + (counts[v] || 0) * v, 0);
}

// ---------- number parsing (digits, English words, Vietnamese words) ----------

const EN_ONES = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const EN_TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

function wordsToNumberEN(tokens) {
  let total = 0, current = 0, found = false;
  for (const tok of tokens) {
    if (tok === "and") continue;
    if (Object.prototype.hasOwnProperty.call(EN_ONES, tok)) { current += EN_ONES[tok]; found = true; }
    else if (Object.prototype.hasOwnProperty.call(EN_TENS, tok)) { current += EN_TENS[tok]; found = true; }
    else if (tok === "hundred") { current = (current || 1) * 100; found = true; }
    else if (tok === "thousand") { total += (current || 1) * 1000; current = 0; found = true; }
  }
  if (!found) return null;
  return total + current;
}

// Vietnamese digit words, including the special forms used after mươi/mười.
const VI_DIGIT = {
  "không": 0, "một": 1, "mốt": 1, "hai": 2, "ba": 3, "bốn": 4, "tư": 4,
  "năm": 5, "lăm": 5, "nhăm": 5, "sáu": 6, "bảy": 7, "bẩy": 7, "tám": 8, "chín": 9,
};

function wordsToNumberVI(tokens) {
  let segment = 0, pendingDigit = null, found = false;
  for (const tok of tokens) {
    if (Object.prototype.hasOwnProperty.call(VI_DIGIT, tok)) {
      pendingDigit = VI_DIGIT[tok];
      found = true;
    } else if (tok === "trăm") {
      segment += (pendingDigit ?? 1) * 100;
      pendingDigit = null;
      found = true;
    } else if (tok === "mười") {
      segment += 10;
      pendingDigit = null;
      found = true;
    } else if (tok === "mươi") {
      segment += (pendingDigit ?? 1) * 10;
      pendingDigit = null;
      found = true;
    } else if (tok === "linh" || tok === "lẻ") {
      pendingDigit = null;
    }
  }
  if (!found) return null;
  return segment + (pendingDigit ?? 0);
}

function parseCount(text) {
  const digitMatch = text.match(/\d+/);
  if (digitMatch) return parseInt(digitMatch[0], 10);
  const tokens = text.normalize("NFC").replace(/[^\p{L}\s]/gu, "").split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const en = wordsToNumberEN(tokens);
  if (en !== null) return en;
  return wordsToNumberVI(tokens);
}

function matchesAny(text, phrases) {
  const tokens = text.split(/\s+/).filter(Boolean);
  return phrases.some((p) => (p.includes(" ") ? text.includes(p) : tokens.includes(p)));
}

// ---------- DOM helpers ----------

const $ = (sel) => document.querySelector(sel);

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 3200);
}

function fmtVND(n) {
  return Math.round(n).toLocaleString("vi-VN") + " ₫";
}

// ---------- tabs ----------

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + name));
  if (name === "count") renderCount();
  if (name === "history") renderHistory();
}

// ---------- speech recognition ----------

function getRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

let recognition = null;
let listening = false;

function updateMicUI() {
  const btn = $("#mic-btn");
  btn.textContent = listening ? "⏹ Stop listening" : "🎤 Start listening";
  btn.classList.toggle("listening", listening);
  $("#mic-status").textContent = listening ? "🎙 Listening… speak the count" : "";
  if (!listening) $("#live-transcript").textContent = "";
}

function startListening() {
  const Ctor = getRecognitionCtor();
  if (!Ctor) { toast("Voice recognition isn't supported in this browser — use the manual entry below."); return; }
  recognition = new Ctor();
  recognition.lang = state.settings.lang;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = onRecognitionResult;
  recognition.onerror = onRecognitionError;
  recognition.onend = onRecognitionEnd;
  try { recognition.start(); } catch (e) { /* already running */ }
  listening = true;
  updateMicUI();
}

function stopListening() {
  listening = false;
  if (recognition) { try { recognition.stop(); } catch (e) { /* ignore */ } }
  updateMicUI();
}

function toggleListening() {
  if (listening) stopListening();
  else startListening();
}

function onRecognitionEnd() {
  if (!listening) return;
  try { recognition.start(); } catch (e) {
    setTimeout(() => { if (listening) { try { recognition.start(); } catch (e2) { /* ignore */ } } }, 250);
  }
}

function onRecognitionError(e) {
  if (e.error === "no-speech" || e.error === "aborted") return; // benign, onend restarts
  if (e.error === "not-allowed" || e.error === "service-not-allowed") {
    toast("Microphone permission denied.");
    listening = false;
    updateMicUI();
  }
}

function onRecognitionResult(event) {
  let interim = "";
  for (let i = event.resultIndex; i < event.results.length; i++) {
    const res = event.results[i];
    const transcript = res[0].transcript;
    if (res.isFinal) {
      $("#live-transcript").textContent = "";
      handleUtterance(transcript.toLowerCase().trim());
    } else {
      interim += transcript;
    }
  }
  if (interim) $("#live-transcript").textContent = interim;
}

function handleUtterance(text) {
  const d = state.draft;
  if (!text || d.finished) return;

  if (d.pending === null) {
    if (matchesAny(text, STOP_WORDS)) { finishSession(); toast("Stopped."); return; }
    const n = parseCount(text);
    if (n === null || !isFinite(n) || n < 0) {
      toast(`Didn't catch a number ("${text}") — try again or type it below.`);
      return;
    }
    d.pending = Math.round(n);
    save();
    renderCount();
  } else {
    if (matchesAny(text, CONFIRM_WORDS)) { commitPending(); return; }
    if (matchesAny(text, REDO_WORDS)) { redoPending(); return; }
    if (matchesAny(text, STOP_WORDS)) { finishSession(); toast("Stopped."); return; }
    const n = parseCount(text);
    if (n !== null) {
      d.pending = Math.round(n);
      save();
      renderCount();
      toast('Updated — say "yes" to confirm.');
      return;
    }
    toast('Say "yes", "no", or a corrected number.');
  }
}

// ---------- count tab ----------

function commitPending() {
  const d = state.draft;
  if (d.pending === null) return;
  d.counts[DENOMINATIONS[d.idx]] = d.pending;
  d.pending = null;
  d.idx++;
  if (d.idx >= DENOMINATIONS.length) d.finished = true;
  save();
  renderCount();
}

function redoPending() {
  const d = state.draft;
  d.pending = null;
  save();
  renderCount();
}

function finishSession() {
  const d = state.draft;
  d.pending = null;
  d.finished = true;
  save();
  renderCount();
}

function submitManual() {
  const input = $("#manual-count");
  const n = Number(input.value);
  if (!Number.isFinite(n) || n < 0) { toast("Enter a valid count (0 or more)."); return; }
  state.draft.pending = Math.round(n);
  save();
  input.value = "";
  renderCount();
}

function renderDenomStrip() {
  const d = state.draft;
  const strip = $("#denom-strip");
  strip.innerHTML = "";
  DENOMINATIONS.forEach((v, i) => {
    const done = Object.prototype.hasOwnProperty.call(d.counts, v);
    const isCurrent = !d.finished && i === d.idx;
    const chip = el("div", "denom-chip" + (isCurrent ? " current" : done ? " done" : ""));
    chip.append(el("span", "", SHORT_LABEL[v]));
    if (done) chip.append(el("span", "chip-count", `${d.counts[v]}×`));
    strip.append(chip);
  });
}

function renderCount() {
  const d = state.draft;
  renderDenomStrip();

  $("#counting-card").classList.add("hidden");
  $("#confirm-card").classList.add("hidden");
  $("#results-card").classList.add("hidden");

  if (d.finished) {
    $("#results-card").classList.remove("hidden");
    renderResults();
    return;
  }

  const denom = DENOMINATIONS[d.idx];
  if (d.pending !== null) {
    $("#confirm-card").classList.remove("hidden");
    $("#confirm-progress").textContent = `${d.idx + 1} of ${DENOMINATIONS.length}`;
    $("#confirm-denom").textContent = fmtVND(denom);
    $("#confirm-count").textContent = `${d.pending} note${d.pending === 1 ? "" : "s"}`;
    $("#confirm-subtotal").textContent = `= ${fmtVND(d.pending * denom)}`;
  } else {
    $("#counting-card").classList.remove("hidden");
    $("#step-progress").textContent = `${d.idx + 1} of ${DENOMINATIONS.length}`;
    $("#current-denom").textContent = fmtVND(denom);
  }
}

function renderResults() {
  const d = state.draft;
  const body = $("#result-body");
  body.innerHTML = "";
  DENOMINATIONS.forEach((v) => {
    const count = d.counts[v] || 0;
    const tr = document.createElement("tr");
    tr.append(el("td", "", fmtVND(v)), el("td", "", String(count)), el("td", "", fmtVND(count * v)));
    body.append(tr);
  });
  $("#grand-total").textContent = fmtVND(computeTotal(d.counts));
}

function summaryText() {
  const d = state.draft;
  const lines = DENOMINATIONS
    .filter((v) => d.counts[v])
    .map((v) => `${fmtVND(v)} × ${d.counts[v]} = ${fmtVND(d.counts[v] * v)}`);
  lines.push(`Total: ${fmtVND(computeTotal(d.counts))}`);
  return lines.join("\n");
}

$("#mic-btn").addEventListener("click", toggleListening);
$("#manual-set-btn").addEventListener("click", submitManual);
$("#manual-count").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); submitManual(); }
});
$("#confirm-btn").addEventListener("click", commitPending);
$("#redo-btn").addEventListener("click", redoPending);
$("#restart-btn").addEventListener("click", () => {
  if (!confirm("Restart the count from the beginning? Unsaved progress will be lost.")) return;
  newSession();
  renderCount();
});
$("#stop-btn").addEventListener("click", finishSession);

$("#save-btn").addEventListener("click", () => {
  const d = state.draft;
  const total = computeTotal(d.counts);
  const name = $("#save-name").value.trim() || new Date().toLocaleString();
  state.history.unshift({ id: uid(), name, timestamp: Date.now(), counts: { ...d.counts }, total });
  save();
  $("#save-name").value = "";
  toast("Saved to history.");
});

$("#copy-btn").addEventListener("click", () => {
  navigator.clipboard.writeText(summaryText())
    .then(() => toast("Summary copied."))
    .catch(() => toast("Couldn't copy — clipboard unavailable."));
});

$("#new-count-btn").addEventListener("click", () => {
  newSession();
  renderCount();
});

// ---------- history tab ----------

function renderHistory() {
  const list = $("#history-list");
  list.innerHTML = "";
  $("#empty-history").classList.toggle("hidden", state.history.length > 0);

  for (const entry of state.history) {
    const row = el("li", "history-row");
    const main = el("div", "history-main");
    main.append(el("div", "history-name", entry.name));
    const noteCount = DENOMINATIONS.reduce((s, v) => s + (entry.counts[v] || 0), 0);
    main.append(el("div", "history-meta", `${new Date(entry.timestamp).toLocaleString()} · ${noteCount} notes`));
    row.append(main, el("span", "history-amount", fmtVND(entry.total)));

    const del = el("button", "icon-btn", "🗑");
    del.title = "Delete";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${entry.name}"?`)) return;
      state.history = state.history.filter((x) => x.id !== entry.id);
      save();
      renderHistory();
    });
    row.append(del);

    row.addEventListener("click", () => openModal(entry));
    list.append(row);
  }
}

function openModal(entry) {
  $("#modal-title").textContent = entry.name;
  $("#modal-date").textContent = new Date(entry.timestamp).toLocaleString();
  const body = $("#modal-body");
  body.innerHTML = "";
  DENOMINATIONS.forEach((v) => {
    const count = entry.counts[v] || 0;
    const tr = document.createElement("tr");
    tr.append(el("td", "", fmtVND(v)), el("td", "", String(count)), el("td", "", fmtVND(count * v)));
    body.append(tr);
  });
  $("#modal-total").textContent = fmtVND(entry.total);
  $("#modal-backdrop").classList.remove("hidden");
}

$("#modal-close").addEventListener("click", () => $("#modal-backdrop").classList.add("hidden"));
$("#modal-backdrop").addEventListener("click", (e) => {
  if (e.target === $("#modal-backdrop")) $("#modal-backdrop").classList.add("hidden");
});

// ---------- settings tab ----------

$("#lang-select").value = state.settings.lang;
$("#lang-select").addEventListener("change", (e) => {
  state.settings.lang = e.target.value;
  save();
  if (listening) { stopListening(); startListening(); }
});

if (!getRecognitionCtor()) {
  $("#speech-support-warning").classList.remove("hidden");
  $("#mic-btn").disabled = true;
  $("#mic-btn").title = "Voice recognition isn't supported in this browser";
}

$("#wipe-btn").addEventListener("click", () => {
  if (!confirm("Delete ALL saved counts? This cannot be undone.")) return;
  state.history = [];
  save();
  renderHistory();
  toast("All saved counts deleted.");
});

// ---------- init ----------

renderCount();

})();
