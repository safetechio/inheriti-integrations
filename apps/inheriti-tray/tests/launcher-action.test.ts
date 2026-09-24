import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildSync } from 'esbuild';
import { expect, it } from 'vitest';

const chrome = ['google-chrome', 'chromium'].find((binary) => {
  try { execFileSync('which', [binary]); return true; } catch { return false; }
});

it.skipIf(!chrome)('opens private and team capture for their tray actions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tray-react-'));
  try {
    buildSync({ entryPoints: [resolve('src/launcher.jsx')], bundle: true, format: 'iife', jsx: 'automatic', minify: true,
      define: { 'process.env.NODE_ENV': '"production"' }, outfile: join(directory, 'launcher.js') });
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'"></head><body><div id="root"></div><script src="preload.js"></script><script src="launcher.js"></script></body></html>');
    for (const [action, expected, signedOut] of [['Share with a team', 'team', false], ['Save privately', 'private', false], ['Save privately', '', true]] as const) {
      writeFileSync(join(directory, 'preload.js'), `window.inheritiTray={state:async()=>({status:'signed-in',selectedId:'org-1',organizations:[{id:'org-1',name:'Organization'}],teams:[{id:'team-1',name:'Team'}],assetCatalog:[]}),onStateChanged:(callback)=>{window.stateChanged=callback;return()=>{}},onHidden:()=>()=>{},onAction:(callback)=>{window.action=callback;return()=>{}},signIn:async()=>{},signOut:async()=>{},select:async()=>{},abandonCreation:async()=>{},createQuickPlan:async()=>{},openApp:async()=>{}};setTimeout(()=>window.action(${JSON.stringify(action)}),200);${signedOut ? "setTimeout(()=>window.stateChanged({status:'signed-out',organizations:[],teams:[],assetCatalog:[]}),300);" : ''}setTimeout(()=>{document.getElementById('root').dataset.audience=document.getElementById('audience')?.value||'';document.getElementById('root').dataset.capture=String(!!document.getElementById('capture'))},500);`);
      const html = execFileSync(chrome!, ['--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=700', '--dump-dom', `file://${join(directory, 'index.html')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      expect(html).toContain(`data-audience="${expected}"`);
      if (signedOut) expect(html).toContain('data-capture="false"');
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it.skipIf(!chrome)('does not show the previous Ready state during a delayed failed second plan', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tray-next-'));
  try {
    buildSync({ entryPoints: [resolve('src/launcher.jsx')], bundle: true, format: 'iife', jsx: 'automatic', minify: true,
      define: { 'process.env.NODE_ENV': '"production"' }, outfile: join(directory, 'launcher.js') });
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'"></head><body><div id="root"></div><script src="preload.js"></script><script src="launcher.js"></script></body></html>');
    writeFileSync(join(directory, 'preload.js'), `
      window.inheritiTray={state:async()=>({status:'signed-in',selectedId:'org-1',organizations:[{id:'org-1',name:'Organization'}],teams:[],assetCatalog:[{id:'PLAIN-TEXT',fields:['text']}],creation:{status:'ready',planId:'old-plan'}}),onStateChanged:()=>()=>{},onHidden:()=>()=>{},onAction:()=>()=>{},signIn:async()=>{},signOut:async()=>{},select:async()=>{},abandonCreation:async()=>{},createQuickPlan:()=>new Promise((_,reject)=>setTimeout(()=>reject(new Error('second failed')),500)),openApp:async()=>{}};
      function fill(id,value){const input=document.getElementById(id);const prototype=input instanceof HTMLSelectElement?HTMLSelectElement.prototype:input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(input,value);input.dispatchEvent(new Event(input instanceof HTMLSelectElement?'change':'input',{bubbles:true}));}
      setTimeout(()=>document.getElementById('save-plan').click(),150);
      setTimeout(()=>{fill('title','Second');fill('asset-type','PLAIN-TEXT');fill('asset-name','Note');fill('asset-text','secret');},250);
      setTimeout(()=>document.getElementById('capture').requestSubmit(),350);
      setTimeout(()=>document.getElementById('submit-capture')?.click(),450);
      setTimeout(()=>{document.getElementById('root').dataset.readyBefore=String(!!document.getElementById('ready'));},550);
      setTimeout(()=>{document.getElementById('root').dataset.readyAfter=String(!!document.getElementById('ready'));document.getElementById('root').dataset.reviewAfter=String(!!document.getElementById('review'));},1050);
    `);
    const html = execFileSync(chrome!, ['--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=1200', '--dump-dom', `file://${join(directory, 'index.html')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    expect(html).toContain('data-ready-before="false"');
    expect(html).toContain('data-ready-after="false"');
    expect(html).toContain('data-review-after="true"');
    expect(html).toContain('second failed');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


it.skipIf(!chrome)('locks capture details while a file is being prepared', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tray-file-'));
  try {
    buildSync({ entryPoints: [resolve('src/launcher.jsx')], bundle: true, format: 'iife', jsx: 'automatic', minify: true,
      define: { 'process.env.NODE_ENV': '"production"' }, outfile: join(directory, 'launcher.js') });
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'"></head><body><div id="root"></div><script src="preload.js"></script><script src="launcher.js"></script></body></html>');
    writeFileSync(join(directory, 'preload.js'), `
      const organizations=[{id:'org-1',name:'First'},{id:'org-2',name:'Second'}];
      const base={status:'signed-in',organizations,teams:[],assetCatalog:[{id:'DOCUMENT',category:'MEDIA-FILES',fields:['data','mimeType']}]};
      window.inheritiTray={state:async()=>({...base,selectedId:'org-1'}),onStateChanged:()=>()=>{},onHidden:()=>()=>{},onAction:()=>()=>{},signIn:async()=>{},signOut:async()=>({status:'signed-out',organizations:[],teams:[],assetCatalog:[]}),select:async(id)=>({...base,selectedId:id}),abandonCreation:async()=>{},createQuickPlan:async()=>{},openApp:async()=>{}};
      window.FileReader=class{readAsDataURL(){setTimeout(()=>{this.result='data:application/pdf;base64,YWJj';this.onload();},500)}};
      function fill(id,value){const input=document.getElementById(id);const prototype=input instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(input,value);input.dispatchEvent(new Event(input instanceof HTMLSelectElement?'change':'input',{bubbles:true}));}
      setTimeout(()=>document.getElementById('save-plan').click(),150);
      setTimeout(()=>{fill('title','File');fill('asset-type','DOCUMENT');fill('asset-name','Document');const transfer=new DataTransfer();transfer.items.add(new File(['abc'],'sample.pdf',{type:'application/pdf'}));const file=document.getElementById('asset-file');file.files=transfer.files;file.dispatchEvent(new Event('change',{bubbles:true}));},250);
      setTimeout(()=>document.getElementById('capture').requestSubmit(),350);
      setTimeout(()=>{const root=document.getElementById('root');root.dataset.nameDisabled=String(document.getElementById('asset-name').disabled);root.dataset.audienceDisabled=String(document.getElementById('audience').disabled);root.dataset.organizationDisabled=String(document.getElementById('organization').disabled);root.dataset.signOutDisabled=String(document.getElementById('sign-out').disabled);},450);
      setTimeout(()=>{const root=document.getElementById('root');root.dataset.review=String(!!document.getElementById('review'));root.dataset.reviewName=document.querySelector('#review dd:last-child')?.textContent||'';},1050);
    `);
    const html = execFileSync(chrome!, ['--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=1200', '--dump-dom', `file://${join(directory, 'index.html')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const attribute of ['name', 'audience', 'organization', 'sign-out']) expect(html).toContain(`data-${attribute}-disabled="true"`);
    expect(html).toContain('data-review="true"');
    expect(html).toContain('data-review-name="Document"');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
