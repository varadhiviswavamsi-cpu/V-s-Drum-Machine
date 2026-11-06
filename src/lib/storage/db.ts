import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Project } from '../types';

export const DB_NAME = 'vs-drum-machine';
export const DB_VERSION = 2;

export interface StoredRecording {
	blob: ArrayBuffer;
	durationSeconds: number;
	sampleRate: number;
	channelCount: number;
	createdAt: string;
}

export interface DrumMachineDB extends DBSchema {
	projects: {
		key: string;
		value: Project;
		indexes: {
			'by-updatedAt': string;
		};
	};
	meta: {
		key: string;
		value: unknown;
	};
	recordings: {
		key: string;
		value: StoredRecording;
	};
}

let dbPromise: Promise<IDBPDatabase<DrumMachineDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<DrumMachineDB>> {
	if (!dbPromise) {
		dbPromise = openDB<DrumMachineDB>(DB_NAME, DB_VERSION, {
			upgrade(db) {
				const projects = db.createObjectStore('projects');
				projects.createIndex('by-updatedAt', 'updatedAt');
				db.createObjectStore('meta');
				if (!db.objectStoreNames.contains('recordings')) {
					db.createObjectStore('recordings');
				}
			}
		});
	}
	return dbPromise;
}

export async function saveProject(id: string, project: Project): Promise<void> {
	const db = await getDB();
	await db.put('projects', project, id);
}

export async function loadProject(id: string): Promise<Project | undefined> {
	const db = await getDB();
	return db.get('projects', id);
}

export async function deleteProject(id: string): Promise<void> {
	const db = await getDB();
	await db.delete('projects', id);
	await db.delete('recordings', id);
}

export async function listProjects(): Promise<Array<{ id: string; project: Project }>> {
	const db = await getDB();
	const entries: Array<{ id: string; project: Project }> = [];
	let cursor = await db.transaction('projects').store.openCursor();
	while (cursor) {
		entries.push({ id: cursor.key as string, project: cursor.value });
		cursor = await cursor.continue();
	}
	return entries;
}

export async function saveRecording(projectId: string, recording: StoredRecording): Promise<void> {
	const db = await getDB();
	await db.put('recordings', recording, projectId);
}

export async function getRecording(projectId: string): Promise<StoredRecording | undefined> {
	const db = await getDB();
	return db.get('recordings', projectId);
}

export async function deleteRecording(projectId: string): Promise<void> {
	const db = await getDB();
	await db.delete('recordings', projectId);
}

export async function setMeta<T>(key: string, value: T): Promise<void> {
	const db = await getDB();
	await db.put('meta', value, key);
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
	const db = await getDB();
	return (await db.get('meta', key)) as T | undefined;
}
