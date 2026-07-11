// lib.js — pure, dependency-free logic for the YouTube Transcript → Clean PDF extension.
// Everything here is deterministic and runs in the service worker (no DOM, no network).
// It is also directly unit-testable with jsc/node (see test.js).

/* ------------------------------------------------------------------ *
 *  1. TEXT CLEANING
 * ------------------------------------------------------------------ */

// Decode the handful of HTML entities that can survive in caption text.
function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return safeCodePoint(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (_, d) { return safeCodePoint(parseInt(d, 10)); });
}

function safeCodePoint(n) {
  try { return String.fromCodePoint(n); } catch (e) { return ""; }
}

// Normalise "smart" punctuation down to plain ASCII so the built-in PDF font
// renders it cleanly. Accented Latin letters are left intact (WinAnsi covers them).
function normalizePunct(s) {
  if (!s) return "";
  return s
    .replace(/[‘’‛′]/g, "'")     // ' ' ‛ ′  -> '
    .replace(/[“”‟″]/g, '"')     // " " ‟ ″  -> "
    .replace(/\s*[–—―]\s*/g, " - ")   // – — ―     -> " - "
    .replace(/…/g, "...")                        // …         -> ...
    .replace(/[•·●]/g, " ")           // • · ●     -> space
    .replace(/ /g, " ")                          // nbsp      -> space
    .replace(/[​-‍﻿]/g, "");          // zero-width -> gone
}

// Turn an array of raw caption fragments into one continuous, clean text string.
function cleanText(segments) {
  var text = Array.isArray(segments) ? segments.join(" ") : String(segments || "");
  text = decodeEntities(text);
  text = text.replace(/\[[^\]\n]{0,40}\]/g, " ");        // drop [Music], [Applause], ...
  text = text.replace(/^\s*>>+\s*/gm, " ");              // drop ">>" speaker markers
  text = normalizePunct(text);
  text = text.replace(/\s+/g, " ").trim();               // un-break caption line splits
  text = text.replace(/\s+([,.!?;:])/g, "$1");           // no space before punctuation
  // Add a missing space only when it's unambiguous — a lowercase letter glued to
  // the next word. This leaves abbreviations (U.S.), decimals (3.50) and initials intact.
  text = text.replace(/([a-z])([.!?])([A-Z])/g, "$1$2 $3");
  text = text.replace(/([a-z]),([A-Za-z])/g, "$1, $2");
  return text.trim();
}

/* ------------------------------------------------------------------ *
 *  2. SENTENCE SPLITTING
 * ------------------------------------------------------------------ */

var ABBREVIATIONS = [
  "Mr", "Mrs", "Ms", "Dr", "Prof", "Sr", "Jr", "St", "vs", "etc", "Inc", "Ltd",
  "Co", "Corp", "Fig", "No", "Vol", "pp", "Dept", "Gen", "Col", "Capt", "Lt",
  "Sgt", "approx", "al", "Rd", "Ave", "Mt", "Ft", "e.g", "i.e", "a.m", "p.m",
  "U.S", "U.K", "Ph.D"
];

function chunkByWords(text, n) {
  var words = text.split(/\s+/).filter(Boolean);
  var out = [];
  for (var i = 0; i < words.length; i += n) {
    out.push(words.slice(i, i + n).join(" "));
  }
  return out;
}

// Split continuous text into sentences. Falls back to fixed-size word chunks when
// the source has essentially no punctuation (common with older auto-captions).
function splitSentences(text) {
  if (!text) return [];
  var terminators = (text.match(/[.!?]/g) || []).length;

  // Very little punctuation for the amount of text -> can't rely on sentence marks.
  if (terminators < 3 || terminators < text.length / 400) {
    return chunkByWords(text, 22);
  }

  var s = " " + text + " ";

  // Protect dots that are NOT sentence ends so we don't split on them.
  s = s.replace(/\.\.\.+/g, "<ELL>");                                  // ellipses
  for (var i = 0; i < ABBREVIATIONS.length; i++) {
    var a = ABBREVIATIONS[i].replace(/\./g, "\\.");
    s = s.replace(new RegExp("\\b" + a + "\\.", "g"), function (m) {
      return m.replace(/\./g, "<DOT>");
    });
  }
  s = s.replace(/(\d)\.(\d)/g, "$1<DOT>$2");     // decimals: 3.14
  s = s.replace(/\b([A-Z])\./g, "$1<DOT>");      // single-letter initials: J. F. K.

  // A boundary is a run of . ! ? (with optional closing quote/paren) that is
  // followed by whitespace + a capital/number, or the end of the string.
  var boundary = /[.!?]+["'\)\]]?(?=\s+["'\(\[]?[A-Z0-9]|\s*$)/g;
  var sentences = [];
  var last = 0, m;
  while ((m = boundary.exec(s)) !== null) {
    var end = m.index + m[0].length;
    sentences.push(s.slice(last, end));
    last = end;
    if (boundary.lastIndex <= end) boundary.lastIndex = end; // guard against zero-width
  }
  if (last < s.length) sentences.push(s.slice(last));

  return sentences
    .map(function (x) { return x.replace(/<DOT>/g, ".").replace(/<ELL>/g, "...").trim(); })
    .filter(Boolean);
}

/* ------------------------------------------------------------------ *
 *  3. PARAGRAPH GROUPING (for the "flowing paragraphs" layout)
 * ------------------------------------------------------------------ */

function groupParagraphs(sentences, perPara, maxChars) {
  perPara = perPara || 4;
  maxChars = maxChars || 520;
  var paras = [];
  var cur = [];
  var curLen = 0;
  for (var i = 0; i < sentences.length; i++) {
    var sen = sentences[i];
    cur.push(sen);
    curLen += sen.length + 1;
    if (cur.length >= perPara || curLen >= maxChars) {
      paras.push(cur.join(" "));
      cur = [];
      curLen = 0;
    }
  }
  if (cur.length) paras.push(cur.join(" "));
  return paras;
}

/* ------------------------------------------------------------------ *
 *  4. MINIMAL PDF WRITER  (Helvetica / Helvetica-Bold, WinAnsi)
 * ------------------------------------------------------------------ */

// Helvetica advance widths (/1000 em) for ASCII 32..126.
var HELV_W = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
  334, 260, 334, 584
];

