import { get } from './core';
import { writable } from './core';
import type { Writable } from './core';
import { DrumMachineEngine } from '$lib/audio/DrumMachineEngine';
import { AudioContextManager } from '$lib/audio/AudioContextManager';
import { Sequencer } from '$lib/sequencer/Sequencer';
import { getTransport, transportState } from './transport';
import { tracksStore } from './tracks';
import { masterStore } from './master';
import type { MasterSettings, TransportState } from '$lib/types';
import type { RecordingResult } from '$lib/audio/Recorder';

let _engine: DrumMachineEngine | null = null;
let _sequencer: Sequencer | null = null;

export const engineReady: Writable<boolean> = writable(false);
export const engineError: Writable<string | null> = writable(null);

export function getEngine(): DrumMachineEngine | null {
	return _engine;
}

export async function initEngine(): Promise<void> {
	if (_engine) return;

	try {
		const engine = new DrumMachineEngine();
		await engine.init();
		_engine = engine;

		// Seed tracks from loaded sample manifest
		const entries = engine.sampleEntries;
		for (const entry of entries) {
			const tracks = get(tracksStore);
			if (!tracks[entry.id]) continue;
			engine.createTrack(tracks[entry.id]);
		}

		// Build sequencer
		const context = AudioContextManager.instance.context;
		const sequencer = new Sequencer(
			context,
			engine,
			() => Object.values(get(tracksStore)),
			getTransport()
		);
		_sequencer = sequencer;

		engineReady.set(true);
		engineError.set(null);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		engineError.set(message);
		engineReady.set(false);
	}
}

export function disposeEngine(): void {
	if (_sequencer) {
		_sequencer.dispose();
		_sequencer = null;
	}
	if (_engine) {
		_engine.dispose();
		_engine = null;
	}
	engineReady.set(false);
}

// ─── Master forwarding ─────────────────────────────────────

export function setMasterSettings(settings: MasterSettings): void {
	const engine = getEngine();
	if (engine) {
		engine.setMaster(settings);
	}
}

// ─── Transport pipeline ────────────────────────────────────

export function setBpm(bpm: number): void {
	if (_sequencer) {
		_sequencer.setBpm(bpm);
	} else {
		getTransport().setBpm(bpm);
	}
}

export function setSwing(swing: number): void {
	if (_sequencer) {
		_sequencer.setSwing(swing);
	} else {
		getTransport().setSwing(swing);
	}
}

export function setSwingEnabled(enabled: boolean): void {
	if (_sequencer) {
		_sequencer.setSwingEnabled(enabled);
	} else {
		getTransport().setSwingEnabled(enabled);
	}
}

export function setLoop(loopStart: number, loopEnd: number): void {
	if (_sequencer) {
		_sequencer.setLoop(loopStart, loopEnd);
	} else {
		getTransport().setLoop(loopStart, loopEnd);
	}
}

// ─── Playback ──────────────────────────────────────────────

export function play(): void {
	if (_sequencer) {
		_sequencer.play();
	} else {
		getTransport().setPlaying(true);
	}
}

export function pause(): void {
	if (_sequencer) {
		_sequencer.pause();
	} else {
		getTransport().setPlaying(false);
	}
}

export function togglePlay(): void {
	if (_sequencer) {
		_sequencer.togglePlay();
	} else {
		const transport = getTransport();
		transport.setPlaying(!transport.state.playing);
	}
}

export function stop(): void {
	if (_sequencer) {
		_sequencer.stop();
	} else {
		getTransport().setPlaying(false);
		getTransport().setCursor(0);
	}
}

// ─── Recording ───────────────────────────────────────────────

export function isRecording(): boolean {
	const engine = getEngine();
	return engine ? engine.isRecording : false;
}

export async function startRecording(): Promise<void> {
	const engine = getEngine();
	if (engine) {
		await engine.startRecording();
	}
}

export async function stopRecording(): Promise<RecordingResult | null> {
	const engine = getEngine();
	if (engine) {
		return engine.stopRecording();
	}
	return null;
}

export function getMasterLevels(): { rms: number; peak: number } | null {
	const engine = getEngine();
	if (!engine) return null;
	const analyser = engine.getMasterAnalyser();
	if (!analyser) return null;
	const data = new Uint8Array(analyser.frequencyBinCount);
	analyser.getByteFrequencyData(data);
	let sum = 0;
	let peak = 0;
	for (let i = 0; i < data.length; i++) {
		const v = data[i] / 255;
		sum += v * v;
		if (v > peak) peak = v;
	}
	const rms = Math.sqrt(sum / data.length);
	return { rms, peak };
}

// ─── Trigger ───────────────────────────────────────────────

export function trigger(sampleId: string, velocity = 1, when?: number): void {
	const engine = getEngine();
	if (engine) {
		engine.trigger(sampleId, velocity, when);
	}
}

// ─── Audio context lifecycle ───────────────────────────────

export async function resume(): Promise<void> {
	await AudioContextManager.instance.resume();
}

export async function suspend(): Promise<void> {
	await AudioContextManager.instance.suspend();
}
