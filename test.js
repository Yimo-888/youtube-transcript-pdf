// Optional unit tests (run with: node test.js). Not needed to use the extension —
// this just documents/verifies the text + PDF logic. Requires Node 16+.
import { writeFileSync } from "node:fs";
import { cleanText, splitSentences, groupParagraphs, buildPdf } from "./lib.js";

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };

// messy, punctuated caption fragments
const A = [
  "[Music]",
  "Hey  everyone, welcome back\nto the channel.",
  "Today we&#39;re going to talk",
  "about Dr. Smith’s three big ideas — focus,",
  "energy, and time.",
  "It costs $3.50 in the U.S.",
  "Let’s get started!",
  "[Applause]"
];
const cleanA = cleanText(A);
console.log("clean =>", cleanA);
ok(!/\[Music\]|\[Applause\]/.test(cleanA), "brackets removed");
ok(cleanA.includes("we're"), "&#39; decoded");
ok(!cleanA.includes("  "), "whitespace collapsed");
ok(cleanA.includes("U.S.") && cleanA.includes("$3.50"), "abbreviations/decimals intact");

const sents = splitSentences(cleanA);
console.log("sentences:", sents);
ok(sents.length >= 3, "sentences split");
ok(!sents.some((s) => /Dr\.$/.test(s)), "no split on 'Dr.'");

const paras = groupParagraphs(sents, 4, 520);
ok(paras.length >= 1 && paras.length <= sents.length, "paragraphs grouped");

// no-punctuation (auto-caption) fallback
const B = [Array.from({ length: 60 }, (_, i) => "word" + i).join(" ")];
ok(splitSentences(cleanText(B)).length >= 2, "no-punctuation text chunked");

// multi-page PDF
const many = Array.from({ length: 90 }, (_, k) =>
  `This is sentence number ${k + 1}, written to fill several pages so we can verify wrapping and pagination.`);
const pdf = buildPdf({
  title: "A Long YouTube Video Title About Focus, Energy & Time",
  author: "Example Channel",
  paragraphs: groupParagraphs(many, 4, 520)
});
ok(pdf instanceof Uint8Array, "buildPdf returns bytes");
ok(Buffer.from(pdf.slice(0, 8)).toString() === "%PDF-1.4", "PDF header");
ok(Buffer.from(pdf).includes("%%EOF"), "PDF trailer");
writeFileSync("sample.pdf", pdf);
console.log(`wrote sample.pdf (${pdf.length} bytes)`);

console.log("\n" + (fails ? `${fails} FAILED` : "ALL TESTS PASSED"));
process.exit(fails ? 1 : 0);
