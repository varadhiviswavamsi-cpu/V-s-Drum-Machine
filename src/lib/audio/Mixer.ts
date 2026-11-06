import type { TrackConfig } from '$lib/types';
import type { MasterBus } from './MasterBus';

interface Channel {
	config: TrackConfig;
	velocityGain: GainNode;
	trackGain: GainNode;
	drive: GainNode;
	panner: StereoPannerNode;
	delaySend: GainNode;
	reverbSend: GainNode;
}

export class Mixer {
	private readonly _context: AudioContext;
	private readonly _master: MasterBus;
	private readonly _channels = new Map<string, Channel>();

	constructor(context: AudioContext, master: MasterBus) {
		this._context = context;
		this._master = master;
	}

	get ids(): string[] {
		return [...this._channels.keys()];
	}

	addChannel(config: TrackConfig): void {
		if (this._channels.has(config.sampleId)) return;

		const ctx = this._context;
		const velocityGain = ctx.createGain();
		const trackGain = ctx.createGain();
		const drive = ctx.createGain();
		const panner = ctx.createStereoPanner();
		const delaySend = ctx.createGain();
		const reverbSend = ctx.createGain();

		velocityGain.connect(trackGain);
		trackGain.connect(drive);
		drive.connect(panner);
		panner.connect(this._master.input);
		panner.connect(delaySend);
		delaySend.connect(this._master.delayIn);
		panner.connect(reverbSend);
		reverbSend.connect(this._master.reverbIn);

		const channel: Channel = {
			config,
			velocityGain,
			trackGain,
			drive,
			panner,
			delaySend,
			reverbSend,
		};
		this._channels.set(config.sampleId, channel);

		this._apply(config.sampleId);
	}

	removeChannel(sampleId: string): void {
		const ch = this._channels.get(sampleId);
		if (!ch) return;

		ch.velocityGain.disconnect();
		ch.trackGain.disconnect();
		ch.drive.disconnect();
		ch.panner.disconnect();
		ch.delaySend.disconnect();
		ch.reverbSend.disconnect();
		this._channels.delete(sampleId);
	}

	trigger(sampleId: string, buffer: AudioBuffer, velocity: number, when: number): void {
		const ch = this._channels.get(sampleId);
		if (!ch) return;
		if (!this._shouldPlay(sampleId)) return;

		const ctx = this._context;
		const source = ctx.createBufferSource();
		source.buffer = buffer;
		source.connect(ch.velocityGain);
		ch.velocityGain.gain.setValueAtTime(Math.max(0.01, Math.min(1, velocity)), when);
		source.start(when);
	}

	private _shouldPlay(sampleId: string): boolean {
		const ch = this._channels.get(sampleId);
		if (!ch) return false;
		if (ch.config.muted) return false;
		if (this._anySolo()) return ch.config.solo;
		return true;
	}

	private _anySolo(): boolean {
		for (const ch of this._channels.values()) {
			if (ch.config.solo) return true;
		}
		return false;
	}

	setVolume(sampleId: string, volume: number): void {
		const ch = this._channels.get(sampleId);
		if (!ch) return;
		ch.config.volume = volume;
		this._apply(sampleId);
	}

	setMuted(sampleId: string, muted: boolean): void {
		const ch = this._channels.get(sampleId);
		if (!ch) return;
		ch.config.muted = muted;
		this._apply(sampleId);
	}

	setSoloed(sampleId: string, solo: boolean): void {
		const ch = this._channels.get(sampleId);
		if (!ch) return;
		ch.config.solo = solo;
		this._applyAll();
	}

	setPan(sampleId: string, pan: number): void {
		const ch = this._channels.get(sampleId);
		if (!ch) return;
		ch.config.pan = pan;
		this._ramp(ch.panner.pan, pan);
	}

	setDelaySend(sampleId: string, amount: number): void {
		const ch = this._channels.get(sampleId);
		if (!ch) return;
		ch.config.send.delay = amount;
		this._ramp(ch.delaySend.gain, amount);
	}

	setReverbSend(sampleId: string, amount: number): void {
		const ch = this._channels.get(sampleId);
		if (!ch) return;
		ch.config.send.reverb = amount;
		this._ramp(ch.reverbSend.gain, amount);
	}

	setDrive(sampleId: string, value: number): void {
		const ch = this._channels.get(sampleId);
		if (!ch) return;
		ch.config.send.drive = value;
		this._ramp(ch.drive.gain, this._driveGain(value));
	}

	private _apply(sampleId: string): void {
		const ch = this._channels.get(sampleId);
		if (!ch) return;
		const target = ch.config.muted ? 0 : ch.config.volume;
		this._ramp(ch.trackGain.gain, target);
		this._ramp(ch.drive.gain, this._driveGain(ch.config.send.drive));
	}

	private _driveGain(value: number): number {
		return 1 + value * 2;
	}

	private _applyAll(): void {
		for (const id of this._channels.keys()) {
			this._apply(id);
		}
	}

	private _ramp(param: AudioParam, value: number): void {
		param.setTargetAtTime(value, this._context.currentTime, 0.02);
	}

	dispose(): void {
		for (const ch of this._channels.values()) {
			ch.velocityGain.disconnect();
			ch.trackGain.disconnect();
			ch.drive.disconnect();
			ch.panner.disconnect();
			ch.delaySend.disconnect();
			ch.reverbSend.disconnect();
		}
		this._channels.clear();
	}
}
