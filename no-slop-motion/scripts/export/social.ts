/**
 * social.ts: turn a finished master MP4 into platform exports that play back the way you mixed them.
 *
 * The principle: the master is not the upload. Every platform re-encodes what it receives, and each
 * one has its own limits: X rejects files over 512 MB, a file without "faststart" waits to download
 * before it plays, 44.1 kHz or odd audio gets resampled, and loudness far from about -14 LUFS gets
 * turned up or down by the player (a quiet film sounds weak next to the post above it; a hot one
 * gets squashed). Export deliberately, then measure what you actually exported.
 *
 * What it does:
 *   1. measures the master's loudness (ffmpeg loudnorm, first pass) and normalises it ONCE to
 *      --lufs (default -14 LUFS integrated) with true peaks under --tp (default -1 dBTP), as one
 *      linear gain where possible. The normaliser aims 0.5 dB under --tp because AAC encoding adds
 *      a little overshoot. The audio is shared by every export, so all versions sound the same;
 *   2. writes each requested format as H.264 (High, yuv420p) + AAC-LC 48 kHz stereo with the moov atom
 *      at the front (faststart). The video bitrate is capped so the file stays under --max-mb;
 *   3. 16x9 keeps the master frame (scaled down to 1920x1080 if larger). 4x5 (1080x1350) and 9x16
 *      (1080x1920) are CROPS of the master, not letterboxes: --focus picks where the crop sits
 *      (0 = left edge, 0.5 = centre, 1 = right edge; per format with --focus-4x5 / --focus-9x16).
 *      A crop throws picture away, so compose the master with the vertical crops in mind, or
 *      render dedicated vertical versions for anything with text near the frame edges;
 *   4. measures every export (size, duration, resolution, loudness, true peak, faststart) and
 *      exits non-zero if one is over the size limit or off the loudness target by more than 1 LU.
 *
 * Usage:
 *   npx tsx social.ts master.mp4 [--out exports/] [--formats 16x9,4x5,9x16] [--focus 0.5]
 *                    [--focus-4x5 0.45] [--focus-9x16 0.6] [--lufs -14] [--tp -1] [--max-mb 512]
 *                    [--crf 18] [--audio-kbps 192] [--name acme-launch]
 *
 * Output: <out>/<name>-16x9.mp4 (and -4x5.mp4, -9x16.mp4), then a table of what was measured.
 *
 * Requirements: Node 20+, ffmpeg and ffprobe on PATH (with libx264 and the loudnorm filter).
 */
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';

type Format = { id: string; w: number; h: number };
const FORMATS: Record<string, Format> = {
	'16x9': { id: '16x9', w: 1920, h: 1080 },
	'4x5': { id: '4x5', w: 1080, h: 1350 },
	'9x16': { id: '9x16', w: 1080, h: 1920 }
};
const USAGE =
	'usage: npx tsx social.ts master.mp4 [--out exports/] [--formats 16x9,4x5,9x16] [--focus 0.5] [--lufs -14] [--tp -1] [--max-mb 512]';

function parseArgs(argv: string[]) {
	const flags = new Map<string, string>();
	const positional: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--help' || a === '-h') {
			flags.set('help', '1');
		} else if (a.startsWith('--')) {
			const v = argv[i + 1];
			if (v === undefined) throw new Error(`${a} needs a value`);
			flags.set(a.slice(2), v);
			i++;
		} else {
			positional.push(a);
		}
	}
	return { flags, positional };
}

