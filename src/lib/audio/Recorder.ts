import { AudioContextManager } from './AudioContextManager';

export interface RecordingResult {
	blob: Blob;
	url: string;
	durationSeconds: number;
	sampleRate: number;
	channelCount: number;
}

const WORKLET_CODE = `
class RecorderProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this._recording = false;
		this._chunks = [];
		this.port.onmessage = (event) => {
			const { type } = event.data || {};
			if (type === 'start') {
				this._recording = true;
				this._chunks = [];
				this.port.postMessage({ type: 'started' });
			} else if (type === 'stop') {
				this._recording = false;
				const copy = this._chunks.slice();
				this._chunks = [];
				this.port.postMessage({ type: 'stopped', chunks: copy });
			}
		};
	}

	process(inputs, outputs, parameters) {
		const input = inputs[0];
		if (!input || input.length === 0) return true;

		if (this._recording) {
			const channelCount = input.length;
			const frameCount = input[0] ? input[0].length : 0;
			const interleaved = new Float32Array(frameCount * Math.max(channelCount, 2));

			for (let f = 0; f < frameCount; f++) {
				let left = 0;
				let right = 0;
				if (channelCount >= 1) left = input[0][f];
				if (channelCount >= 2) right = input[1][f];
				else right = left;
				interleaved[f * 2] = left;
				interleaved[f * 2 + 1] = right;
			}

			this._chunks.push(interleaved);

			if (this._chunks.length >= 16) {
				const batch = this._chunks.splice(0, 16);
				this.port.postMessage({ type: 'data', chunks: batch });
			}
		}

		if (outputs[0] && outputs[0].length > 0) {
			for (let c = 0; c < outputs[0].length; c++) {
				const out = outputs[0][c];
				const srcC = c < input.length ? input[c] : input[input.length - 1];
				if (srcC) out.set(srcC);
			}
		}

		return true;
	}
}

registerProcessor('recorder-processor', RecorderProcessor);
`;

const WAV_HEADER_SIZE = 44;

function floatTo24BitPCM(samples: Float32Array, channelCount: number): ArrayBuffer {
	const frameCount = samples.length / channelCount;
	const byteCount = frameCount * channelCount * 3;
	const ab = new ArrayBuffer(byteCount);
	const out = new Uint8Array(ab);
	let offset = 0;
	for (let f = 0; f < frameCount; f++) {
		for (let c = 0; c < channelCount; c++) {
			let sample = samples[f * channelCount + c];
			sample = Math.max(-1, Math.min(1, sample));
			let int24 = sample < 0 ? sample * 0x800000 : sample * 0x7fffff;
			int24 = Math.round(int24);
			if (int24 < -0x800000) int24 = -0x800000;
			if (int24 > 0x7fffff) int24 = 0x7fffff;
			if (int24 < 0) int24 += 0x1000000;
			out[offset++] = int24 & 0xff;
			out[offset++] = (int24 >> 8) & 0xff;
			out[offset++] = (int24 >> 16) & 0xff;
		}
	}
	return ab;
}

function writeWavHeader(
	pcmBytes: number,
	sampleRate: number,
	channelCount: number,
	bitsPerSample = 24
): ArrayBuffer {
	const byteRate = sampleRate * channelCount * (bitsPerSample / 8);
	const blockAlign = channelCount * (bitsPerSample / 8);
	const dataSize = pcmBytes;
	const totalSize = 36 + dataSize;
	const ab = new ArrayBuffer(WAV_HEADER_SIZE);
	const header = new Uint8Array(ab);
	const view = new DataView(ab);

	header[0] = 0x52; // R
	header[1] = 0x49; // I
	header[2] = 0x46; // F
	header[3] = 0x46; // F
	view.setUint32(4, totalSize, true);
	header[8] = 0x57; // W
	header[9] = 0x41; // A
	header[10] = 0x56; // V
	header[11] = 0x45; // E

	header[12] = 0x66; // f
	header[13] = 0x6d; // m
	header[14] = 0x74; // t
	header[15] = 0x20; // space
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, channelCount, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bitsPerSample, true);

	header[36] = 0x64; // d
	header[37] = 0x61; // a
	header[38] = 0x74; // t
	header[39] = 0x61; // a
	view.setUint32(40, dataSize, true);

	return ab;
}

