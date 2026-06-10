/* Memora — local-first memory consolidation app.
 * Data model: items are scheduled with a Leitner-style ladder; grading a
 * review moves the item up (got it), holds it (almost), or resets it (missed).
 */
(() => {
"use strict";

const STORAGE_KEY = "memora.v1";
const MIN = 60 * 1000;

// Review intervals per Leitner box, in minutes: 10m, 1h, 4h, 12h, 1d, 3d, 7d
const BOX_INTERVALS = [10, 60, 240, 720, 1440, 4320, 10080];
const MAX_BOX = BOX_INTERVALS.length - 1;

const GRADE = { MISSED: 0, ALMOST: 1, GOT: 2 };

// ---------- state ----------

let state = load();
let session = null; // { queue: [ids], total, results: {got, almost, missed} }
let reminderTimer = null;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.items)) {
        return {
          items: parsed.items,
          settings: { notify: false, checkMins: 15, ...parsed.settings },
        };
      }
    }
  } catch (e) { /* corrupted storage -> start fresh */ }
  return { items: [], settings: { notify: false, checkMins: 15 } };
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---------- scheduling & scoring ----------

function dueItems(now = Date.now()) {
  return state.items.filter((it) => it.due <= now);
}

function applyGrade(item, grade) {
  const now = Date.now();
  item.history.push({ t: now, g: grade });
  if (grade === GRADE.GOT) item.box = Math.min(item.box + 1, MAX_BOX);
  else if (grade === GRADE.MISSED) item.box = 0;
  // ALMOST keeps the current box
  item.due = now + BOX_INTERVALS[item.box] * MIN;
}

/* Memory strength in [0,1]: exponentially weighted recall history (recent
 * reviews count more) blended with ladder progress. Unreviewed items = 0. */
function strength(item) {
  if (item.history.length === 0) return 0;
  let num = 0, den = 0, w = 1;
  for (let i = item.history.length - 1; i >= 0; i--) {
    num += w * (item.history[i].g / 2);
    den += w;
    w *= 0.7;
  }
  const recall = num / den;
  const progress = item.box / MAX_BOX;
  return 0.7 * recall + 0.3 * progress;
}

function strengthBucket(s, reviewed) {
  if (!reviewed) return -1; // "new", shown grey
  if (s < 0.2) return 0;
  if (s < 0.4) return 1;
  if (s < 0.6) return 2;
  if (s < 0.8) return 3;
  return 4;
}

const STRENGTH_VARS = ["--s0", "--s1", "--s2", "--s3", "--s4"];

function strengthColor(item) {
  const b = strengthBucket(strength(item), item.history.length > 0);
  if (b === -1) return "var(--surface-2)";
  return `var(${STRENGTH_VARS[b]})`;
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
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
}

function fmtAgo(ts) {
  const d = Date.now() - ts;
  if (d < MIN) return "just now";
  if (d < 60 * MIN) return `${Math.floor(d / MIN)}m ago`;
  if (d < 24 * 60 * MIN) return `${Math.floor(d / (60 * MIN))}h ago`;
  return `${Math.floor(d / (24 * 60 * MIN))}d ago`;
}

function fmtIn(ts) {
  const d = ts - Date.now();
  if (d <= 0) return "now";
  if (d < 60 * MIN) return `in ${Math.ceil(d / MIN)}m`;
  if (d < 24 * 60 * MIN) return `in ${Math.ceil(d / (60 * MIN))}h`;
  return `in ${Math.ceil(d / (24 * 60 * MIN))}d`;
}

// ---------- tabs ----------

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((p) =>
    p.classList.toggle("active", p.id === "tab-" + name));
  if (name === "items") renderItems();
  if (name === "quiz") renderQuiz();
  if (name === "report") renderReport();
}

// ---------- items tab ----------

$("#add-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#q-input").value.trim();
  const a = $("#a-input").value.trim();
  const tag = $("#tag-input").value.trim();
  if (!q || !a) return;
  state.items.push({
    id: uid(),
    q, a, tag,
    createdAt: Date.now(),
    box: 0,
    due: Date.now() + BOX_INTERVALS[0] * MIN,
    history: [],
  });
  save();
  e.target.reset();
  $("#q-input").focus();
  toast("Added! First quiz in ~10 minutes.");
  renderItems();
  updateDueBadge();
});

$("#search-input").addEventListener("input", renderItems);

