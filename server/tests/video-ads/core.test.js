import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSource, normalizeRender, captionsFromAlignment, assertWorkspaceAd, maxWords, wordCount } from '../../src/services/video-ads/validation.js';
import { draftScript } from '../../src/services/video-ads/drafts.js';
import { resolveMood } from '../../src/services/video-ads/catalog.js';
import { jobDirectory } from '../../src/services/video-ads/media.js';
import { createSpeech, startMusic, waitForMusic, musicPrompt } from '../../src/services/video-ads/providers.js';

test('product ad details need photos and a name, and only offer supported choices', () => {
    assert.throws(() => normalizeSource({ name: 'Bottle' }, 0), /photo/);
    assert.throws(() => normalizeSource({}, 1), /name/);
    for (const bad of [{ duration: 26 }, { preset: 'spinny' }, { category: 'weapons' }, { format: 'portrait' }]) assert.throws(() => normalizeSource({ name: 'Bottle', ...bad }, 1));
    const input = normalizeSource({ name: '<b>Bottle</b>', points: JSON.stringify(['One', '', 'Two', 'Three', 'Four']), website: 'https://shop.example.com/', duration: 10 }, 1);
    assert.equal(input.name, 'b Bottle /b');
    assert.deepEqual(input.points, ['One', 'Two', 'Three']);
    assert.equal(input.website, 'shop.example.com');
    assert.equal(input.cta, 'Shop now');
    assert.deepEqual(normalizeSource({ name: 'B', points: 'Fast\nLight' }, 1).points, ['Fast', 'Light']);
});
test('the starting script fits every length by dropping selling points first', () => {
    const base = { name: 'Everyday Bottle', tagline: 'Cold for 24 hours.', points: ['Leak-proof lid that never drips', 'Made from recycled steel', 'Fits every cup holder'], offer: '20% off this week', cta: 'Shop now' };
    for (const duration of [10, 15, 20, 25]) {
        const script = draftScript({ ...base, duration });
        assert.ok(wordCount(script) <= maxWords(duration), script);
        assert.match(script, /Shop now\.$/);
    }
    assert.match(draftScript({ ...base, duration: 25 }), /recycled steel/);
});
test('Auto music follows the product type and named moods reach the Treblo prompt', () => {
    assert.equal(resolveMood('auto', 'fitness'), 'energetic');
    assert.equal(resolveMood('auto', 'professional'), 'corporate');
    assert.equal(resolveMood('cinematic', 'fitness'), 'cinematic');
    assert.match(musicPrompt('energetic', 'ad', 'a gym and fitness brand'), /workout.*gym and fitness brand/);
});
test('render requires reviewed claims, a voice and a bounded script', () => {
    const input = { voiceId: 'testvoice12345', script: 'A short ad.', confirmed: true };
    assert.equal(normalizeRender(input, { duration: 15 }).music, true);
    assert.throws(() => normalizeRender({ ...input, confirmed: false }, { duration: 15 }));
    assert.throws(() => normalizeRender({ ...input, script: 'word '.repeat(31) }, { duration: 15 }));
    assert.throws(() => normalizeRender({ ...input, voiceId: '../secret' }, { duration: 15 }));
    const silent = normalizeRender({ voiceover: false, confirmed: true }, { duration: 15 });
    assert.deepEqual([silent.voiceover, silent.script, silent.voiceId, silent.captions], [false, '', '', false]);
});
test('workspace ownership and file path boundaries deny cross-tenant or traversal access', () => {
    assert.throws(() => assertWorkspaceAd({ workspaceId: 'other' }, 'mine'), { status: 404 });
    assert.throws(() => assertWorkspaceAd(null, 'mine'), { status: 404 });
    assert.throws(() => assertWorkspaceAd({}, undefined), { status: 404 });
    assert.equal(assertWorkspaceAd({ workspaceId: 'mine' }, 'mine').workspaceId, 'mine');
    assert.throws(() => jobDirectory('../../secret'));
});
test('captions use provider timings rather than estimated word durations', () => {
    const chars = [...'One two three four five six'];
    const result = captionsFromAlignment({ characters: chars, character_start_times_seconds: chars.map((_,i)=>i/10), character_end_times_seconds: chars.map((_,i)=>(i+1)/10) });
    assert.equal(result.length,2);
    assert.equal(result[0].text,'One two three four five');
    assert.equal(result[1].end, chars.length / 10);
    assert.deepEqual(captionsFromAlignment(null), []);
});
test('ElevenLabs adapter uses the selected voice and timed narration response', async () => {
    process.env.ELEVENLABS_API_KEY = 'test-secret';
    const speech = await createSpeech('Hello', 'testvoice12345', async (url, init) => {
        assert.match(url,/testvoice12345\/with-timestamps$/);
        assert.equal(init.headers['xi-api-key'],'test-secret');
        assert.equal(JSON.parse(init.body).text,'Hello');
        return { ok:true, json:async()=>({ audio_base64:Buffer.from('audio').toString('base64'), alignment:{ characters:['H'] } }) };
    });
    assert.equal(speech.audio.toString(),'audio');
});
test('provider errors never expose upstream credentials or response bodies', async () => {
    await assert.rejects(createSpeech('Hi','testvoice12345',async()=>({ok:false,status:401,json:async()=>({secret:'do-not-expose'})})), error => error.status === 502 && !error.message.includes('do-not-expose'));
});
test('Treblo sends supported instrumental parameters and resumes polling by task ID', async () => {
    process.env.TREBLO_API_KEY = 'test-secret';
    const id = await startMusic('calm',async(url,init)=>{
        assert.match(url,/generations\/v3$/);
        const body=JSON.parse(init.body);
        assert.equal(body.instrumental,true); assert.deepEqual(body.length_range,[0,30]);
        return {ok:true,json:async()=>({task_id:'task-123'})};
    });
    let calls=0;
    const audio=await waitForMusic(id,{delay:async()=>{},fetcher:async()=>({ok:true,json:async()=>++calls===1?{status:'GENERATING'}:{status:'SUCCESS',song_paths:['https://cdn.example.com/song.mp3']}}),download:async()=>({data:Buffer.from('music')})});
    assert.equal(audio.toString(),'music'); assert.equal(calls,2);
});
test('music failure and timeout fail explicitly without a silent fallback', async () => {
    await assert.rejects(waitForMusic('failed',{fetcher:async()=>({ok:true,json:async()=>({status:'FAILURE'})})}),/could not generate/);
    await assert.rejects(waitForMusic('slow',{attempts:1,delay:async()=>{},fetcher:async()=>({ok:true,json:async()=>({status:'GENERATING'})})}),/timed out/);
});
