/**
 * lint-slop.ts: find the fingerprints of AI motion slop in a HyperFrames project's HTML, CSS and JS.
 *
 * The principle: generated motion graphics share a look that viewers now recognise in a second:
 * soft drop shadows on every card, radial glows and vignettes, a CSS filter pretending to be a
 * colour grade, things sliding at constant speed, everything bouncing, emoji standing in for design,
 * three competing calls to action, a font zoo. None of these is wrong once, on purpose. They are
 * slop when they arrive by default. This linter makes each one a decision: fix it, or keep it with a
 * written reason. It also catches the things that break a HyperFrames render outright (randomness,
 * clocks, timers, network) because every frame must be a pure function of time.
 *
 * Usage:
 *   npx tsx lint-slop.ts [project-dir] [--config slop.config.json] [--json] [--strict] [--list-rules]
 *   node --test lint-slop.test.ts        (the rule tests)
 *
 * Output: path:line:col  severity  rule  message, then the offending line. Exit status 1 when any
 * error is found (with --strict, any warning too), 2 on a usage error.
 *
 * Keeping something on purpose: put a comment with a reason on the same line or the line above
 * (for CSS, above the rule's selector also works):
 *   box-shadow: 0 2px 0 #000;   /* slop-ok: hard offset shadow is the print look *\/
 *   // slop-ok(nondeterministic): seeded once at build time, identical on every worker
 *   <!-- slop-ok: the only emoji is the product's own logo glyph -->
 * A slop-ok without a reason is ignored and reported. slop-ok(rule-a,rule-b) limits it to those rules.
 *
 * Configuration: slop.config.json in the project (or --config). Everything is optional:
 *   {
 *     "rules": [   // your own banned patterns, e.g. from a loves/hates list
 *       { "id": "no-neon", "pattern": "#0ff\\b|#00ffff|cyan", "flags": "i", "files": ["css", "html", "js"],
 *         "severity": "error", "message": "Neon cyan is on the hates list" }
 *     ],
 *     "disable": ["font-count"],               // built-in rules to switch off
 *     "severity": { "linear-move": "error" },  // change a rule's severity
 *     "ignore": ["assets/vendor/**"],          // globs (relative to the project) to skip
 *     "maxFonts": 4,
 *     "ctaSelector": "btn|button|cta",         // selectors allowed to carry a shadow (regex)
 *     "characterNames": "mascot|character|creature|puppet|avatar",   // actors allowed to overshoot
 *     "sceneFiles": "(^|/)s\\d+[\\w-]*\\.js$", // files that must not hard-code seconds
 *     "timingTable": "auto"                    // true | false | "auto" (a plan.js/plan.json exists)
 *   }
 * Rule files (key "files") name languages: css (stylesheets and <style>), js (scripts and <script>),
 * html (markup outside <style>/<script>). Comments are never matched.
 *
 * Scanned: .html .htm .css .js .mjs, skipping node_modules, .git, renders, dist, build, scripts,
 * .cache and *.min.js.
 *
 * Requirements: Node 20+ (Node 22.18+ runs the tests without tsx).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export type Severity = 'error' | 'warn';
export type Lang = 'css' | 'js' | 'html';
export type Finding = { file: string; line: number; col: number; rule: string; severity: Severity; message: string; snippet: string };
export type UserRule = { id: string; pattern: string; flags?: string; files?: Lang[]; severity?: Severity; message: string };
export type Config = {
	rules?: UserRule[];
	disable?: string[];
	severity?: Record<string, Severity>;
	ignore?: string[];
	maxFonts?: number;
	ctaSelector?: string;
	characterNames?: string;
	sceneFiles?: string;
	timingTable?: boolean | 'auto';
};

/** A slice of a file in one language, with comments blanked out (same length, newlines kept). */
type Region = { lang: Lang; start: number; code: string };
type SourceFile = { path: string; rel: string; text: string; lines: string[]; lineStarts: number[]; regions: Region[] };
type Hit = { offset: number; message: string; anchors?: number[] };
type Ctx = { file: SourceFile; files: SourceFile[]; cfg: Required<Omit<Config, 'rules' | 'disable' | 'severity' | 'ignore'>>; timingTable: boolean };
type Rule = { id: string; severity: Severity; about: string; check: (ctx: Ctx) => Hit[] };

