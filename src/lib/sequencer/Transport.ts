import type { TransportState } from '$lib/types';
import {
	BPM_MIN,
	BPM_MAX,
	DEFAULT_BPM,
	SWING_MIN,
	SWING_MAX,
	DEFAULT_SWING,
	DEFAULT_PATTERN_LENGTH,
} from '$lib/constants';

export class Transport {
	private readonly _state: TransportState;
	private _onChange: ((state: TransportState) => void) | null = null;
	private _onCursor: ((cursor: { currentStep: number; currentBeat: number; currentBar: number }) => void) | null = null;

	constructor(
		init: Partial<
			Pick<TransportState, 'bpm' | 'swing' | 'swingEnabled' | 'loopStart' | 'loopEnd'>
		> = {},
	) {
		this._state = {
			bpm: init.bpm ?? DEFAULT_BPM,
			swing: init.swing ?? DEFAULT_SWING,
			swingEnabled: init.swingEnabled ?? true,
			playing: false,
			currentStep: 0,
			currentBeat: 0,
			currentBar: 0,
			loopStart: init.loopStart ?? 0,
			loopEnd: init.loopEnd ?? DEFAULT_PATTERN_LENGTH,
		};
	}

	get state(): TransportState {
		return { ...this._state };
	}

	onChange(callback: (state: TransportState) => void): void {
		this._onChange = callback;
	}

	onCursorChange(callback: (cursor: { currentStep: number; currentBeat: number; currentBar: number }) => void): void {
		this._onCursor = callback;
	}

	setBpm(bpm: number): void {
		this._state.bpm = Math.min(BPM_MAX, Math.max(BPM_MIN, bpm));
		this._emit();
	}

	setSwing(swing: number): void {
		this._state.swing = Math.min(SWING_MAX, Math.max(SWING_MIN, swing));
		this._emit();
	}

	setSwingEnabled(enabled: boolean): void {
		this._state.swingEnabled = enabled;
		this._emit();
	}

	setLoop(loopStart: number, loopEnd: number): void {
		const start = Math.max(0, Math.round(loopStart));
		const end = Math.max(start + 1, Math.round(loopEnd));
		this._state.loopStart = start;
		this._state.loopEnd = end;
		this._emit();
	}

	setPlaying(playing: boolean): void {
		this._state.playing = playing;
		this._emit();
	}

	setCursor(stepIndex: number): void {
		const span = this._state.loopEnd - this._state.loopStart;
		const rel = ((stepIndex - this._state.loopStart) % span + span) % span;
		this._state.currentStep = rel;
		this._state.currentBeat = Math.floor((rel % 16) / 4);
		this._state.currentBar = Math.floor((this._state.loopStart + rel) / 16);
		if (this._onCursor) {
			this._onCursor({
				currentStep: this._state.currentStep,
				currentBeat: this._state.currentBeat,
				currentBar: this._state.currentBar,
			});
		}
	}

	private _emit(): void {
		if (this._onChange) this._onChange(this.state);
	}
}