// Beat analysis off the main thread (a 3-minute song takes ~0.5 s of CPU).
import { analyseBeats } from '../lib/beats.js';

self.onmessage = (event) => {
    const { id, samples } = event.data;
    try {
        self.postMessage({ id, result: analyseBeats(samples) });
    } catch (error) {
        self.postMessage({ id, error: String(error?.message || error) });
    }
};
