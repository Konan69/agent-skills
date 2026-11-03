/**
 * tts-cartesia.ts: record voiceover takes with Cartesia TTS (REST, one request per take).
 *
 * The principle: write the script as ACTS, each a continuous passage the narrator reads in one
 * breath group (several sentences). Record each act as ONE take, several times, then score the
 * takes (score_takes.py) and split the winner into line pieces (split_takes.py). Do not record line
 * by line: separately generated lines never share a breath, a pitch contour or a pace, so lines
 * stitched together sound robotic.
 *
 * Usage:
 *   CARTESIA_API_KEY=... npx tsx tts-cartesia.ts lines.json [--out takes/] [--only A1,A3] [--force]
 *                                              [--voice <voice id>] [--model sonic-3] [--dry-run]
 *
 * lines.json:
 *   {
 *     "voice": "<cartesia voice id>",        // or --voice, or CARTESIA_VOICE_ID
 *     "model": "sonic-3",                     // optional; or --model, or CARTESIA_MODEL
 *     "language": "en",                       // optional
 *     "acts": [
 *       { "id": "A1", "text": "Your invoices are late again. Nobody noticed until Friday.",
 *         "emotion": "calm", "speed": 0.95, "n": 3 },
 *       { "id": "A2", "text": "Acme sends them the moment the work is done.",
 *         "takes": [ { "emotion": "confident" }, { "emotion": "content", "speed": 0.95 },
 *                    { "text": "An alternate wording for this take." } ] }
 *     ]
 *   }
 *   An act either lists explicit "takes" (each may override emotion, speed or text), or records
 *   "n" takes (default 3) with the act's own emotion and speed. Generation is not deterministic,
 *   so repeated takes with the same direction still differ. A bare array of acts is also accepted.
 *
 * Output: <out>/<act>-t<k>.wav (44.1 kHz 16-bit mono WAV) and <out>/takes.json, the index that
 * score_takes.py reads: [{ file, act, take, text, emotion, speed, voice, model }].
 * Existing files are kept unless --force (or --only names the act), so reruns are cheap. Each file
 * is written to a temporary name first, so an interrupted run never leaves a half file behind.
 *
 * Environment:
 *   CARTESIA_API_KEY   required unless --dry-run. Read from the environment only; never commit it.
 *   CARTESIA_VOICE_ID  default voice.       CARTESIA_MODEL  default model (sonic-3).
 *   CARTESIA_BASE_URL  API base (default https://api.cartesia.ai); point it at a local stub to test.
 *   CARTESIA_VERSION   Cartesia-Version header (default 2025-04-16).
 *
 * Requirements: Node 20+ (global fetch), `npx tsx`.
 * API: POST <base>/tts/bytes. generation_config carries speed and emotion for Sonic 3 models. If
 * the API has moved on, the request is built in one place (requestBody below).
 */
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

type Take = { emotion?: string; speed?: number; text?: string };
type Act = { id: string; text: string; emotion?: string; speed?: number; n?: number; takes?: Take[] };
type LinesFile = { voice?: string; model?: string; language?: string; acts: Act[] };
type IndexEntry = { file: string; act: string; take: number; text: string; emotion: string | null; speed: number; voice: string; model: string };

const BASE_URL = (process.env.CARTESIA_BASE_URL ?? 'https://api.cartesia.ai').replace(/\/+$/, '');
const API_URL = `${BASE_URL}/tts/bytes`;
const API_VERSION = process.env.CARTESIA_VERSION ?? '2025-04-16';
const SAMPLE_RATE = 44100;
const BOOLEAN_FLAGS = new Set(['force', 'dry-run', 'help']);
const USAGE =
	'usage: npx tsx tts-cartesia.ts lines.json [--out takes/] [--only A1,A2] [--force] [--voice id] [--model m] [--dry-run]';

function parseArgs(argv: string[]) {
	const flags = new Map<string, string | true>();
	const positional: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith('--')) {
			positional.push(a);
			continue;
		}
		const key = a.slice(2);
		const next = argv[i + 1];
		if (next !== undefined && !next.startsWith('--') && !BOOLEAN_FLAGS.has(key)) {
			flags.set(key, next);
			i++;
		} else {
			flags.set(key, true);
		}
	}
	return { flags, positional };
}

