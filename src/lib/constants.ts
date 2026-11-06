import type {
	MasterSettings,
	SampleManifestEntry,
	StepResolution,
	TrackConfig,
	TrackPattern,
} from './types';

export const PROJECT_VERSION = 1;

export const BPM_MIN = 20;
export const BPM_MAX = 300;
export const DEFAULT_BPM = 120;

export const SWING_MIN = 0;
export const SWING_MAX = 0.6;
export const DEFAULT_SWING = 0.1;

export const PATTERN_SIZES = [16, 32, 64] as const;
export const DEFAULT_PATTERN_LENGTH = 16;
export const MIN_PATTERN_LENGTH = 16;
export const MAX_PATTERN_LENGTH = 64;

export const DEFAULT_RESOLUTION: StepResolution = 4;

export const SCHEDULER = {
	/** setInterval driver period in ms */
	tickIntervalMs: 25,
	/** how far ahead of ctx.currentTime scheduling starts, in seconds */
	lookaheadS: 0.025,
	/** how far ahead of the cursor the sequencer schedules, in seconds */
	scheduleWindowS: 0.12,
} as const;

export const PALETTE = [
	'#e53935',
	'#d81b60',
	'#8e24aa',
	'#5e35b1',
	'#3949ab',
	'#1e88e5',
	'#039be5',
	'#00acc1',
	'#00897b',
	'#43a047',
	'#7cb342',
	'#c0ca33',
	'#fdd835',
	'#ffb300',
	'#fb8c00',
	'#f4511e',
] as const;

/** Top row, then bottom row — order matches the manifest's track order. */
export const KEY_MAP = [
	'a',
	's',
	'd',
	'f',
	'g',
	'h',
	'j',
	'k',
	'z',
	'x',
	'c',
	'v',
	'b',
	'n',
	'm',
	',',
] as const;

export const DEFAULT_MASTER: MasterSettings = {
	volume: 0.9,
	filterCutoff: 18000,
	filterResonance: 0.7,
	delayTime: 0.25,
	delayFeedback: 0.35,
	delayMix: 0.15,
	reverbMix: 0.12,
	drive: 0,
};

export function createEmptyPattern(
	steps: number,
	resolution: StepResolution = DEFAULT_RESOLUTION,
): TrackPattern {
	return { resolution, steps: Array<null>(steps).fill(null) };
}

export function createTrackConfig(
	sample: SampleManifestEntry,
	steps = DEFAULT_PATTERN_LENGTH,
): TrackConfig {
	return {
		sampleId: sample.id,
		name: sample.label,
		color: sample.color,
		volume: 1,
		pan: 0,
		muted: false,
		solo: false,
		send: { delay: 0, reverb: 0, drive: 0 },
		pattern: createEmptyPattern(steps),
	};
}