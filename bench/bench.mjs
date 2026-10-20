// rough skim benchmark: CPU per reply on synthetic replies, and the marked share of real stored replies
//
//   npx esbuild plugins/skim/hooks/highlight-core.ts --format=esm --outfile=/tmp/skim-core.mjs
//   node bench/bench.mjs /tmp/skim-core.mjs [~/.claude/plugins/store/skim_*.json]
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const core = await import(pathToFileURL(process.argv[2]).href);
const { parseMarks, hashText, keepMarks, shownMarks, canSkim, layout, MAX_KEPT } = core;

const SENTENCES = [
    "The hook runs once for every reply that streams in, and again whenever the terminal redraws it.",
    "Most of the cost is splitting the text into lines and finding where each mark sits.",
    "A fenced block is passed through untouched, since marks never go inside code.",
    "Lists keep their bullets apart so that a wrapped item still hangs under its marker.",
    "Headings stay bright under skim, so the reply keeps its outline while the rest fades.",
    "None of this touches the network or the disk, apart from saving the marks once per reply.",
];

// a markdown reply of about `size` chars: headings, paragraphs, a list and a code block, with three marked sentences
function reply(size) {
    const parts = [];
    let n = 0;
    let i = 0;
    while (n < size) {
        const s = SENTENCES[i % SENTENCES.length];
        const block =
            i % 9 === 0
                ? `## Section ${i / 9 + 1}`
                : i % 7 === 0
                  ? "```ts\nconst x = layout(clean, marks, true);\nconsole.log(x.length);\n```"
                  : i % 5 === 0
                    ? `- ${s}\n- ${s}\n- ${s}`
                    : `${s} ${SENTENCES[(i + 1) % SENTENCES.length]} ${SENTENCES[(i + 2) % SENTENCES.length]}`;
        parts.push(block);
        n += block.length + 2;
        i++;
    }
    // mark the first sentence of three paragraphs spread through the reply
    const paras = parts.map((p, k) => [p, k]).filter(([p]) => !p.startsWith("#") && !p.startsWith("```") && !p.startsWith("-"));
    for (const at of [0, Math.floor(paras.length / 2), paras.length - 1]) {
        const [p, k] = paras[at];
        const end = p.indexOf(". ") + 1;
        parts[k] = `==${p.slice(0, end)}==${p.slice(end)}`;
    }
    return parts.join("\n\n");
}

function time(fn, iters) {
    for (let i = 0; i < 200; i++) fn();
    const runs = [];
    for (let r = 0; r < 7; r++) {
        const t = process.hrtime.bigint();
        for (let i = 0; i < iters; i++) fn();
        runs.push(Number(process.hrtime.bigint() - t) / iters / 1000);
    }
    runs.sort((a, b) => a - b);
    return runs[3];
}

const fullKept = Array.from({ length: MAX_KEPT }, (_, i) => [`h${i}`, ["a marked sentence."]]);

console.log("size\tmarks\tappend_us\trender_us");
for (const size of [1500, 5000, 20000]) {
    const text = reply(size);
    const { clean, marks } = parseMarks(text);
    const iters = size > 10000 ? 500 : 2000;
    // session.append: once per reply, against a full store of 500 kept replies
    const append = time(() => {
        const p = parseMarks(text);
        keepMarks(fullKept, hashText(p.clean), p.marks);
    }, iters);
    // ui.render: each time the terminal draws the reply
    const render = time(() => {
        const p = parseMarks(text);
        hashText(p.clean);
        const shown = shownMarks(p.marks);
        layout(p.clean, shown, canSkim(p.clean, shown));
    }, iters);
    console.log(`${clean.length}\t${marks.length}\t${append.toFixed(1)}\t${render.toFixed(1)}`);
}

if (!process.argv[3]) process.exit(0);

// real replies: each kept key ends in the stored text's length in hex, after the 8-hex FNV hash
const kept = JSON.parse(readFileSync(process.argv[3], "utf8")).highlightMarks;
const rows = kept.map(([h, m]) => {
    const len = parseInt(h.slice(8), 16);
    const marked = m.reduce((n, s) => n + s.length, 0);
    return { len, marks: m.length, share: marked / len, ask: /[?？]$/.test(m[m.length - 1] ?? "") };
});
const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];
const explain = rows.filter((r) => !r.ask);
const shares = explain.map((r) => r.share);
console.log("\nreal replies kept:", rows.length, " brainstorm (ask):", rows.length - explain.length);
console.log("explanations:", explain.length);
console.log("  length chars  median", pct(explain.map((r) => r.len), 0.5), " p90", pct(explain.map((r) => r.len), 0.9));
console.log("  marks/reply   median", pct(explain.map((r) => r.marks), 0.5), " max", Math.max(...explain.map((r) => r.marks)));
console.log("  marked share  median", (pct(shares, 0.5) * 100).toFixed(1) + "%", " p90", (pct(shares, 0.9) * 100).toFixed(1) + "%",
    " mean", ((shares.reduce((a, b) => a + b, 0) / shares.length) * 100).toFixed(1) + "%");
console.log("  over 1/3 (drawn undimmed):", explain.filter((r) => r.share > 1 / 3).length);
console.log("  over 4 marks (old cap):", explain.filter((r) => r.marks > 4).length);
