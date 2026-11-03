/* Render the film with sound: picture from HyperFrames, audio mixed from the film's own timing table.

   usage (from the project root, or pass --project):
     npx tsx scripts/render/render.ts [options]

   options:
     --project <dir>       the HyperFrames project (default: current directory)
     --quality <q>         draft | standard | high (default: standard). Passed to `hyperframes render`.
                           draft is for checking motion and timing. standard is usually enough for
                           delivery. high uses a much slower x264 preset: expect several times the encode
                           time for a difference few viewers can see after a social platform re-encodes it.
     --workers <n|auto>    parallel Chrome capture workers (default: auto)
     --out <file>          final MP4 (default: renders/<meta.json id>.mp4)
     --audio-only          picture lock: skip the picture render and remix audio onto the cached picture
                           (renders/.cache/picture.mp4) or onto --picture <file>. Use it while tuning
                           VO, music and SFX levels: a remix takes seconds instead of a full render.
     --picture <file>      picture to use with --audio-only
     --data-only           export resolved film data to renders/.cache/film.json and stop
     --help                print usage without setup, browser access or rendering
     --x                   also write <out>-x.mp4, an H.264/AAC export sized to stay under X's 512 MB
                           upload limit (the bitrate is capped from the film's duration)
     --loudnorm / --no-loudnorm
                           force loudness normalisation on or off (default: on when any VO or music was
                           placed; off for an SFX-only mix, which normalisation would boost to a roar)

   What it does:
     1. reads the film data (timing table, placed VO takes, SFX cue sheet) out of the composition itself:
        E.mount() writes it as JSON into #film-data, and a bare headless Chrome prints the DOM with
        --dump-dom. No Playwright or Puppeteer install, no hard-coded Chrome path: the Chrome is the one
        HyperFrames already manages (`hyperframes browser path`), or $CHROME_PATH if set.
     2. renders the picture with the project's pinned HyperFrames version (read from package.json)
        into renders/.cache/picture.mp4, plus a fingerprint of every picture input.
     3. mixes music, voiceover and SFX with mix.py (next to this file): VO normalised to about -16 dBFS
        RMS over its speech, music ducked under it, SFX from assets/sfx/<name>.wav. Missing VO takes
        are skipped with a warning, so the starter renders before any audio exists.
     4. normalises loudness to -14 LUFS integrated with peaks under -1.5 dBTP (measured with ffmpeg's
        ebur128 meter, then one gain for the whole mix, so it is turned up or down rather than
        compressed; a limiter only if peaks would clip) and muxes, copying the video.

   Linux note: Chrome keeps frame buffers in /dev/shm. Containers often mount it at 64 MB, which makes
   HyperFrames fall back to slow one-frame-at-a-time capture (a render can take many times longer). The
   fix is `sudo mount -o remount,size=4G /dev/shm` (or `--shm-size=4g` for Docker). This script warns
   when /dev/shm is under 1 GB.

   Run browser-backed work on the configured execution machine, with Jev steps for preview inspection.
   Requirements: Node 20+, ffmpeg and ffprobe on PATH, python3 with numpy, soundfile, librosa
   (install scripts/render/requirements.txt in a project-local environment). */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statfsSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type FilmData = {
	title: string;
	fps: number;
	duration: number;
	vo: { id: string; onset: number; file?: string }[];
	sfx: { t: number; sfx: string; db: number }[];
	music: { file?: string | null };
	warnings: string[];
};
type MixReport = { vo_placed: number; music: boolean; sfx_placed: number; missing: string[]; peak: number };

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_HF_VERSION = '0.8.78';

// ---- arguments ----------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv.includes('--help')) {
	console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].slice(2).trim());
	process.exit(0);
}
process.env.HYPERFRAMES_NO_TELEMETRY = '1';
process.env.DO_NOT_TRACK = '1';
const flag = (name: string) => argv.includes(`--${name}`);
function opt(name: string, fallback: string): string {
	const i = argv.indexOf(`--${name}`);
	if (i < 0) return fallback;
	const v = argv[i + 1];
	if (!v || v.startsWith('--')) throw new Error(`--${name} needs a value`);
	return v;
}

