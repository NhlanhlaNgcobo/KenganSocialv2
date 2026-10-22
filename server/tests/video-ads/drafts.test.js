import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { prepareDraft } from '../../src/services/video-ads/drafts.js';
import { fallbackPlan } from '../../src/services/brag/plan.js';
import { normalizeSource } from '../../src/services/video-ads/validation.js';

const plan=async(source,options)=>({plan:fallbackPlan(source,options.tone,options.duration)});
test('website focus excludes unrelated source claims even without an AI provider',async()=>{
    const draft=await prepareDraft(normalizeSource({url:'https://example.com',name:'Design service',description:'Website design for small businesses. Book a consultation.',duration:15}),[],{}, {
        inspect:async()=>({title:'Unrelated original title',description:'We sell unrelated diamonds.',headings:['Diamonds'],paragraphs:['Our diamonds sparkle.'],screenshots:[],colors:{},sections:[{heading:'Diamonds',text:'Buy diamonds'}]}),plan,
    });
    assert.ok(!draft.script.toLowerCase().includes('diamond'));
    assert.ok(!draft.plan.scenes.some(scene=>scene.headline.toLowerCase().includes('diamond')));
    assert.deepEqual(draft.offerings,['Diamonds']);
    assert.equal(draft.plan.scenes.reduce((sum,s)=>sum+Math.round(s.duration*30),0),450);
});
test('image uploads are decoded and re-encoded; corrupt images are refused',async()=>{
    const input=normalizeSource({name:'Bottle',description:'A reusable bottle for everyday use.'},1);
    const buffer=await sharp({create:{width:80,height:80,channels:3,background:'#587d64'}}).png().toBuffer();
    const draft=await prepareDraft(input,[{buffer}],{}, {plan});
    assert.ok(draft.source.productPhotos);
    assert.match(draft.source.screenshots[0],/^data:image\/jpeg;base64,/);
    await assert.rejects(prepareDraft(input,[{buffer:Buffer.from('not an image')}],{},{plan}));
});
test('website extraction blocks private destinations before launching Chrome',async()=>{
    await assert.rejects(prepareDraft(normalizeSource({url:'http://127.0.0.1/admin'}),[],{}, {plan}),/private network/i);
});
