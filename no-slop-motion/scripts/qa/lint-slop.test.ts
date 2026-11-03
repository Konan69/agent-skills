/**
 * Tests for lint-slop.ts. Run: node --test lint-slop.test.ts   (Node 22.18+; or npx tsx --test)
 *
 * The fixtures under fixtures/lint-slop/ are small projects: "slop" holds one instance of every rule
 * plus the look-alikes that must NOT fire (a CTA's shadow, a character's overshoot, a comment, an
 * allowlisted line), "clean" must pass untouched, "warn-only" has only a warning. Findings are
 * located by the text of the line they point at, so the fixtures can be edited without renumbering.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { type Finding, lintProject, loadConfig, maskJs } from './lint-slop.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures', 'lint-slop');
const slopDir = join(fixtures, 'slop');
const slop = lintProject(slopDir, loadConfig(slopDir));

/** Line number (1-based) of the first line in a fixture file containing `needle`. */
function lineWith(file: string, needle: string): number {
	const lines = readFileSync(join(slopDir, file), 'utf8').split('\n');
	const i = lines.findIndex((l) => l.includes(needle));
	assert.ok(i >= 0, `fixture ${file} has no line containing ${needle}`);
	return i + 1;
}

function at(findings: Finding[], file: string, needle: string): Finding[] {
	const line = lineWith(file, needle);
	return findings.filter((f) => f.file === file && f.line === line);
}

function fires(rule: string, file: string, needle: string) {
	const here = at(slop, file, needle);
	assert.ok(here.some((f) => f.rule === rule), `${rule} should fire on "${needle}" in ${file}; found: ${here.map((f) => f.rule).join(', ') || 'nothing'}`);
}

function silent(file: string, needle: string, rule?: string) {
	const here = at(slop, file, needle).filter((f) => !rule || f.rule === rule);
	assert.equal(here.length, 0, `nothing should fire on "${needle}" in ${file}; found: ${here.map((f) => f.rule).join(', ')}`);
}

test('every built-in rule fires on its fixture line', () => {
	fires('shadow', 'index.html', '.card { box-shadow');
	fires('shadow', 'index.html', '<div style="box-shadow');
	fires('radial-gradient', 'index.html', 'radial-gradient(circle');
	fires('vignette', 'index.html', '.frame-vignette');
	fires('vignette', 'index.html', 'inset 0 0 120px');
	fires('filter-grade', 'index.html', 'grayscale(1)');
	fires('linear-move', 'index.html', 'transform 0.6s linear');
	fires('linear-move', 'assets/js/s1-hook.js', "x: 400, duration: 1, ease: 'none'");
	fires('overshoot-ease', 'assets/js/s1-hook.js', "ease: 'back.out(2)'");
	fires('overshoot-ease', 'index.html', 'cubic-bezier(0.3, 1.6');
	fires('nondeterministic', 'index.html', 'Math.random()');
	fires('nondeterministic', 'index.html', 'setTimeout(');
	fires('emoji', 'index.html', 'late again. \u{1F680}');
	fires('multiple-primary-cta', 'index.html', 'class="btn primary"');
	fires('multiple-primary-cta', 'assets/js/s1-hook.js', '<a class="cta">Pay now');
	fires('font-count', 'index.html', 'font-family: Futura');
	fires('hardcoded-time', 'assets/js/s1-hook.js', "'back.out(2)' }, 2.4)");
	fires('hardcoded-time', 'assets/js/s1-hook.js', '{ at: 3.1 }');
});

test('look-alikes that are fine do not fire', () => {
	silent('index.html', '.btn-buy { box-shadow'); // a CTA may carry a shadow
	silent('index.html', 'animation: turn 2s linear'); // a linear spin moves nothing
	silent('index.html', '.ghost { box-shadow'); // inside a comment
	silent('index.html', "const url = 'https://acme.test/a//b'"); // "//" in a string is not a comment
	silent('index.html', '<a class="cta">Try Acme'); // the only CTA of the second scene
	silent('assets/js/s1-hook.js', 'mascot, { y: -20'); // characters may overshoot
	silent('assets/js/s1-hook.js', 'tl.set(el, { opacity: 1 }, 0)'); // zero is the film start
	silent('assets/js/s1-hook.js', 'rotation: 360'); // linear rotation is not a position move
	silent('assets/js/plan.js', 'window.PLAN'); // the timing table itself holds seconds
});

test('slop-ok with a reason allowlists; scoped slop-ok only covers its rules', () => {
	// .hero's shadow sits on its own line; the slop-ok comment is above the selector
	assert.ok(!slop.some((f) => f.snippet === 'box-shadow: 0 1px 0 #000;'), '.hero shadow should be allowlisted');
	silent('assets/js/s1-hook.js', 'const built = Date.now()');
	fires('nondeterministic', 'assets/js/s1-hook.js', 'const seed = performance.now()'); // slop-ok(emoji) does not cover it
});

test('slop-ok without a reason is ignored and reported', () => {
	fires('shadow', 'index.html', '.tag { box-shadow');
	fires('slop-ok-reason', 'index.html', '.tag { box-shadow');
});

test('user rules from slop.config.json fire; disable and severity overrides apply', () => {
	fires('no-neon', 'index.html', '#00FFFF');
	const tuned = lintProject(slopDir, { ...loadConfig(slopDir), disable: ['emoji'], severity: { 'linear-move': 'error' } });
	assert.ok(!tuned.some((f) => f.rule === 'emoji'));
	assert.ok(tuned.filter((f) => f.rule === 'linear-move').every((f) => f.severity === 'error'));
	assert.ok(!lintProject(slopDir, {}).some((f) => f.rule === 'no-neon'), 'no config, no user rule');
});

test('a clean project has no findings', () => {
	assert.deepEqual(lintProject(join(fixtures, 'clean')), []);
});

test('comments are blanked without touching strings or regex literals', () => {
	const src = "a = 'http://x'; // Math.random()\nb = /\\/\\//.test(s); /* c */ d";
	const out = maskJs(src);
	assert.equal(out.length, src.length);
	assert.ok(out.includes("'http://x'"));
	assert.ok(!out.includes('Math.random'));
	assert.ok(out.includes('/\\/\\//.test(s)'));
	assert.ok(!out.includes('/* c */'));
});

test('CLI exit codes: errors fail, warnings pass unless --strict', () => {
	const cli = (...args: string[]) => spawnSync(process.execPath, [join(here, 'lint-slop.ts'), ...args], { encoding: 'utf8' }).status;
	assert.equal(cli(slopDir), 1);
	assert.equal(cli(join(fixtures, 'clean')), 0);
	assert.equal(cli(join(fixtures, 'warn-only')), 0);
	assert.equal(cli(join(fixtures, 'warn-only'), '--strict'), 1);
	assert.equal(cli(join(fixtures, 'nope')), 2);
});
