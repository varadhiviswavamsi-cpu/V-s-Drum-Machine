export function createReverbImpulse(
	context: AudioContext,
	duration = 2.7,
	decay = 2.5
): AudioBuffer {
	const rate = context.sampleRate;
	const length = Math.floor(rate * duration);
	const impulse = context.createBuffer(2, length, rate);

	for (let channel = 0; channel < 2; channel++) {
		const data = impulse.getChannelData(channel);
		for (let i = 0; i < length; i++) {
			const t = i / length;
			const noise = Math.random() * 2 - 1;
			const envelope = Math.pow(1 - t, decay);
			const spread = 1 + (Math.random() * 2 - 1) * 0.1;
			data[i] = noise * envelope * spread;
		}
	}

	return impulse;
}