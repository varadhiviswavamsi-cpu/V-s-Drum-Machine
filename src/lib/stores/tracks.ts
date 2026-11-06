import { writable, get } from './core';
import type { Writable } from './core';
import { createTrackConfig, DEFAULT_RESOLUTION, MIN_PATTERN_LENGTH, MAX_PATTERN_LENGTH } from '$lib/constants';
import type { TrackConfig, TrackPattern, StepResolution, PatternStep, SampleManifestEntry } from '$lib/types';
import { getEngine } from './engine';

export const tracksStore: Writable<Record<string, TrackConfig>> = writable({});

/**
 * Seed tracks from SampleManager entries after manifest load.
 */
export function setTracksFromSamples(entries: SampleManifestEntry[]): void {
	const engine = getEngine();
	const tracks: Record<string, TrackConfig> = {};
	for (const entry of entries) {
		const config = createTrackConfig(entry);
		tracks[entry.id] = config;
		if (engine) {
			engine.createTrack(config);
		}
	}
	tracksStore.set(tracks);
}

/**
 * Immutable per-track update + engine forwarding.
 */
function applyTrack(sampleId: string, fn: (track: TrackConfig) => TrackConfig): void {
	tracksStore.update((tracks) => {
		const existing = tracks[sampleId];
		if (!existing) return tracks;
		const updated = fn({
			...existing,
			pattern: { ...existing.pattern, steps: [...existing.pattern.steps] }
		});
		return { ...tracks, [sampleId]: updated };
	});
	const engine = getEngine();
	const updated = get(tracksStore)[sampleId];
	if (!engine || !updated) return;
	engine.setTrackVolume(sampleId, updated.volume);
	engine.setTrackMuted(sampleId, updated.muted);
	engine.setTrackSoloed(sampleId, updated.solo);
	engine.setTrackPan(sampleId, updated.pan);
	engine.setTrackDelaySend(sampleId, updated.send.delay);
	engine.setTrackReverbSend(sampleId, updated.send.reverb);
	engine.setTrackDrive(sampleId, updated.send.drive);
}

export function setTrackVolume(sampleId: string, volume: number): void {
	applyTrack(sampleId, (t) => ({ ...t, volume }));
}

export function setTrackMuted(sampleId: string, muted: boolean): void {
	applyTrack(sampleId, (t) => ({ ...t, muted }));
}

export function setTrackSoloed(sampleId: string, solo: boolean): void {
	applyTrack(sampleId, (t) => ({ ...t, solo }));
}

export function setTrackPan(sampleId: string, pan: number): void {
	applyTrack(sampleId, (t) => ({ ...t, pan }));
}

export function setTrackDelaySend(sampleId: string, delay: number): void {
	applyTrack(sampleId, (t) => ({ ...t, send: { ...t.send, delay } }));
}

export function setTrackReverbSend(sampleId: string, reverb: number): void {
	applyTrack(sampleId, (t) => ({ ...t, send: { ...t.send, reverb } }));
}

/**
 * Drive into the effects bus; forwarded to the mixer via applyTrack.
 * Non-muting makeup gain: gain = 1 + drive * 2.
 */
export function setTrackDrive(sampleId: string, drive: number): void {
	applyTrack(sampleId, (t) => ({ ...t, send: { ...t.send, drive } }));
}

// ─── Pattern operations ────────────────────────────────────
// The sequencer maps sixteenth-note indices to pattern slots via:
//   factor = 4 / resolution
//   patternIndex = floor(sixteenthIndex / factor)
//   pattern.steps.length = patternLength (in pattern-native steps)

function patternIndex(sixteenthIndex: number, resolution: StepResolution): number {
	const factor = 4 / resolution;
	return Math.floor(sixteenthIndex / factor);
}

function patternLengthFromSteps(steps: (PatternStep | null)[], resolution: StepResolution): number {
	const factor = 4 / resolution;
	return steps.length * factor;
}

function resampleSteps(
	steps: (PatternStep | null)[],
	newSixteenthLength: number,
	newResolution: StepResolution
): (PatternStep | null)[] {
	const factor = 4 / newResolution;
	const newPatternLength = Math.ceil(newSixteenthLength / factor);
	const newSteps: (PatternStep | null)[] = [];
	for (let i = 0; i < newPatternLength; i++) {
		// Map back to sixteenth index to sample from old steps
		const sixteenthIndex = i * factor;
		const oldFactor = 4 / DEFAULT_RESOLUTION;
		const oldIndex = Math.floor(sixteenthIndex / oldFactor);
		newSteps.push(oldIndex < steps.length ? steps[oldIndex] : null);
	}
	return newSteps;
}

