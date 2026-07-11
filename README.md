# YouTube Transcript → Clean PDF

A tiny Chrome (Manifest V3) extension: click the toolbar icon on any YouTube
video and it saves the full transcript as a **clean, readable PDF** — no
timestamps, no `[Music]` tags, caption fragments re-joined into real sentences
that flow as paragraphs.

Everything runs locally in your browser. No servers, no accounts, no tracking,
no dependencies.

## Install & use

See **[INSTALL.md](INSTALL.md)** — it's a one-minute "Load unpacked" setup:

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick this folder.
2. Open any YouTube video that has captions and click the extension icon.
3. The PDF lands in your Downloads folder, named after the video.

## How it works

- YouTube's raw caption endpoints no longer respond outside its own player
  (they require a proof-of-origin token), so the extension opens YouTube's own
  "Show transcript" panel **invisibly**, reads the rendered segments, and
  closes it again.
- The text is cleaned (HTML entities, bracketed tags, smart punctuation),
  split into sentences abbreviation-aware, grouped into paragraphs, and laid
  out into a PDF by a small dependency-free writer (`lib.js`) — Helvetica,
  US Letter, page numbers.

## Files

| File | What it is |
|------|-----------|
| `manifest.json` | Extension definition (MV3) |
| `background.js` | Service worker: grabs the transcript, builds the PDF, triggers the download |
| `lib.js` | Text-cleaning, sentence-splitting and PDF-writing engine (pure, unit-testable) |
| `test.js` | Optional self-tests (`node test.js`) |
| `generate_icons.py` | Regenerates the toolbar icons (optional, Python 3) |

## Limitations

- The transcript language is whatever YouTube's panel shows by default
  (usually the video's original language).
- The built-in PDF font covers Latin scripts; non-Latin scripts (Chinese,
  Arabic, …) aren't rendered yet.
