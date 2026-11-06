import { writable } from './core';
import type { Writable } from './core';
import { DEFAULT_BPM, DEFAULT_SWING, BPM_MIN, BPM_MAX, SWING_MIN, SWING_MAX } from '$lib/constants';
import { Transport } from '$lib/sequencer/Transport';
import type { TransportState } from '$lib/types';

// Module singleton
const _transport = new Transport({
	bpm: DEFAULT_BPM,
	swing: DEFAULT_SWING,
	swingEnabled: true
});

export const transportState: Writable<TransportState> = writable(_transport.state);
export const cursorState: Writable<{ currentStep: number; currentBeat: number; currentBar: number }> = writable({
	currentStep: _transport.state.currentStep,
	currentBeat: _transport.state.currentBeat,
	currentBar: _transport.state.currentBar
});

_transport.onChange((state) => {
	transportState.set(state);
});

_transport.onCursorChange((cursor) => {
	cursorState.set(cursor);
});

export function getTransport(): Transport {
	return _transport;
}