function run(cmd: string, args: string[]): { stdout: string; stderr: string } {
	const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
	if (r.error) throw new Error(`${cmd} could not start: ${r.error.message}`);
	if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}\n${r.stderr.slice(-2000)}`);
	return { stdout: r.stdout, stderr: r.stderr };
}

type Probe = { duration: number; width: number; height: number; fps: number; hasAudio: boolean };

function probe(file: string): Probe {
	const out = run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate:format=duration', '-of', 'json', file]).stdout;
	const j = JSON.parse(out) as { streams: { codec_type: string; width?: number; height?: number; r_frame_rate?: string }[]; format: { duration: string } };
	const v = j.streams.find((s) => s.codec_type === 'video');
	if (!v || !v.width || !v.height) throw new Error(`${file} has no video stream`);
	const [num, den] = (v.r_frame_rate ?? '30/1').split('/').map(Number);
	return { duration: Number(j.format.duration), width: v.width, height: v.height, fps: num / (den || 1), hasAudio: j.streams.some((s) => s.codec_type === 'audio') };
}

/** Last JSON object printed by ffmpeg's loudnorm filter (print_format=json goes to stderr). */
function loudnormJson(stderr: string): Record<string, string> {
	const start = stderr.lastIndexOf('{');
	const end = stderr.lastIndexOf('}');
	if (start < 0 || end < start) throw new Error('loudnorm printed no measurement');
	return JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>;
}

function measureLoudness(file: string, lufs: number, tp: number) {
	const { stderr } = run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', `loudnorm=I=${lufs}:TP=${tp}:LRA=20:print_format=json`, '-f', 'null', '-']);
	const j = loudnormJson(stderr);
	return { i: Number(j.input_i), tp: Number(j.input_tp), lra: Number(j.input_lra), thresh: Number(j.input_thresh), offset: Number(j.target_offset) };
}

/** Normalise the master's audio once, to a 48 kHz WAV every export then shares. */
function normaliseAudio(master: string, dir: string, lufs: number, tp: number): { wav: string; before: ReturnType<typeof measureLoudness> } {
	const aim = tp - 0.5;
	const m = measureLoudness(master, lufs, aim);
	const wav = join(dir, 'audio.wav');
	// linear=true applies one gain when the peak allows it; LRA=20 keeps the film's dynamics
	const filter =
		`loudnorm=I=${lufs}:TP=${aim}:LRA=20:measured_I=${m.i}:measured_TP=${m.tp}:measured_LRA=${m.lra}` +
		`:measured_thresh=${m.thresh}:offset=${m.offset}:linear=true:print_format=json`;
	run('ffmpeg', ['-v', 'error', '-y', '-i', master, '-vn', '-af', filter, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s24le', wav]);
	return { wav, before: m };
}

function videoFilter(src: Probe, f: Format, focus: number): string {
	if (f.id === '16x9') {
		// keep the master frame, fit inside 1920x1080, even dimensions
		return `scale='min(${f.w},iw)':'min(${f.h},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1`;
	}
	const target = f.w / f.h;
	const cropH = src.height;
	const cropW = Math.min(src.width, Math.round((cropH * target) / 2) * 2);
	const x = Math.round((src.width - cropW) * Math.min(1, Math.max(0, focus)));
	return `crop=${cropW}:${cropH}:${x}:0,scale=${f.w}:${f.h}:flags=lanczos,setsar=1`;
}

function hasFaststart(file: string): boolean {
	// top-level atoms: faststart means moov comes before mdat
	const fd = openSync(file, 'r');
	try {
		const size = statSync(file).size;
		let pos = 0;
		const head = Buffer.alloc(16);
		while (pos + 8 <= size) {
			readSync(fd, head, 0, 16, pos);
			let len = head.readUInt32BE(0);
			const type = head.toString('ascii', 4, 8);
			if (type === 'moov') return true;
			if (type === 'mdat') return false;
			if (len === 1) len = Number(head.readBigUInt64BE(8));
			if (len < 8) return false;
			pos += len;
		}
		return false;
	} finally {
		closeSync(fd);
	}
}

