export interface SampleManifestEntry {
	/** Machine-readable id, e.g. "kick" */
	id: string;
	/** Filename relative to /samples, e.g. "kick.wav" */
	src: string;
	/** Human-readable label */
	label: string;
	/** Accent color used across the UI */
	color: string;
	/** Keyboard trigger key (single character) */
	key: string;
}

export interface LoadedSample extends SampleManifestEntry {
	buffer: AudioBuffer;
}

export interface PatternStep {
	/** 0.01 .. 1 */
	velocity: number;
	/** Off-grid displacement in milliseconds, -50 .. 50 */
	offsetMs: number;
}

/** 1 = quarter note steps, 2 = eighth, 4 = sixteenth */
export type StepResolution = 1 | 2 | 4;

export interface TrackPattern {
	resolution: StepResolution;
	/** One entry per step; null = inactive */
	steps: Array<PatternStep | null>;
}

export interface TrackSend {
	delay: number;
	reverb: number;
	/** Drive into the effects bus; non-muting makeup gain (gain = 1 + drive * 2) */
	drive: number;
}

export interface TrackConfig {
	sampleId: string;
	name: string;
	color: string;
	volume: number;
	pan: number;
	muted: boolean;
	solo: boolean;
	send: TrackSend;
	pattern: TrackPattern;
}

export interface MasterSettings {
	volume: number;
	filterCutoff: number;
	filterResonance: number;
	/** 0.05 .. 0.8 s */
	delayTime: number;
	/** 0 .. 0.95 */
	delayFeedback: number;
	delayMix: number;
	reverbMix: number;
	/** 0 .. 1, non-muting makeup gain (gain = 1 + drive * 2) */
	drive: number;
}

export interface TransportState {
	bpm: number;
	/** 0 .. 0.6 */
	swing: number;
	swingEnabled: boolean;
	playing: boolean;
	currentStep: number;
	currentBeat: number;
	currentBar: number;
	loopStart: number;
	loopEnd: number;
}

export interface Recording {
	projectId: string;
	durationSeconds: number;
	sampleRate: number;
	channelCount: number;
	createdAt: string;
}

export interface Project {
	version: number;
	name: string;
	transport: Pick<
		TransportState,
		'bpm' | 'swing' | 'swingEnabled' | 'loopStart' | 'loopEnd'
	>;
	patternLength: number;
	tracks: Record<string, TrackConfig>;
	master: MasterSettings;
	createdAt: string;
	updatedAt: string;
}