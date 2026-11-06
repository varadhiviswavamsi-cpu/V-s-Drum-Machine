// @ts-nocheck
class RecorderProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this._recording = false;
		this._chunks = [];
		this.port.onmessage = (event) => {
			const { type } = event.data || {};
			if (type === 'start') {
				this._recording = true;
				this._chunks = [];
				this.port.postMessage({ type: 'started' });
			} else if (type === 'stop') {
				this._recording = false;
				const copy = this._chunks.slice();
				this._chunks = [];
				this.port.postMessage({ type: 'stopped', chunks: copy });
			}
		};
	}

	process(inputs, outputs, parameters) {
		const input = inputs[0];
		if (!input || input.length === 0) return true;

		if (this._recording) {
			const channelCount = input.length;
			const frameCount = input[0] ? input[0].length : 0;
			const interleaved = new Float32Array(frameCount * Math.max(channelCount, 2));

			for (let f = 0; f < frameCount; f++) {
				let left = 0;
				let right = 0;
				if (channelCount >= 1) left = input[0][f];
				if (channelCount >= 2) right = input[1][f];
				else right = left;
				interleaved[f * 2] = left;
				interleaved[f * 2 + 1] = right;
			}

			this._chunks.push(interleaved);

			if (this._chunks.length >= 16) {
				const batch = this._chunks.splice(0, 16);
				this.port.postMessage({ type: 'data', chunks: batch });
			}
		}

		if (outputs[0] && outputs[0].length > 0) {
			for (let c = 0; c < outputs[0].length; c++) {
				const out = outputs[0][c];
				const srcC = c < input.length ? input[c] : input[input.length - 1];
				if (srcC) out.set(srcC);
			}
		}

		return true;
	}
}

registerProcessor('recorder-processor', RecorderProcessor);
