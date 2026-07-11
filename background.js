// background.js — service worker (module).
// Flow: user clicks the toolbar icon on a YouTube video ->
//   1. inject extractInPage() to pull the caption fragments from the tab
//   2. clean + split into sentences + group into paragraphs (lib.js)
//   3. render a PDF and drop it into Downloads.

import { transcriptToParagraphs, buildPdf } from "./lib.js";

const VIDEO_URL = /^https?:\/\/(www\.|m\.)?youtube\.com\/(watch|shorts)/i;

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;

  if (!tab.url || !VIDEO_URL.test(tab.url)) {
    await toast(tab.id, "Open a YouTube video page, then click the icon.", true);
    return;
  }

  try {
    await toast(tab.id, "Fetching transcript…", false, 8000);

    const injected = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractInPage
    });
    const result = injected && injected[0] && injected[0].result;

    if (!result || !result.segments || !result.segments.length) {
      await toast(
        tab.id,
        "No transcript found. If the video has captions, open its transcript " +
        "(description → “Show transcript”) and click the icon again.",
        true, 6000
      );
      return;
    }

    const paragraphs = transcriptToParagraphs(result.segments);
    if (!paragraphs.length) {
      await toast(tab.id, "The transcript came back empty.", true);
      return;
    }

    const pdf = buildPdf({
      title: result.title || "YouTube Transcript",
      author: result.author || "",
      paragraphs
    });

    const filename = sanitizeFilename(result.title || "youtube-transcript") + ".pdf";
    await chrome.downloads.download({
      url: bytesToDataUrl(pdf),
      filename,
      saveAs: false
    });

    await toast(tab.id, "Transcript PDF saved to Downloads ✓", false);
  } catch (err) {
    await toast(tab.id, "Could not build the PDF: " + (err && err.message ? err.message : err), true);
  }
});

/* ---------- helpers that run in the service worker ---------- */

function sanitizeFilename(name) {
  return (name || "")
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "youtube-transcript";
}

function bytesToDataUrl(bytes) {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return "data:application/pdf;base64," + btoa(bin);
}

async function toast(tabId, message, isError, ms) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: showToast,
      args: [message, !!isError, ms || 3500]
    });
  } catch (e) { /* tab may not allow injection; ignore */ }
}

/* ---------- functions injected INTO the YouTube page ---------- */
// Runs in the page's isolated world (DOM access, no page JS globals).
//
// Why we scrape the transcript panel instead of calling YouTube's caption APIs:
//   - The classic timedtext URLs (captionTracks[].baseUrl) now require a
//     proof-of-origin token; without it YouTube returns an empty 200 body.
//   - The InnerTube get_transcript endpoint requires a BotGuard attestation
//     blob that only the page's own runtime can produce.
// So we let YouTube's own UI do the authorized work: open the "Show
// transcript" panel (kept invisible via opacity:0 so nothing flashes),
// wait for the segments to render, scrape them, then close the panel.

