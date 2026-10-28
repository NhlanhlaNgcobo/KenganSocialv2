/**
 * Self-hosted text AI through Ollama (MIT) running Qwen3 (Apache-2.0), for the private pilot.
 *
 * AI_PROVIDER=ollama makes every text/JSON AI call in the server use this, and only this: no paid
 * provider is tried. Unset AI_PROVIDER to go back to the previous provider order (rollback).
 *
 *  OLLAMA_BASE_URL         http://ollama:11434 (internal network only; never publish port 11434)
 *  OLLAMA_MODEL            qwen3:1.7b
 *  OLLAMA_MAX_TOKENS       700      hard cap on output tokens per text call
 *  OLLAMA_JSON_MAX_TOKENS  1500     hard cap for JSON calls (clip lists, plans)
 *  OLLAMA_NUM_CTX          4096     context window (RAM grows with it)
 *  OLLAMA_MAX_INPUT_CHARS  12000    longer prompts are cut (short context keeps CPU time bounded)
 *  OLLAMA_TIMEOUT_MS       90000    per call
 *  AI_CONCURRENCY          1        calls run one at a time on a CPU box; others wait in line
 *  AI_QUEUE_MAX            20       beyond this many waiting, calls fail fast with 503 AI_BUSY
 *
 * Prompts and replies are never logged.
 */

export const ollamaEnabled = () => String(process.env.AI_PROVIDER || '').toLowerCase() === 'ollama';

const int = (name, fallback) => {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export function ollamaSettings() {
    return {
        baseUrl: (process.env.OLLAMA_BASE_URL || 'http://ollama:11434').replace(/\/+$/, ''),
        model: process.env.OLLAMA_MODEL || 'qwen3:1.7b',
        maxTokens: int('OLLAMA_MAX_TOKENS', 700),
        jsonMaxTokens: int('OLLAMA_JSON_MAX_TOKENS', 1500),
        numCtx: int('OLLAMA_NUM_CTX', 4096),
        maxInputChars: int('OLLAMA_MAX_INPUT_CHARS', 12000),
        timeoutMs: int('OLLAMA_TIMEOUT_MS', 90_000),
        concurrency: int('AI_CONCURRENCY', 1),
        queueMax: int('AI_QUEUE_MAX', 20),
    };
}

// ── One-at-a-time queue ──
let running = 0;
const waiting = [];
function acquire() {
    const { concurrency, queueMax } = ollamaSettings();
    if (running < concurrency) {
        running += 1;
        return Promise.resolve();
    }
    if (waiting.length >= queueMax) {
        return Promise.reject(Object.assign(new Error('The AI is busy with other requests. Try again in a minute.'), { status: 503, code: 'AI_BUSY' }));
    }
    return new Promise((resolve) => waiting.push(resolve));
}
function release() {
    const next = waiting.shift();
    if (next) next();
    else running = Math.max(0, running - 1);
}
export const ollamaQueueState = () => ({ running, waiting: waiting.length });

/** Removes Qwen3's <think>…</think> block (also an unterminated one cut off by the token cap). */
export function stripThinking(text) {
    return String(text || '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<think>[\s\S]*$/i, '')
        .trim();
}

/** Text content of an OpenAI-style message (string, or an array of parts; images are dropped). */
function messageText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.filter((p) => p?.type === 'text' || typeof p?.text === 'string').map((p) => p.text).join('\n\n');
    return String(content ?? '');
}

/** Keeps the system prompt and the end of the conversation within maxInputChars. */
function fitMessages(messages, maxChars) {
    const out = messages.map((m) => ({ role: m.role === 'developer' ? 'system' : m.role, content: messageText(m.content) }));
    let total = out.reduce((n, m) => n + m.content.length, 0);
    for (const m of out) {
        if (total <= maxChars) break;
        if (m.role === 'system') continue;
        const cut = Math.min(m.content.length, total - maxChars);
        m.content = m.content.slice(0, m.content.length - cut);
        total -= cut;
    }
    return out;
}

/**
 * One chat call. Returns { text, usage }.
 * @param {{ messages: {role: string, content: any}[], maxTokens?: number, temperature?: number, json?: boolean, fetchImpl?: typeof fetch }} params
 */
export async function ollamaChat({ messages, maxTokens, temperature = 0.7, json = false, fetchImpl = fetch }) {
    const s = ollamaSettings();
    const body = {
        model: s.model,
        messages: fitMessages(messages, s.maxInputChars),
        stream: false,
        think: false, // Qwen3: skip the reasoning trace (CPU time) — the reply is all we use
        keep_alive: '30m',
        options: { num_predict: Math.min(maxTokens || (json ? s.jsonMaxTokens : s.maxTokens), json ? s.jsonMaxTokens : s.maxTokens), num_ctx: s.numCtx, temperature },
        ...(json ? { format: 'json' } : {}),
    };
    await acquire();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), s.timeoutMs);
    try {
        let res;
        try {
            res = await fetchImpl(`${s.baseUrl}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
        } catch (err) {
            const timedOut = err?.name === 'AbortError';
            throw Object.assign(new Error(timedOut ? 'The AI took too long to answer. Try a shorter request.' : 'The AI service is not reachable right now.'), { status: timedOut ? 504 : 503, code: timedOut ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE' });
        }
        if (!res.ok) {
            // Status only: the body can echo the prompt.
            throw Object.assign(new Error(`The AI service returned an error (${res.status}).`), { status: 502, code: 'AI_UPSTREAM_ERROR' });
        }
        const data = await res.json();
        return {
            text: stripThinking(data?.message?.content),
            usage: { prompt_tokens: data?.prompt_eval_count || 0, completion_tokens: data?.eval_count || 0, total_tokens: (data?.prompt_eval_count || 0) + (data?.eval_count || 0) },
        };
    } finally {
        clearTimeout(timer);
        release();
    }
}

/** The OpenAI SDK shape (`chat.completions.create`) the existing call sites use. */
export function ollamaChatClient(fetchImpl = fetch) {
    return {
        chat: {
            completions: {
                create: async (params = {}) => {
                    const { text, usage } = await ollamaChat({
                        messages: params.messages || [],
                        maxTokens: params.max_tokens || params.max_completion_tokens,
                        temperature: params.temperature ?? 0.7,
                        json: params.response_format?.type === 'json_object',
                        fetchImpl,
                    });
                    return { id: `ollama-${Date.now()}`, object: 'chat.completion', model: ollamaSettings().model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage };
                },
            },
        },
    };
}

/** Health for the admin dashboard and /api/ai/status: is the model pulled and answering? */
export async function ollamaHealth(fetchImpl = fetch) {
    const s = ollamaSettings();
    try {
        const res = await fetchImpl(`${s.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) return { ok: false, model: s.model, error: `status ${res.status}` };
        const tags = await res.json();
        const pulled = (tags?.models || []).some((m) => m.name === s.model || m.model === s.model);
        return { ok: pulled, model: s.model, pulled, queue: ollamaQueueState(), ...(pulled ? {} : { error: `model ${s.model} is not pulled (ollama pull ${s.model})` }) };
    } catch (err) {
        return { ok: false, model: s.model, error: err?.name === 'TimeoutError' ? 'timeout' : 'unreachable' };
    }
}
