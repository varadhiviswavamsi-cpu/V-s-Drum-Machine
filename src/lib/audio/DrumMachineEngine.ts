import type { MasterSettings, TrackConfig } from '$lib/types';
import { AudioContextManager } from './AudioContextManager';
import { SampleManager } from './SampleManager';
import { MasterBus } from './MasterBus';
import { Mixer } from './Mixer';
import { Recorder } from './Recorder';
import type { RecordingResult } from './Recorder';

export class DrumMachineEngine {
	private readonly _ctx = AudioContextManager.instance;
	private _samples: SampleManager | null = null;
	private _master: MasterBus | null = null;
	private _mixer: Mixer | null = null;
	private _recorder: Recorder | null = null;

	get ready(): boolean {
		return this._master !== null;
	}

	get sampleEntries() {
		if (!this._samples) return [];
		return this._samples.entries;
	}

	async init(): Promise<void> {
		this._ctx.init();
		await this._ctx.resume();

		this._samples = new SampleManager(() => this._ctx.context);
		await this._samples.loadManifest();
		await this._samples.loadAll();

		this._master = new MasterBus(this._ctx.context);
		this._mixer = new Mixer(this._ctx.context, this._master);

		this._recorder = new Recorder(this._ctx.context);
		await this._recorder.init();

		// Tap the full mix: master gain -> recorder -> destination.
		// The recorder always passes audio through; it only captures when armed.
		this._master.masterVolume.disconnect();
		this._master.masterVolume.connect(this._recorder.node);
		this._recorder.node.connect(this._ctx.context.destination);
	}

	get isRecording(): boolean {
		return this._recorder ? this._recorder.isRecording : false;
	}

	getMasterAnalyser(): AnalyserNode | null {
		return this._master ? this._master.analyser : null;
	}

	async startRecording(): Promise<void> {
		if (!this._recorder) throw new Error('Recorder not initialized.');
		await this._recorder.start();
	}

	async stopRecording(): Promise<RecordingResult | null> {
		if (!this._recorder) return null;
		return this._recorder.stop();
	}

	createTrack(config: TrackConfig): void {
		this._assertReady();
		this._mixer!.addChannel(config);
	}

	removeTrack(sampleId: string): void {
		this._assertReady();
		this._mixer!.removeChannel(sampleId);
	}

	trigger(sampleId: string, velocity: number, when?: number): void {
		this._assertReady();
		const buffer = this._samples!.buffer(sampleId);
		if (!buffer) return;
		const t = when ?? this._ctx.currentTime;
		this._mixer!.trigger(sampleId, buffer, velocity, t);
	}

	setMaster(settings: MasterSettings): void {
		this._assertReady();
		this._master!.setSettings(settings);
	}

	setTrackVolume(sampleId: string, volume: number): void {
		this._assertReady();
		this._mixer!.setVolume(sampleId, volume);
	}

	setTrackMuted(sampleId: string, muted: boolean): void {
		this._assertReady();
		this._mixer!.setMuted(sampleId, muted);
	}

	setTrackSoloed(sampleId: string, soloed: boolean): void {
		this._assertReady();
		this._mixer!.setSoloed(sampleId, soloed);
	}

	setTrackPan(sampleId: string, pan: number): void {
		this._assertReady();
		this._mixer!.setPan(sampleId, pan);
	}

	setTrackDelaySend(sampleId: string, amount: number): void {
		this._assertReady();
		this._mixer!.setDelaySend(sampleId, amount);
	}

	setTrackReverbSend(sampleId: string, amount: number): void {
		this._assertReady();
		this._mixer!.setReverbSend(sampleId, amount);
	}

	setTrackDrive(sampleId: string, drive: number): void {
		this._assertReady();
		this._mixer!.setDrive(sampleId, drive);
	}

	async resume(): Promise<void> {
		await this._ctx.resume();
	}

	async suspend(): Promise<void> {
		await this._ctx.suspend();
	}

	dispose(): void {
		this._mixer?.dispose();
		this._samples?.dispose();
		this._mixer = null;
		this._master = null;
		this._samples = null;
	}

	private _assertReady(): void {
		if (!this.ready) throw new Error('Engine not initialized.');
	}
}