function main() {
	const { flags, positional } = parseArgs(process.argv.slice(2));
	const master = positional[0];
	if (!master || flags.has('help')) {
		console.error(USAGE);
		process.exit(master ? 0 : 2);
	}
	if (!existsSync(master)) throw new Error(`no such file: ${master}`);
	const num = (k: string, d: number) => (flags.has(k) ? Number(flags.get(k)) : d);
	const lufs = num('lufs', -14);
	const tp = num('tp', -1);
	const maxMb = num('max-mb', 512);
	const crf = num('crf', 18);
	const audioKbps = num('audio-kbps', 192);
	const focus = num('focus', 0.5);
	const outDir = resolve(flags.get('out') ?? 'exports');
	const name = flags.get('name') ?? basename(master, extname(master));
	const ids = (flags.get('formats') ?? '16x9').split(',').map((s) => s.trim());
	for (const id of ids) if (!FORMATS[id]) throw new Error(`unknown format ${id} (use ${Object.keys(FORMATS).join(', ')})`);
	for (const v of [lufs, tp, maxMb, crf, audioKbps, focus]) if (!Number.isFinite(v)) throw new Error('numeric options must be numbers');

	const src = probe(master);
	mkdirSync(outDir, { recursive: true });
	const tmp = mkdtempSync(join(tmpdir(), 'social-'));
	try {
		let audio: string | null = null;
		if (src.hasAudio) {
			const { wav, before } = normaliseAudio(master, tmp, lufs, tp);
			audio = wav;
			console.log(`master: ${src.width}x${src.height} ${src.fps.toFixed(3)} fps ${src.duration.toFixed(2)} s, ${before.i.toFixed(1)} LUFS, ${before.tp.toFixed(1)} dBTP`);
		} else {
			console.warn(`master: ${src.width}x${src.height}, no audio track: exporting picture only`);
		}
		// cap the video bitrate so size stays under the limit (5% headroom for the container)
		const budgetKbps = Math.floor(((maxMb * 1024 * 1024 * 8 * 0.95) / src.duration) / 1000) - (audio ? audioKbps : 0);
		const maxrateKbps = Math.max(1000, Math.min(budgetKbps, 25000));
		const fpsOut = src.fps > 60 ? 60 : src.fps;
		const rows: string[][] = [];
		let failed = false;
		for (const id of ids) {
			const f = FORMATS[id];
			const fFocus = num(`focus-${id}`, focus);
			const out = join(outDir, `${name}-${id}.mp4`);
			if (id !== '16x9') {
				const cropW = Math.round((src.height * f.w) / f.h);
				const upscale = f.h / src.height;
				if (cropW > src.width) console.warn(`${id}: master is narrower than a ${id} crop; the crop uses the full width`);
				if (upscale > 1.01) console.warn(`${id}: the crop is upscaled ${upscale.toFixed(2)}x to ${f.w}x${f.h}; render a native vertical version for the sharpest result`);
			}
			const args = ['-v', 'error', '-y', '-i', master];
			if (audio) args.push('-i', audio);
			args.push('-map', '0:v:0');
			if (audio) args.push('-map', '1:a:0');
			args.push(
				'-vf', videoFilter(src, f, fFocus), '-r', String(fpsOut),
				'-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', String(crf),
				'-maxrate', `${maxrateKbps}k`, '-bufsize', `${maxrateKbps * 2}k`, '-g', String(Math.round(fpsOut * 2)),
				'-tag:v', 'avc1', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'
			);
			if (audio) args.push('-c:a', 'aac', '-b:a', `${audioKbps}k`, '-ar', '48000', '-ac', '2');
			args.push('-movflags', '+faststart', '-shortest', out);
			run('ffmpeg', args);

			const p = probe(out);
			const mb = statSync(out).size / (1024 * 1024);
			const fast = hasFaststart(out);
			let loud = '-';
			let peak = '-';
			if (audio) {
				const m = measureLoudness(out, lufs, tp);
				loud = m.i.toFixed(1);
				peak = m.tp.toFixed(1);
				if (Math.abs(m.i - lufs) > 1) {
					failed = true;
					console.error(`${id}: loudness ${m.i.toFixed(1)} LUFS is more than 1 LU from ${lufs}`);
				}
				if (m.tp > tp + 0.2) console.warn(`${id}: true peak ${m.tp.toFixed(1)} dBTP is above ${tp} dBTP`);
			}
			if (mb > maxMb) {
				failed = true;
				console.error(`${id}: ${mb.toFixed(1)} MB is over the ${maxMb} MB limit`);
			}
			if (!fast) {
				failed = true;
				console.error(`${id}: moov atom is not at the front (no faststart)`);
			}
			rows.push([id, basename(out), `${p.width}x${p.height}`, `${p.duration.toFixed(2)} s`, `${mb.toFixed(1)} MB`, loud, peak, fast ? 'yes' : 'NO']);
		}
		const head = ['format', 'file', 'size', 'duration', 'MB', 'LUFS', 'dBTP', 'faststart'];
		console.log('\n| ' + head.join(' | ') + ' |\n|' + head.map(() => '---').join('|') + '|');
		for (const r of rows) console.log('| ' + r.join(' | ') + ' |');
		console.log(`\nwrote ${rows.length} file(s) to ${outDir}`);
		if (failed) process.exitCode = 1;
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

try {
	main();
} catch (err) {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
}
