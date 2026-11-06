import type { TrackConfig, TransportState } from '$lib/types';
import { SCHEDULER } from '$lib/constants';
import type { DrumMachineEngine } from '$lib/audio';
import { Clock } from './Clock';
import { Transport } from './Transport';

export class Sequencer {
	private readonly _context: AudioContext;
	private readonly _engine: DrumMachineEngine;
	private readonly _getTracks: () => TrackConfig[];
	private readonly _transport: Transport;
	private readonly _clock: Clock;
	private _stepIndex: number;
	private _nextStepTime = 0;
	private _stepDur: number;

	constructor(
		context: AudioContext,
		engine: DrumMachineEngine,
		getTracks: () => TrackConfig[],
		transport: Transport,
	) {
		this._context = context;
		this._engine = engine;
		this._getTracks = getTracks;
		this._transport = transport;
		this._stepIndex = transport.state.loopStart;
		this._stepDur = this._computeStepDur();
		this._clock = new Clock(() => this._tick(), SCHEDULER.tickIntervalMs);
	}

	get transport(): TransportState {
		return this._transport.state;
	}

	play(): void {
		if (this._transport.state.playing) return;
		this._stepDur = this._computeStepDur();
		this._stepIndex = this._transport.state.loopStart;
		this._nextStepTime = this._context.currentTime + SCHEDULER.lookaheadS;
		this._transport.setPlaying(true);
		this._clock.start();
	}

	pause(): void {
		if (!this._transport.state.playing) return;
		this._clock.stop();
		this._transport.setPlaying(false);
	}

	stop(): void {
		this._clock.stop();
		this._transport.setPlaying(false);
		this._stepIndex = this._transport.state.loopStart;
		this._transport.setCursor(this._stepIndex);
	}

	togglePlay(): void {
		if (this._transport.state.playing) {
			this.pause();
		} else {
			this.play();
		}
	}

	setBpm(bpm: number): void {
		this._transport.setBpm(bpm);
		this._stepDur = this._computeStepDur();
	}

	setSwing(swing: number): void {
		this._transport.setSwing(swing);
	}

	setSwingEnabled(enabled: boolean): void {
		this._transport.setSwingEnabled(enabled);
	}

	setLoop(loopStart: number, loopEnd: number): void {
		this._transport.setLoop(loopStart, loopEnd);
		if (this._stepIndex >= this._transport.state.loopEnd) {
			this._stepIndex = this._transport.state.loopStart;
		}
	}

	dispose(): void {
		this._clock.dispose();
		this._transport.setPlaying(false);
	}

	private _computeStepDur(): number {
		return 60 / this._transport.state.bpm / 4;
	}

	private _isSwingStep(stepIndex: number): boolean {
		return Math.floor(stepIndex / 2) % 2 === 1;
	}

	private _tick(): void {
		const state = this._transport.state;
		if (!state.playing) return;

		const horizon =
			this._context.currentTime + SCHEDULER.lookaheadS + SCHEDULER.scheduleWindowS;

		const tracks = this._getTracks();

		while (this._nextStepTime < horizon) {
			this._scheduleStep(this._stepIndex, this._nextStepTime, state, tracks);
			this._nextStepTime += this._stepDur;
			this._stepIndex++;
			if (this._stepIndex >= state.loopEnd) {
				this._stepIndex = state.loopStart;
			}
		}
	}

	private _scheduleStep(
		stepIndex: number,
		t: number,
		state: TransportState,
		tracks: TrackConfig[],
	): void {
		this._transport.setCursor(stepIndex);

		const swingDelay =
			state.swingEnabled && this._isSwingStep(stepIndex) ? state.swing * this._stepDur * 2 : 0;

		for (const track of tracks) {
			const factor = 4 / track.pattern.resolution;
			if (stepIndex % factor !== 0) continue;
			const idx = Math.floor(stepIndex / factor);
			if (idx >= track.pattern.steps.length) continue;
			const step = track.pattern.steps[idx];
			if (!step) continue;
			const when = t + swingDelay + step.offsetMs / 1000;
			this._engine.trigger(track.sampleId, step.velocity, when);
		}
	}
}