// ------------------------------------------------------------------------------------ lexing
function blank(s: string): string {
	return s.replace(/[^\n]/g, ' ');
}

/** Blank JS comments, keeping strings, template literals and regex literals intact. */
export function maskJs(src: string): string {
	let out = '';
	let i = 0;
	let prev = ''; // last significant char, to tell a regex literal from a division
	while (i < src.length) {
		const c = src[i];
		const n = src[i + 1];
		if (c === '/' && n === '/') {
			const end = src.indexOf('\n', i);
			const stop = end < 0 ? src.length : end;
			out += blank(src.slice(i, stop));
			i = stop;
			continue;
		}
		if (c === '/' && n === '*') {
			const end = src.indexOf('*/', i + 2);
			const stop = end < 0 ? src.length : end + 2;
			out += blank(src.slice(i, stop));
			i = stop;
			continue;
		}
		if (c === '"' || c === "'" || c === '`') {
			let j = i + 1;
			while (j < src.length && src[j] !== c) {
				if (src[j] === '\\') j++;
				else if (c !== '`' && src[j] === '\n') break;
				j++;
			}
			out += src.slice(i, j + 1);
			i = j + 1;
			prev = c;
			continue;
		}
		if (c === '/' && (prev === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev))) {
			let j = i + 1;
			let inClass = false;
			while (j < src.length && src[j] !== '\n') {
				if (src[j] === '\\') j++;
				else if (src[j] === '[') inClass = true;
				else if (src[j] === ']') inClass = false;
				else if (src[j] === '/' && !inClass) break;
				j++;
			}
			out += src.slice(i, j + 1);
			i = j + 1;
			prev = '/';
			continue;
		}
		out += c;
		if (!/\s/.test(c)) prev = c;
		i++;
	}
	return out;
}

/** Blank CSS comments. */
export function maskCss(src: string): string {
	return src.replace(/\/\*[\s\S]*?(\*\/|$)/g, blank);
}