function flag(flags: Map<string, string | true>, name: string): string | undefined {
	const v = flags.get(name);
	if (typeof v === 'string') return v;
	return undefined;
}

function validate(spec: LinesFile) {
	if (!Array.isArray(spec.acts) || spec.acts.length === 0) throw new Error('lines.json has no acts');
	const seen = new Set<string>();
	for (const act of spec.acts) {
		if (!act.id || typeof act.id !== 'string') throw new Error(`an act has no string "id": ${JSON.stringify(act)}`);
		if (!/^[\w.-]+$/.test(act.id)) throw new Error(`act id "${act.id}" must be safe as a file name (letters, digits, _ . -)`);
		if (seen.has(act.id)) throw new Error(`duplicate act id "${act.id}"`);
		seen.add(act.id);
		if (!act.text && !(act.takes ?? []).every((t) => t.text)) throw new Error(`act ${act.id} has no "text"`);
		if (act.n !== undefined && (!Number.isInteger(act.n) || act.n < 1)) throw new Error(`act ${act.id}: "n" must be a positive integer`);
	}
}

function takesFor(act: Act): Take[] {
	if (act.takes && act.takes.length > 0) {
		return act.takes.map((t) => ({ emotion: t.emotion ?? act.emotion, speed: t.speed ?? act.speed, text: t.text }));
	}
	const n = act.n ?? 3;
	return Array.from({ length: n }, () => ({ emotion: act.emotion, speed: act.speed }));
}

function requestBody(opts: { model: string; voice: string; language: string; transcript: string; take: Take }) {
	const generation_config: Record<string, unknown> = { speed: opts.take.speed ?? 1 };
	if (opts.take.emotion) generation_config.emotion = opts.take.emotion;
	return {
		model_id: opts.model,
		transcript: opts.transcript,
		voice: { mode: 'id', id: opts.voice },
		language: opts.language,
		output_format: { container: 'wav', encoding: 'pcm_s16le', sample_rate: SAMPLE_RATE },
		generation_config
	};
}

/**
 * Check the response is a RIFF/WAVE file and make its size fields match the bytes received.
 * Streaming encoders often write placeholder sizes (0 or 0xFFFFFFFF), which some tools read as an
 * empty or endless file.
 */
function repairWav(buf: Buffer, label: string): Buffer {
	if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
		const head = buf.toString('utf8', 0, Math.min(buf.length, 200));
		throw new Error(`${label}: response is not a WAV file (${buf.length} bytes): ${head}`);
	}
	buf.writeUInt32LE(buf.length - 8, 4);
	let p = 12;
	while (p + 8 <= buf.length) {
		const id = buf.toString('ascii', p, p + 4);
		const size = buf.readUInt32LE(p + 4);
		if (id === 'data') {
			buf.writeUInt32LE(buf.length - (p + 8), p + 4);
			return buf;
		}
		p += 8 + size + (size % 2);
	}
	throw new Error(`${label}: WAV response has no data chunk`);
}

