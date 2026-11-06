export class Clock {
	private _timer: ReturnType<typeof setInterval> | null = null;

	constructor(
		private readonly _callback: () => void,
		private readonly _intervalMs: number,
	) {}

	start(): void {
		if (this._timer !== null) return;
		this._timer = setInterval(this._callback, this._intervalMs);
	}

	stop(): void {
		if (this._timer === null) return;
		clearInterval(this._timer);
		this._timer = null;
	}

	dispose(): void {
		this.stop();
	}
}