function renderItems() {
  const list = $("#item-list");
  list.innerHTML = "";
  const filter = $("#search-input").value.trim().toLowerCase();
  const items = state.items
    .filter((it) => !filter || it.q.toLowerCase().includes(filter) ||
      it.a.toLowerCase().includes(filter) || (it.tag || "").toLowerCase().includes(filter))
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt);

  $("#item-count").textContent = state.items.length ? `(${state.items.length})` : "";
  $("#empty-items").classList.toggle("hidden", state.items.length > 0);

  for (const it of items) {
    const row = el("li", "item-row");

    const dot = el("span", "strength-dot");
    dot.style.background = strengthColor(it);
    dot.title = it.history.length ? `strength ${Math.round(strength(it) * 100)}%` : "not reviewed yet";

    const main = el("div", "item-main");
    main.append(el("div", "item-q", it.q));
    const meta = el("div", "item-meta",
      `${it.history.length} review${it.history.length === 1 ? "" : "s"} · next ${fmtIn(it.due)}`);
    main.append(meta);

    row.append(dot, main);
    if (it.tag) row.append(el("span", "tag-chip", it.tag));

    const info = el("button", "icon-btn", "👁");
    info.title = "View details";
    info.addEventListener("click", () => openModal(it));

    const del = el("button", "icon-btn", "🗑");
    del.title = "Delete";
    del.addEventListener("click", () => {
      if (!confirm(`Delete "${it.q}"?`)) return;
      state.items = state.items.filter((x) => x.id !== it.id);
      save();
      renderItems();
      updateDueBadge();
    });

    row.append(info, del);
    list.append(row);
  }
}

// ---------- quiz tab ----------

$("#practice-btn").addEventListener("click", () => startSession(true));
$("#reveal-btn").addEventListener("click", () => {
  $("#answer-zone").classList.remove("hidden");
  $("#reveal-btn").classList.add("hidden");
});
document.querySelectorAll(".btn.grade").forEach((btn) => {
  btn.addEventListener("click", () => gradeCurrent(Number(btn.dataset.grade)));
});
$("#back-to-idle").addEventListener("click", renderQuiz);

function renderQuiz() {
  $("#quiz-done").classList.add("hidden");
  const due = dueItems();
  if (session && session.queue.length > 0) {
    showQuestion();
    return;
  }
  session = null;
  if (due.length > 0) {
    startSession(false);
    return;
  }
  // idle screen
  $("#quiz-card").classList.add("hidden");
  $("#quiz-idle").classList.remove("hidden");
  const hasItems = state.items.length > 0;
  $("#quiz-idle-title").textContent = hasItems ? "All caught up!" : "Nothing to quiz yet";
  $("#quiz-idle-sub").textContent = hasItems
    ? "No questions due right now. Memora will ping you when it's time to review."
    : "Add a few items first, then come back here.";
  $("#practice-btn").classList.toggle("hidden", !hasItems);
  if (hasItems) {
    const next = Math.min(...state.items.map((it) => it.due));
    $("#next-due-info").textContent = `Next question due ${fmtIn(next)}.`;
  } else {
    $("#next-due-info").textContent = "";
  }
}

function startSession(practice) {
  let pool = dueItems();
  if (practice && pool.length === 0) {
    // review ahead of schedule: take the soonest-due / weakest items
    pool = state.items.slice()
      .sort((a, b) => strength(a) - strength(b) || a.due - b.due)
      .slice(0, 10);
  }
  if (pool.length === 0) { renderQuiz(); return; }
  // weakest first within the session
  pool.sort((a, b) => strength(a) - strength(b));
  session = {
    queue: pool.map((it) => it.id),
    total: pool.length,
    practice,
    results: { got: 0, almost: 0, missed: 0 },
  };
  showQuestion();
}

function currentItem() {
  if (!session || session.queue.length === 0) return null;
  return state.items.find((it) => it.id === session.queue[0]) || null;
}

function showQuestion() {
  const it = currentItem();
  if (!it) { finishSession(); return; }
  $("#quiz-idle").classList.add("hidden");
  $("#quiz-done").classList.add("hidden");
  $("#quiz-card").classList.remove("hidden");
  $("#answer-zone").classList.add("hidden");
  $("#reveal-btn").classList.remove("hidden");
  $("#quiz-progress").textContent =
    `Question ${session.total - session.queue.length + 1} of ${session.total}`;
  $("#quiz-tag").textContent = it.tag || "";
  $("#quiz-question").textContent = it.q;
  $("#quiz-answer").textContent = it.a;
}