async function synthesize(apiKey: string, body: unknown, label: string): Promise<Buffer> {
	const maxAttempts = 5;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		let res: Response;
		try {
			res = await fetch(API_URL, {
				method: 'POST',
				headers: { 'X-API-Key': apiKey, 'Cartesia-Version': API_VERSION, 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
		} catch (err) {
			// network errors (reset, DNS) are worth a retry like a 5xx
			if (attempt === maxAttempts) throw new Error(`${label}: ${(err as Error).message}`);
			await backoff(label, attempt, (err as Error).message);
			continue;
		}
		if (res.ok) return repairWav(Buffer.from(await res.arrayBuffer()), label);
		const detail = await res.text();
		const retryable = res.status === 429 || res.status >= 500;
		if (!retryable || attempt === maxAttempts) throw new Error(`${label}: HTTP ${res.status} ${detail}`);
		await backoff(label, attempt, `HTTP ${res.status}`);
	}
	throw new Error(`${label}: unreachable`);
}

async function backoff(label: string, attempt: number, why: string) {
	const wait = 1000 * 2 ** (attempt - 1);
	console.warn(`${label}: ${why}, retrying in ${wait} ms`);
	await new Promise((r) => setTimeout(r, wait));
}

const exists = (p: string) =>
	access(p).then(
		() => true,
		() => false
	);

async function main() {
	const { flags, positional } = parseArgs(process.argv.slice(2));
	const linesPath = positional[0];
	if (!linesPath || flags.has('help')) {
		console.error(USAGE);
		process.exit(linesPath ? 0 : 2);
	}
	const raw = JSON.parse(await readFile(linesPath, 'utf8')) as LinesFile | Act[];
	const spec: LinesFile = Array.isArray(raw) ? { acts: raw } : raw;
	validate(spec);
	const voice = flag(flags, 'voice') ?? spec.voice ?? process.env.CARTESIA_VOICE_ID;
	const model = flag(flags, 'model') ?? spec.model ?? process.env.CARTESIA_MODEL ?? 'sonic-3';
	const language = spec.language ?? 'en';
	const outDir = resolve(flag(flags, 'out') ?? join(dirname(resolve(linesPath)), 'takes'));
	const onlyRaw = flag(flags, 'only');
	const only = onlyRaw ? new Set(onlyRaw.split(',').map((s) => s.trim())) : null;
	const force = flags.has('force');
	const dryRun = flags.has('dry-run');
	const apiKey = process.env.CARTESIA_API_KEY;
	if (!voice) throw new Error('No voice id: set "voice" in lines.json, pass --voice, or set CARTESIA_VOICE_ID');
	if (!apiKey && !dryRun) throw new Error('Set CARTESIA_API_KEY in the environment (never commit it)');
	if (only) {
		const unknown = [...only].filter((id) => !spec.acts.some((a) => a.id === id));
		if (unknown.length) throw new Error(`--only names unknown act(s): ${unknown.join(', ')}`);
	}

	if (!dryRun) await mkdir(outDir, { recursive: true });
	const indexPath = join(outDir, 'takes.json');
	// With --only, keep the index entries of the acts that are not being re-recorded.
	const previous: IndexEntry[] = only && (await exists(indexPath)) ? JSON.parse(await readFile(indexPath, 'utf8')) : [];
	const index: IndexEntry[] = previous.filter((e) => only !== null && !only.has(String(e.act)));

	for (const act of spec.acts) {
		if (only && !only.has(act.id)) continue;
		for (const [i, take] of takesFor(act).entries()) {
			const file = join(outDir, `${act.id}-t${i + 1}.wav`);
			const transcript = take.text ?? act.text;
			const label = `${act.id} t${i + 1}`;
			index.push({ file: relative(outDir, file), act: act.id, take: i + 1, text: transcript, emotion: take.emotion ?? null, speed: take.speed ?? 1, voice, model });
			if (!force && !only && (await exists(file))) {
				console.log('kept ', label);
				continue;
			}
			const body = requestBody({ model, voice, language, transcript, take });
			if (dryRun) {
				console.log('would record', label, JSON.stringify(body.generation_config), JSON.stringify(transcript));
				continue;
			}
			const wav = await synthesize(apiKey as string, body, label);
			await writeFile(`${file}.part`, wav);
			await rename(`${file}.part`, file);
			const seconds = (wav.length - 44) / (2 * SAMPLE_RATE);
			console.log('wrote', relative(process.cwd(), file), `${seconds.toFixed(2)} s`, take.emotion ?? '', take.speed ?? 1);
		}
	}
	index.sort((a, b) => a.act.localeCompare(b.act) || a.take - b.take);
	if (dryRun) {
		console.log(`${index.length} takes would be indexed in ${indexPath}`);
		return;
	}
	await writeFile(indexPath, JSON.stringify(index, null, '\t') + '\n');
	console.log(`${index.length} takes indexed in ${relative(process.cwd(), indexPath) || indexPath}`);
}

main().catch((err: unknown) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
