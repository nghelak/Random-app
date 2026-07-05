# 💵 Đếm Tiền — Voice Cash Counter

A tiny, local-first app for counting stacks of Vietnamese Dong by voice. It
walks you through each banknote value one at a time — you count the physical
notes, say the number out loud, confirm it, and the app moves to the next
denomination. When you're done (or stop early), it shows a full breakdown and
the total amount.

No build step, no server, no accounts. Just open `index.html` in a browser
(Chrome/Edge recommended for voice support).

## How it works

1. **Count tab** starts you on the largest note (500.000 ₫) and shows a
   progress strip for all nine denominations down to 1.000 ₫.
2. Tap **🎤 Start listening**, count your notes of that value, then say the
   number (in Vietnamese or English — "mười lăm" or "fifteen" both work, and
   plain digits always work). No mic or noisy room? Type the count instead.
3. The app repeats back what it heard: *"Did you say... 15 notes = 7.500.000
   ₫"*. Say **"yes"** to move to the next denomination, **"no"** to redo it,
   or just say a different number to correct it on the spot.
4. Say **"stop"** (or tap **⏹ Stop & show result**) at any point to end the
   count early — whatever you've confirmed so far still gets totaled.
5. When finished, you get a per-denomination breakdown and a grand total.
   **Save** it to History with an optional name, or **Copy summary** as
   plain text.

## History

The **History** tab keeps every saved count (name, date, full breakdown,
total) so you can look back at past sessions. Tap one to see the full
breakdown, or delete it.

## Data & privacy

Everything lives in your browser's `localStorage`. Nothing ever leaves your
device — voice recognition runs through your browser's built-in speech API,
not a server this app controls.

## Browser support

Voice input uses the Web Speech API (`SpeechRecognition`), which is best
supported in Chrome and Edge. If your browser doesn't support it, the app
still works fully via the manual number entry field.

## Tech

Plain HTML + CSS + vanilla JavaScript. No dependencies, no frameworks.
