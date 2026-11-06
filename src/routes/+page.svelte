<script lang="ts">
	import { onMount } from 'svelte';
	import {
		clamp,
		transportState,
		cursorState,
		tracksStore,
		setTracksFromSamples,
		setTrackVolume,
		setTrackMuted,
		setTrackSoloed,
		setTrackPan,
		setTrackDrive,
		setTrackDelaySend,
		setTrackReverbSend,
		setPatternLength,
		setPatternResolution,
		setStep,
		toggleStep,
		clearStep,
		setStepVelocity,
		masterStore,
		updateMaster,
		resetMaster,
		engineReady,
		engineError,
		getEngine,
		initEngine,
		togglePlay,
		stop,
		setBpm,
		setSwing,
		setSwingEnabled,
		setLoop,
		trigger,
		resume,
		startRecording,
		stopRecording,
		isRecording,
		getMasterLevels
	} from '$lib/stores';
	import { get } from '$lib/stores/core';
	import {
		BPM_MIN,
		BPM_MAX,
		SWING_MIN,
		SWING_MAX,
		PATTERN_SIZES,
		KEY_MAP,
		DEFAULT_RESOLUTION
	} from '$lib/constants';
	import {
		currentProjectId,
		currentProjectName,
		saveProject,
		loadProject,
		newProjectSafe,
		listProjects,
		deleteProject,
		saveProjectAudio,
		getProjectAudio,
		deleteProjectAudio,
		createAudioUrl
	} from '$lib/projects';
	import type { Project } from '$lib/types';

	const VELOCITIES = [0.25, 0.5, 0.75, 1];
	const RESOLUTIONS: Array<1 | 2 | 4> = [1, 2, 4];

	let projectName = $state('Untitled');
	let projects = $state<Array<{ id: string; project: Project }>>([]);
	let error = $state<string | null>(null);

	let recording = $state(false);
	let recordingSeconds = $state(0);
	let recordError = $state<string | null>(null);
	let recordingUrl = $state<string | null>(null);
	let recordingInterval: ReturnType<typeof setInterval> | null = null;

	let audioPlayingId = $state<string | null>(null);
	let audioEls = new Map<string, HTMLAudioElement>();
	let audioUrls = new Map<string, string>();
	let audioTimes = $state<Record<string, number>>({});

	let preBoot = $state(true);
	let showBoot = $state(true);
	let starting = $state(false);
	let bootFailed = $state(false);

	let activeTrackId = $state<string | null>(null);
	let pressed = $state<Record<string, boolean>>({});

	// ─── DAW state ─────────────────────────────────────────────
	let showManual = $state(false);
	let metronomeEnabled = $state(false);
	let recLevel = $state(0);
	let playLevel = $state(0);
	let downbeatFlash = $state(false);
	let opening = $state(true);
	let openingProgress = $state(0);

	let trackOrder = $derived(Object.keys($tracksStore));
	let activeTrack = $derived(
		activeTrackId ? ($tracksStore[activeTrackId] ?? null) : null
	);
	let firstTrack = $derived(trackOrder.length > 0 ? $tracksStore[trackOrder[0]] ?? null : null);
	let activeCells = $derived(
		firstTrack ? firstTrack.pattern.steps.length * (4 / firstTrack.pattern.resolution) : 0
	);
	let playhead = $derived($cursorState.currentStep % Math.max(activeCells, 1));

	let sidebarOpen = $state(false);
	let lastSavedSignature = $state('');

	function snapshotSignature(): string {
		return JSON.stringify({
			name: projectName,
			tracks: $tracksStore,
			master: $masterStore,
			bpm: $transportState.bpm,
			swing: $transportState.swing,
			swingEnabled: $transportState.swingEnabled
		});
	}

	let dirty = $derived(snapshotSignature() !== lastSavedSignature);
	let sortedProjects = $derived(
		[...projects].sort((a, b) => new Date(b.project.updatedAt).getTime() - new Date(a.project.updatedAt).getTime())
	);

	function markSaved() {
		lastSavedSignature = snapshotSignature();
	}

	function toggleSidebar() {
		sidebarOpen = !sidebarOpen;
	}

	function closeSidebar() {
		sidebarOpen = false;
	}

	async function refresh() {
		projects = await listProjects();
	}

	onMount(() => {
		refresh();

		// ─── Pre-boot loading audio (3s futuristic UI beep) ────────────────────────
		const bootAudio = new Audio('/opening-overlay.mp3');
		bootAudio.play().catch(() => {
			const playOnce = () => {
				void bootAudio.play();
				document.removeEventListener('click', playOnce);
			};
			document.addEventListener('click', playOnce, { once: true });
		});

		// After 3s, transition from pre-boot to boot overlay
		setTimeout(() => {
			preBoot = false;
		}, 3000);

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				closeSidebar();
				return;
			}
			if (!get(engineReady) || e.repeat) return;
			const target = e.target as HTMLElement | null;
			if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
			if (e.code === 'Space') {
				e.preventDefault();
				togglePlay();
				return;
			}
			const idx = KEY_MAP.indexOf(e.key as (typeof KEY_MAP)[number]);
			if (idx === -1) return;
			const id = trackOrder[idx];
			if (!id) return;
			pressed[id] = true;
			trigger(id);
		};

		const onKeyUp = (e: KeyboardEvent) => {
			const idx = KEY_MAP.indexOf(e.key as (typeof KEY_MAP)[number]);
			if (idx === -1) return;
			const id = trackOrder[idx];
			if (id) pressed[id] = false;
		};

		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);

		// ─── Metronome + level metering ────────────────────────
		let lastBeat = $cursorState.currentBeat;
		const unsubCursor = cursorState.subscribe((c: { currentStep: number; currentBeat: number; currentBar: number }) => {
			if (!$transportState.playing || !metronomeEnabled) return;
			if (c.currentBeat !== lastBeat) {
				lastBeat = c.currentBeat;
				const downbeat = c.currentBeat % 4 === 0;
				if (downbeat) {
					playClick(true);
					flashDownbeat();
				} else {
					playClick(false);
				}
			}
		});
		startLevelMetering();

		// ─── Opening lightning sequence ────────────────────────
		let flash = 0;
		const openingTimer = setInterval(() => {
			openingProgress += 1;
			flash += 1;
			if (openingProgress >= 100) {
				clearInterval(openingTimer);
				opening = false;
			}
		}, 30);

		return () => {
			if (recordingInterval) {
				clearInterval(recordingInterval);
				recordingInterval = null;
			}
			stopLevelMetering();
			unsubCursor();
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
		};
	});

	function ensureActiveTrack() {
		if (activeTrackId && $tracksStore[activeTrackId]) return;
		activeTrackId = Object.keys($tracksStore)[0] ?? null;
	}

	async function startMachine() {
		if (starting) return;
		starting = true;
		bootFailed = false;
		try {
			await resume();
			await initEngine();
		} finally {
			starting = false;
		}
		if (!$engineReady) {
			bootFailed = true;
			return;
		}
		if (Object.keys($tracksStore).length === 0) {
			const engine = getEngine();
			if (engine) {
				setTracksFromSamples(engine.sampleEntries);
			}
		}
		ensureActiveTrack();
		showBoot = false;
		markSaved();
	}

	function handlePadPress(trackId: string) {
		trigger(trackId);
		pressed[trackId] = true;
	}

	function handlePadRelease(trackId: string) {
		pressed[trackId] = false;
	}

	function handleBpmInput(e: Event) {
		const v = Number((e.currentTarget as HTMLInputElement).value);
		setBpm(clamp(v, BPM_MIN, BPM_MAX));
	}

	function handleSwingInput(e: Event) {
		const v = Number((e.currentTarget as HTMLInputElement).value);
		setSwing(clamp(v, SWING_MIN, SWING_MAX));
	}

	function handleRowCellClick(trackId: string, ci: number) {
		toggleStep(trackId, ci);
	}

	function handleRowCellContext(trackId: string, ci: number) {
		const track = $tracksStore[trackId];
		if (!track) return;
		const factor = 4 / track.pattern.resolution;
		const si = Math.floor(ci / factor);
		const step = track.pattern.steps[si];
		if (!step) {
			setStep(trackId, ci, { velocity: 0.25, offsetMs: 0 });
			return;
		}
		const vi = VELOCITIES.indexOf(step.velocity);
		if (vi === -1 || vi === VELOCITIES.length - 1) {
			clearStep(trackId, ci);
		} else {
			setStepVelocity(trackId, ci, VELOCITIES[vi + 1]);
		}
	}

	function handleGlobalLengthChange(e: Event) {
		const v = Number((e.currentTarget as HTMLInputElement).value);
		for (const id of trackOrder) {
			setPatternLength(id, v);
		}
		setLoop(0, v);
		ensureActiveTrack();
	}

	function handleGlobalResolutionChange(e: Event) {
		const v = Number((e.currentTarget as HTMLInputElement).value) as 1 | 2 | 4;
		for (const id of trackOrder) {
			setPatternResolution(id, v);
		}
		setLoop(0, activeCells);
		ensureActiveTrack();
	}

	async function handleNew() {
		error = null;
		try {
			if (dirty) {
				await saveProject(undefined, projectName);
			}
			const result = await newProjectSafe();
			if (!result.ok) {
				error = 'Storage full — delete a project to create a new one.';
				await refresh();
				return;
			}
			projectName = 'Untitled';
			ensureActiveTrack();
			markSaved();
			await refresh();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to create project';
		}
	}

	async function handleLoad(id: string) {
		error = null;
		try {
			await loadProject(id);
			projectName = currentProjectName();
			ensureActiveTrack();
			closeSidebar();
			markSaved();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load project';
		}
	}

	async function handleDelete(id: string) {
		error = null;
		try {
			await deleteProject(id);
			if (currentProjectId() === null) {
				projectName = 'Untitled';
			}
			await refresh();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to delete project';
		}
	}

	function formatTime(seconds: number): string {
		const total = Math.max(0, Math.floor(seconds));
		const m = Math.floor(total / 60);
		const s = total % 60;
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	function ensureRecordingUrl(id: string): string | null {
		const existing = audioUrls.get(id);
		if (existing) return existing;
		return null;
	}

	async function toggleRecording() {
		error = null;
		recordError = null;
		try {
			if (!recording) {
				const id = currentProjectId();
				if (id === null) {
					await saveProject(undefined, projectName);
				}
				await startRecording();
				recording = true;
				recordingSeconds = 0;
				recordingUrl = null;
				recordingInterval = setInterval(() => {
					recordingSeconds += 1;
				}, 1000);
			} else {
				await stopRecordingAndSave();
			}
		} catch (e) {
			recordError = e instanceof Error ? e.message : 'Recording failed';
			error = recordError;
			recording = false;
			if (recordingInterval) {
				clearInterval(recordingInterval);
				recordingInterval = null;
			}
		}
	}

	async function stopRecordingAndSave() {
		if (!recordingInterval) return;
		clearInterval(recordingInterval);
		recordingInterval = null;

		try {
			const result = await stopRecording();
			recording = false;

			if (!result) return;

			const id = currentProjectId();
			if (id === null) return;

			await saveProjectAudio(id, result.blob, result.durationSeconds, result.sampleRate, result.channelCount);

			if (recordingUrl) {
				URL.revokeObjectURL(recordingUrl);
			}
			recordingUrl = result.url;
			audioUrls.set(id, result.url);
			await refresh();
		} catch (e) {
			recordError = e instanceof Error ? e.message : 'Failed to save recording';
			error = recordError;
			recording = false;
		}
	}

	// ─── Metronome click synthesis ─────────────────────────────
	let _clickCtx: AudioContext | null = null;

	function ensureClickCtx(): AudioContext {
		if (!_clickCtx) _clickCtx = new AudioContext();
		return _clickCtx;
	}

	function playClick(accent: boolean): void {
		try {
			const ctx = ensureClickCtx();
			if (ctx.state === 'suspended') void ctx.resume();
			const now = ctx.currentTime;
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = accent ? 'sine' : 'square';
			osc.frequency.setValueAtTime(accent ? 880 : 440, now);
			osc.frequency.exponentialRampToValueAtTime(accent ? 440 : 220, now + 0.05);
			gain.gain.setValueAtTime(accent ? 0.18 : 0.09, now);
			gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
			osc.connect(gain);
			gain.connect(ctx.destination);
			osc.start(now);
			osc.stop(now + 0.15);
		} catch {
			// click synth is non-essential
		}
	}

	function flashDownbeat(): void {
		downbeatFlash = true;
		setTimeout(() => {
			downbeatFlash = false;
		}, 120);
	}

	// ─── Level metering ────────────────────────────────────────
	let _meterInterval: ReturnType<typeof setInterval> | null = null;

	function startLevelMetering(): void {
		if (_meterInterval) return;
		_meterInterval = setInterval(() => {
			const levels = getMasterLevels();
			if (!levels) return;
			if (recording) recLevel = levels.peak;
			if ($transportState.playing) playLevel = levels.peak;
			else if (!recording) playLevel = 0;
		}, 40);
	}

	function stopLevelMetering(): void {
		if (_meterInterval) {
			clearInterval(_meterInterval);
			_meterInterval = null;
		}
	}

	// ─── Manual ────────────────────────────────────────────────
	function toggleManual(): void {
		showManual = !showManual;
	}

	async function togglePlayback(id: string) {
		error = null;
		const rec = await getProjectAudio(id);
		if (!rec) {
			error = 'No recording for this project.';
			return;
		}

		if (audioPlayingId === id) {
			const el = audioEls.get(id);
			if (el) el.pause();
			audioPlayingId = null;
			return;
		}

		if (audioPlayingId && audioEls.has(audioPlayingId)) {
			audioEls.get(audioPlayingId)!.pause();
		}

		let url = audioUrls.get(id);
		if (!url) {
			url = createAudioUrl(rec);
			audioUrls.set(id, url);
		}

		const el = new Audio(url);
		el.ontimeupdate = () => {
			audioTimes = { ...audioTimes, [id]: el.currentTime };
		};
		el.onended = () => {
			if (audioPlayingId === id) audioPlayingId = null;
		};
		el.play().catch(() => {
			// user gesture should allow playback
		});
		audioEls.set(id, el);
		audioPlayingId = id;
	}

	function stopPlayback(id: string) {
		error = null;
		const el = audioEls.get(id);
		if (el) {
			el.pause();
			el.currentTime = 0;
			audioTimes = { ...audioTimes, [id]: 0 };
		}
		if (audioPlayingId === id) {
			audioPlayingId = null;
		}
	}

	async function downloadAudio(id: string) {
		error = null;
		const rec = await getProjectAudio(id);
		if (!rec) {
			error = 'No recording to download.';
			return;
		}
		const blob = new Blob([rec.blob], { type: 'audio/wav' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${(currentProjectName() || 'recording')}.wav`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}
</script>

<script module lang="ts">
	const DEFS_ID = 'glass-defs';
	const SELECTOR = '[data-glass]';
	const SCALE = 30;
	const SATURATE = 125;
	const SIZE = 128;
	const MAX_INTENSITY = 0.85;
	const NS = 'http://www.w3.org/2000/svg';
	const PRESET = {
		edgeIntensity: 0.015,
		rimIntensity: 0.028,
		baseIntensity: 0.06,
		edgeDistance: 4,
		rimDistance: 13.6,
		blurRadius: 3
	};
	const applied = new Set<string>();

	type Preset = {
		edgeIntensity: number;
		rimIntensity: number;
		baseIntensity: number;
		edgeDistance: number;
		rimDistance: number;
		blurRadius: number;
	};

	function bakeDisplacement(w: number, h: number, preset: Preset): string {
		const canvas = document.createElement('canvas');
		canvas.width = SIZE;
		canvas.height = SIZE;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('no 2d context');
		const data = new Uint8ClampedArray(SIZE * SIZE * 4);
		const sx = SIZE / w;
		const sy = SIZE / h;
		for (let y = 0; y < SIZE; y++) {
			for (let x = 0; x < SIZE; x++) {
				const d = data.subarray((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 4);
				const xb = Math.round(x / sx);
				const yb = Math.round(y / sy);
				const dx = Math.min(xb, w - 1 - xb);
				const dy = Math.min(yb, h - 1 - yb);
				const dmin = Math.min(dx, dy);
				let i = 0;
				if (dmin <= preset.edgeDistance) i = preset.edgeIntensity;
				else if (dmin <= preset.rimDistance) i = preset.rimIntensity;
				else i = preset.baseIntensity;
				const intensity = i * MAX_INTENSITY;
				d[0] = Math.round(127.5 + intensity * (x - 63.5));
				d[1] = Math.round(127.5 + intensity * (y - 63.5));
				d[2] = 128;
				d[3] = 255;
			}
		}
		ctx.putImageData(new ImageData(data, SIZE, SIZE), 0, 0);
		return canvas.toDataURL('image/png');
	}

	function ensureFilter(w: number, h: number, preset: Preset): string {
		if (typeof document === 'undefined') return '';
		const defs = document.getElementById(DEFS_ID) as SVGDefsElement | null;
		if (!defs) return '';
		const id = `glass-${w}x${h}`;
		if (document.getElementById(id)) return `url(#${id})`;
		const filter = document.createElementNS(NS, 'filter');
		filter.id = id;
		const img = document.createElementNS(NS, 'feImage');
		img.setAttribute('href', bakeDisplacement(w, h, preset));
		img.setAttribute('result', 'disp');
		const map = document.createElementNS(NS, 'feDisplacementMap');
		map.setAttribute('in', 'SourceGraphic');
		map.setAttribute('in2', 'disp');
		map.setAttribute('scale', String(SCALE));
		map.setAttribute('xChannelSelector', 'R');
		map.setAttribute('yChannelSelector', 'G');
		const blur = document.createElementNS(NS, 'feGaussianBlur');
		blur.setAttribute('stdDeviation', String(preset.blurRadius));
		filter.appendChild(img);
		filter.appendChild(map);
		filter.appendChild(blur);
		defs.appendChild(filter);
		return `url(#${id})`;
	}

	function apply(el: Element, preset: Preset) {
		const target = el as HTMLElement;
		const width = target.clientWidth;
		const height = target.clientHeight;
		if (!width || !height) return;
		const key = `${width}x${height}`;
		const url = ensureFilter(width, height, preset);
		if (!url) return;
		const value = `${url} saturate(${SATURATE}%)`;
		target.style.setProperty('backdrop-filter', value);
		target.style.setProperty('-webkit-backdrop-filter', value);
		applied.add(key);
		target.removeAttribute('data-glass');
		target.dataset.glass = key;
	}

	function scan(preset: Preset) {
		if (typeof document === 'undefined') return;
		document.querySelectorAll(SELECTOR).forEach((el) => apply(el, preset));
	}

	function recycle() {
		if (typeof document === 'undefined') return;
		const defs = document.getElementById(DEFS_ID) as SVGDefsElement | null;
		if (!defs) return;
		Array.from(defs.children).forEach((child) => {
			if (!(child instanceof SVGFilterElement)) return;
			const key = child.id.slice('glass-'.length);
			if (child.id.startsWith('glass-') && !applied.has(key)) {
				defs.removeChild(child);
			}
		});
	}

	function boot() {
		if (typeof window === 'undefined' || typeof document === 'undefined') return;
		if (!/Chromium|Chrome|Edg\//.test(navigator.userAgent)) return;
		const body = document.body;
		if (!body) return;
		if (!document.getElementById(DEFS_ID)) {
			const svg = document.createElementNS(NS, 'svg');
			svg.setAttribute('width', '0');
			svg.setAttribute('height', '0');
			svg.setAttribute('style', 'position:absolute;overflow:hidden;pointer-events:none');
			svg.setAttribute('aria-hidden', 'true');
			const defs = document.createElementNS(NS, 'defs');
			defs.id = DEFS_ID;
			svg.appendChild(defs);
			body.appendChild(svg);
		}
		scan(PRESET);
		new ResizeObserver(() => scan(PRESET)).observe(body);
		new MutationObserver(() => scan(PRESET)).observe(body, {
			childList: true,
			subtree: true
		});
		const timer = window.setInterval(() => {
			scan(PRESET);
			recycle();
		}, 600);
		window.addEventListener('beforeunload', () => window.clearInterval(timer), { once: true });
	}

	if (typeof document !== 'undefined') {
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', boot);
		} else {
			boot();
		}
	}
</script>

<svelte:head>
	<title>V's Drum Machine</title>
</svelte:head>

<div class="shell">
	<aside class="project-sidebar" data-glass="" class:open={sidebarOpen} aria-label="Projects">
		<div class="sidebar-head">
			<h2>Projects</h2>
			<span class="count">{projects.length} / 16</span>
			<button class="sidebar-close" aria-label="Close projects" onclick={closeSidebar}>×</button>
		</div>
		<button class="btn btn-primary sidebar-new" onclick={handleNew} disabled={!$engineReady}>
			New Project
		</button>
		{#if sortedProjects.length === 0}
			<p class="empty">No saved projects yet.</p>
		{:else}
			<div class="proj-cards">
				{#each sortedProjects as entry (entry.id)}
					{@const len = entry.project.patternLength || 16}
					{@const tracks = Object.values(entry.project.tracks).slice(0, 4)}
					<div class="proj-card" class:active={currentProjectId() === entry.id}>
						<button class="proj-card-main" type="button" onclick={() => handleLoad(entry.id)}>
							<span class="proj-card-name">{entry.project.name || 'Untitled'}</span>
							<span class="proj-card-date">
								{new Date(entry.project.updatedAt).toLocaleDateString()}
							</span>
							<span class="mini-grid" style={`--cols:${len}`}>
								{#each tracks as track (track.sampleId)}
									<span class="mini-row">
										{#each Array(len) as _, i}
											{@const step =
												track.pattern.steps[Math.floor(i / (4 / track.pattern.resolution))]}
											<span
												class="mini-cell"
												class:lit={step && step.velocity > 0}
												style={step && step.velocity > 0 ? `--tint:${track.color}` : ''}
											></span>
										{/each}
									</span>
								{/each}
							</span>
						</button>
						<button
							class="proj-card-del"
							type="button"
							aria-label={`Delete ${entry.project.name || 'Untitled'}`}
							onclick={() => handleDelete(entry.id)}
						>
							×
						</button>
					</div>
				{/each}
			</div>
		{/if}
	</aside>

	{#if sidebarOpen}
		<button class="sidebar-backdrop" aria-label="Close projects" onclick={closeSidebar}></button>
	{/if}

	<main class="app">
		<div class="ambient" aria-hidden="true"></div>

		<header class="top-bar" data-glass="">
			<div class="brand">
				<button
					class="sidebar-toggle"
					aria-expanded={sidebarOpen}
					aria-label="Toggle projects"
					onclick={toggleSidebar}
				>
					☰
				</button>
				<img src="/emblem.png" class="brand-logo" alt="V's Drum Machine" />
				<h1>V's Drum Machine</h1>
			</div>

			<div class="project-controls" class:disabled={!$engineReady}>
				<button class="btn manual-btn" onclick={toggleManual} aria-label="Open manual">📖</button>
				<input
					type="text"
					class="project-name"
					bind:value={projectName}
					disabled={!$engineReady}
					placeholder="Project name…"
				/>
				<button class="btn" onclick={handleNew} disabled={!$engineReady}>New</button>
			</div>
		</header>

	{#if error}
		<div class="error-banner">{error}</div>
	{/if}

	<div class="rec-banner" class:visible={recording}>
		<span class="record-dot" style="width:10px;height:10px;border-radius:50%;background:#fff;box-shadow:0 0 8px #fff;"></span>
		RECORDING — {formatTime(recordingSeconds)}
	</div>

	{#if preBoot}
		<section class="boot-overlay">
			<div class="boot-card" data-glass="" style="text-align:center;">
				<div class="opening-logo" style="margin:0 auto 1rem;">
					<img src="/emblem.png" alt="V's Drum Machine" />
				</div>
				<h1 class="opening-title">V's Drum Machine</h1>
				<p class="boot-hint" style="color:var(--glass-muted);">Loading…</p>
			</div>
		</section>
	{:else if !$engineReady && showBoot}
		<section class="boot-overlay">
			<div class="boot-card" data-glass="">
				<h2>Welcome to V's Drum Machine</h2>
				<p class="boot-hint">
					Your browser requires a sound engine to load. Press the button below to start the machine.
				</p>
				{#if starting}
					<p class="boot-status">Loading samples…</p>
				{:else if bootFailed}
					<p class="boot-error">{`${$engineError ?? 'Unknown error'}`}</p>
					<button class="btn btn-primary" onclick={startMachine}>Retry</button>
				{:else}
					<button class="btn btn-primary" onclick={startMachine}>Start the Machine</button>
				{/if}
			</div>
		</section>
	{:else}
		<section class="transport-bar" data-glass="">
			<div class="downbeat-flash" class:active={downbeatFlash}></div>
			<div class="transport-controls">
				<button class="btn btn-play" onclick={togglePlay} disabled={!$engineReady}>
					{$transportState.playing ? 'Pause' : 'Play'}
				</button>
				<button
					class="btn btn-metro"
					class:active={metronomeEnabled}
					onclick={() => { metronomeEnabled = !metronomeEnabled; }}
					disabled={!$engineReady}
					aria-label="Metronome"
					title="Metronome"
				>
					🎵
				</button>
				<button
					class="btn-record"
					class:recording={recording}
					onclick={toggleRecording}
					disabled={!$engineReady}
					aria-label={recording ? 'Stop recording' : 'Record'}
					title={recording ? `Recording… ${formatTime(recordingSeconds)}` : 'Record'}
				>
					<span class="record-dot"></span>
					<span class="record-label">{recording ? formatTime(recordingSeconds) : 'Record'}</span>
				</button>
				<button class="btn" onclick={stop} disabled={!$engineReady}>Stop</button>
			</div>

			<div class="transport-meters">
			<div class="meter">
				<span class="meter-label">REC</span>
				<div class="meter-fill" style="--v: {recLevel}" class:active={recording}></div>
				<span class="meter-val" class:active={recording}>{Math.round(recLevel * 100)}%</span>
			</div>
			<div class="meter">
				<span class="meter-label">PLAY</span>
				<div class="meter-fill" style="--v: {playLevel}" class:active={$transportState.playing}></div>
				<span class="meter-val" class:active={$transportState.playing}>{Math.round(playLevel * 100)}%</span>
			</div>
			</div>

			<div class="transport-tempo">
				<label>
					BPM
					<input
						type="number"
						class="num-input"
						value={$transportState.bpm}
						min={BPM_MIN}
						max={BPM_MAX}
						onchange={handleBpmInput}
						disabled={!$engineReady}
					/>
				</label>
				<span class="readout">
					Bar {$cursorState.currentBar + 1} · Beat {$cursorState.currentBeat + 1} · Step {$cursorState.currentStep + 1}
				</span>
			</div>

			<div class="transport-swing">
				<label class="checkbox">
					<input
						type="checkbox"
						checked={$transportState.swingEnabled}
						onchange={(e) => setSwingEnabled((e.currentTarget as HTMLInputElement).checked)}
						disabled={!$engineReady}
					/>
					Swing
				</label>
				<input
					type="range"
					value={$transportState.swing}
					min={SWING_MIN}
					max={SWING_MAX}
					step="0.01"
					oninput={handleSwingInput}
					disabled={!$engineReady || !$transportState.swingEnabled}
				/>
				<span class="value">{Math.round($transportState.swing * 100)}%</span>
			</div>
		</section>

		<section class="pads">
			{#each trackOrder as trackId, i (trackId)}
				<button
					class="pad"
					class:active={pressed[trackId]}
					style="--c: {$tracksStore[trackId].color}"
					onpointerdown={() => handlePadPress(trackId)}
					onpointerup={() => handlePadRelease(trackId)}
					onpointerleave={() => handlePadRelease(trackId)}
					oncontextmenu={(e) => e.preventDefault()}
					disabled={!$engineReady}
				>
					<span class="pad-key">{KEY_MAP[i]}</span>
					<span class="pad-label">{$tracksStore[trackId].name}</span>
				</button>
			{/each}
		</section>

		<section class="sequencer" data-glass="">
			<div class="track-selector">
				{#each trackOrder as trackId (trackId)}
					<button
						class="track-chip"
						class:selected={activeTrackId === trackId}
						class:muted={$tracksStore[trackId].muted}
						class:solo={$tracksStore[trackId].solo}
						style="--c: {$tracksStore[trackId].color}"
						onclick={() => (activeTrackId = trackId)}
						disabled={!$engineReady}
					>
						{$tracksStore[trackId].name}
					</button>
				{/each}
			</div>

			<div class="pattern-toolbar">
				<label>
					Length
					<select
						value={activeCells}
						onchange={handleGlobalLengthChange}
						disabled={!$engineReady}
					>
						{#each PATTERN_SIZES as size (size)}
							<option value={size}>{size}</option>
						{/each}
					</select>
				</label>
				<label>
					Resolution
					<select
						value={firstTrack?.pattern.resolution ?? 4}
						onchange={handleGlobalResolutionChange}
						disabled={!$engineReady}
					>
						{#each RESOLUTIONS as res (res)}
							<option value={res}>
								{res === 1 ? 'Quarter' : res === 2 ? 'Eighth' : 'Sixteenth'}
							</option>
						{/each}
					</select>
				</label>
				<span class="toolbar-hint">Click row label: select track · Left-click cell: on/off · Right-click: velocity</span>
			</div>

			{#if trackOrder.length > 0}
				<div class="matrix" style="--cols: {activeCells}" class:dense={activeCells === 64}>
					{#each trackOrder as trackId (trackId)}
						{@const track = $tracksStore[trackId]}
						<div
							class="matrix-row"
							class:active-row={activeTrackId === trackId}
							style="--g: {track.color}"
							role="row"
						>
							<button
								class="row-label"
								class:selected={activeTrackId === trackId}
								onclick={() => { activeTrackId = trackId; }}
								disabled={!$engineReady}
							>
								{track.name}
							</button>
							{#each Array.from({ length: activeCells }) as _, ci}
								{@const factor = 4 / track.pattern.resolution}
								{@const step = track.pattern.steps[Math.floor(ci / factor)] ?? null}
								<button
									class="cell"
									class:on={step !== null}
									class:play={ci === playhead}
									class:beat={ci % 4 === 0}
									style="--v: {step?.velocity ?? 0}"
									aria-label={`${track.name} step ${Math.floor(ci / factor) + 1} of ${track.pattern.steps.length}`}
									onclick={() => handleRowCellClick(trackId, ci)}
									oncontextmenu={(e) => {
										e.preventDefault();
										handleRowCellContext(trackId, ci);
									}}
									disabled={!$engineReady}
								></button>
							{/each}
						</div>
					{/each}
				</div>
			{:else}
				<p class="empty">Load or create a project to start programming beats.</p>
			{/if}
		</section>

		<section class="controls">
			{#if activeTrack}
				<div class="panel mixer" data-glass="" style="--c: {activeTrack?.color}">
					<h2>Mixer — {activeTrack.name}</h2>
					<div class="knob-row">
						<label>
							Volume
							<span class="value">{(activeTrack.volume * 100).toFixed(0)}%</span>
							<input
								type="range"
								min="0"
								max="1"
								step="0.01"
								value={activeTrack.volume}
								oninput={(e) =>
									activeTrackId &&
									setTrackVolume(
										activeTrackId,
										Number((e.currentTarget as HTMLInputElement).value)
									)}
								disabled={!$engineReady}
							/>
						</label>
						<label>
							Pan
							<span class="value">{((activeTrack.pan + 1) / 2 * 100).toFixed(0)}</span>
							<input
								type="range"
								min="-1"
								max="1"
								step="0.01"
								value={activeTrack.pan}
								oninput={(e) =>
									activeTrackId &&
									setTrackPan(
										activeTrackId,
										Number((e.currentTarget as HTMLInputElement).value)
									)}
								disabled={!$engineReady}
							/>
						</label>
						<label>
							Delay
							<span class="value">{(activeTrack.send.delay * 100).toFixed(0)}%</span>
							<input
								type="range"
								min="0"
								max="1"
								step="0.01"
								value={activeTrack.send.delay}
								oninput={(e) =>
									activeTrackId &&
									setTrackDelaySend(
										activeTrackId,
										Number((e.currentTarget as HTMLInputElement).value)
									)}
								disabled={!$engineReady}
							/>
						</label>
						<label>
							Reverb
							<span class="value">{(activeTrack.send.reverb * 100).toFixed(0)}%</span>
							<input
								type="range"
								min="0"
								max="1"
								step="0.01"
value={activeTrack.send.reverb}
							oninput={(e) =>
								activeTrackId &&
								setTrackReverbSend(
									activeTrackId,
									Number((e.currentTarget as HTMLInputElement).value)
								)}
							disabled={!$engineReady}
						/>
					</label>
					<label>
						Drive
						<span class="value">{(activeTrack.send.drive * 100).toFixed(0)}%</span>
						<input
							type="range"
							min="0"
							max="1"
							step="0.01"
							value={activeTrack.send.drive}
							oninput={(e) =>
								activeTrackId &&
								setTrackDrive(
									activeTrackId,
									Number((e.currentTarget as HTMLInputElement).value)
								)}
							disabled={!$engineReady}
						/>
					</label>
				</div>
					<div class="toggle-row">
						<label class="checkbox">
							<input
								type="checkbox"
								checked={activeTrack.muted}
								onchange={(e) => {
									if (!activeTrackId) return;
									setTrackMuted(activeTrackId, (e.currentTarget as HTMLInputElement).checked);
								}}
								disabled={!$engineReady}
							/>
							Mute
						</label>
						<label class="checkbox">
							<input
								type="checkbox"
								checked={activeTrack.solo}
								onchange={(e) => {
									if (!activeTrackId) return;
									setTrackSoloed(activeTrackId, (e.currentTarget as HTMLInputElement).checked);
								}}
								disabled={!$engineReady}
							/>
							Solo
						</label>
					</div>
				</div>
			{/if}

			<div class="panel master" data-glass="">
				<h2>Master</h2>
				<div class="knob-row">
					<label>
						Volume
						<span class="value">{($masterStore.volume * 100).toFixed(0)}%</span>
						<input
							type="range"
							min="0"
							max="1"
							step="0.01"
							value={$masterStore.volume}
							oninput={(e) =>
								updateMaster({ volume: Number((e.currentTarget as HTMLInputElement).value) })}
							disabled={!$engineReady}
						/>
					</label>
					<label>
						Filter
						<span class="value">{Math.round($masterStore.filterCutoff)}Hz</span>
						<input
							type="range"
							min="16"
							max="20000"
							step="1"
							value={$masterStore.filterCutoff}
							oninput={(e) =>
								updateMaster({ filterCutoff: Number((e.currentTarget as HTMLInputElement).value) })}
							disabled={!$engineReady}
						/>
					</label>
					<label>
						Resonance
						<span class="value">{$masterStore.filterResonance.toFixed(2)}</span>
						<input
							type="range"
							min="0"
							max="1"
							step="0.01"
							value={$masterStore.filterResonance}
							oninput={(e) =>
								updateMaster({
									filterResonance: Number((e.currentTarget as HTMLInputElement).value)
								})}
							disabled={!$engineReady}
						/>
					</label>
					<label>
						Delay Time
						<span class="value">{$masterStore.delayTime.toFixed(2)}s</span>
						<input
							type="range"
							min="0.05"
							max="0.8"
							step="0.01"
							value={$masterStore.delayTime}
							oninput={(e) =>
								updateMaster({ delayTime: Number((e.currentTarget as HTMLInputElement).value) })}
							disabled={!$engineReady}
						/>
					</label>
					<label>
						Delay Fbk
						<span class="value">{$masterStore.delayFeedback.toFixed(2)}</span>
						<input
							type="range"
							min="0"
							max="0.95"
							step="0.01"
							value={$masterStore.delayFeedback}
							oninput={(e) =>
								updateMaster({ delayFeedback: Number((e.currentTarget as HTMLInputElement).value) })}
							disabled={!$engineReady}
						/>
					</label>
					<label>
						Delay Mix
						<span class="value">{($masterStore.delayMix * 100).toFixed(0)}%</span>
						<input
							type="range"
							min="0"
							max="1"
							step="0.01"
							value={$masterStore.delayMix}
							oninput={(e) =>
								updateMaster({ delayMix: Number((e.currentTarget as HTMLInputElement).value) })}
							disabled={!$engineReady}
						/>
					</label>
					<label>
						Reverb
						<span class="value">{($masterStore.reverbMix * 100).toFixed(0)}%</span>
						<input
							type="range"
							min="0"
							max="1"
							step="0.01"
							value={$masterStore.reverbMix}
							oninput={(e) =>
								updateMaster({ reverbMix: Number((e.currentTarget as HTMLInputElement).value) })}
							disabled={!$engineReady}
						/>
					</label>
					<label>
						Drive
						<span class="value">{($masterStore.drive * 100).toFixed(0)}%</span>
						<input
							type="range"
							min="0"
							max="1"
							step="0.01"
							value={$masterStore.drive}
							oninput={(e) =>
								updateMaster({ drive: Number((e.currentTarget as HTMLInputElement).value) })}
							disabled={!$engineReady}
						/>
					</label>
				</div>
				<div class="toggle-row">
					<button class="btn btn-sm" onclick={resetMaster} disabled={!$engineReady}>Reset</button>
				</div>
			</div>
		</section>

		<section class="project-list">
			<h2>Saved Projects</h2>
			{#if projects.length === 0}
				<p class="empty">No saved projects yet.</p>
			{:else}
				<ul>
					{#each projects as entry (entry.id)}
						{#await getProjectAudio(entry.id) then rec}
							{#if rec}
								<li class:active={currentProjectId() === entry.id} data-glass="">
									<span class="proj-name">{entry.project.name}</span>
									<span class="proj-date">{new Date(entry.project.updatedAt).toLocaleString()}</span>
									<div class="project-audio">
										<button
											class="btn btn-sm"
											class:active={audioPlayingId === entry.id}
											onclick={() => togglePlayback(entry.id)}
											title="Play recording"
										>
											{audioPlayingId === entry.id ? '⏸' : '▶'}
										</button>
										{#if audioPlayingId === entry.id}
											<button
												class="btn btn-sm"
												onclick={() => stopPlayback(entry.id)}
												title="Stop recording"
											>
												⏹
											</button>
										{/if}
										<input
											type="range"
											class="audio-bar"
											min="0"
											max={rec.durationSeconds}
											value={audioTimes[entry.id] ?? 0}
											step="0.1"
											oninput={(e) => {
												const el = audioEls.get(entry.id);
												if (el) el.currentTime = Number((e.currentTarget as HTMLInputElement).value);
											}}
										/>
										<span class="audio-time">
											{formatTime(audioTimes[entry.id] ?? 0)} / {formatTime(rec.durationSeconds)}
										</span>
										<button
											class="btn btn-sm"
											onclick={() => downloadAudio(entry.id)}
											title="Download WAV"
										>
											⬇
										</button>
									</div>
									<div class="proj-actions">
										<button class="btn btn-sm" onclick={() => handleLoad(entry.id)}>Load</button>
										<button class="btn btn-sm btn-danger" onclick={() => handleDelete(entry.id)}>
											Delete
										</button>
									</div>
								</li>
							{/if}
						{/await}
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</main>

{#if opening}
	<section class="opening-overlay" data-glass="">
		<div class="opening-content">
			<div class="opening-logo">
				<img src="/emblem.png" alt="V's Drum Machine" />
				<div class="opening-glow"></div>
			</div>
			<h1 class="opening-title">V's Drum Machine</h1>
			<p class="opening-sub">Dark DAW · Neon Mix · Professional Beat Studio</p>
			<div class="opening-progress">
				<div class="opening-bar" style="--p: {openingProgress}"></div>
			</div>
		</div>
		<div class="opening-flash"></div>
		<div class="opening-lightning"></div>
	</section>
{/if}

{#if showManual}
	<section class="manual-overlay" data-glass="">
		<button class="manual-close" onclick={toggleManual} aria-label="Close manual">✕</button>
		<div class="manual">
				<div class="manual-header">
					<img src="/emblem.png" class="manual-logo" alt="Logo" />
					<h1>V's Drum Machine — Manual</h1>
					<p class="manual-tag">Dark DAW · Logic-inspired · Neon Mix</p>
				</div>
				<div class="manual-section">
					<h2>1. Getting Started</h2>
					<ul>
						<li><strong>Start the Machine</strong> — click the boot button (or <kbd>Enter</kbd>) to initialize the audio engine. Browsers require a user gesture before audio can play.</li>
						<li><strong>Name &amp; save</strong> — give your project a name and hit <strong>Save</strong>. Projects are stored locally in IndexedDB (up to 16).</li>
						<li><strong>Play pads</strong> — tap the colored pads (keys <kbd>1</kbd>–<kbd>8</kbd>) to trigger samples. Hold a pad to retrigger.</li>
					</ul>
				</div>
				<div class="manual-section">
					<h2>2. Transport</h2>
					<ul>
						<li><strong>Play / Pause</strong> — start or stop the sequencer (<kbd>Space</kbd>).</li>
						<li><strong>Stop</strong> — halt playback and reset the playhead.</li>
						<li><strong>Record</strong> — arm and capture your performance to a WAV file. A red REC banner shows while armed.</li>
						<li><strong>BPM</strong> — set tempo. Use <strong>Tap Tempo</strong> to set BPM by clicking in rhythm.</li>
						<li><strong>Swing</strong> — add groove to off-beat steps.</li>
					</ul>
				</div>
				<div class="manual-section">
					<h2>3. Matrix Sequencer</h2>
					<ul>
						<li><strong>Left-click a cell</strong> — toggle a step on/off.</li>
						<li><strong>Right-click a cell</strong> — cycle velocity (quiet → medium → loud → off).</li>
						<li><strong>Row label</strong> — click to select that track for editing.</li>
						<li><strong>Track chips</strong> — select, mute, or solo individual tracks.</li>
						<li><strong>Length / Resolution</strong> — set pattern length and step grid (quarter / eighth / sixteenth).</li>
					</ul>
				</div>
				<div class="manual-section">
					<h2>4. Mixer &amp; Master</h2>
					<ul>
						<li><strong>Volume / Pan / Delay / Reverb / Drive</strong> — adjust per-track sends with faders.</li>
						<li><strong>Mute / Solo</strong> — toggle track mute or solo (solo isolates one track).</li>
						<li><strong>Master</strong> — global volume, filter cutoff/resonance, delay time/feedback/mix, reverb, drive.</li>
						<li><strong>VU meters</strong> — input level while recording, playback level while playing.</li>
					</ul>
				</div>
				<div class="manual-section">
					<h2>5. Recording</h2>
					<ul>
						<li>Click <strong>● Record</strong> to arm; the button pulses red and the input meter moves.</li>
						<li>Play your beat — the performance is captured to WAV.</li>
						<li>Click <strong>● Record</strong> again to stop. The recording appears under Saved Projects with play/download.</li>
						<li>Recordings are saved per-project and persist across reloads.</li>
					</ul>
				</div>
				<div class="manual-section">
					<h2>6. Metronome</h2>
					<ul>
						<li>Enable <strong>Metronome</strong> to hear a click on each beat (accented on the downbeat).</li>
						<li>A visual flash marks the downbeat.</li>
						<li>Works only while the sequencer is playing.</li>
					</ul>
				</div>
				<div class="manual-section">
					<h2>7. Keyboard Shortcuts</h2>
					<ul>
						<li><kbd>Space</kbd> — Play / Pause</li>
						<li><kbd>1</kbd>–<kbd>8</kbd> — Trigger pads</li>
						<li><kbd>Esc</kbd> — Close sidebar / manual</li>
						<li><kbd>Enter</kbd> — Start the machine (from boot)</li>
					</ul>
				</div>
				<div class="manual-footer">
					<p>Built with the Web Audio API · Recordings stored in IndexedDB · Export WAV anytime</p>
				</div>
			</div>
		</section>
	{/if}
</div>

<style>
	:global(:root) {
		color-scheme: dark;
		--bg: #0b0d12;
		--panel: rgba(20, 23, 31, 0.72);
		--panel-border: rgba(255, 255, 255, 0.10);
		--panel-rim: rgba(0, 229, 255, 0.18);
		--glass-bg: rgba(16, 19, 27, 0.82);
		--glass-border: rgba(255, 255, 255, 0.07);
		--glass-rim: rgba(0, 229, 255, 0.12);
		--glass-text: #eef3fb;
		--glass-muted: #7f8c9e;
		--glass-faint: #b8c2d4;
		--accent: #00e5ff;
		--accent-2: #7b2cbf;
		--accent-3: #ff2e88;
		--neon-accent: #00e5ff;
		--neon-purple: #a855f7;
		--neon-pink: #ff2e88;
		--rec: #ff2e88;
		--radius: 16px;
		--mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
		--font-heading: 'Orbitron', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif;
		--font-body: 'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
	}

	.shell {
		display: flex;
		min-height: 100vh;
	}

	.app {
		flex: 1;
		min-width: 0;
		padding: 1.5rem 2rem 3rem;
		font-family: var(--font-body);
		color: var(--glass-text);
		min-height: 100vh;
		position: relative;
	}

	.app::before {
		content: '';
		position: fixed;
		inset: 0;
		z-index: -2;
		pointer-events: none;
		background:
			radial-gradient(1400px 900px at 15% -10%, rgba(0, 150, 255, 0.55) 0%, transparent 60%),
			radial-gradient(1200px 800px at 85% -10%, rgba(255, 120, 40, 0.55) 0%, transparent 60%),
			#000000;
	}

	.ambient {
		position: fixed;
		inset: 0;
		z-index: -1;
		pointer-events: none;
		overflow: hidden;
	}

	.ambient::before {
		content: '';
		position: absolute;
		width: 60vmax;
		height: 60vmax;
		left: -15vmax;
		top: -20vmax;
		background: radial-gradient(circle, rgba(0, 150, 255, 0.55) 0%, transparent 55%);
		animation: ambient-drift 18s ease-in-out infinite alternate;
	}

	.ambient::after {
		content: '';
		position: absolute;
		inset: 0;
		background-image:
			radial-gradient(circle at 20% 20%, rgba(0, 150, 255, 0.5) 0%, transparent 45%),
			radial-gradient(circle at 80% 80%, rgba(255, 120, 40, 0.5) 0%, transparent 45%),
			linear-gradient(rgba(255, 255, 255, 0.028) 1px, transparent 1px),
			linear-gradient(90deg, rgba(255, 255, 255, 0.028) 1px, transparent 1px);
		background-size:
			60vmax 60vmax,
			60vmax 60vmax,
			44px 44px,
			44px 44px;
		mask-image: radial-gradient(140% 120% at 50% 0%, rgba(0, 0, 0, 0.9), transparent 72%);
		-webkit-mask-image: radial-gradient(140% 120% at 50% 0%, rgba(0, 0, 0, 0.9), transparent 72%);
		animation: lighting-sweep 18s ease-in-out infinite alternate;
	}

	@keyframes ambient-drift {
		from {
			transform: translate3d(0, 0, 0) scale(1);
		}
		to {
			transform: translate3d(8vmax, 6vmax, 0) scale(1.15);
		}
	}

	@keyframes lighting-sweep {
		0% {
			background-position: 20% 20%, 80% 80%;
			opacity: 0.6;
		}
		50% {
			opacity: 0.95;
		}
		100% {
			background-position: 80% 20%, 20% 80%;
			opacity: 0.6;
		}
	}

	.top-bar,
	.boot-card,
	.transport-bar,
	.sequencer,
	.panel,
	.project-list li {
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius);
		box-shadow:
			0 20px 50px rgba(0, 0, 0, 0.35),
			inset 0 1px 0 var(--glass-rim);
		backdrop-filter: blur(20px) saturate(140%);
		-webkit-backdrop-filter: blur(20px) saturate(140%);
	}

	[data-glass] {
		backdrop-filter: blur(3px) saturate(125%);
		-webkit-backdrop-filter: blur(3px) saturate(125%);
	}

	.top-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.5rem;
		margin-bottom: 1rem;
		padding: 0.9rem 1.1rem;
	}

	h1 {
		font-size: 1.25rem;
		font-weight: 700;
		margin: 0;
		color: #fff;
		white-space: nowrap;
		letter-spacing: -0.02em;
		font-family: var(--font-heading);
		text-transform: uppercase;
	}

	.project-controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.project-controls.disabled {
		opacity: 0.4;
		pointer-events: none;
	}

	.project-name {
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid var(--glass-border);
		border-radius: 8px;
		padding: 0.4rem 0.6rem;
		color: var(--glass-text);
		font-size: 0.875rem;
		width: 220px;
		outline: none;
	}

	.project-name:focus {
		border-color: rgba(0, 229, 255, 0.6);
		box-shadow: 0 0 0 2px rgba(0, 229, 255, 0.15);
	}

	.btn {
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid var(--glass-border);
		border-radius: 10px;
		padding: 0.4rem 0.75rem;
		color: var(--glass-text);
		font-size: 0.8rem;
		cursor: pointer;
		white-space: nowrap;
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		transition: background 0.15s, border-color 0.15s, transform 0.06s, box-shadow 0.15s;
	}

	.btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.12);
		border-color: var(--glass-rim);
	}

	.btn:active:not(:disabled) {
		transform: scale(0.97);
	}

	.btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.btn-primary {
		background: linear-gradient(135deg, var(--accent), var(--accent-2));
		border: none;
		color: #04121a;
		font-size: 1rem;
		font-weight: 600;
		padding: 0.6rem 1.25rem;
		box-shadow: 0 8px 24px rgba(0, 229, 255, 0.25);
	}

	.btn-primary:hover:not(:disabled) {
		background: linear-gradient(135deg, var(--accent), var(--accent-2));
		filter: brightness(1.15);
		box-shadow: 0 8px 32px rgba(0, 229, 255, 0.4);
	}

	.btn-play {
		min-width: 84px;
		font-weight: 700;
		letter-spacing: 0.02em;
	}

	.btn-record {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 90px;
		padding: 0.5rem 0.85rem;
		background: rgba(255, 46, 136, 0.12);
		border: 1px solid rgba(255, 46, 136, 0.45);
		border-radius: 10px;
		color: #ff85b1;
		font-weight: 700;
		font-size: 0.85rem;
		letter-spacing: 0.02em;
		cursor: pointer;
		transition: background 0.2s, border-color 0.2s, color 0.2s, box-shadow 0.2s;
	}

	.btn-record:hover:not(:disabled) {
		background: rgba(255, 46, 136, 0.22);
		border-color: rgba(255, 46, 136, 0.65);
		color: #ffa3c6;
	}

	.btn-record.recording {
		background: rgba(255, 46, 136, 0.3);
		border-color: rgba(255, 46, 136, 0.9);
		color: #fff;
		animation: rec-pulse 1.1s ease-in-out infinite;
		box-shadow: 0 0 0 0 rgba(255, 46, 136, 0.5);
	}

	.record-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: currentColor;
		box-shadow: 0 0 6px currentColor;
	}

	.btn-record.recording .record-dot {
		animation: rec-dot-blink 1.2s ease-in-out infinite;
	}

	.record-label {
		white-space: nowrap;
	}

	@keyframes rec-pulse {
		0% {
			box-shadow: 0 0 0 0 rgba(255, 46, 136, 0.6);
		}
		70% {
			box-shadow: 0 0 0 14px rgba(255, 46, 136, 0);
		}
		100% {
			box-shadow: 0 0 0 0 rgba(255, 46, 136, 0);
		}
	}

	@keyframes rec-dot-blink {
		0%, 100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}

	.btn-sm {
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
	}

	.btn-danger {
		border-color: rgba(255, 46, 136, 0.4);
		color: #ff85b1;
	}

	.btn-danger:hover:not(:disabled) {
		background: rgba(255, 46, 136, 0.12);
		border-color: rgba(255, 46, 136, 0.6);
	}

	.error-banner {
		background: rgba(255, 46, 136, 0.1);
		border: 1px solid rgba(255, 46, 136, 0.5);
		border-radius: 10px;
		padding: 0.6rem 1rem;
		color: #ffa3c6;
		font-size: 0.8rem;
		margin-bottom: 1rem;
	}

	.boot-overlay {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background:
			radial-gradient(circle at 20% 20%, rgba(0, 150, 255, 0.25) 0%, transparent 50%),
			radial-gradient(circle at 80% 80%, rgba(255, 120, 40, 0.25) 0%, transparent 50%),
			#000000;
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		z-index: 100;
	}

	.boot-card {
		padding: 2.5rem;
		max-width: 460px;
		text-align: center;
		background: rgba(6, 6, 6, 0.85);
		border: 1px solid rgba(0, 150, 255, 0.18);
		box-shadow:
			0 0 45px rgba(0, 150, 255, 0.18),
			0 0 45px rgba(255, 120, 40, 0.12),
			inset 0 1px 0 rgba(255, 120, 40, 0.12);
	}

	.boot-card h2 {
		margin: 0 0 0.75rem;
		color: #fff;
		font-family: var(--font-heading);
		text-transform: uppercase;
		text-shadow: 0 0 18px var(--neon-accent);
	}

	.boot-hint {
		color: var(--glass-muted);
		font-size: 0.9rem;
		margin: 0 0 1.5rem;
		line-height: 1.5;
	}

	.boot-status {
		color: var(--glass-faint);
		font-size: 0.85rem;
		margin: 0;
	}

	.boot-error {
		color: #ffb482;
		font-size: 0.85rem;
		margin: 0 0 1rem;
		word-break: break-word;
		text-shadow: 0 0 10px rgba(255, 120, 40, 0.4);
	}

	.transport-bar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 1.5rem;
		padding: 0.75rem 1rem;
		margin-bottom: 1rem;
	}

	.transport-controls {
		display: flex;
		gap: 0.5rem;
	}

	.transport-tempo {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.transport-tempo label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8rem;
		color: var(--glass-muted);
	}

	.num-input {
		width: 64px;
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid var(--glass-border);
		border-radius: 8px;
		padding: 0.25rem 0.4rem;
		color: var(--glass-text);
		font-size: 0.875rem;
		outline: none;
	}

	.num-input:focus {
		border-color: rgba(0, 229, 255, 0.6);
		box-shadow: 0 0 0 2px rgba(0, 229, 255, 0.15);
	}

	.readout {
		font-variant-numeric: tabular-nums;
		font-size: 0.8rem;
		color: var(--glass-muted);
		font-family: var(--mono);
	}

	.transport-swing {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-left: auto;
	}

	.checkbox {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8rem;
		color: var(--glass-faint);
		cursor: pointer;
	}

	.checkbox input {
		accent-color: var(--accent);
	}

	.value {
		font-variant-numeric: tabular-nums;
		font-size: 0.75rem;
		color: var(--glass-muted);
		min-width: 34px;
		text-align: right;
		font-family: var(--mono);
	}

	.pads {
		display: grid;
		grid-template-columns: repeat(8, 1fr);
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.pad {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		aspect-ratio: 1.6;
		background: linear-gradient(180deg, color-mix(in srgb, var(--c) 16%, rgba(20, 24, 34, 0.7)), rgba(20, 24, 34, 0.7));
		border: 1px solid color-mix(in srgb, var(--c) 38%, transparent);
		border-radius: 10px;
		color: var(--glass-text);
		cursor: pointer;
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
		transition: transform 0.06s, box-shadow 0.06s, background 0.06s, border-color 0.06s;
	}

	.pad:hover:not(:disabled) {
		border-color: color-mix(in srgb, var(--c) 75%, white);
		box-shadow: 0 0 22px color-mix(in srgb, var(--c) 70%, white);
	}

	.pad.active {
		background: color-mix(in srgb, var(--c) 34%, rgba(11, 13, 19, 0.9));
		border-color: var(--c);
		transform: scale(0.96);
		box-shadow:
			0 0 28px color-mix(in srgb, var(--c) 85%, white),
			inset 0 0 16px color-mix(in srgb, var(--c) 50%, white);
	}

	.pad:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.pad-key {
		font-family: var(--mono);
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--c);
		text-transform: uppercase;
	}

	.pad-label {
		font-size: 0.7rem;
		color: var(--glass-faint);
		text-align: center;
		line-height: 1.1;
	}

	.sequencer {
		padding: 0.9rem;
		margin-bottom: 1rem;
	}

	.track-selector {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-bottom: 0.75rem;
	}

	.track-chip {
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid var(--glass-border);
		border-left: 3px solid var(--c);
		border-radius: 8px;
		padding: 0.3rem 0.6rem;
		color: var(--glass-faint);
		font-size: 0.75rem;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
	}

	.track-chip.selected {
		background: color-mix(in srgb, var(--c) 16%, rgba(255, 255, 255, 0.06));
		border-color: var(--c);
		color: #fff;
	}

	.track-chip.muted {
		opacity: 0.5;
	}

	.track-chip.solo {
		box-shadow: 0 0 10px color-mix(in srgb, var(--c) 65%, transparent);
		border-color: color-mix(in srgb, var(--c) 60%, transparent);
	}

	.track-chip:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.pattern-toolbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 1rem;
		margin-bottom: 0.75rem;
	}

	.pattern-toolbar label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8rem;
		color: var(--glass-muted);
	}

	.pattern-toolbar select {
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid var(--glass-border);
		border-radius: 8px;
		padding: 0.25rem 0.4rem;
		color: var(--glass-text);
		font-size: 0.8rem;
		outline: none;
		accent-color: var(--accent);
	}

	.toolbar-hint {
		margin-left: auto;
		font-size: 0.7rem;
		color: var(--glass-muted);
		font-family: var(--mono);
	}

	.matrix {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.panel {
		flex: 1 1 420px;
		padding: 0.9rem;
	}

	.panel.mixer {
		box-shadow:
			0 0 45px color-mix(in srgb, var(--c) 80%, white),
			inset 0 1px 0 rgba(255, 255, 255, 0.12);
		transition: box-shadow 0.2s ease, background-color 0.2s ease;
	}

	.panel.master {
		box-shadow:
			0 0 55px rgba(0, 150, 255, 0.45),
			0 0 55px rgba(255, 120, 40, 0.4),
			inset 0 1px 0 var(--panel-rim);
	}

	.panel h2 {
		font-size: 0.85rem;
		font-weight: 600;
		margin: 0 0 0.75rem;
		color: var(--glass-muted);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-family: var(--font-heading);
	}

	.knob-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.25rem;
	}

	.knob-row label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
		color: var(--glass-muted);
		min-width: 160px;
	}

	.knob-row input[type='range'] {
		flex: 1;
		accent-color: var(--accent);
		min-width: 80px;
	}

	.toggle-row {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-top: 0.75rem;
	}

	.empty {
		color: var(--glass-muted);
		font-size: 0.8rem;
	}

	.project-list h2 {
		font-size: 0.9rem;
		font-weight: 600;
		margin: 0 0 0.75rem;
		color: var(--glass-muted);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-family: var(--font-heading);
	}

	.project-list ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.project-list li {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.5rem 0.75rem;
		border-radius: 10px;
		margin-bottom: 0.35rem;
		transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
	}

	.project-list li:hover {
		background: rgba(255, 255, 255, 0.07);
	}

	.project-list li.active {
		background: rgba(0, 229, 255, 0.07);
		border: 1px solid rgba(0, 229, 255, 0.55);
		box-shadow: 0 0 12px rgba(0, 229, 255, 0.12);
	}

	.proj-name {
		font-weight: 600;
		font-size: 0.875rem;
		min-width: 140px;
	}

	.proj-date {
		color: var(--glass-muted);
		font-size: 0.75rem;
		flex: 1;
	}

	.proj-actions {
		display: flex;
		gap: 0.35rem;
	}

	.project-audio {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex: 1;
	}

	.audio-bar {
		flex: 1;
		height: 6px;
		background: rgba(255, 255, 255, 0.08);
		border: none;
		border-radius: 3px;
		appearance: none;
		cursor: pointer;
	}

	.audio-bar::-webkit-slider-thumb {
		appearance: none;
		width: 12px;
		height: 12px;
		background: var(--accent);
		border-radius: 50%;
		cursor: pointer;
	}

	.audio-bar::-moz-range-thumb {
		width: 12px;
		height: 12px;
		background: var(--accent);
		border-radius: 50%;
		cursor: pointer;
		border: none;
	}

	.audio-time {
		font-variant-numeric: tabular-nums;
		font-size: 0.72rem;
		color: var(--glass-muted);
		font-family: var(--mono);
		white-space: nowrap;
	}

	.project-sidebar {
		width: 280px;
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-right: 1px solid var(--glass-border);
		border-radius: var(--radius);
		box-shadow: 0 20px 50px rgba(0,0,0,.35), inset 0 1px 0 var(--glass-rim);
		backdrop-filter: blur(20px) saturate(140%);
		-webkit-backdrop-filter: blur(20px) saturate(140%);
		position: sticky;
		top: 0;
		height: 100vh;
		overflow-y: auto;
		flex-shrink: 0;
		margin-left: -280px;
		transition: margin-left .25s ease;
	}

	.project-sidebar.open {
		margin-left: 0;
	}

	.sidebar-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: .85rem 1rem;
		border-bottom: 1px solid var(--glass-border);
	}

	.sidebar-head h2 {
		margin: 0;
		font-size: 1rem;
		letter-spacing: .05em;
		color: var(--glass-text);
		font-family: var(--font-heading);
		text-transform: uppercase;
	}

	.count {
		font-size: .75rem;
		color: var(--glass-muted);
	}

	.sidebar-close {
		background: transparent;
		border: none;
		color: var(--glass-muted);
		font-size: 1.5rem;
		line-height: 1;
		cursor: pointer;
		padding: 0;
	}

	.sidebar-close:hover {
		color: var(--glass-text);
	}

	.sidebar-new {
		width: 100%;
		justify-content: center;
		margin: 1rem;
	}

	.empty {
		grid-column: 1 / -1;
		color: var(--glass-muted);
		font-size: .8rem;
		text-align: center;
		padding: 1rem;
	}

	.proj-cards {
		display: flex;
		flex-direction: column;
		gap: .75rem;
		padding: 0 1rem 1rem;
	}

	.proj-card {
		position: relative;
	}

	.proj-card-main {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: .4rem;
		background: transparent;
		border: none;
		padding: .85rem 1rem;
		border-radius: 10px;
		cursor: pointer;
		text-align: left;
		color: var(--glass-text);
		transition: background .2s ease, border-color .2s ease;
	}

	.proj-card-main:hover {
		background: rgba(255,255,255,.04);
	}

	.proj-card-main:active {
		background: rgba(255,255,255,.08);
	}

	.proj-card.active .proj-card-main {
		border: 1px solid var(--accent);
		background: rgba(0,229,255,.08);
	}

	.proj-card-name {
		font-weight: 600;
		font-size: .9rem;
		color: var(--glass-text);
	}

	.proj-card-date {
		color: var(--glass-muted);
		font-size: .72rem;
	}

	.mini-grid {
		display: grid;
		grid-template-columns: repeat(var(--cols, 16), 1fr);
		gap: 2px;
		margin-top: .5rem;
		width: 100%;
	}

	.mini-row {
		display: contents;
	}

	.mini-cell {
		aspect-ratio: 1;
		border-radius: 2px;
		background: rgba(255,255,255,.07);
	}

	.mini-cell.lit {
		background: var(--tint, var(--accent));
		box-shadow: 0 0 4px var(--tint, var(--accent));
	}

	.proj-card-del {
		position: absolute;
		top: .55rem;
		right: .55rem;
		width: 20px;
		height: 20px;
		display: grid;
		place-items: center;
		background: rgba(0,0,0,.35);
		border: 1px solid var(--glass-border);
		border-radius: 6px;
		color: var(--glass-muted);
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
		opacity: 0;
		transition: opacity .2s ease;
	}

	.proj-card:hover .proj-card-del {
		opacity: 1;
	}

	.sidebar-backdrop {
		display: none;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: .75rem;
	}

	.sidebar-toggle {
		background: rgba(255,255,255,.06);
		border: 1px solid var(--glass-border);
		border-radius: 10px;
		color: var(--glass-text);
		font-size: 1.1rem;
		width: 40px;
		height: 40px;
		display: grid;
		place-items: center;
		cursor: pointer;
		backdrop-filter: blur(8px);
	}

	.sidebar-toggle:hover {
		background: rgba(255,255,255,.12);
	}

	@media (max-width: 720px) {
		.app {
			padding: 1rem;
		}

		.top-bar {
			flex-direction: column;
			align-items: stretch;
		}

		.project-name {
			width: 100%;
		}

		.project-controls {
			flex-wrap: wrap;
		}

	.pads {
		grid-template-columns: repeat(4, 1fr);
	}

	.project-sidebar {
		position: fixed;
		inset: 0 auto 0 0;
		margin-left: 0;
		transform: translateX(-100%);
		z-index: 50;
	}

	.project-sidebar.open {
		transform: translateX(0);
	}

	.sidebar-backdrop {
		display: block;
		position: fixed;
		inset: 0;
		background: rgba(0,0,0,.5);
		z-index: 40;
	}
	}

	/* ─── DAW Components ─── */
	.brand-logo {
		width: 32px;
		height: 32px;
		border-radius: 8px;
		box-shadow: 0 0 14px var(--neon-accent);
		background: #000;
		border: 1px solid var(--panel-border);
	}

	.manual-btn {
		font-size: 1.25rem;
		padding: 0.35rem 0.6rem;
		background: rgba(255,255,255,0.06);
		border: 1px solid var(--panel-border);
		border-radius: 10px;
		color: var(--glass-text);
		cursor: pointer;
		transition: all 0.2s;
	}
	.manual-btn:hover:not(:disabled) {
		background: var(--neon-accent);
		color: #04121a;
		box-shadow: 0 0 16px var(--neon-accent);
	}

	.btn {
		background: rgba(255,255,255,0.05);
		border: 1px solid var(--panel-border);
		border-radius: 10px;
		color: var(--glass-text);
		font-size: 0.8rem;
		padding: 0.4rem 0.75rem;
		cursor: pointer;
		white-space: nowrap;
		transition: all 0.15s;
		backdrop-filter: blur(8px);
	}
	.btn:hover:not(:disabled) {
		background: rgba(255,255,255,0.12);
		border-color: var(--panel-rim);
		box-shadow: 0 0 10px rgba(0,229,255,0.15);
	}
	.btn:active:not(:disabled) { transform: scale(0.97); }
	.btn:disabled { opacity: 0.45; cursor: not-allowed; }
	.btn.btn-metro.active { background: var(--neon-purple); color: #fff; border-color: var(--neon-purple); box-shadow: 0 0 14px var(--neon-purple); }

	.btn-record {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		min-width: 100px;
		padding: 0.55rem 0.95rem;
		background: rgba(255,46,136,0.10);
		border: 1px solid rgba(255,46,136,0.45);
		border-radius: 12px;
		color: #ffa3c6;
		font-weight: 700;
		font-size: 0.85rem;
		letter-spacing: 0.02em;
		cursor: pointer;
		transition: all 0.2s;
	}
	.btn-record:hover:not(:disabled) {
		background: rgba(255,46,136,0.22);
		border-color: rgba(255,46,136,0.7);
		color: #ffb6d9;
		box-shadow: 0 0 14px rgba(255,46,136,0.25);
	}
	.btn-record.recording {
		background: rgba(255,46,136,0.35);
		border-color: var(--rec);
		color: #fff;
		animation: rec-pulse 1.1s ease-in-out infinite;
		box-shadow: 0 0 0 0 rgba(255,46,136,0.6);
	}

	/* REC banner */
	.rec-banner {
		position: fixed;
		top: 1rem;
		left: 50%;
		transform: translateX(-50%);
		z-index: 200;
		display: none;
		align-items: center;
		gap: 0.6rem;
		padding: 0.55rem 1rem;
		background: var(--rec);
		color: #04121a;
		border-radius: 999px;
		font-weight: 700;
		font-size: 0.85rem;
		letter-spacing: 0.05em;
		box-shadow: 0 0 24px var(--rec);
		border: 1px solid rgba(255,255,255,0.5);
		animation: rec-blink 1.2s ease-in-out infinite;
	}
	.rec-banner.visible { display: flex; }

	/* Level meters */
	.transport-meters {
		display: flex;
		gap: 1rem;
		align-items: center;
		margin-left: auto;
	}
	.meter {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.2rem;
	}
	.meter-label {
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--glass-muted);
		font-family: var(--mono);
	}
	.meter-fill {
		width: 70px;
		height: 10px;
		background: rgba(255,255,255,0.08);
		border-radius: 6px;
		overflow: hidden;
		border: 1px solid var(--panel-border);
		position: relative;
	}
	.meter-fill::after {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: calc(var(--v) * 100%);
		background: linear-gradient(90deg, var(--accent), var(--neon-purple));
		border-radius: 6px;
		box-shadow: 0 0 10px var(--accent);
		transition: width 0.06s ease;
	}
	.meter-fill.active::after { background: var(--rec); box-shadow: 0 0 12px var(--rec); }
	.meter-val {
		font-size: 0.65rem;
		font-family: var(--mono);
		color: var(--glass-muted);
	}
	.meter-val.active { color: var(--rec); }

	/* Downbeat flash */
	.downbeat-flash {
		position: absolute;
		inset: 0;
		background: radial-gradient(circle, rgba(255,255,255,0.25) 0%, transparent 60%);
		opacity: 0;
		pointer-events: none;
		z-index: 5;
		transition: opacity 0.12s ease;
	}
	.downbeat-flash.active { opacity: 1; }

	/* Opening lightning sequence */
	.opening-overlay {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: flex;
		align-items: center;
		justify-content: center;
		background:
			radial-gradient(circle at 30% 30%, rgba(0, 150, 255, 0.2) 0%, transparent 50%),
			radial-gradient(circle at 70% 70%, rgba(255, 120, 40, 0.2) 0%, transparent 50%),
			#000000;
	}
	.opening-content {
		text-align: center;
		z-index: 10;
		opacity: 0;
		animation: opening-fade 2.4s ease forwards;
	}
	.opening-logo {
		display: inline-block;
		position: relative;
		width: 110px;
		height: 110px;
		margin: 0 auto 1rem;
		box-shadow: 0 0 35px rgba(0, 150, 255, 0.6);
		border-radius: 24px;
		overflow: hidden;
		border: 1px solid var(--panel-border);
		animation: opening-logo-bounce 3.5s ease-in-out infinite;
	}
	.opening-logo img { width: 100%; height: 100%; object-fit: cover; display: block; }
	.opening-glow {
		position: absolute;
		inset: -20%;
		background: radial-gradient(circle, rgba(0, 150, 255, 0.4) 0%, rgba(255, 120, 40, 0.25) 50%, transparent 70%);
		opacity: 0;
		animation: opening-glow 3s ease-in-out infinite;
	}
	.opening-title {
		margin: 0 0 0.35rem;
		font-size: 2rem;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: #fff;
		text-shadow: 0 0 25px rgba(0, 150, 255, 0.7);
		font-family: var(--font-heading);
		text-transform: uppercase;
	}
	.opening-sub {
		margin: 0;
		font-size: 0.95rem;
		color: var(--glass-muted);
		letter-spacing: 0.15em;
		text-transform: uppercase;
	}
	.opening-progress {
		margin-top: 1.4rem;
		width: 260px;
		height: 6px;
		background: rgba(255,255,255,0.08);
		border-radius: 3px;
		overflow: hidden;
		border: 1px solid var(--panel-border);
	}
	.opening-bar {
		height: 100%;
		background: linear-gradient(90deg, var(--accent), var(--accent-2));
		width: calc(var(--p) * 1%);
		border-radius: 3px;
		box-shadow: 0 0 16px rgba(0, 150, 255, 0.6), 0 0 16px rgba(255, 120, 40, 0.4);
		transition: width 0.1s linear;
	}
	.opening-flash {
		position: absolute;
		inset: 0;
		background: radial-gradient(circle at 50% 30%, rgba(0, 150, 255, 0.35) 0%, rgba(255, 120, 40, 0.25) 30%, transparent 55%);
		opacity: 0;
		animation: opening-flash-anim 1.6s ease-in-out infinite;
		pointer-events: none;
	}
	.opening-lightning {
		position: absolute;
		inset: 0;
		background: repeating-linear-gradient(
			0deg,
			rgba(0, 150, 255, 0.0) 0%,
			rgba(0, 150, 255, 0.14) 2%,
			rgba(0, 150, 255, 0.0) 4%,
			rgba(255, 120, 40, 0.0) 4%,
			rgba(255, 120, 40, 0.14) 6%,
			rgba(255, 120, 40, 0.0) 8%
		);
		opacity: 0;
		animation: opening-lightning 1.8s ease-in-out infinite;
		pointer-events: none;
	}

	/* Manual overlay */
	.manual-overlay {
		position: fixed;
		inset: 0;
		z-index: 9998;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(5,7,10,0.75);
		backdrop-filter: blur(12px);
	}
	.manual {
		width: min(720px, 92vw);
		max-height: 88vh;
		overflow-y: auto;
		background: var(--panel);
		border: 1px solid var(--panel-border);
		border-radius: 20px;
		box-shadow: 0 24px 60px rgba(0,0,0,0.5), inset 0 1px 0 var(--panel-rim);
		padding: 2rem 2.25rem;
		color: var(--glass-text);
		animation: manual-in 0.35s ease;
	}
	.manual-close {
		position: absolute;
		top: 1rem;
		right: 1.1rem;
		background: rgba(255,255,255,0.08);
		border: 1px solid var(--panel-border);
		border-radius: 10px;
		width: 32px;
		height: 32px;
		font-size: 1.25rem;
		cursor: pointer;
		color: var(--glass-text);
		transition: all 0.15s;
	}
	.manual-close:hover { background: var(--rec); color: #04121a; }
	.manual-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.5rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--panel-border);
	}
	.manual-logo { width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--panel-border); box-shadow: 0 0 14px var(--neon-accent); }
	.manual-header h1 { margin: 0; font-size: 1.35rem; color: #fff; letter-spacing: -0.01em; font-family: var(--font-heading); text-transform: uppercase; }
	.manual-tag { color: var(--glass-muted); font-size: 0.8rem; font-family: var(--mono); }
	.manual-section h2 {
		margin: 0 0 0.6rem;
		font-size: 0.9rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--neon-accent);
		font-family: var(--font-heading);
	}
	.manual-section { margin-bottom: 1.4rem; }
	.manual-section ul { margin: 0; padding-left: 1.1rem; color: var(--glass-faint); line-height: 1.7; }
	.manual-section li { margin-bottom: 0.45rem; }
	.manual-section kbd {
		display: inline-block;
		background: rgba(255,255,255,0.06);
		border: 1px solid var(--panel-border);
		border-radius: 6px;
		padding: 0.1rem 0.45rem;
		font-size: 0.78rem;
		color: var(--neon-accent);
		font-family: var(--mono);
		margin: 0 0.1rem;
	}
	.manual-footer {
		margin-top: 1.6rem;
		padding-top: 1rem;
		border-top: 1px solid var(--panel-border);
		color: var(--glass-muted);
		font-size: 0.75rem;
		font-family: var(--mono);
		text-align: center;
	}

	/* Pads DAW */
	.pad {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		aspect-ratio: 1.6;
		background: linear-gradient(180deg, color-mix(in srgb, var(--c) 12%, rgba(20,24,34,0.8)), rgba(20,24,34,0.85));
		border: 1px solid color-mix(in srgb, var(--c) 28%, transparent);
		border-radius: 12px;
		color: var(--glass-text);
		cursor: pointer;
		box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
		transition: transform 0.06s, box-shadow 0.06s, border-color 0.06s, background 0.06s;
	}
	.pad:hover:not(:disabled) {
		border-color: color-mix(in srgb, var(--c) 70%, white);
		box-shadow: 0 0 26px color-mix(in srgb, var(--c) 65%, white);
	}
	.pad.active {
		background: color-mix(in srgb, var(--c) 30%, rgba(11,13,19,0.95));
		border-color: var(--c);
		transform: scale(0.95);
		box-shadow: 0 0 32px color-mix(in srgb, var(--c) 90%, white), inset 0 0 18px color-mix(in srgb, var(--c) 55%, white);
	}
	.pad-key { font-family: var(--mono); font-size: 0.72rem; font-weight: 700; color: var(--c); text-transform: uppercase; letter-spacing: 0.05em; }
	.pad-label { font-size: 0.68rem; color: var(--glass-faint); text-align: center; line-height: 1.1; }

	/* Matrix DAW */
	.matrix-row {
		display: grid;
		grid-template-columns: 100px repeat(var(--cols), minmax(0, 1fr));
		gap: 1px;
		align-items: center;
	}
	.row-label {
		font-size: 0.7rem;
		font-family: var(--mono);
		color: var(--g);
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 4px 6px;
		text-align: right;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: background 0.1s, color 0.1s;
		border-radius: 4px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.row-label:hover {
		background: rgba(255, 255, 255, 0.06);
	}
	.row-label.selected {
		background: rgba(255, 255, 255, 0.1);
		color: #fff;
	}
	.row-label:disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}
	.active-row {
		background: rgba(255, 255, 255, 0.02);
		border-radius: 4px;
	}
	.cell {
		border: 1px solid rgba(255,255,255,0.06);
		border-radius: 4px;
		background: rgba(12,14,20,0.55);
		cursor: pointer;
		padding: 0;
		min-width: 14px;
		height: 30px;
		transition: background 0.05s, box-shadow 0.05s;
	}
	.cell.beat {
		border-color: rgba(255, 255, 255, 0.14);
	}
	.cell.on {
		background: color-mix(in srgb, var(--g) calc(30% + (1 - var(--v)) * 55%), #0a0c10);
		border-color: color-mix(in srgb, var(--g) 75%, transparent);
	}
	.cell.play {
		box-shadow:
			inset 0 0 0 2px rgba(255, 255, 255, 0.85),
			0 0 10px rgba(255, 255, 255, 0.25);
	}
	.cell:disabled {
		cursor: not-allowed;
	}

	/* 64-step mode: tighter cells so they fit the screen in a single row */
	.matrix.dense .cell {
		min-width: 9px;
		height: 26px;
		border-radius: 3px;
	}
	.matrix.dense .row-label {
		padding: 3px 2px;
		font-size: 0.6rem;
	}

	/* Project list DAW */
	.project-list li {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.55rem 0.8rem;
		border-radius: 12px;
		margin-bottom: 0.35rem;
		transition: all 0.15s;
		border: 1px solid transparent;
	}
	.project-list li:hover { background: rgba(255,255,255,0.06); }
	.project-list li.active {
		background: rgba(0,229,255,0.08);
		border: 1px solid rgba(0,229,255,0.5);
		box-shadow: 0 0 14px rgba(0,229,255,0.12);
	}
	.project-audio { display: flex; align-items: center; gap: 0.45rem; flex: 1; }
	.audio-bar {
		flex: 1;
		height: 6px;
		background: rgba(255,255,255,0.08);
		border: none;
		border-radius: 3px;
		appearance: none;
		cursor: pointer;
	}
	.audio-bar::-webkit-slider-thumb { appearance: none; width: 12px; height: 12px; background: var(--accent); border-radius: 50%; cursor: pointer; box-shadow: 0 0 10px var(--accent); }
	.audio-bar::-moz-range-thumb { width: 12px; height: 12px; background: var(--accent); border-radius: 50%; cursor: pointer; border: none; }
	.audio-time { font-variant-numeric: tabular-nums; font-size: 0.7rem; color: var(--glass-muted); font-family: var(--mono); white-space: nowrap; }

	/* Project cards DAW */
	.proj-card-main {
		width: 100%;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.4rem;
		background: transparent;
		border: none;
		padding: 0.9rem 1rem;
		border-radius: 12px;
		cursor: pointer;
		text-align: left;
		color: var(--glass-text);
		transition: background 0.2s ease, border-color 0.2s ease;
	}
	.proj-card-main:hover { background: rgba(255,255,255,0.05); }
	.proj-card.active .proj-card-main { border: 1px solid var(--accent); background: rgba(0,229,255,0.08); }

	/* Scrollbar */
	::-webkit-scrollbar { width: 10px; height: 10px; }
	::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); }
	::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 6px; border: 2px solid rgba(0,0,0,0.3); }
	::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.22); }

	/* ─── Animations ─── */
	@keyframes rec-pulse {
		0% { box-shadow: 0 0 0 0 rgba(255,46,136,0.6); }
		70% { box-shadow: 0 0 0 16px rgba(255,46,136,0); }
		100% { box-shadow: 0 0 0 0 rgba(255,46,136,0); }
	}
	@keyframes rec-dot-blink {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.35; }
	}
	@keyframes rec-blink {
		0%, 100% { opacity: 1; box-shadow: 0 0 24px var(--rec); }
		50% { opacity: 0.85; box-shadow: 0 0 36px var(--rec); }
	}
	@keyframes opening-fade {
		0% { opacity: 0; transform: scale(0.92); }
		100% { opacity: 1; transform: scale(1); }
	}
	@keyframes opening-logo-bounce {
		0%, 100% { transform: translateY(0) scale(1); }
		50% { transform: translateY(-6px) scale(1.03); }
	}
	@keyframes opening-glow {
		0%, 100% { opacity: 0.5; }
		50% { opacity: 1; }
	}
	@keyframes opening-flash-anim {
		0%, 100% { opacity: 0; }
		50% { opacity: 0.45; }
	}
	@keyframes opening-lightning {
		0%, 90%, 100% { opacity: 0; }
		92% { opacity: 0.35; }
	}
	@keyframes manual-in {
		0% { opacity: 0; transform: translateY(16px) scale(0.97); }
		100% { opacity: 1; transform: translateY(0) scale(1); }
	}
</style>
