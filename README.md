# 🧠 Memora

A tiny, local-first app that helps you remember key information through
**spaced repetition** — add what you want to remember, get quizzed throughout
the day, and watch your memory strengthen on a color-coded report.

No build step, no server, no accounts. Just open `index.html` in a browser.

## How it works

### 1. Add what you need to remember
On the **Items** tab, enter a question/prompt and its answer (plus an optional
tag). Examples:

- *"What's the wifi password at the office?"* → `Tr0ub4dor&3`
- *"Spanish: 'to wake up'?"* → `despertarse`
- *"Who owns the billing service?"* → `Priya's team`

### 2. Get quizzed throughout the day
Memora schedules each item on a **Leitner ladder**. A new item is first asked
**~10 minutes** after you add it; each time you answer correctly the gap
grows — 1h → 4h → 12h → 1 day → 3 days → 1 week — and a miss resets it, so
weak memories come back quickly while strong ones fade into the background.

- The **Quiz** tab shows a badge (and the page title shows a count) whenever
  questions are due.
- Enable **browser notifications** in Settings to get pinged when reviews are
  due, even while the tab sits in the background.
- You grade yourself: **✓ Got it · ~ Almost · ✗ Missed it** — quick and honest.
- Can't wait? Use *Practice anyway* to review your weakest items ahead of
  schedule.

### 3. See your performance
The **Report** tab visualizes how well things are sticking:

- **Memory strength map** — one tile per item, colored from red (weak) through
  amber to bright green (strong). The intensity reflects an exponentially
  weighted recall score where recent answers count most.
- **Ranking (weakest first)** — a top-10 list with strength bars, so you know
  exactly what needs attention.
- **Activity heatmap** — a GitHub-style calendar of your review activity over
  the last 12 weeks.
- **Headline stats** — items tracked, total reviews, overall accuracy, and
  your daily streak 🔥.

## Running it

```sh
# Option A: just open the file
open index.html            # macOS
xdg-open index.html        # Linux

# Option B: serve it (recommended for notification support)
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Data & privacy

Everything lives in your browser's `localStorage`. Use **Settings → Export
JSON** to back up or move your data, and **Import JSON** to restore it.
Nothing ever leaves your device.

## Tech

Plain HTML + CSS + vanilla JavaScript (~500 lines). No dependencies.