function regionsFor(path: string, text: string): Region[] {
	if (/\.css$/i.test(path)) return [{ lang: 'css', start: 0, code: maskCss(text) }];
	if (/\.(m?js|cjs)$/i.test(path)) return [{ lang: 'js', start: 0, code: maskJs(text) }];
	// HTML: markup with comments and <style>/<script> bodies blanked, plus one region per body
	let markup = text.replace(/<!--[\s\S]*?(-->|$)/g, blank);
	const regions: Region[] = [];
	const block = /(<(style|script)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi;
	for (const m of markup.matchAll(block)) {
		const bodyStart = (m.index ?? 0) + m[1].length;
		const body = text.slice(bodyStart, bodyStart + m[3].length);
		const lang: Lang = m[2].toLowerCase() === 'style' ? 'css' : 'js';
		if (lang === 'js' && /type\s*=\s*["']?(application\/json|importmap|text\/template)/i.test(m[1])) continue;
		regions.push({ lang, start: bodyStart, code: lang === 'css' ? maskCss(body) : maskJs(body) });
	}
	for (const r of regions) markup = markup.slice(0, r.start) + blank(markup.slice(r.start, r.start + r.code.length)) + markup.slice(r.start + r.code.length);
	regions.unshift({ lang: 'html', start: 0, code: markup });
	return regions;
}

function loadFile(root: string, path: string): SourceFile {
	const text = readFileSync(path, 'utf8');
	const lineStarts = [0];
	for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
	return { path, rel: relative(root, path).split(sep).join('/'), text, lines: text.split('\n'), lineStarts, regions: regionsFor(path, text) };
}

function lineOf(f: SourceFile, offset: number): { line: number; col: number } {
	let lo = 0;
	let hi = f.lineStarts.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (f.lineStarts[mid] <= offset) lo = mid;
		else hi = mid - 1;
	}
	return { line: lo + 1, col: offset - f.lineStarts[lo] + 1 };
}

function* matches(f: SourceFile, re: RegExp, langs: Lang[]): Generator<{ m: RegExpMatchArray; offset: number; region: Region }> {
	const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
	for (const r of f.regions) {
		if (!langs.includes(r.lang)) continue;
		for (const m of r.code.matchAll(g)) yield { m, offset: r.start + (m.index ?? 0), region: r };
	}
}

// ------------------------------------------------------------------------------------ CSS helpers
type CssBlock = { selector: string; selStart: number; start: number; end: number };

/** Rule blocks of a CSS region: selector text, where it starts, and the body span (file offsets). */
function cssBlocks(r: Region): CssBlock[] {
	const blocks: CssBlock[] = [];
	const stack: { selector: string; selStart: number; start: number }[] = [];
	let segStart = 0;
	const s = r.code;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (c === '"' || c === "'") {
			const j = s.indexOf(c, i + 1);
			i = j < 0 ? s.length : j;
		} else if (c === '{') {
			const raw = s.slice(segStart, i);
			const lead = raw.length - raw.trimStart().length;
			stack.push({ selector: raw.trim(), selStart: r.start + segStart + lead, start: r.start + i + 1 });
			segStart = i + 1;
		} else if (c === '}') {
			const top = stack.pop();
			if (top) blocks.push({ ...top, end: r.start + i });
			segStart = i + 1;
		} else if (c === ';') {
			segStart = i + 1;
		}
	}
	return blocks;
}

function enclosing(blocks: CssBlock[], offset: number): CssBlock | undefined {
	let best: CssBlock | undefined;
	for (const b of blocks) if (b.start <= offset && offset <= b.end && (!best || b.start > best.start)) best = b;
	return best;
}

type Decl = { prop: string; value: string; offset: number; block?: CssBlock };

/** CSS declarations in stylesheets, <style> blocks and style="" attributes. */
function declarations(f: SourceFile): Decl[] {
	const out: Decl[] = [];
	for (const r of f.regions) {
		if (r.lang === 'css') {
			const blocks = cssBlocks(r);
			for (const m of r.code.matchAll(/(^|[;{\s])(-?[a-zA-Z-]+)\s*:\s*([^;{}]*)/g)) {
				const offset = r.start + (m.index ?? 0) + m[1].length;
				const block = enclosing(blocks, offset);
				if (!block || block.selector.startsWith('@font-face')) continue;
				out.push({ prop: m[2].toLowerCase(), value: m[3].trim(), offset, block });
			}
		} else if (r.lang === 'html') {
			for (const m of r.code.matchAll(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/gi)) {
				const bodyStart = r.start + (m.index ?? 0) + m[0].indexOf(m[2]);
				for (const d of m[2].matchAll(/(^|;)\s*([a-zA-Z-]+)\s*:\s*([^;]*)/g)) {
					out.push({ prop: d[2].toLowerCase(), value: d[3].trim(), offset: bodyStart + (d.index ?? 0) + d[1].length });
				}
			}
		}
	}
	return out;
}

/** The opening tag around an offset in markup (for style="" attributes). */
function tagAt(f: SourceFile, offset: number): string {
	const open = f.text.lastIndexOf('<', offset);
	const close = f.text.indexOf('>', offset);
	return open >= 0 && close > open ? f.text.slice(open, close + 1) : '';
}

// ------------------------------------------------------------------------------------ JS helpers
/** Index of the bracket matching the one at `open` (string-aware), or -1. */
function matchBracket(s: string, open: number): number {
	const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
	const stack: string[] = [];
	for (let i = open; i < s.length; i++) {
		const c = s[i];
		if (c === '"' || c === "'" || c === '`') {
			let j = i + 1;
			while (j < s.length && s[j] !== c) j += s[j] === '\\' ? 2 : 1;
			i = j;
		} else if (pairs[c]) stack.push(pairs[c]);
		else if (c === ')' || c === '}' || c === ']') {
			if (stack.pop() !== c) return -1;
			if (stack.length === 0) return i;
		}
	}
	return -1;
}

/** Index of the unmatched opening bracket `ch` before `pos`, or -1. */
function openerBefore(s: string, pos: number, ch: '{' | '('): number {
	const close = ch === '{' ? '}' : ')';
	let depth = 0;
	for (let i = pos - 1; i >= 0; i--) {
		if (s[i] === close) depth++;
		else if (s[i] === ch) {
			if (depth === 0) return i;
			depth--;
		}
	}
	return -1;
}

/** Top-level comma-separated arguments of the call whose '(' is at `open`. */
function callArgs(s: string, open: number): { text: string; start: number }[] {
	const end = matchBracket(s, open);
	if (end < 0) return [];
	const args: { text: string; start: number }[] = [];
	let depth = 0;
	let segStart = open + 1;
	for (let i = open + 1; i < end; i++) {
		const c = s[i];
		if (c === '"' || c === "'" || c === '`') {
			let j = i + 1;
			while (j < end && s[j] !== c) j += s[j] === '\\' ? 2 : 1;
			i = j;
		} else if ('([{'.includes(c)) depth++;
		else if (')]}'.includes(c)) depth--;
		else if (c === ',' && depth === 0) {
			args.push({ text: s.slice(segStart, i), start: segStart });
			segStart = i + 1;
		}
	}
	if (s.slice(segStart, end).trim()) args.push({ text: s.slice(segStart, end), start: segStart });
	return args;
}

const POSITION_ARG: Record<string, number> = { to: 2, from: 2, set: 2, fromTo: 3, add: 1, addLabel: 1, call: 2, addPause: 0 };

// ------------------------------------------------------------------------------------ rules
const MOVE_KEYS = /\b(x|y|left|top|right|bottom|xPercent|yPercent|motionPath|translate[XYZ]?)\s*:/;
const GENERIC_FONTS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', 'inherit', 'initial', 'unset', 'revert', 'emoji', 'math', '-apple-system', 'blinkmacsystemfont']);

function ctaTokens(cls: string): boolean {
	const t = new Set(cls.split(/\s+/).filter(Boolean));
	for (const k of ['cta', 'cta-primary', 'primary-cta', 'btn-primary', 'button-primary', 'button--primary', 'btn--primary']) if (t.has(k)) return true;
	return t.has('primary') && (t.has('btn') || t.has('button'));
}

const BUILTIN: Rule[] = [
	{
		id: 'shadow',
		severity: 'error',
		about: 'box-shadow or drop-shadow on something that is not a button or CTA',
		check: ({ file, cfg }) => {
			const cta = new RegExp(cfg.ctaSelector, 'i');
			const hits: Hit[] = [];
			for (const d of declarations(file)) {
				const isShadow = (d.prop === 'box-shadow' && !/^none\b/i.test(d.value) && !/\binset\b/i.test(d.value)) || (/^(-webkit-)?filter$/.test(d.prop) && /drop-shadow\s*\(/i.test(d.value));
				if (!isShadow) continue;
				const owner = d.block ? d.block.selector : tagAt(file, d.offset);
				if (cta.test(owner)) continue;
				hits.push({ offset: d.offset, message: `shadow on "${owner.replace(/\s+/g, ' ').slice(0, 60)}": soft shadows on cards are the default AI look; use contrast, borders or real depth`, anchors: d.block ? [d.block.selStart] : [] });
			}
			for (const { offset, region } of matches(file, /\bboxShadow\s*:|['"`][^'"`\n]*box-shadow\s*:/, ['js'])) {
				const line = region.code.slice(region.code.lastIndexOf('\n', offset - region.start) + 1, region.code.indexOf('\n', offset - region.start));
				if (!cta.test(line)) hits.push({ offset, message: 'shadow set from script on something that is not a button or CTA' });
			}
			return hits;
		}
	},
	{
		id: 'radial-gradient',
		severity: 'error',
		about: 'radial-gradient (glows, spotlights and orbs)',
		check: ({ file }) => [...matches(file, /\b(repeating-)?radial-gradient\s*\(/, ['css', 'js', 'html'])].map(({ offset }) => ({ offset, message: 'radial-gradient: glows and spotlight orbs are the default AI backdrop; light the scene with shapes, colour and composition' }))
	},
	{
		id: 'vignette',
		severity: 'error',
		about: 'vignette overlays (a class or id named vignette, or a large inset shadow)',
		check: ({ file }) => {
			const hits: Hit[] = [...matches(file, /vignette/i, ['css', 'js', 'html'])].map(({ offset }) => ({ offset, message: 'vignette: darkened edges are a filter look, not a design; frame the subject instead' }));
			for (const d of declarations(file)) {
				if (d.prop !== 'box-shadow' || !/\binset\b/i.test(d.value)) continue;
				const lengths = [...d.value.matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
				if (lengths.some((v) => v >= 40)) hits.push({ offset: d.offset, message: 'large inset shadow: a vignette in disguise', anchors: d.block ? [d.block.selStart] : [] });
			}
			return hits;
		}
	},
	{
		id: 'filter-grade',
		severity: 'error',
		about: 'grayscale/sepia/saturate/hue-rotate filters used to fake a colour world',
		check: ({ file }) => [...matches(file, /\b(grayscale|greyscale|sepia|saturate|hue-rotate)\s*\(/i, ['css', 'js', 'html'])].map(({ offset, m }) => ({ offset, message: `${m[1]}(): a CSS filter over the picture reads as a filter; design each colour world's palette directly` }))
	},
	{
		id: 'linear-move',
		severity: 'warn',
		about: 'ease "none"/linear on a position move',
		check: ({ file }) => {
			const hits: Hit[] = [];
			for (const { offset, region, m } of matches(file, /\bease\s*:\s*(['"`])(none|linear|power0(\.\w+)?|Linear\.easeNone|sine\.none)\1/, ['js'])) {
				const at = offset - region.start;
				const open = openerBefore(region.code, at, '{');
				const close = open >= 0 ? matchBracket(region.code, open) : -1;
				const obj = open >= 0 && close > 0 ? region.code.slice(open, close + 1) : '';
				if (MOVE_KEYS.test(obj)) hits.push({ offset, message: `ease "${m[2]}" on a position move: constant speed looks mechanical; ease in and out (power2/power3) or give it a curve` });
			}
			// CSS: a linear transition of position, or a linear animation whose keyframes move something
			const moving = new Set<string>();
			for (const r of file.regions) {
				if (r.lang !== 'css') continue;
				for (const b of cssBlocks(r)) {
					const k = /^@(-webkit-)?keyframes\s+([\w-]+)/.exec(b.selector);
					if (k && /translate|\b(left|top|right|bottom)\s*:/.test(file.text.slice(b.start, b.end))) moving.add(k[2]);
				}
			}
			for (const d of declarations(file)) {
				if (!/\blinear\b/.test(d.value)) continue;
				const transition = /^transition(-timing-function)?$/.test(d.prop) && /transform|translate|\b(left|top|right|bottom|all)\b/.test(d.value);
				const animation = /^animation$/.test(d.prop) && d.value.split(/[\s,]+/).some((t) => moving.has(t));
				if (transition || animation) hits.push({ offset: d.offset, message: 'linear timing on a CSS move: constant speed looks mechanical', anchors: d.block ? [d.block.selStart] : [] });
			}
			return hits;
		}
	},
	{
		id: 'overshoot-ease',
		severity: 'warn',
		about: 'back/elastic/bounce eases on actors that are not characters',
		check: ({ file, cfg }) => {
			const character = new RegExp(cfg.characterNames, 'i');
			const hits: Hit[] = [];
			for (const { offset, region, m } of matches(file, /\bease\s*:\s*(['"`])((back|elastic|bounce)[\w.]*(\([^)]*\))?)\1/i, ['js'])) {
				const at = offset - region.start;
				const paren = openerBefore(region.code, at, '(');
				const call = paren >= 0 ? region.code.slice(Math.max(0, paren - 60), matchBracket(region.code, paren) + 1) : region.code.slice(Math.max(0, at - 120), at);
				if (character.test(call)) continue;
				hits.push({ offset, message: `ease "${m[2]}" on a non-character: overshoot on UI and type is the default AI bounce; reserve it for characters and settle with power3/expo` });
			}
			for (const d of declarations(file)) {
				const cb = /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(d.value);
				if (!cb) continue;
				const y1 = Number(cb[2]);
				const y2 = Number(cb[4]);
				if ((y1 > 1 || y1 < 0 || y2 > 1 || y2 < 0) && !character.test(d.block?.selector ?? tagAt(file, d.offset))) {
					hits.push({ offset: d.offset, message: 'overshooting cubic-bezier on a non-character', anchors: d.block ? [d.block.selStart] : [] });
				}
			}
			return hits;
		}
	},
	{
		id: 'nondeterministic',
		severity: 'error',
		about: 'Math.random, clocks, timers or network in the composition',
		check: ({ file }) =>
			[...matches(file, /\b(Math\.random|Date\.now|new\s+Date|performance\.now|fetch|XMLHttpRequest|setTimeout|setInterval|requestAnimationFrame)\b\s*\(?/, ['js'])].map(({ offset, m }) => {
				const what = m[1].replace(/\s+/, ' ');
				const timer = /setTimeout|setInterval|requestAnimationFrame/.test(what);
				const net = /fetch|XMLHttpRequest/.test(what);
				let why = 'every frame must be a pure function of time; use a seeded hash of the frame or element index';
				if (timer) why = 'timers do not run when the renderer seeks frames; drive it from the timeline';
				if (net) why = 'network results differ between render workers; inline the data';
				return { offset, message: `${what}: ${why}` };
			})
	},
	{
		id: 'emoji',
		severity: 'error',
		about: 'emoji characters in text',
		check: ({ file }) => [...matches(file, /\p{Emoji_Presentation}|\p{Extended_Pictographic}️/u, ['html', 'js', 'css'])].map(({ offset, m }) => ({ offset, message: `emoji "${m[0]}": renders as a box without an emoji font in headless Chrome, and reads as filler; draw an icon` }))
	},
	{
		id: 'multiple-primary-cta',
		severity: 'error',
		about: 'more than one element marked as the primary CTA in one scene',
		check: ({ file, cfg }) => {
			const scenes = new RegExp(cfg.sceneFiles);
			// a scene file is one scene; other scripts (shared UI builders) are not counted
			if (/\.m?js$/.test(file.rel) && !scenes.test(file.rel)) return [];
			const markers: number[] = [];
			const segStarts: number[] = [0];
			for (const r of file.regions) {
				if (r.lang === 'css') continue;
				for (const m of r.code.matchAll(/\bclass(?:Name)?\s*[=:]\s*(["'`])([^"'`]*)\1/g)) if (ctaTokens(m[2])) markers.push(r.start + (m.index ?? 0));
				for (const m of r.code.matchAll(/\bdata-(cta|primary)\b(?!-)/g)) markers.push(r.start + (m.index ?? 0));
				for (const m of r.code.matchAll(/classList\.add\(([^)]*)\)/g)) if (ctaTokens(m[1].replace(/['"`,]/g, ' '))) markers.push(r.start + (m.index ?? 0));
				if (r.lang === 'html' && !scenes.test(file.rel)) {
					for (const m of r.code.matchAll(/<(section|div|article)\b[^>]*(\bdata-composition-id\b|\bdata-scene\b|class\s*=\s*["'][^"']*\bscene\b)[^>]*>/gi)) segStarts.push(r.start + (m.index ?? 0));
				}
			}
			const hits: Hit[] = [];
			const starts = [...new Set(segStarts)].sort((a, b) => a - b);
			for (let s = 0; s < starts.length; s++) {
				const lo = starts[s];
				const hi = s + 1 < starts.length ? starts[s + 1] : Infinity;
				const inScene = markers.filter((o) => o >= lo && o < hi).sort((a, b) => a - b);
				for (const o of inScene.slice(1)) hits.push({ offset: o, message: `a second primary CTA in this scene (first on line ${lineOf(file, inScene[0]).line}): one scene, one thing to do` });
			}
			return hits;
		}
	},
	{
		id: 'font-count',
		severity: 'warn',
		about: 'more font families than maxFonts across the project',
		check: ({ file, files, cfg }) => {
			// project-wide: report once, from the file where the first family over the limit appears
			const seen: { family: string; file: SourceFile; offset: number }[] = [];
			for (const f of files) {
				const decls = declarations(f).filter((d) => d.prop === 'font-family' || (d.prop.startsWith('--') && d.prop.includes('font') && /["']|,/.test(d.value)));
				const js = [...matches(f, /\bfontFamily\s*:\s*(['"`])([^'"`]+)\1/, ['js'])].map(({ m, offset }) => ({ value: m[2], offset }));
				for (const d of [...decls.map((d) => ({ value: d.value, offset: d.offset })), ...js]) {
					const first = d.value.split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();
					if (!first || GENERIC_FONTS.has(first) || first.startsWith('var(')) continue;
					if (!seen.some((s) => s.family === first)) seen.push({ family: first, file: f, offset: d.offset });
				}
			}
			if (seen.length <= cfg.maxFonts) return [];
			const over = seen[cfg.maxFonts];
			if (over.file !== file) return [];
			return [{ offset: over.offset, message: `${seen.length} font families (${seen.map((s) => s.family).join(', ')}), more than ${cfg.maxFonts}: pick one display face and one text face` }];
		}
	},
	{
		id: 'hardcoded-time',
		severity: 'warn',
		about: 'raw seconds as GSAP positions in scene files when the project has a timing table',
		check: ({ file, cfg, timingTable }) => {
			if (!timingTable || !new RegExp(cfg.sceneFiles).test(file.rel)) return [];
			const hits: Hit[] = [];
			const num = /^\s*[+-]?(\d+\.?\d*|\.\d+)\s*($|[-+*/])/;
			for (const { offset, region, m } of matches(file, /\.(to|from|fromTo|set|add|addLabel|call|addPause)\s*\(/, ['js'])) {
				const open = offset - region.start + m[0].length - 1;
				const args = callArgs(region.code, open);
				const pos = args[POSITION_ARG[m[1]]];
				if (!pos) continue;
				const lit = num.exec(pos.text);
				if (lit && Number(lit[1]) !== 0) hits.push({ offset: region.start + pos.start + (pos.text.length - pos.text.trimStart().length), message: `raw time ${lit[1]} s as a timeline position: take it from the timing table (PLAN.at, a VO word, a scene start)` });
			}
			for (const { offset, m } of matches(file, /\b(at|start|time)\s*:\s*(\d+\.?\d*|\.\d+)\b/, ['js'])) {
				if (Number(m[2]) !== 0) hits.push({ offset, message: `raw time ${m[2]} s in "${m[1]}:": take it from the timing table` });
			}
			return hits;
		}
	}
];

// ------------------------------------------------------------------------------------ engine
const DEFAULTS = {
	maxFonts: 4,
	ctaSelector: 'btn|button|cta',
	characterNames: 'mascot|character|creature|puppet|avatar',
	sceneFiles: '(^|/)s\\d+[\\w-]*\\.js$',
	timingTable: 'auto' as boolean | 'auto'
};
const SKIP_DIRS = new Set(['node_modules', '.git', 'renders', 'dist', 'build', 'scripts', '.cache']);

function globToRegExp(glob: string): RegExp {
	const re = glob
		.split('**')
		.map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]'))
		.join('.*');
	return new RegExp(`^${re}$`);
}

function walk(root: string, ignore: RegExp[]): string[] {
	const out: string[] = [];
	const visit = (dir: string) => {
		for (const name of readdirSync(dir).sort()) {
			const p = join(dir, name);
			const rel = relative(root, p).split(sep).join('/');
			if (ignore.some((r) => r.test(rel))) continue;
			if (statSync(p).isDirectory()) {
				if (!SKIP_DIRS.has(name)) visit(p);
			} else if (/\.(html?|css|m?js)$/i.test(name) && !/\.min\.js$/i.test(name)) {
				out.push(p);
			}
		}
	};
	visit(root);
	return out;
}

function userRule(u: UserRule): Rule {
	if (!u.id || !u.pattern || !u.message) throw new Error(`slop.config.json: each rule needs id, pattern and message (${JSON.stringify(u)})`);
	const re = new RegExp(u.pattern, (u.flags ?? '').replace('g', ''));
	const langs = u.files ?? (['css', 'js', 'html'] as Lang[]);
	return { id: u.id, severity: u.severity ?? 'error', about: u.message, check: ({ file }) => [...matches(file, re, langs)].map(({ offset }) => ({ offset, message: u.message })) };
}

const OK_RE = /slop-ok(?:\(([\w\s,-]+)\))?(\s*:\s*([^*\n]*?))?\s*(\*\/|-->|$)/;

/** Is this finding allowlisted by a slop-ok comment on its line, on a comment-only line right above
 * it, or likewise at an anchor line (a CSS rule's selector)? A trailing comment on the line above
 * belongs to that line, not to this one. */
function allowed(f: SourceFile, lines: number[], rule: string): 'yes' | 'no' | 'no-reason' {
	let noReason = false;
	for (const ln of lines) {
		for (const l of [ln, ln - 1]) {
			const text = f.lines[l - 1];
			if (!text) continue;
			if (l !== ln && !/^\s*(\/\/|\/\*|\*|<!--)/.test(text)) continue;
			const m = OK_RE.exec(text);
			if (!m) continue;
			const scoped = m[1] ? m[1].split(',').map((s) => s.trim()) : null;
			if (scoped && !scoped.includes(rule)) continue;
			if (!m[3] || !m[3].trim()) {
				noReason = true;
				continue;
			}
			return 'yes';
		}
	}
	return noReason ? 'no-reason' : 'no';
}

export function loadConfig(root: string, explicit?: string): Config {
	const p = explicit ?? join(root, 'slop.config.json');
	if (!existsSync(p)) {
		if (explicit) throw new Error(`config not found: ${explicit}`);
		return {};
	}
	return JSON.parse(readFileSync(p, 'utf8')) as Config;
}

export function rulesFor(config: Config): Rule[] {
	const disabled = new Set(config.disable ?? []);
	const rules = [...BUILTIN, ...(config.rules ?? []).map(userRule)].filter((r) => !disabled.has(r.id));
	return rules.map((r) => ({ ...r, severity: config.severity?.[r.id] ?? r.severity }));
}

export function lintProject(rootDir: string, config: Config = {}): Finding[] {
	const root = resolve(rootDir);
	const cfg = { ...DEFAULTS, ...Object.fromEntries(Object.entries(config).filter(([k]) => k in DEFAULTS)) } as Ctx['cfg'];
	const ignore = (config.ignore ?? []).map(globToRegExp);
	const files = walk(root, ignore).map((p) => loadFile(root, p));
	let timingTable = cfg.timingTable === true;
	if (cfg.timingTable === 'auto') timingTable = files.some((f) => /(^|\/)(plan|timing)[\w-]*\.(js|json)$/.test(f.rel)) || existsSync(join(root, 'plan.json'));
	const rules = rulesFor(config);
	const findings: Finding[] = [];
	for (const file of files) {
		for (const rule of rules) {
			for (const hit of rule.check({ file, files, cfg, timingTable })) {
				const { line, col } = lineOf(file, hit.offset);
				const anchors = (hit.anchors ?? []).map((o) => lineOf(file, o).line);
				const ok = allowed(file, [line, ...anchors], rule.id);
				if (ok === 'yes') continue;
				const snippet = (file.lines[line - 1] ?? '').trim().slice(0, 140);
				findings.push({ file: file.rel, line, col, rule: rule.id, severity: rule.severity, message: hit.message, snippet });
				if (ok === 'no-reason') findings.push({ file: file.rel, line, col, rule: 'slop-ok-reason', severity: 'warn', message: 'slop-ok needs a reason after the colon; it was ignored', snippet });
			}
		}
	}
	findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.col - b.col);
	return findings;
}

function main(argv: string[]): number {
	const args = [...argv];
	const flag = (name: string) => {
		const i = args.indexOf(name);
		if (i < 0) return false;
		args.splice(i, 1);
		return true;
	};
	const value = (name: string) => {
		const i = args.indexOf(name);
		if (i < 0) return undefined;
		const v = args[i + 1];
		args.splice(i, 2);
		return v;
	};
	if (flag('--help') || flag('-h')) {
		console.log('usage: npx tsx lint-slop.ts [project-dir] [--config slop.config.json] [--json] [--strict] [--list-rules]');
		return 0;
	}
	const json = flag('--json');
	const strict = flag('--strict');
	const list = flag('--list-rules');
	const configPath = value('--config');
	const unknown = args.filter((a) => a.startsWith('-'));
	if (unknown.length || args.length > 1) {
		console.error(`unknown arguments: ${[...unknown, ...args.slice(1)].join(' ')}`);
		return 2;
	}
	const root = resolve(args[0] ?? '.');
	if (!existsSync(root) || !statSync(root).isDirectory()) {
		console.error(`not a directory: ${root}`);
		return 2;
	}
	const config = loadConfig(root, configPath);
	if (list) {
		for (const r of rulesFor(config)) console.log(`${r.severity.padEnd(5)}  ${r.id.padEnd(22)} ${r.about}`);
		return 0;
	}
	const findings = lintProject(root, config);
	const errors = findings.filter((f) => f.severity === 'error').length;
	const warns = findings.length - errors;
	if (json) {
		console.log(JSON.stringify({ errors, warnings: warns, findings }, null, 2));
	} else {
		for (const f of findings) console.log(`${f.file}:${f.line}:${f.col}  ${f.severity.padEnd(5)}  ${f.rule}  ${f.message}\n    ${f.snippet}`);
		console.log(`\n${errors} error(s), ${warns} warning(s) in ${root}`);
	}
	return errors > 0 || (strict && warns > 0) ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		process.exitCode = main(process.argv.slice(2));
	} catch (err) {
		console.error(err instanceof Error ? err.message : err);
		process.exitCode = 2;
	}
}
