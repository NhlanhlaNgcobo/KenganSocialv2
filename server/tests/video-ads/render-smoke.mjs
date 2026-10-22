// Manual integration test: real Brag/Remotion/FFmpeg, generated test-tone narration.
// Uses the locally cached live Treblo sample when present; makes no paid API calls.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { FFMPEG } from '../../src/services/ffmpeg-runner.js';
import { ROOT, jobDirectory, saveJson, exists, probe } from '../../src/services/video-ads/media.js';
import { fitScenes } from '../../src/services/video-ads/validation.js';
import { renderAd } from '../../src/services/video-ads/pipeline.js';

const dir = jobDirectory(randomUUID());
await fs.mkdir(dir, { recursive: true });
const image = await sharp(Buffer.from('<svg width="900" height="1000" xmlns="http://www.w3.org/2000/svg"><rect width="900" height="1000" fill="#f5ead7"/><rect x="300" y="180" width="300" height="620" rx="70" fill="#587d64"/><rect x="365" y="120" width="170" height="100" rx="18" fill="#263e30"/><text x="450" y="465" text-anchor="middle" font-size="48" font-family="Arial" fill="white">EVERYDAY</text><text x="450" y="520" text-anchor="middle" font-size="28" font-family="Arial" fill="white">REUSABLE BOTTLE</text></svg>')).jpeg().toBuffer();
const source = { name: 'Everyday Bottle', title: 'Everyday Bottle', description: 'A reusable bottle for your daily routine.', screenshots: [`data:image/jpeg;base64,${image.toString('base64')}`], colors: { background: '#f5ead7', text: '#263e30', accent: '#587d64' }, productPhotos: true };
const plan = { productName: 'Everyday Bottle', tone: 'polished', scenes: fitScenes([
    { type:'hook', headline:'Make reuse your routine', duration:3 },
    { type:'reveal', headline:'Everyday Bottle', screenshot:0, duration:4 },
    { type:'feature', headline:'Ready for your everyday', screenshot:0, duration:4 },
    { type:'outro', headline:'Everyday Bottle', cta:'Explore the collection', duration:4 },
],25) };
await saveJson(dir,'draft.json',{input:{duration:25,format:'vertical'},source,plan});
const liveSpeech=await exists(path.join(ROOT,'live-speech.mp3'));
if(liveSpeech) await fs.copyFile(path.join(ROOT,'live-speech.mp3'),path.join(dir,'speech.mp3'));
else await promisify(execFile)(FFMPEG,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','sine=frequency=440:duration=4','-af','volume=0.1','-c:a','libmp3lame',path.join(dir,'speech.mp3')],{windowsHide:true});
const text=[...'This is a render test.'];
if(liveSpeech) await fs.copyFile(path.join(ROOT,'live-speech-alignment.json'),path.join(dir,'alignment.json'));
else await saveJson(dir,'alignment.json',{characters:text,character_start_times_seconds:text.map((_,i)=>i*.15),character_end_times_seconds:text.map((_,i)=>(i+1)*.15)});
const liveMusic=path.join(ROOT,'live-music.mp3');
const hasMusic=await exists(liveMusic);
if(hasMusic) await fs.copyFile(liveMusic,path.join(dir,'music-original.mp3'));
let last=-1;
const result=await renderAd(dir,{script:'This is a render test.',voiceId:'fixture',music:hasMusic,mood:'upbeat',captions:true},async(stage,progress)=>{if(Math.floor(progress/10)!==last){last=Math.floor(progress/10);console.log(`${stage}: ${progress}%`)}});
const metadata=await probe(path.join(dir,'ad.mp4'));
await saveJson(ROOT,'render-smoke-result.json',{dir,...result,liveSpeech,liveMusic:hasMusic,streams:metadata.streams.map(s=>({type:s.codec_type,codec:s.codec_name}))});
console.log(JSON.stringify({dir,...result,liveSpeech,liveMusic:hasMusic}));
