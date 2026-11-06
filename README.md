# 🥁 V's Drum Machine

> A premium, browser-based drum machine & DAW with a neon space-age aesthetic. Built with SvelteKit, Web Audio API, and IndexedDB. Program beats, mix tracks, record performances, and export WAVs — all in the browser.

<div align="center">

[![SvelteKit](https://img.shields.io/badge/SvelteKit-5.x-FF3E00?style=for-the-badge&logo=svelte&logoColor=white)](https://kit.svelte.dev/)
[![Vite](https://img.shields.io/badge/Vite-6.x-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Web Audio API](https://img.shields.io/badge/Web%20Audio-API-00E5FF?style=for-the-badge&logo=google-chrome&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)

</div>

---

## 📸 Preview

| Boot Sequence | Matrix Sequencer | Mixer & Master |
|--------------|------------------|----------------|
| Neon Orbitron title + 3-second UI beep | 8-track step grid with velocity control | Per-track sends + global master FX |

---

## 🎯 About

**V's Drum Machine** is a full-featured digital audio workstation for beat programming, running entirely in the browser. No installation, no accounts, no server round-trips — just open it and start making music.

It combines a step matrix sequencer, per-track mixer, global master bus, metronome, performance recording, and WAV export, wrapped in a dark neon aesthetic inspired by sci-fi interfaces and retro-futurism.

### Key Capabilities

- **8-track step sequencer** with quarter/eighth/sixteenth resolution
- **Per-track mixer**: Volume, Pan, Delay send, Reverb send, Drive
- **Master bus**: Filter cutoff/resonance, Delay time/feedback/mix, Reverb, Drive
- **Transport**: Play, Pause, Stop, Record, BPM, Swing
- **Performance recording**: Capture your session to WAV and download it
- **Project management**: Save up to 16 projects locally (IndexedDB)
- **Keyboard shortcuts**: Space (play), 1–8 (pads), Esc (close panels), Enter (start from boot)
- **Metronome** with downbeat flash

---

## 🛠 Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Framework** | [SvelteKit 5](https://kit.svelte.dev/) | Reactive UI framework + static site generation |
| **Build Tool** | [Vite 6](https://vitejs.dev/) | Fast bundling, HMR, static asset optimization |
| **Language** | [TypeScript 5](https://www.typescriptlang.org/) | Type-safe frontend code |
| **Audio Engine** | [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) | Sample playback, mixing, effects, recording |
| **Storage** | [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) | Client-side project & recording persistence |
| **Styling** | CSS Variables + Backdrop Filters | Glassmorphism, neon gradients, dark theme |
| **Fonts** | [Orbitron](https://fonts.google.com/specimen/Orbitron) (headings) · [SF Pro](https://developer.apple.com/fonts/) (body) | Space-age display + clean system UI |
| **Deployment** | [Vercel](https://vercel.com/) (static adapter) | Edge-hosted static site |

---

## 🏗 Architecture

```
V's Drum Machine/
├── src/
│   ├── app.html                      # Shell HTML + Google Fonts preload
│   ├── routes/
│   │   ├── +page.svelte              # Main app (all UI + logic)
│   │   └── +layout.ts                # Prerender + SSR config
│   ├── lib/
│   │   ├── audio/                    # Web Audio engine
│   │   │   ├── AudioContextManager.ts
│   │   │   ├── DrumMachineEngine.ts  # Core synthesis & playback
│   │   │   ├── MasterBus.ts          # Global FX chain
│   │   │   ├── Mixer.ts              # Per-track mixing
│   │   │   ├── Recorder.ts           # WAV capture & export
│   │   │   ├── SampleManager.ts      # Sample loading & playback
│   │   │   ├── effects.ts            # Delay, reverb, drive nodes
│   │   │   └── recorder.worklet.js   # Audio worklet for recording
│   │   ├── sequencer/                # Step sequencer logic
│   │   │   ├── Clock.ts              # Transport timing
│   │   │   ├── Sequencer.ts          # Step triggering
│   │   │   └── Transport.ts          # Play/stop/record state
│   │   ├── storage/                  # IndexedDB persistence
│   │   │   ├── db.ts                 # Database schema & access
│   │   │   └── index.ts              # Project CRUD layer
│   │   ├── stores/                   # Svelte 5 runes-based state
│   │   │   ├── engine.ts             # Audio engine store
│   │   │   ├── master.ts             # Master bus state
│   │   │   ├── tracks.ts             # Per-track state
│   │   │   ├── transport.ts          # Playhead & tempo
│   │   │   └── core.ts               # Utility rune getters
│   │   ├── constants.ts              # BPM limits, swing range, key map
│   │   ├── projects.ts               # Project save/load/delete
│   │   └── types.ts                  # TypeScript interfaces
│   └── static/
│       ├── emblem.png                # App icon / logo
│       ├── opening-overlay.mp3       # 3s futuristic UI beep
│       └── samples/                  # Drum one-shots (WAV)
├── svelte.config.js                  # Static adapter config
├── vite.config.ts                    # Vite configuration
└── package.json                      # Dependencies & scripts
```

### State Management

The app uses **Svelte 5 runes** (`$state`, `$derived`, `$effect`) for reactive state:

- **`tracksStore`** — Per-track volume, pan, sends, mute, solo, pattern steps
- **`masterStore`** — Global volume, filter, delay, reverb, drive
- **`transportState`** — BPM, swing, playhead position, play/pause state
- **`cursorState`** — Current bar, beat, step for playhead visualization
- **`engineReady` / `engineError`** — Audio engine initialization status

---

## 🎨 Design Philosophy

### "Neon Dark DAW"

The visual language is built around three pillars:

1. **Black canvas** — Deep blacks (`#000000`) let the neon accents pop and reduce visual fatigue during long sessions.
2. **Split-tone lighting** — Cyan (`#0096ff`) on the left, orange (`#ff7828`) on the right, echoing the project logo's dual-tone "V". Animated lighting sweeps drift across the background.
3. **Glassmorphism** — Frosted glass panels with backdrop blur, subtle borders, and inner rim lighting create depth without heaviness.

### Typography

- **Headings**: Orbitron — a geometric, space-age display font for titles and section headers (uppercase, tracked out).
- **Body/UI**: SF Pro — clean, legible system font for controls, labels, and readouts.
- **Monospace**: JetBrains Mono for numeric values (BPM, time, levels).

### Interaction

- **Pads light up on tap** with a bright neon flare matching the track color.
- **Mixer panel glows** with the active track's color, updating live when you switch tracks.
- **Master panel** carries the signature cyan/orange dual-tone outer glow.
- All controls are touch-friendly and keyboard-accessible.

---

## ⌨ Controls

| Action | Key / Click |
|--------|-------------|
| Play / Pause | `Space` or Play button |
| Stop | Stop button |
| Record | ● Record button |
| Trigger pads | `1`–`8` or tap pads |
| Toggle metronome | 🎵 button |
| Close sidebar / manual | `Esc` |
| Start from boot | `Enter` |

---

## 📜 The Rules

These are the guiding constraints that shaped the project:

1. **Client-side only** — No backend, no auth, no accounts. Everything lives in IndexedDB.
2. **Dark by default** — Light themes are not supported; the experience is designed for dark environments.
3. **16 project limit** — IndexedDB quota-conscious storage cap.
4. **No external audio dependencies** — All samples are bundled locally; no streaming.
5. **Static-first** — Built as a static SPA; deployable to any static host (Vercel, Netlify, GitHub Pages).
6. **Audio requires user gesture** — Browsers block autoplay; the boot sequence handles this gracefully.

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- npm or pnpm

### Install

```bash
git clone https://github.com/YOUR_USERNAME/V-s-Drum-Machine.git
cd V's Drum Machine
npm install
```

### Develop

```bash
npm run dev
```

Open `http://localhost:5173` — click **"Start the Machine"** to initialize the audio engine.

### Build

```bash
npm run build
```

Output goes to `build/` — ready for static hosting.

### Type Check

```bash
npm run check
```

---

## ☁ Deployment (Vercel)

1. Push this repo to GitHub.
2. Import the repository in [Vercel](https://vercel.com).
3. Vercel auto-detects SvelteKit — use the **SvelteKit** framework preset.
4. Build command: `npm run build`
5. Output directory: `build`
6. Deploy.

Alternatively, deploy any static host by uploading the contents of `build/`.

---

## 📄 License

MIT License — feel free to fork, remix, and build your own drum machines.

---

<div align="center">

Made with ⚡ and ☕ by **V**

</div>