const project = resolve(opt('project', process.cwd()));
const quality = opt('quality', 'standard');
const workers = opt('workers', 'auto');
const audioOnly = flag('audio-only');
const wantX = flag('x');
if (!['draft', 'standard', 'high'].includes(quality)) throw new Error(`--quality must be draft, standard or high (got ${quality})`);
if (!existsSync(join(project, 'index.html'))) throw new Error(`no index.html in ${project}: pass --project <dir>`);

const cache = join(project, 'renders', '.cache');
mkdirSync(cache, { recursive: true });
const PICTURE = audioOnly && argv.includes('--picture') ? resolve(opt('picture', '')) : join(cache, 'picture.mp4');
const FINGERPRINT = join(cache, 'picture.json');

function projectId(): string {
	try {
		const meta = JSON.parse(readFileSync(join(project, 'meta.json'), 'utf8'));
		if (meta.id) return String(meta.id);
	} catch {
		// no meta.json: fall back to the folder name
	}
	return basename(project);
}
const out = resolve(opt('out', join(project, 'renders', `${projectId()}.mp4`)));

// ---- helpers ------------------------------------------------------------------------------------------
function run(cmd: string, args: string[], opts: { quiet?: boolean } = {}): string {
	const r = spawnSync(cmd, args, { cwd: project, env: process.env, encoding: 'utf8', stdio: opts.quiet ? 'pipe' : ['ignore', 'inherit', 'inherit'], maxBuffer: 64 * 1024 * 1024 });
	if (r.error) throw r.error;
	if (r.status !== 0) {
		if (opts.quiet) process.stderr.write(r.stderr || '');
		throw new Error(`${cmd} ${args.slice(0, 3).join(' ')}... exited with ${r.status}`);
	}
	return (r.stdout || '') + (r.stderr || '');
}

// The HyperFrames version is pinned once, in the project's package.json scripts. Reuse that pin so the
// picture render and the Chrome used here are the same ones `npm run render` would use.
function hyperframesVersion(): string {
	try {
		const pkg = readFileSync(join(project, 'package.json'), 'utf8');
		const m = pkg.match(/hyperframes@(\d+\.\d+\.\d+[\w.-]*)/);
		if (m) return m[1];
	} catch {
		// no package.json: use the default below
	}
	return DEFAULT_HF_VERSION;
}
const HF = `hyperframes@${hyperframesVersion()}`;

function warnSmallShm() {
	if (process.platform !== 'linux') return;
	try {
		const s = statfsSync('/dev/shm');
		const gb = (s.blocks * s.bsize) / 1024 ** 3;
		if (gb < 1) {
			console.warn(
				`\n! /dev/shm is only ${(gb * 1024).toFixed(0)} MB. Chrome capture will fall back to slow single-frame mode.\n` +
					'  Fix: sudo mount -o remount,size=4G /dev/shm   (Docker: --shm-size=4g)\n'
			);
		}
	} catch {
		// no /dev/shm: nothing to check
	}
}

function findChrome(): string {
	if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
	// `browser ensure` downloads HyperFrames' pinned chrome-headless-shell once; `browser path` prints it.
	run('npx', ['--yes', HF, 'browser', 'ensure'], { quiet: true });
	const lines = run('npx', ['--yes', HF, 'browser', 'path'], { quiet: true })
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean);
	const path = lines.reverse().find((l) => l.startsWith('/') || /^[A-Z]:\\/.test(l));
	if (!path || !existsSync(path)) throw new Error('could not locate Chrome: set CHROME_PATH or run `npx hyperframes browser ensure`');
	return path;
}

