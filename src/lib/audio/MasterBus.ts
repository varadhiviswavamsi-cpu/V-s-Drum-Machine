import type { MasterSettings } from '$lib/types';
import { DEFAULT_MASTER } from '$lib/constants';
import { createReverbImpulse } from './effects';

const TIME_CONSTANT = 0.02;

export class MasterBus {
	readonly input!: GainNode;
	readonly delayIn!: GainNode;
	readonly reverbIn!: GainNode;
	readonly analyser!: AnalyserNode;
	readonly drive!: GainNode;

	private readonly _filter!: BiquadFilterNode;
	private readonly _compressor!: DynamicsCompressorNode;
	readonly masterVolume!: GainNode;
	private readonly _delayL!: DelayNode;
	private readonly _delayR!: DelayNode;
	private readonly _delayWetL!: GainNode;
	private readonly _delayWetR!: GainNode;
	private readonly _panL!: StereoPannerNode;
	private readonly _panR!: StereoPannerNode;
	private readonly _delayFeedL!: GainNode;
	private readonly _delayFeedR!: GainNode;
	private readonly _convolver!: ConvolverNode;
	private readonly _reverbWet!: GainNode;
	private _driveValue = DEFAULT_MASTER.drive;

	constructor(private readonly _context: AudioContext) {
		const ctx = this._context;

		const input = (this.input = ctx.createGain());

		const filter = (this._filter = ctx.createBiquadFilter());
		filter.type = 'lowpass';
		input.connect(filter);

		const compressor = (this._compressor = ctx.createDynamicsCompressor());
		compressor.threshold.value = -18;
		compressor.ratio.value = 3;
		compressor.attack.value = 0.005;
		compressor.release.value = 0.18;
		compressor.knee.value = 20;
		filter.connect(compressor);

		const analyser = (this.analyser = ctx.createAnalyser());
		analyser.fftSize = 2048;
		compressor.connect(analyser);

		const drive = (this.drive = ctx.createGain());

		const masterVolume = (this.masterVolume = ctx.createGain());
		analyser.connect(drive);
		drive.connect(masterVolume);
		masterVolume.connect(ctx.destination);

		const delayL = (this._delayL = ctx.createDelay(1));
		const delayR = (this._delayR = ctx.createDelay(1));
		const delayIn = (this.delayIn = ctx.createGain());
		delayIn.connect(delayL);
		delayIn.connect(delayR);

		const feedL = (this._delayFeedL = ctx.createGain());
		const feedR = (this._delayFeedR = ctx.createGain());
		const delayWetL = (this._delayWetL = ctx.createGain());
		const delayWetR = (this._delayWetR = ctx.createGain());
		const panL = (this._panL = ctx.createStereoPanner());
		const panR = (this._panR = ctx.createStereoPanner());

		delayL.connect(feedR);
		delayL.connect(delayWetL);
		delayR.connect(feedL);
		delayR.connect(delayWetR);
		feedL.connect(delayL);
		feedR.connect(delayR);
		panL.pan.value = -1;
		panR.pan.value = 1;
		delayWetL.connect(panL);
		delayWetR.connect(panR);
		panL.connect(input);
		panR.connect(input);

		const convolver = (this._convolver = ctx.createConvolver());
		convolver.buffer = createReverbImpulse(ctx);
		const reverbIn = (this.reverbIn = ctx.createGain());
		const reverbWet = (this._reverbWet = ctx.createGain());
		reverbIn.connect(convolver);
		convolver.connect(reverbWet);
		reverbWet.connect(input);

		this.setSettings(DEFAULT_MASTER);
	}

	setMasterVolume(value: number): void {
		this._ramp(this.masterVolume.gain, value);
	}

	setFilterCutoff(value: number): void {
		this._ramp(this._filter.frequency, value);
	}

	setFilterResonance(value: number): void {
		this._ramp(this._filter.Q, value);
	}

	setDelayTime(value: number): void {
		this._ramp(this._delayL.delayTime, value);
		this._ramp(this._delayR.delayTime, value);
	}

	setDelayFeedback(value: number): void {
		this._ramp(this._delayFeedL.gain, value);
		this._ramp(this._delayFeedR.gain, value);
	}

	setDelayMix(value: number): void {
		const wet = value / 2;
		this._ramp(this._delayWetL.gain, wet);
		this._ramp(this._delayWetR.gain, wet);
	}

	setReverbMix(value: number): void {
		this._ramp(this._reverbWet.gain, value);
	}

	setDrive(value: number): void {
		this._driveValue = value;
		this._ramp(this.drive.gain, this._driveGain(value));
	}

	get driveValue(): number {
		return this._driveValue;
	}

	setSettings(settings: MasterSettings): void {
		this.setMasterVolume(settings.volume);
		this.setFilterCutoff(settings.filterCutoff);
		this.setFilterResonance(settings.filterResonance);
		this.setDelayTime(settings.delayTime);
		this.setDelayFeedback(settings.delayFeedback);
		this.setDelayMix(settings.delayMix);
		this.setReverbMix(settings.reverbMix);
		this.setDrive(settings.drive);
	}

	private _driveGain(value: number): number {
		return 1 + value * 2;
	}

	private _ramp(param: AudioParam, value: number): void {
		param.setTargetAtTime(value, this._context.currentTime, TIME_CONSTANT);
	}
}