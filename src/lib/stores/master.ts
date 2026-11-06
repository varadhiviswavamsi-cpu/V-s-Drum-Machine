import { writable, get } from './core';
import type { Writable } from './core';
import { DEFAULT_MASTER } from '$lib/constants';
import type { MasterSettings } from '$lib/types';
import { getEngine } from './engine';

export const masterStore: Writable<MasterSettings> = writable({ ...DEFAULT_MASTER });

export function setMaster(settings: MasterSettings): void {
	masterStore.set(settings);
	const engine = getEngine();
	if (engine) {
		engine.setMaster(settings);
	}
}

export function updateMaster(patch: Partial<MasterSettings>): void {
	const current = get(masterStore);
	const updated = { ...current, ...patch };
	setMaster(updated);
}

export function resetMaster(): void {
	setMaster({ ...DEFAULT_MASTER });
}
