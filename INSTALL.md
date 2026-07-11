# YouTube Transcript → Clean PDF — Install & Use

A tiny Chrome/Edge/Brave/Arc extension. Click the toolbar icon on any YouTube
video and it saves the **full transcript as a clean PDF** — no timestamps, with
the caption fragments re-joined into real sentences that flow as paragraphs.
Everything runs locally in your browser; nothing is uploaded anywhere.

---

## Install (one time, ~1 minute)

1. Open your browser's extensions page:
   - **Chrome:** type `chrome://extensions` in the address bar and press Enter
   - **Edge:** `edge://extensions`
   - **Brave:** `brave://extensions`
   - **Arc:** `arc://extensions` (or the Chrome page above)
2. Turn on **Developer mode** (toggle in the top-right corner).
3. Click **“Load unpacked.”**
4. Select this folder: **`youtube-transcript-pdf`** (the folder containing
   `manifest.json`).
5. Done — a small red **download** icon appears in your toolbar. If you don't see
   it, click the puzzle-piece 🧩 icon and pin **“YouTube Transcript → Clean PDF.”**

You only do this once. It stays installed until you remove it.

---

## Use it

1. Open any YouTube video that has captions/subtitles (the **CC** button is lit).
2. Click the extension's toolbar icon.
3. A small message appears (“Fetching transcript…”, then “saved to Downloads ✓”),
   and the PDF lands in your **Downloads** folder, named after the video.

That's it.

---

## What the PDF looks like

- **Header:** the video title (bold) and the channel name, then a thin divider.
- **Body:** the transcript as flowing paragraphs — no times, no `[Music]` tags,
  no chopped-up caption lines. Sentences are rebuilt and grouped into readable
  paragraphs. Page numbers at the bottom.

---

## If it says “No transcript/captions are available”

- Make sure the video actually has captions (click the **CC** button — if it's
  greyed out, YouTube has none for that video, so there's nothing to export).
- Some videos only offer captions after you open them once; press play, then try.
- As a fallback, open YouTube's own transcript panel (••• under the video →
  **Show transcript**) and click the icon again — the extension will read it.

---

## Notes

- **Privacy:** the transcript is read and turned into a PDF entirely inside
  your browser. No servers, no accounts, no tracking.
- **How it reads the transcript:** it opens YouTube's own "Show transcript"
  panel invisibly for a moment, reads the text, and closes it again. (YouTube's
  raw caption download URLs no longer work outside its own player, so the panel
  is the reliable way in.)
- **Languages:** you get the transcript language YouTube shows by default in
  its panel (usually the video's original language). Latin-script languages
  (English, Spanish, French, German, etc.) render fully. Non-Latin scripts
  (e.g. Chinese, Arabic) aren't supported by the built-in PDF font yet.
- **Auto-captions without punctuation** (older videos) can't be split into true
  sentences, so the text is grouped into evenly-sized readable blocks instead.

---

## Files in this folder

| File | What it is |
|------|-----------|
| `manifest.json` | Extension definition (Manifest V3) |
| `background.js` | Grabs the transcript, builds the PDF, triggers the download |
| `lib.js` | The text-cleaning, sentence-splitting and PDF-writing engine |
| `icons/` | Toolbar icons |
| `generate_icons.py` | Regenerates the icons (optional; needs Python 3) |
| `test.js` | Optional self-tests (optional; needs Node.js) |

To customize the look (font size, margins, sentences-per-paragraph), edit the
values near the top of `buildPdf` and `groupParagraphs` in `lib.js`.
