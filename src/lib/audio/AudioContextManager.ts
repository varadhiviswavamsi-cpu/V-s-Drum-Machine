export class AudioContextManager {
	private static _instance: AudioContextManager | null = null;

	static get instance(): AudioContextManager {
		if (!AudioContextManager._instance) {
			AudioContextManager._instance = new AudioContextManager();
		}
		return AudioContextManager._instance;
	}

	private _context: AudioContext | null = null;

	private constructor() {}

	get ready(): boolean {
		return this._context !== null;
	}

	get context(): AudioContext {
		if (!this._context) {
			throw new Error('Audio could not be started.');
		}
		return this._context;
	}

	get currentTime(): number {
		return this.context.currentTime;
	}

	init(): AudioContext {
		if (!this._context) {
			this._context = new AudioContext();
		}
		if (this._context.state === 'suspended') {
			this._context.resume();
		}
		return this._context;
	}

	async resume(): Promise<void> {
		if (!this._context) return;
		if (this._context.state !== 'running') {
			await this._context.resume();
		}
	}

	async suspend(): Promise<void> {
		if (!this._context) return;
		if (this._context.state !== 'suspended') {
			await this._context.suspend();
		}
	}

	dispose(): void {
		if (this._context) {
			void this._context.close();
			this._context = null;
		}
	}
}