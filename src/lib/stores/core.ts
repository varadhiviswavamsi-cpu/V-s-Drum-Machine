// Svelte store re-exports + shared utilities
export { writable, readable, get } from 'svelte/store';
import type { Writable, Readable, Unsubscriber } from 'svelte/store';
export type { Writable, Readable, Unsubscriber };

export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