// A few WinAnsi code points for punctuation that might slip past normalizePunct.
var WINANSI = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x2039: 0x8B,
  0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x2122: 0x99, 0x203A: 0x9B
};

function charWidth(ch, size, bold) {
  var code = ch.charCodeAt(0);
  var w = (code >= 32 && code <= 126) ? HELV_W[code - 32] : 556;
  if (bold) w = w * 1.06; // Helvetica-Bold runs a touch wider; keep wrapping safe.
  return (w / 1000) * size;
}

function measure(str, size, font) {
  var bold = font === "F2";
  var w = 0;
  for (var i = 0; i < str.length; i++) w += charWidth(str[i], size, bold);
  return w;
}

function wrapText(text, maxW, size, font) {
  var words = text.split(/\s+/).filter(Boolean);
  var lines = [];
  var cur = "";
  for (var w = 0; w < words.length; w++) {
    var word = words[w];
    // Break a single word that is wider than the column.
    while (measure(word, size, font) > maxW && word.length > 1) {
      var i = word.length;
      while (i > 1 && measure(word.slice(0, i), size, font) > maxW) i--;
      if (cur) { lines.push(cur); cur = ""; }
      lines.push(word.slice(0, i));
      word = word.slice(i);
    }
    var trial = cur ? cur + " " + word : word;
    if (measure(trial, size, font) <= maxW) {
      cur = trial;
    } else {
      if (cur) lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function fmtNum(n) {
  var r = Math.round(n * 100) / 100;
  return String(r);
}

// Encode one text run into PDF-string bytes (WinAnsi), escaping ( ) \.
function encodePdfText(str) {
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var code = str.codePointAt(i);
    if (code > 0xFFFF) i++; // consumed a surrogate pair
    if (code === 0x28) { bytes.push(0x5c, 0x28); continue; }   // (
    if (code === 0x29) { bytes.push(0x5c, 0x29); continue; }   // )
    if (code === 0x5c) { bytes.push(0x5c, 0x5c); continue; }   // \
    if (code >= 0x20 && code <= 0x7e) { bytes.push(code); continue; }
    if (code >= 0xa0 && code <= 0xff) { bytes.push(code); continue; } // Latin-1 accents
    if (WINANSI[code] !== undefined) { bytes.push(WINANSI[code]); continue; }
    bytes.push(0x3f); // '?'
  }
  return bytes;
}

var PAGE_W = 612, PAGE_H = 792, MARGIN = 72;
var CONTENT_W = PAGE_W - 2 * MARGIN;

// Lay text out into pages, then serialise to a PDF byte array (Uint8Array).
function buildPdf(opts) {
  var title = normalizePunct(String(opts.title || "")).replace(/[\x00-\x1f]/g, " ").trim();
  var author = normalizePunct(String(opts.author || "")).replace(/[\x00-\x1f]/g, " ").trim();
  var paragraphs = opts.paragraphs || [];

  var TITLE_SIZE = 17, TITLE_LEAD = 22;
  var META_SIZE = 10.5, META_LEAD = 15;
  var BODY_SIZE = 11, BODY_LEAD = 15.5;
  var PARA_GAP = 7;

  var pages = [[]];
  var pageIdx = 0;
  var y = PAGE_H - MARGIN;

  function newPage() { pages.push([]); pageIdx++; y = PAGE_H - MARGIN; }
  function line(text, font, size, lead) {
    if (y < MARGIN) newPage();
    pages[pageIdx].push({ text: text, x: MARGIN, y: y, font: font, size: size });
    y -= lead;
  }

  // --- Header (page 1 only) ---
  if (title) {
    var tLines = wrapText(title, CONTENT_W, TITLE_SIZE, "F2");
    for (var t = 0; t < tLines.length; t++) line(tLines[t], "F2", TITLE_SIZE, TITLE_LEAD);
    y -= 3;
  }
  if (author) {
    var aLines = wrapText(author, CONTENT_W, META_SIZE, "F1");
    for (var a = 0; a < aLines.length; a++) line(aLines[a], "F1", META_SIZE, META_LEAD);
  }
  if (title || author) {
    y -= 6;
    pages[pageIdx].push({ rule: true, x: MARGIN, y: y, x2: PAGE_W - MARGIN });
    y -= 16;
  }

  // --- Body: flowing paragraphs ---
  for (var p = 0; p < paragraphs.length; p++) {
    var bLines = wrapText(paragraphs[p], CONTENT_W, BODY_SIZE, "F1");
    for (var b = 0; b < bLines.length; b++) line(bLines[b], "F1", BODY_SIZE, BODY_LEAD);
    y -= PARA_GAP;
  }

  // --- Page numbers ---
  for (var i = 0; i < pages.length; i++) {
    var label = String(i + 1);
    var lw = measure(label, 9, "F1");
    pages[i].push({ text: label, x: (PAGE_W - lw) / 2, y: 36, font: "F1", size: 9 });
  }

  return serializePdf(pages);
}

function buildPageStream(items) {
  var b = [];
  function put(s) { for (var i = 0; i < s.length; i++) b.push(s.charCodeAt(i) & 0xff); }
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (it.rule) {
      put("q 0.75 G 0.6 w " + fmtNum(it.x) + " " + fmtNum(it.y) + " m " +
          fmtNum(it.x2) + " " + fmtNum(it.y) + " l S Q\n");
    } else {
      put("BT /" + it.font + " " + fmtNum(it.size) + " Tf 1 0 0 1 " +
          fmtNum(it.x) + " " + fmtNum(it.y) + " Tm (");
      var enc = encodePdfText(it.text);
      for (var k = 0; k < enc.length; k++) b.push(enc[k]);
      put(") Tj ET\n");
    }
  }
  return b;
}

function serializePdf(pages) {
  var out = [];
  var offsets = {};
  function put(s) { for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff); }
  function putRaw(arr) { for (var i = 0; i < arr.length; i++) out.push(arr[i]); }
  function beginObj(n) { offsets[n] = out.length; put(n + " 0 obj\n"); }
  function endObj() { put("\nendobj\n"); }

  put("%PDF-1.4\n");
  putRaw([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]); // binary marker comment

  // 1 Catalog, 2 Pages, 3 Helvetica, 4 Helvetica-Bold
  beginObj(1); put("<< /Type /Catalog /Pages 2 0 R >>"); endObj();

  beginObj(2);
  var kids = pages.map(function (_, i) { return (5 + 2 * i) + " 0 R"; }).join(" ");
  put("<< /Type /Pages /Count " + pages.length + " /Kids [" + kids + "] >>");
  endObj();

  beginObj(3);
  put("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  endObj();
  beginObj(4);
  put("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  endObj();

  for (var i = 0; i < pages.length; i++) {
    var pnum = 5 + 2 * i, cnum = 6 + 2 * i;
    var stream = buildPageStream(pages[i]);

    beginObj(pnum);
    put("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + PAGE_W + " " + PAGE_H + "]" +
        " /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents " + cnum + " 0 R >>");
    endObj();

    beginObj(cnum);
    put("<< /Length " + stream.length + " >>\nstream\n");
    putRaw(stream);
    put("\nendstream");
    endObj();
  }

  var maxObj = 4 + 2 * pages.length;
  var size = maxObj + 1;
  var xrefOffset = out.length;
  put("xref\n0 " + size + "\n");
  put("0000000000 65535 f \n");
  for (var n = 1; n < size; n++) {
    var off = offsets[n] || 0;
    put(String(off).padStart ? String(off).padStart(10, "0") : padLeft(String(off), 10) );
    put(" 00000 n \n");
  }
  put("trailer\n<< /Size " + size + " /Root 1 0 R >>\nstartxref\n" + xrefOffset + "\n%%EOF");

  return new Uint8Array(out);
}

function padLeft(s, n) { while (s.length < n) s = "0" + s; return s; }

/* ------------------------------------------------------------------ *
 *  5. TOP-LEVEL: raw caption fragments -> finished PDF bytes
 * ------------------------------------------------------------------ */

function transcriptToParagraphs(segments) {
  var text = cleanText(segments);
  var sentences = splitSentences(text);
  return groupParagraphs(sentences, 4, 520);
}

export {
  cleanText,
  normalizePunct,
  splitSentences,
  groupParagraphs,
  transcriptToParagraphs,
  buildPdf
};
