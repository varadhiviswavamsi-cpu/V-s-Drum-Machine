import { get } from '$lib/stores/core';
import {
	tracksStore,
	setTracksFromSamples,
	masterStore,
	setMaster,
	resetMaster,
	getTransport,
	setBpm,
	setSwing,
	setSwingEnabled,
	setLoop,
	initEngine,
	disposeEngine,
	stop,
	getEngine
} from '$lib/stores';
import { saveProject as dbSave, loadProject as dbLoad, deleteProject as dbDelete, listProjects as dbList, saveRecording as dbSaveRecording, getRecording as dbGetRecording, deleteRecording as dbDeleteRecording } from '$lib/storage';
import { PROJECT_VERSION } from '$lib/constants';
import type { Project, TrackConfig } from '$lib/types';
import type { StoredRecording } from '$lib/storage';

let _currentId: string | null = null;
let _currentName = 'Untitled';
let _currentCreatedAt: string | null = null;

export function currentProjectId(): string | null {
	return _currentId;
}

export function currentProjectName(): string {
	return _currentName;
}

function computePatternLength(tracks: Record<string, TrackConfig>): number {
	let max = 0;
	for (const track of Object.values(tracks)) {
		const len = track.pattern.steps.length * (4 / track.pattern.resolution);
		if (len > max) max = len;
	}
	return max || 16;
}

function buildProject(name: string, createdAt: string): Project {
	const transport = getTransport().state;
	const tracks = get(tracksStore);
	const master = get(masterStore);
	const now = new Date().toISOString();
	return {
		version: PROJECT_VERSION,
		name,
		transport: {
			bpm: transport.bpm,
			swing: transport.swing,
			swingEnabled: transport.swingEnabled,
			loopStart: transport.loopStart,
			loopEnd: transport.loopEnd
		},
		patternLength: computePatternLength(tracks),
		tracks,
		master,
		createdAt,
		updatedAt: now
	};
}

export async function saveProject(id?: string, name?: string): Promise<string> {
	if (name !== undefined) _currentName = name;
	const createdAt = _currentCreatedAt || new Date().toISOString();
	const project = buildProject(_currentName, createdAt);

	if (id) {
		_currentId = id;
		_currentCreatedAt = createdAt;
		await dbSave(id, project);
		return id;
	}

	if (_currentId) {
		_currentCreatedAt = createdAt;
		await dbSave(_currentId, project);
		return _currentId;
	}

	const newId = crypto.randomUUID();
	_currentId = newId;
	_currentCreatedAt = createdAt;
	await dbSave(newId, project);
	return newId;
}

export async function loadProject(id: string): Promise<void> {
	const project = await dbLoad(id);
	if (!project) throw new Error(`Project not found: ${id}`);

	stop();
	disposeEngine();

	tracksStore.set(project.tracks);
	setBpm(project.transport.bpm);
	setSwing(project.transport.swing);
	setSwingEnabled(project.transport.swingEnabled);
	setLoop(project.transport.loopStart, project.transport.loopEnd);

	await initEngine();
	setMaster(project.master);

	_currentId = id;
	_currentName = project.name;
	_currentCreatedAt = project.createdAt;

	// Sync the transport loop to the loaded pattern length so the sequencer
	// plays the full pattern (16 / 32 / 64 steps) instead of clamping at 16.
	setLoop(0, activeCellsFromTracks(project.tracks));
}

function activeCellsFromTracks(tracks: Record<string, TrackConfig>): number {
	let max = 0;
	for (const track of Object.values(tracks)) {
		const factor = 4 / track.pattern.resolution;
		const cells = track.pattern.steps.length * factor;
		if (cells > max) max = cells;
	}
	return max || 16;
}

export async function newProject(): Promise<void> {
	stop();
	disposeEngine();

	tracksStore.set({});
	await initEngine();

	const engine = getEngine();
	if (engine) {
		setTracksFromSamples(engine.sampleEntries);
	}

	const transport = getTransport();
	transport.setBpm(120);
	transport.setSwing(0.1);
	transport.setSwingEnabled(true);
	transport.setLoop(0, 16);

	resetMaster();

	_currentId = null;
	_currentName = 'Untitled';
	_currentCreatedAt = null;
}

export const MAX_PROJECTS = 16;

export async function canCreateProject(): Promise<boolean> {
	const existing = await dbList();
	return existing.length < MAX_PROJECTS;
}

export type NewProjectResult = { ok: true } | { ok: false; reason: 'full' };

export async function newProjectSafe(): Promise<NewProjectResult> {
	if (_currentId === null && !(await canCreateProject())) {
		return { ok: false, reason: 'full' };
	}
	await newProject();
	return { ok: true };
}

export async function listProjects(): Promise<Array<{ id: string; project: Project }>> {
	return dbList();
}

export async function deleteProject(id: string): Promise<void> {
	await dbDelete(id);
	if (_currentId === id) {
		_currentId = null;
		_currentCreatedAt = null;
	}
}

export async function saveProjectAudio(
	projectId: string,
	blob: Blob,
	durationSeconds: number,
	sampleRate: number,
	channelCount: number
): Promise<void> {
	const arrayBuffer = await blob.arrayBuffer();
	const recording: StoredRecording = {
		blob: arrayBuffer,
		durationSeconds,
		sampleRate,
		channelCount,
		createdAt: new Date().toISOString()
	};
	await dbSaveRecording(projectId, recording);
}

export async function getProjectAudio(projectId: string): Promise<StoredRecording | undefined> {
	return dbGetRecording(projectId);
}

export async function deleteProjectAudio(projectId: string): Promise<void> {
	await dbDeleteRecording(projectId);
}

export function createAudioUrl(recording: StoredRecording): string {
	const blob = new Blob([recording.blob], { type: 'audio/wav' });
	return URL.createObjectURL(blob);
}