// Load index.html in headless Chrome and read the JSON E.mount() wrote into #film-data.
function readFilmData(): FilmData {
	const chrome = findChrome();
	const url = pathToFileURL(join(project, 'index.html')).href;
	const dom = run(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--virtual-time-budget=10000', '--dump-dom', url], { quiet: true });
	const m = dom.match(/<script type="application\/json" id="film-data">([\s\S]*?)<\/script>/);
	if (!m) throw new Error('no #film-data in the page: does index.html call E.mount(root) after building every scene? Open it in a browser and check the console.');
	return JSON.parse(m[1]);
}

// Everything that can change a picture frame. Audio (assets/audio, assets/sfx) is excluded on purpose:
// changing a sound must not invalidate the picture lock.
function pictureFingerprint(): string {
	const hash = createHash('sha256');
	const skip = new Set(['node_modules', 'renders', 'snapshots', '.git', 'audio', 'sfx', 'scripts']);
	const walk = (dir: string) => {
		for (const name of readdirSync(dir).sort()) {
			const p = join(dir, name);
			if (skip.has(name)) continue;
			if (statSync(p).isDirectory()) walk(p);
			else if (['.html', '.js', '.css', '.woff2', '.woff', '.ttf', '.png', '.jpg', '.jpeg', '.svg', '.webp', '.mp4', '.webm', '.json'].includes(extname(name).toLowerCase())) {
				hash.update(relative(project, p));
				hash.update(readFileSync(p));
			}
		}
	};
	walk(project);
	return hash.digest('hex');
}

function probeDuration(file: string): number {
	return parseFloat(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { quiet: true }).trim());
}

// Loudness normalisation in two passes: measure with ffmpeg's ebur128 filter (a spec-accurate EBU R128
// meter), then apply ONE gain so the whole mix lands on the target, like turning a fader. ffmpeg's
// loudnorm is not used for the measurement: on short films its own reading is off by about 1 LU, so
// its "linear" pass misses the target. A true-peak limiter is added only if the gain would push peaks
// past the ceiling.
const LOUD = { I: -14, TP: -1.5 };
function loudnessFilter(wav: string): string {
	const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', wav, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
	const summary = (r.stderr || '').split('Summary:').pop() || '';
	const I = parseFloat((summary.match(/I:\s+(-?[\d.]+) LUFS/) || [])[1]);
	const TP = parseFloat((summary.match(/Peak:\s+(-?[\d.]+|-inf) dBFS/) || [])[1]);
	if (!Number.isFinite(I) || I < -69) {
		console.warn('! could not measure loudness (silent mix?); leaving levels as mixed');
		return 'anull';
	}
	const gain = LOUD.I - I;
	console.log(`  measured ${I.toFixed(1)} LUFS, true peak ${TP.toFixed(1)} dBTP; gain ${gain >= 0 ? '+' : ''}${gain.toFixed(2)} dB to ${LOUD.I} LUFS`);
	let af = `volume=${gain.toFixed(2)}dB`;
	if (Number.isFinite(TP) && TP + gain > LOUD.TP) {
		console.log(`  peaks would reach ${(TP + gain).toFixed(1)} dBTP: limiting to ${LOUD.TP} dBTP`);
		// oversample so the limiter catches inter-sample peaks, then come back to 48 kHz
		af += `,aresample=192000,alimiter=limit=${Math.pow(10, (LOUD.TP - 0.3) / 20).toFixed(4)}:level=false:latency=true,aresample=48000`;
	}
	return af;
}

// X accepts uploads up to 512 MB. Cap the video bitrate so the file lands under ~480 MB whatever the
// length, and never above 16 Mb/s (more is wasted: X re-encodes everything).
function exportForX(src: string, duration: number) {
	const dst = out.replace(/\.mp4$/i, '') + '-x.mp4';
	const audioKbps = 192;
	const budgetKbps = Math.floor((480 * 8 * 1024) / Math.max(duration, 1)) - audioKbps;
	const videoKbps = Math.max(2000, Math.min(16000, budgetKbps));
	console.log(`[x] H.264 High, ${videoKbps} kb/s cap -> ${dst}`);
	run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-maxrate', `${videoKbps}k`, '-bufsize', `${videoKbps * 2}k`, '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-c:a', 'aac', '-b:a', `${audioKbps}k`, '-ar', '48000', '-movflags', '+faststart', dst]);
	const mb = statSync(dst).size / 1024 ** 2;
	console.log(`[x] ${mb.toFixed(1)} MB${mb > 512 ? '  ! over the 512 MB limit' : ''}`);
}

