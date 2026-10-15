/**
 * Headless Chrome jobs (website reads, slide rendering) are memory-heavy: run them one at a
 * time per server process. Same pattern as the launch-video queue in routes/brag.ts.
 */
let tail = Promise.resolve();

export function inChromeQueue(task) {
    const next = tail.then(task, task);
    tail = next.then(
        () => undefined,
        () => undefined
    );
    return next;
}