function gradeCurrent(grade) {
  const it = currentItem();
  if (!it) return;
  applyGrade(it, grade);
  if (grade === GRADE.GOT) session.results.got++;
  else if (grade === GRADE.ALMOST) session.results.almost++;
  else session.results.missed++;
  session.queue.shift();
  save();
  updateDueBadge();
  if (session.queue.length === 0) finishSession();
  else showQuestion();
}

function finishSession() {
  if (!session) { renderQuiz(); return; }
  const r = session.results;
  const answered = r.got + r.almost + r.missed;
  session = null;
  if (answered === 0) { renderQuiz(); return; }
  $("#quiz-card").classList.add("hidden");
  $("#quiz-idle").classList.add("hidden");
  $("#quiz-done").classList.remove("hidden");
  $("#session-summary").textContent =
    `${answered} reviewed — ✓ ${r.got} got it, ~ ${r.almost} almost, ✗ ${r.missed} missed.`;
}

// ---------- report tab ----------

function renderReport() {
  const items = state.items;
  const allReviews = items.flatMap((it) => it.history);

  $("#stat-items").textContent = items.length;
  $("#stat-reviews").textContent = allReviews.length;
  const correctish = allReviews.filter((h) => h.g === GRADE.GOT).length +
    0.5 * allReviews.filter((h) => h.g === GRADE.ALMOST).length;
  $("#stat-accuracy").textContent = allReviews.length
    ? Math.round((correctish / allReviews.length) * 100) + "%" : "–";
  $("#stat-streak").textContent = computeStreak(allReviews);

  renderStrengthMap(items);
  renderRanking(items);
  renderActivityHeatmap(allReviews);
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function computeStreak(reviews) {
  const days = new Set(reviews.map((h) => dayKey(h.t)));
  let streak = 0;
  const cursor = new Date();
  // today counts if reviewed; otherwise streak may still be alive from yesterday
  if (!days.has(dayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dayKey(cursor.getTime()))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function renderStrengthMap(items) {
  const map = $("#strength-map");
  map.innerHTML = "";
  if (items.length === 0) {
    map.append(el("p", "empty", "Add items to see your memory map."));
    return;
  }
  for (const it of items) {
    const tile = el("div", "strength-tile");
    tile.style.background = strengthColor(it);
    const s = Math.round(strength(it) * 100);
    tile.textContent = it.history.length ? s : "new";
    tile.title = it.q;
    tile.addEventListener("click", () => openModal(it));
    map.append(tile);
  }
}

function renderRanking(items) {
  const list = $("#ranking-list");
  list.innerHTML = "";
  const reviewed = items.filter((it) => it.history.length > 0);
  if (reviewed.length === 0) {
    list.append(el("p", "empty", "Complete some quizzes to build your ranking."));
    return;
  }
  const ranked = reviewed.slice().sort((a, b) => strength(a) - strength(b)).slice(0, 10);
  ranked.forEach((it, i) => {
    const s = strength(it);
    const row = el("li", "rank-row");
    row.append(el("span", "rank-num", String(i + 1)));

    const barWrap = el("div", "rank-bar-wrap");
    const bar = el("div", "rank-bar");
    bar.style.width = Math.max(4, Math.round(s * 100)) + "%";
    bar.style.background = strengthColor(it);
    barWrap.append(bar);
    row.append(barWrap);

    const q = el("span", "rank-q", it.q);
    q.title = it.q;
    q.style.cursor = "pointer";
    q.addEventListener("click", () => openModal(it));
    row.append(q);

    row.append(el("span", "rank-pct", Math.round(s * 100) + "% strong"));
    list.append(row);
  });
}

function renderActivityHeatmap(reviews) {
  const wrap = $("#activity-heatmap");
  wrap.innerHTML = "";
  const counts = new Map();
  for (const h of reviews) {
    const k = dayKey(h.t);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const weeks = 12;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // start on the Sunday `weeks` weeks back so columns align to weekdays
  const start = new Date(today);
  start.setDate(start.getDate() - (weeks * 7 - 1) - today.getDay());
  const cursor = new Date(start);
  while (cursor <= today) {
    const c = counts.get(dayKey(cursor.getTime())) || 0;
    const cell = el("div", "activity-cell");
    const lvl = c === 0 ? 0 : c <= 2 ? 1 : c <= 5 ? 2 : c <= 10 ? 3 : 4;
    cell.style.background = `var(--a${lvl})`;
    cell.title = `${cursor.toDateString()}: ${c} review${c === 1 ? "" : "s"}`;
    wrap.append(cell);
    cursor.setDate(cursor.getDate() + 1);
  }
}

// ---------- item detail modal ----------

function openModal(item) {
  $("#modal-q").textContent = item.q;
  $("#modal-a").textContent = item.a;
  const s = Math.round(strength(item) * 100);
  const stats = $("#modal-stats");
  stats.innerHTML = "";
  stats.append(
    el("span", "", `💪 strength: ${item.history.length ? s + "%" : "new"}`),
    el("span", "", `📦 level ${item.box + 1}/${MAX_BOX + 1}`),
    el("span", "", `🔁 ${item.history.length} reviews`),
    el("span", "", `⏰ next ${fmtIn(item.due)}`),
  );
  const hist = $("#modal-history");
  hist.innerHTML = "";
  if (item.history.length) {
    hist.append(el("span", "small muted", "history: "));
    for (const h of item.history) {
      const dot = el("span", "history-dot");
      dot.style.background =
        h.g === GRADE.GOT ? "var(--green)" : h.g === GRADE.ALMOST ? "var(--amber)" : "var(--danger)";
      dot.title = `${new Date(h.t).toLocaleString()} — ${["missed", "almost", "got it"][h.g]}`;
      hist.append(dot);
    }
  }
  $("#modal-backdrop").classList.remove("hidden");
}

$("#modal-close").addEventListener("click", () => $("#modal-backdrop").classList.add("hidden"));
$("#modal-backdrop").addEventListener("click", (e) => {
  if (e.target === $("#modal-backdrop")) $("#modal-backdrop").classList.add("hidden");
});

// ---------- reminders & notifications ----------

function updateDueBadge() {
  const n = dueItems().length;
  const badge = $("#due-badge");
  badge.textContent = n;
  badge.classList.toggle("hidden", n === 0);
  document.title = n > 0 ? `(${n}) Memora` : "Memora";
}

function checkReminders() {
  updateDueBadge();
  const n = dueItems().length;
  if (n > 0 && state.settings.notify && "Notification" in window &&
      Notification.permission === "granted" && document.hidden) {
    const note = new Notification("Memora — time to review! 🧠", {
      body: `${n} question${n === 1 ? "" : "s"} waiting for you.`,
      tag: "memora-due", // collapse repeats into one notification
    });
    note.onclick = () => { window.focus(); switchTab("quiz"); };
  }
}

function startReminderLoop() {
  clearInterval(reminderTimer);
  reminderTimer = setInterval(checkReminders, state.settings.checkMins * MIN);
  // lightweight badge refresh so "due" counts stay current while the app is open
  setInterval(updateDueBadge, MIN);
}

// ---------- settings ----------

$("#notify-toggle").checked = state.settings.notify;
$("#check-interval").value = String(state.settings.checkMins);

$("#notify-toggle").addEventListener("change", async (e) => {
  if (e.target.checked) {
    if (!("Notification" in window)) {
      toast("Notifications aren't supported in this browser.");
      e.target.checked = false;
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      toast("Permission denied — enable notifications in browser settings.");
      e.target.checked = false;
      return;
    }
    toast("Notifications on. Keep this tab open in the background.");
  }
  state.settings.notify = e.target.checked;
  save();
});

$("#check-interval").addEventListener("change", (e) => {
  state.settings.checkMins = Number(e.target.value);
  save();
  startReminderLoop();
});

$("#export-btn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "memora-export.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

$("#import-btn").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.items)) throw new Error("bad format");
      const existing = new Set(state.items.map((it) => it.id));
      let added = 0;
      for (const it of data.items) {
        if (it && it.id && it.q && it.a && !existing.has(it.id)) {
          state.items.push({
            id: it.id, q: String(it.q), a: String(it.a), tag: String(it.tag || ""),
            createdAt: it.createdAt || Date.now(),
            box: Math.min(Math.max(it.box || 0, 0), MAX_BOX),
            due: it.due || Date.now(),
            history: Array.isArray(it.history) ? it.history : [],
          });
          added++;
        }
      }
      save();
      renderItems();
      updateDueBadge();
      toast(`Imported ${added} item${added === 1 ? "" : "s"}.`);
    } catch {
      toast("Couldn't read that file — expected a Memora JSON export.");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

$("#wipe-btn").addEventListener("click", () => {
  if (!confirm("Delete ALL items and history? This cannot be undone.")) return;
  state = { items: [], settings: state.settings };
  save();
  renderItems();
  updateDueBadge();
  toast("All data deleted.");
});

// ---------- init ----------

renderItems();
updateDueBadge();
startReminderLoop();
checkReminders();

})();