// ---- main ---------------------------------------------------------------------------------------------
function main() {
	if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Node 20+ is required');
	if (!flag('data-only')) {
		run('ffmpeg', ['-version'], { quiet: true });
		run('ffprobe', ['-version'], { quiet: true });
		run('python3', ['-c', 'import numpy, soundfile, librosa'], { quiet: true });
	}
	console.log(`project ${project}\nusing ${HF}`);

	console.log('[1/4] film data (timing table, VO takes, SFX cue sheet)');
	const film = readFilmData();
	writeFileSync(join(cache, 'film.json'), JSON.stringify(film, null, 1));
	if (flag('data-only')) {
		console.log(`wrote ${join(cache, 'film.json')}`);
		return;
	}
	console.log(`  ${film.duration}s, ${film.vo.length} voice lines, ${film.sfx.length} sfx cues`);
	for (const w of film.warnings) console.warn(`! ${w}`);

	if (audioOnly) {
		console.log('[2/4] picture: locked (--audio-only)');
		if (!existsSync(PICTURE)) throw new Error(`no picture at ${PICTURE}: run a full render first, or pass --picture <file>`);
		if (PICTURE === join(cache, 'picture.mp4') && existsSync(FINGERPRINT)) {
			const saved = JSON.parse(readFileSync(FINGERPRINT, 'utf8'));
			if (saved.fingerprint !== pictureFingerprint()) console.warn('! the composition changed since this picture was rendered: the picture may no longer match the timing. Run a full render.');
		}
	} else {
		warnSmallShm();
		console.log(`[2/4] picture (${quality}, workers ${workers})`);
		const t0 = Date.now();
		run('npx', ['--yes', HF, 'render', project, '-o', PICTURE, '--quality', quality, '--workers', workers]);
		writeFileSync(FINGERPRINT, JSON.stringify({ fingerprint: pictureFingerprint(), quality, renderedAt: new Date().toISOString() }, null, 1));
		console.log(`  picture in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
	}

	console.log('[3/4] mix');
	const mixWav = join(cache, 'mix.wav');
	const reportPath = join(cache, 'mix.json');
	run('python3', [join(HERE, 'mix.py'), '--project', project, '--film', join(cache, 'film.json'), '--out', mixWav, '--report', reportPath]);
	const report: MixReport = JSON.parse(readFileSync(reportPath, 'utf8'));

	console.log('[4/4] loudness + mux');
	let normalise = report.vo_placed > 0 || report.music;
	if (flag('loudnorm')) normalise = true;
	if (flag('no-loudnorm')) normalise = false;
	let af = 'anull';
	if (normalise) af = loudnessFilter(mixWav);
	else console.log('  no VO or music in the mix: loudness normalisation skipped, SFX stay at their authored levels');
	mkdirSync(dirname(out), { recursive: true });
	run('ffmpeg', ['-y', '-loglevel', 'error', '-i', PICTURE, '-i', mixWav, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-af', `${af},aresample=48000`, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', out]);
	const dur = probeDuration(out);
	const shown = relative(process.cwd(), out);
	console.log(`wrote ${shown.startsWith('..') ? out : shown} (${dur.toFixed(2)}s, film is ${film.duration}s)`);
	if (Math.abs(dur - film.duration) > 0.1) console.warn('! output length differs from PLAN.duration: check data-duration on #root');
	if (report.missing.length) console.warn(`! missing audio (skipped): ${report.missing.join(', ')}`);

	if (wantX) exportForX(out, dur);
}

try {
	main();
} catch (err) {
	console.error(`\nrender failed: ${(err as Error).message}`);
	process.exit(1);
}
