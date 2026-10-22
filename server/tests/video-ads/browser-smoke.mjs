// Isolated UI integration: actual component, controlled API fixtures, desktop/mobile QA.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createServer } from '../../../client/node_modules/vite/dist/node/index.js';
import puppeteer from 'puppeteer-core';
import { ensureBrowser } from '@remotion/renderer';

const root=fileURLToPath(new URL('../../../client/',import.meta.url));
const output=fileURLToPath(new URL('../../.cache/video-ads/',import.meta.url));
const file=path.join(root,'node_modules/.cache/video-ad-preview.html');
await fs.mkdir(path.dirname(file),{recursive:true});
await fs.mkdir(output,{recursive:true});
await fs.writeFile(file,`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module">
import React from 'react';
import {createRoot} from 'react-dom/client';
import Studio from '/src/pages/Marketing/VideoAdStudio.jsx';
import '/src/index.css';import '/src/pages/Marketing/Marketing.css';
createRoot(document.getElementById('root')).render(React.createElement('main',{style:{padding:'32px',maxWidth:'1280px',margin:'auto'}},React.createElement(Studio,{kit:{}})));
</script></body></html>`);
const vite=await createServer({root,server:{host:'127.0.0.1',port:5199},logLevel:'error'});
await vite.listen();
const chrome=await ensureBrowser();
const browser=await puppeteer.launch({executablePath:chrome.path,headless:true,args:['--no-sandbox']});
const page=await browser.newPage();
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
let generated=false;
const draft={id:'11111111-1111-4111-8111-111111111111',name:'Everyday Bottle',description:'A reusable bottle for your daily routine.',offerings:['Reusable bottles'],script:'Meet Everyday Bottle. Make reuse your routine. Explore the collection.',duration:20,format:'vertical',status:'draft',stage:'Review your script',progress:0,createdAt:Date.now(),scenes:[{type:'hook',headline:'Make reuse your routine',duration:5},{type:'reveal',headline:'Everyday Bottle',duration:5},{type:'feature',headline:'Ready for your everyday',duration:5},{type:'outro',headline:'Explore the collection',duration:5}]};
await page.setRequestInterception(true);
page.on('request',request=>{
    const url=request.url();
    if(!url.includes('/api/marketing/video-ads')) return void request.continue();
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS','Content-Type':'application/json'};
    if(request.method()==='OPTIONS') return void request.respond({status:204,headers});
    let body;
    if(url.endsWith('/options')) body={voices:[{id:'testvoice12345',name:'Test Voice',accent:'South African'}],configured:{voice:true,music:true}};
    else if(url.endsWith('/render')) {generated=true;body={...draft,status:'queued',stage:'Queued'};}
    else if(url.endsWith('/video-ads')) body=request.method()==='POST'?draft:{ads:[]};
    else body={...draft,status:generated?'processing':'draft',stage:'Generating voiceover',progress:25};
    void request.respond({status:200,headers,body:JSON.stringify(body)});
});
try {
    await page.setViewport({width:1440,height:1100});
    await page.goto('http://127.0.0.1:5199/node_modules/.cache/video-ad-preview.html',{waitUntil:'networkidle0',timeout:120000});
    await page.waitForSelector('input[type=url]',{timeout:60000});
    await page.type('input[type=url]','https://example.com');
    await page.click('button[type=submit], form button.btn-primary');
    await page.waitForFunction(()=>document.body.innerText.includes('Voiceover script'));
    assert.equal(await page.$eval('.video-ad-confirm input',el=>el.checked),false);
    assert.equal(await page.$eval('section.video-ad-panel button.btn-primary',el=>el.disabled),true);
    await page.screenshot({path:path.join(output,'studio-desktop.png'),fullPage:true});
    await page.click('.video-ad-confirm input');
    await page.click('section.video-ad-panel button.btn-primary');
    await page.waitForSelector('progress');
    assert.ok(generated);
    await page.setViewport({width:390,height:844});
    await page.screenshot({path:path.join(output,'studio-mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Mobile should not overflow horizontally');
    assert.deepEqual(errors,[]);
    console.log('PASS: draft review, confirmation gating, render submission, polling, desktop/mobile layout, no browser errors.');
} finally {await browser.close();await vite.close();await fs.unlink(file).catch(()=>{});}
