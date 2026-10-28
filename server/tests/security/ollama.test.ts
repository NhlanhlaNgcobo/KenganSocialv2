import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

/** A stand-in Ollama server: records requests, answers like /api/chat and /api/tags. */
function mockOllama(handler: (body: any, res: http.ServerResponse) => void) {
    const calls: any[] = [];
    let active = 0;
    let maxActive = 0;
    const server = http.createServer((req, res) => {
        if (req.url === '/api/tags') {
            res.setHeader('content-type', 'application/json');
            return res.end(JSON.stringify({ models: [{ name: 'qwen3:1.7b' }] }));
        }
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
            const body = JSON.parse(raw);
            calls.push(body);
            active += 1;
            maxActive = Math.max(maxActive, active);
            res.on('finish', () => (active -= 1));
            handler(body, res);
        });
    });
    return new Promise<{ url: string; calls: any[]; maxActive: () => number; close: () => void }>((resolve) =>
        server.listen(0, () => resolve({ url: `http://127.0.0.1:${(server.address() as any).port}`, calls, maxActive: () => maxActive, close: () => server.close() }))
    );
}
const reply = (res: http.ServerResponse, content: string, delay = 0) =>
    setTimeout(() => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ message: { role: 'assistant', content }, prompt_eval_count: 12, eval_count: 5 }));
    }, delay);

test('ollama: request shape, output cap, no thinking trace, and the OpenAI-style client', async () => {
    const mock = await mockOllama((_b, res) => reply(res, '<think>planning…</think>\nGreat caption #fyp'));
    process.env.AI_PROVIDER = 'ollama';
    process.env.OLLAMA_BASE_URL = mock.url;
    process.env.OLLAMA_MAX_TOKENS = '300';
    try {
        const { ollamaChatClient, stripThinking } = await import('../../src/services/ollama-client.js');
        const out = await ollamaChatClient().chat.completions.create({ model: 'ignored', max_tokens: 5000, messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: [{ type: 'text', text: 'hi' }, { type: 'image_url', image_url: { url: 'data:x' } }] }] });
        assert.equal(out.choices[0].message.content, 'Great caption #fyp');
        const sent = mock.calls[0];
        assert.equal(sent.model, 'qwen3:1.7b');
        assert.equal(sent.stream, false);
        assert.equal(sent.think, false);
        assert.equal(sent.options.num_predict, 300, 'callers cannot raise the output cap');
        assert.equal(sent.messages[1].content, 'hi', 'image parts dropped, text kept');
        assert.equal(stripThinking('<think>cut off by the token limit'), '');

        // JSON mode
        await ollamaChatClient().chat.completions.create({ messages: [{ role: 'user', content: 'x' }], response_format: { type: 'json_object' } });
        assert.equal(mock.calls[1].format, 'json');
    } finally {
        mock.close();
    }
});

test('ollama: one call at a time, a bounded queue, timeouts and errors that do not echo content', async () => {
    const mock = await mockOllama((body, res) => {
        if (body.messages.at(-1).content === 'slow') return reply(res, 'late', 400);
        if (body.messages.at(-1).content === 'boom') {
            res.statusCode = 500;
            return res.end('secret prompt text echoed back');
        }
        reply(res, 'ok', 50);
    });
    process.env.OLLAMA_BASE_URL = mock.url;
    process.env.AI_CONCURRENCY = '1';
    process.env.AI_QUEUE_MAX = '2';
    process.env.OLLAMA_TIMEOUT_MS = '200';
    try {
        const { ollamaChat } = await import('../../src/services/ollama-client.js');
        const msg = (t: string) => ({ messages: [{ role: 'user', content: t }] });
        const results = await Promise.allSettled([ollamaChat(msg('a')), ollamaChat(msg('b')), ollamaChat(msg('c')), ollamaChat(msg('d'))]);
        assert.equal(mock.maxActive(), 1, 'never more than AI_CONCURRENCY at once');
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 3);
        const busy = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
        assert.equal(busy.reason.code, 'AI_BUSY');
        assert.equal(busy.reason.status, 503);

        await assert.rejects(ollamaChat(msg('slow')), (e: any) => e.code === 'AI_TIMEOUT' && e.status === 504);
        await assert.rejects(ollamaChat(msg('boom')), (e: any) => e.code === 'AI_UPSTREAM_ERROR' && !e.message.includes('secret'));
        // The queue recovers after failures.
        assert.equal((await ollamaChat(msg('after'))).text, 'ok');
    } finally {
        mock.close();
        process.env.OLLAMA_TIMEOUT_MS = '90000';
        process.env.AI_QUEUE_MAX = '20';
    }
});

test('ollama: JSON generation and health, with no paid provider tried', async () => {
    const mock = await mockOllama((_b, res) => reply(res, 'Here you go: {"clips":[{"start":1,"end":5,}]}'));
    process.env.AI_PROVIDER = 'ollama';
    process.env.OLLAMA_BASE_URL = mock.url;
    process.env.OPENROUTER_API_KEY = 'should-not-be-used';
    try {
        const { generateJson, aiConfigured } = await import('../../src/services/gemini-json.js');
        assert.equal(aiConfigured(), true);
        assert.deepEqual(await generateJson([{ text: 'find clips' }]), { clips: [{ start: 1, end: 5 }] }, 'small-model JSON is repaired');
        assert.equal(mock.calls.length, 1, 'only Ollama was called');
        const { ollamaHealth } = await import('../../src/services/ollama-client.js');
        const health = await ollamaHealth();
        assert.equal(health.ok, true);
        process.env.OLLAMA_MODEL = 'qwen3:4b';
        assert.match((await ollamaHealth()).error, /not pulled/);
        process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:1';
        assert.equal((await ollamaHealth()).ok, false);
    } finally {
        delete process.env.OPENROUTER_API_KEY;
        delete process.env.OLLAMA_MODEL;
        mock.close();
    }
});

test('ollama: caption generation through the content service uses Ollama only', async () => {
    const mock = await mockOllama((_b, res) => reply(res, 'Sunset vibes ✨ #travel'));
    process.env.AI_PROVIDER = 'ollama';
    process.env.OLLAMA_BASE_URL = mock.url;
    try {
        const { generateContent } = await import('../../src/services/ai.service.js');
        const out = await generateContent('caption', 'beach sunset', { platform: 'instagram' });
        assert.deepEqual(out, { result: 'Sunset vibes ✨ #travel', provider: 'ollama' });
        assert.equal(mock.calls.length, 1);
    } finally {
        mock.close();
    }
});
