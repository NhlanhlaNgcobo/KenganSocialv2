export async function readiness(checks, timeoutMs = 2500) {
    const results = await Promise.all(Object.entries(checks).map(async ([name, check]) => {
        let timer;
        try {
            await Promise.race([Promise.resolve().then(check), new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('Dependency timeout')), timeoutMs);
            })]);
            return [name, 'ready'];
        } catch { return [name, 'unavailable']; }
        finally { clearTimeout(timer); }
    }));
    return { ready: results.every(([, value]) => value === 'ready'), dependencies: Object.fromEntries(results) };
}