async function extractInPage() {
  const PANEL_SEL =
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function getSegments() {
    const nodes = document.querySelectorAll("ytd-transcript-segment-renderer");
    if (!nodes.length) return null;
    const segs = [];
    nodes.forEach((n) => {
      const el = n.querySelector(".segment-text") ||
                 n.querySelector('[class*="segment-text"]');
      let v = ((el ? el.textContent : n.textContent) || "").trim();
      // Without .segment-text we got the whole row — strip the leading timestamp.
      if (!el) v = v.replace(/^\s*(?:\d+:)?\d{1,2}:\d{2}\s*/, "");
      if (v) segs.push(v);
    });
    return segs.length ? segs : null;
  }

  function transcriptButton() {
    // Structural selector first (locale-independent), aria-label as fallback.
    return document.querySelector("ytd-video-description-transcript-section-renderer button") ||
           document.querySelector('button[aria-label*="ranscript"]');
  }

  async function openPanelAndScrape() {
    let btn = transcriptButton();
    if (!btn) {
      // The transcript section may only exist once the description is expanded.
      const expander = document.querySelector(
        "#description-inline-expander #expand, tp-yt-paper-button#expand"
      );
      if (expander) { expander.click(); await sleep(350); btn = transcriptButton(); }
    }
    if (!btn) return null;

    // opacity (not display:none) keeps the panel rendering while invisible.
    const style = document.createElement("style");
    style.textContent = PANEL_SEL + "{opacity:0 !important; pointer-events:none !important;}";
    document.documentElement.appendChild(style);

    let segs = null;
    try {
      btn.click();
      for (let waited = 0; waited < 10000 && !segs; waited += 250) {
        await sleep(250);
        segs = getSegments();
      }
    } finally {
      const panel = document.querySelector(PANEL_SEL);
      const close = panel && panel.querySelector(
        '#visibility-button button, button[aria-label*="lose"]'
      );
      if (close) close.click();
      style.remove();
    }
    return segs;
  }

  // Legacy fallback: captionTracks + timedtext fetch. Dead for most videos
  // (empty 200s without a proof-of-origin token) but harmless to try if the
  // panel machinery ever changes under us.
  async function legacyTimedtext() {
    function extractJsonVar(html, name) {
      const key = html.indexOf(name);
      if (key < 0) return null;
      const start = html.indexOf("{", key);
      if (start < 0) return null;
      let depth = 0, inStr = false, esc = false;
      let i = start;
      for (; i < html.length; i++) {
        const c = html[i];
        if (inStr) {
          if (esc) esc = false;
          else if (c === "\\") esc = true;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') { inStr = true; continue; }
        if (c === "{") depth++;
        else if (c === "}") { depth--; if (depth === 0) { i++; break; } }
      }
      try { return JSON.parse(html.slice(start, i)); } catch (e) { return null; }
    }

    function pickTrack(tracks) {
      const eng = (t) => (t.languageCode || "").toLowerCase().indexOf("en") === 0;
      const manual = (t) => t.kind !== "asr";
      return tracks.find((t) => eng(t) && manual(t)) ||
             tracks.find((t) => manual(t)) ||
             tracks.find((t) => eng(t)) ||
             tracks[0];
    }

    try {
      const res = await fetch(location.href, { credentials: "include" });
      const html = await res.text();
      const pr = extractJsonVar(html, "ytInitialPlayerResponse");
      const tracks = pr && pr.captions &&
        pr.captions.playerCaptionsTracklistRenderer &&
        pr.captions.playerCaptionsTracklistRenderer.captionTracks;
      if (!tracks || !tracks.length) return null;
      const track = pickTrack(tracks);
      if (!track || !track.baseUrl) return null;

      const url = track.baseUrl + (track.baseUrl.indexOf("?") >= 0 ? "&" : "?") + "fmt=json3";
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) return null;
      const data = await r.json();
      if (!data || !data.events) return null;
      const segs = [];
      for (const ev of data.events) {
        if (!ev.segs) continue;
        const lineText = ev.segs.map((s) => s.utf8 || "").join("");
        if (lineText.trim()) segs.push(lineText);
      }
      return segs.length ? segs : null;
    } catch (e) {
      return null;
    }
  }

  function getMeta() {
    let title = "";
    const h1 = document.querySelector("h1.ytd-watch-metadata yt-formatted-string, h1 yt-formatted-string");
    if (h1) title = (h1.textContent || "").trim();
    if (!title) {
      title = (document.title || "")
        .replace(/^\(\d+\)\s*/, "")            // "(3) Title" unread-count prefix
        .replace(/\s*-\s*YouTube\s*$/i, "")
        .trim();
    }
    const ownerEl = document.querySelector(
      "#owner ytd-channel-name a, ytd-video-owner-renderer ytd-channel-name a"
    );
    const author = ownerEl ? (ownerEl.textContent || "").trim() : "";
    return { title: title || null, author: author || null };
  }

  const meta = getMeta();
  let segments = getSegments();                         // panel already rendered
  if (!segments) segments = await openPanelAndScrape(); // main path
  if (!segments) segments = await legacyTimedtext();    // legacy fallback

  return { segments: segments || [], title: meta.title, author: meta.author };
}

function showToast(message, isError, ms) {
  const id = "ytt-pdf-toast";
  const old = document.getElementById(id);
  if (old) old.remove();
  const d = document.createElement("div");
  d.id = id;
  d.textContent = message;
  Object.assign(d.style, {
    position: "fixed", zIndex: "2147483647", left: "50%", bottom: "32px",
    transform: "translateX(-50%)",
    background: isError ? "#b3261e" : "#0f9d58", color: "#fff",
    padding: "12px 18px", borderRadius: "10px", maxWidth: "80vw",
    font: "500 14px/1.35 Roboto, Arial, sans-serif",
    boxShadow: "0 6px 20px rgba(0,0,0,.35)", pointerEvents: "none"
  });
  document.body.appendChild(d);
  setTimeout(() => {
    d.style.transition = "opacity .4s";
    d.style.opacity = "0";
    setTimeout(() => d.remove(), 420);
  }, ms);
}