export class Recorder {
	private _context: AudioContext;
	private _node: AudioWorkletNode | null = null;
	private _recording = false;
	private _chunks: Float32Array[] = [];
	private _url: string | null = null;
	private _initError: Error | null = null;

	constructor(context: AudioContext) {
		this._context = context;
	}

	get isRecording(): boolean {
		return this._recording;
	}

	get node(): AudioWorkletNode {
		if (!this._node) throw new Error('Recorder not initialized.');
		return this._node;
	}

	get url(): string | null {
		return this._url;
	}

	async init(): Promise<void> {
		if (this._node) return;
		if (this._initError) throw this._initError;

		try {
			const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
			const workletUrl = URL.createObjectURL(blob);
			await this._context.audioWorklet.addModule(workletUrl);
			URL.revokeObjectURL(workletUrl);
			this._node = new AudioWorkletNode(this._context, 'recorder-processor');

			this._node.port.onmessage = (event: MessageEvent) => {
				const { type, chunks } = event.data || {};
				if (type === 'data' && Array.isArray(chunks)) {
					for (const c of chunks) {
						this._chunks.push(c as Float32Array);
					}
				}
			};
		} catch (err) {
			this._initError = err instanceof Error ? err : new Error(String(err));
			throw this._initError;
		}
	}

	async start(): Promise<void> {
		if (!this._node) await this.init();
		this._recording = true;
		this._chunks = [];
		this._node!.port.postMessage({ type: 'start' });
	}

	async stop(): Promise<RecordingResult | null> {
		if (!this._recording || !this._node) return null;
		this._recording = false;

		return new Promise<RecordingResult | null>((resolve, reject) => {
			let settled = false;
			const timeout = setTimeout(() => {
				if (!settled) {
					settled = true;
					reject(new Error('Recording stop timed out.'));
				}
			}, 5000);

			const handler = (event: MessageEvent) => {
				if (event.data?.type === 'stopped') {
					settled = true;
					clearTimeout(timeout);
					this._node!.port.removeEventListener('message', handler as any);
					const chunks = (event.data.chunks as Float32Array[]) ?? [];
					const all = [...this._chunks, ...chunks];
					this._chunks = [];
					try {
						resolve(this._buildResult(all));
					} catch (err) {
						reject(err);
					}
				}
			};
			this._node!.port.addEventListener('message', handler);
			this._node!.port.postMessage({ type: 'stop' });
		});
	}

	private _buildResult(chunks: Float32Array[]): RecordingResult {
		const channelCount = 2;

		if (chunks.length === 0) {
			const header = writeWavHeader(0, this._context.sampleRate, 2);
			const blob = new Blob([header], { type: 'audio/wav' });
			const url = URL.createObjectURL(blob);
			this._url = url;
			return { blob, url, durationSeconds: 0, sampleRate: this._context.sampleRate, channelCount };
		}

		const totalFrames = chunks.reduce((sum, c) => sum + c.length / channelCount, 0);
		const pcm = floatTo24BitPCM(flattenChunks(chunks, channelCount), channelCount);
		const header = writeWavHeader(pcm.byteLength, this._context.sampleRate, channelCount);
		const blob = new Blob([header, pcm], { type: 'audio/wav' });
		const url = URL.createObjectURL(blob);
		this._url = url;
		const durationSeconds = totalFrames / this._context.sampleRate;
		return { blob, url, durationSeconds, sampleRate: this._context.sampleRate, channelCount };
	}
}

function flattenChunks(chunks: Float32Array[], channelCount: number): Float32Array {
	let total = 0;
	for (const c of chunks) total += c.length;
	const out = new Float32Array(total);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.length;
	}
	return out;
}
