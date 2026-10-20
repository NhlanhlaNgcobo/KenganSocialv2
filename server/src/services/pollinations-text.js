/**
 * Free last-resort AI text provider: Pollinations (https://pollinations.ai, open source), an
 * OpenAI-compatible endpoint serving open models (GPT-OSS 20B on the anonymous tier). Used only
 * when no paid provider key is set or every configured provider failed, so AI features keep
 * working in development and early testing.
 *
 * Text only (no images). Anonymous use is rate-limited and has no service guarantee: set
 * OPENROUTER_API_KEY (or GEMINI/OPENAI) for production. POLLINATIONS_API_KEY raises the limits.
 * Disable with AI_FREE_FALLBACK=off. Prompts are sent to Pollinations' servers (outside South
 * Africa), which the privacy policy must mention while this is in use.
 */

export const POLLINATIONS_BASE = 'https://text.pollinations.ai/openai';
export const POLLINATIONS_MODEL = process.env.POLLINATIONS_TEXT_MODEL || 'openai';

export const freeFallbackEnabled = () => String(process.env.AI_FREE_FALLBACK || 'on').toLowerCase() !== 'off';

// The anonymous tier allows one reply every 30 seconds per server IP. Requests are queued and
// spaced so callers wait instead of failing; a POLLINATIONS_API_KEY removes the spacing.
const ANON_SPACING_MS = 31000;
let queue = Promise.resolve();
let lastCallAt = 0;

function inLine(task) {
    const run = queue.then(async () => {
        if (!process.env.POLLINATIONS_API_KEY) {
            const wait = lastCallAt + ANON_SPACING_MS - Date.now();
            if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        }
        try {
            return await task();
        } finally {
            lastCallAt = Date.now();
        }
    });
    queue = run.catch(() => {});
    return run;
}

/** Seconds Pollinations asks us to wait ("Retry after 8s"), if any. */
function retryAfter(message) {
    const m = /retry after (\d+)\s*s/i.exec(String(message || ''));
    return m ? Number(m[1]) : null;
}

export function pollinationsKey() {
    // The OpenAI client always sends a key; Pollinations accepts a placeholder on the anonymous tier.
    return process.env.POLLINATIONS_API_KEY || 'anonymous';
}

/**
 * @param {{ messages: Array<{role:string, content:string}>, temperature?: number, maxTokens?: number, json?: boolean }} opts
 * @returns {Promise<string>} the reply text
 */
export async function requestPollinationsText({ messages, temperature = 0.7, maxTokens = null, json = false }) {
    const body = { messages, temperature, reasoning_effort: 'low', ...(maxTokens ? { max_tokens: maxTokens } : {}) };
    // JSON mode: the provider constrains the reply to a valid JSON object.
    if (json) body.response_format = { type: 'json_object' };
    const data = await inLine(() => callOnce(body));
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('Pollinations returned an empty reply');
    return String(text);
}

/**
 * OpenAI-shaped client (chat.completions.create) for llm-client.js, going through the same queue,
 * spacing and retries. Returns the provider's OpenAI-compatible response object.
 */
export function pollinationsChatClient() {
    return {
        chat: {
            completions: {
                create: (params = {}) => {
                    const { model: _ignored, stream: _noStream, ...rest } = params;
                    return inLine(() => callOnce({ reasoning_effort: 'low', ...rest }));
                },
            },
        },
    };
}

/** One request with retries; body holds the OpenAI chat parameters (the model is set here). */
async function callOnce(body) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const response = await fetch(`${POLLINATIONS_BASE}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pollinationsKey()}` },
                // The model reasons before answering and its reasoning counts against max_tokens, so no cap by
                // default (a cap cut replies off mid-JSON) and low reasoning effort to keep it fast.
                body: JSON.stringify({ ...body, model: POLLINATIONS_MODEL }),
                signal: AbortSignal.timeout(120000),
            });
            if (response.status === 429 || response.status >= 500) {
                lastError = new Error(`Pollinations is busy (${response.status})`);
                await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
                continue;
            }
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                const message = String(data?.error?.message || data?.error || data?.message || `Pollinations error ${response.status}`);
                const wait = retryAfter(message);
                if (wait != null && wait <= 60 && attempt < 2) {
                    lastError = new Error(message);
                    await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
                    continue;
                }
                throw new Error(message);
            }
            return data;
        } catch (error) {
            lastError = error;
            if (!/busy|timeout|aborted|fetch failed|ECONNRESET/i.test(error.message)) break;
            await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
        }
    }
    throw lastError;
}
