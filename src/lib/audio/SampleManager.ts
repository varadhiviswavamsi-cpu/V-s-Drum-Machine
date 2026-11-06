import type { SampleManifestEntry } from '$lib/types';

export class SampleManager {
	private static readonly retries = 1;

	private readonly _getContext: () => AudioContext;
	private _entries: SampleManifestEntry[] = [];
	private _buffers = new Map<string, AudioBuffer>();

	constructor(getContext: () => AudioContext) {
		this._getContext = getContext;
	}

	get entries(): SampleManifestEntry[] {
		return this._entries;
	}

	get loaded(): boolean {
		return this._entries.length > 0 && this._entries.every((entry) => this._buffers.has(entry.id));
	}

	async loadManifest(): Promise<SampleManifestEntry[]> {
		const res = await fetch('/samples/manifest.json');
		if (!res.ok) {
			throw new Error(`Sample manifest failed to load (${res.status}).`);
		}
		const data = (await res.json()) as SampleManifestEntry[];
		this._entries = data;
		return this._entries;
	}

	async loadAll(): Promise<Map<string, AudioBuffer>> {
		const results = await Promise.allSettled(this._entries.map((entry) => this.loadOne(entry)));
		const failed = results
			.map((result, index) => (result.status === 'rejected' ? this._entries[index] : null))
			.filter((entry): entry is SampleManifestEntry => entry !== null);
		if (failed.length > 0) {
			const list = failed.map((entry) => entry.src).join(', ');
			throw new Error(`Sample${failed.length > 1 ? 's' : ''} could not be decoded: ${list}.`);
		}
		return this._buffers;
	}

	async loadOne(entry: SampleManifestEntry): Promise<AudioBuffer> {
		const existing = this._buffers.get(entry.id);
		if (existing) return existing;

		const buffer = await this._decode(entry.src);
		if (!buffer) {
			throw new Error(`Sample "${entry.src}" could not be decoded.`);
		}
		this._buffers.set(entry.id, buffer);
		return buffer;
	}

	private async _decode(file: string): Promise<AudioBuffer | null> {
		for (let attempt = 0; attempt <= SampleManager.retries; attempt++) {
			try {
				const res = await fetch(`/samples/${file}`);
				if (!res.ok) {
					throw new Error(`Sample could not be loaded (${res.status}).`);
				}
				const arrayBuffer = await res.arrayBuffer();
				const buffer = await this._getContext().decodeAudioData(arrayBuffer);
				return buffer;
			} catch {
				if (attempt === SampleManager.retries) return null;
			}
		}
		return null;
	}

	buffer(id: string): AudioBuffer | null {
		return this._buffers.get(id) ?? null;
	}

	dispose(): void {
		this._buffers.clear();
		this._entries = [];
	}
}