export function setPatternLength(sampleId: string, length: number): void {
	const clamped = Math.max(MIN_PATTERN_LENGTH, Math.min(MAX_PATTERN_LENGTH, length));
	applyTrack(sampleId, (t) => {
		const factor = 4 / t.pattern.resolution;
		const newPatternLength = Math.ceil(clamped / factor);
		const newSteps: (PatternStep | null)[] = [];
		for (let i = 0; i < newPatternLength; i++) {
			newSteps.push(i < t.pattern.steps.length ? t.pattern.steps[i] : null);
		}
		return { ...t, pattern: { ...t.pattern, steps: newSteps } };
	});
}

export function setPatternResolution(sampleId: string, resolution: StepResolution): void {
	applyTrack(sampleId, (t) => {
		const sixteenthLength = patternLengthFromSteps(t.pattern.steps, t.pattern.resolution);
		const factor = 4 / resolution;
		const newPatternLength = Math.ceil(sixteenthLength / factor);
		const newSteps: (PatternStep | null)[] = [];
		for (let i = 0; i < newPatternLength; i++) {
			const sixteenthIdx = i * factor;
			const oldFactor = 4 / t.pattern.resolution;
			const oldIdx = Math.floor(sixteenthIdx / oldFactor);
			newSteps.push(oldIdx < t.pattern.steps.length ? t.pattern.steps[oldIdx] : null);
		}
		return { ...t, pattern: { ...t.pattern, resolution, steps: newSteps } };
	});
}

export function setStep(sampleId: string, sixteenthIndex: number, step: PatternStep | null): void {
	applyTrack(sampleId, (t) => {
		const hi = patternIndex(sixteenthIndex, t.pattern.resolution);
		const newSteps = [...t.pattern.steps];
		newSteps[hi] = step;
		return { ...t, pattern: { ...t.pattern, steps: newSteps } };
	});
}

export function toggleStep(sampleId: string, sixteenthIndex: number): void {
	applyTrack(sampleId, (t) => {
		const hi = patternIndex(sixteenthIndex, t.pattern.resolution);
		const newSteps = [...t.pattern.steps];
		const existing = newSteps[hi];
		newSteps[hi] = existing ? null : { velocity: 1, offsetMs: 0 };
		return { ...t, pattern: { ...t.pattern, steps: newSteps } };
	});
}

export function clearStep(sampleId: string, sixteenthIndex: number): void {
	applyTrack(sampleId, (t) => {
		const hi = patternIndex(sixteenthIndex, t.pattern.resolution);
		const newSteps = [...t.pattern.steps];
		newSteps[hi] = null;
		return { ...t, pattern: { ...t.pattern, steps: newSteps } };
	});
}

export function setStepVelocity(sampleId: string, sixteenthIndex: number, velocity: number): void {
	const clamped = Math.max(0.01, Math.min(1, velocity));
	applyTrack(sampleId, (t) => {
		const hi = patternIndex(sixteenthIndex, t.pattern.resolution);
		const newSteps = [...t.pattern.steps];
		const existing = newSteps[hi];
		if (existing) {
			newSteps[hi] = { ...existing, velocity: clamped };
		} else {
			newSteps[hi] = { velocity: clamped, offsetMs: 0 };
		}
		return { ...t, pattern: { ...t.pattern, steps: newSteps } };
	});
}

export function setStepOffsetMs(sampleId: string, sixteenthIndex: number, offsetMs: number): void {
	const clamped = Math.max(-50, Math.min(50, offsetMs));
	applyTrack(sampleId, (t) => {
		const hi = patternIndex(sixteenthIndex, t.pattern.resolution);
		const newSteps = [...t.pattern.steps];
		const existing = newSteps[hi];
		if (existing) {
			newSteps[hi] = { ...existing, offsetMs: clamped };
		} else {
			newSteps[hi] = { velocity: 1, offsetMs: clamped };
		}
		return { ...t, pattern: { ...t.pattern, steps: newSteps } };
	});
}

// ─── Add / remove tracks ──────────────────────────────────

export function addTrack(sample: SampleManifestEntry): string {
	const engine = getEngine();
	const config = createTrackConfig(sample);
	if (engine) {
		engine.createTrack(config);
	}
	tracksStore.update((tracks) => ({ ...tracks, [config.sampleId]: config }));
	return config.sampleId;
}

export function removeTrack(sampleId: string): void {
	const engine = getEngine();
	if (engine) {
		engine.removeTrack(sampleId);
	}
	tracksStore.update((tracks) => {
		const { [sampleId]: _, ...rest } = tracks;
		return rest;
	});
}
