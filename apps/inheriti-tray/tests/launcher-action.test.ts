import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    for (const [action, expected, signedOut] of [['Share with a team', 'team', false], ['Create a plan', 'team', false], ['Save privately', 'private', false], ['Save privately', '', true]] as const) {
      writeFileSync(join(directory, 'preload.js'), `window.inheritiTray={state:async()=>({status:'signed-in',selectedId:'org-1',organizations:[{id:'org-1',name:'Organization'}],teams:[{id:'team-1',name:'Team'}],assetCatalog:[]}),onStateChanged:(callback)=>{window.stateChanged=callback;return()=>{}},onHidden:()=>()=>{},onAction:(callback)=>{window.action=callback;return()=>{}},signIn:async()=>{},signOut:async()=>{},select:async()=>{},abandonCreation:async()=>{},createQuickPlan:async()=>{},openApp:async()=>{}};setTimeout(()=>window.action(${JSON.stringify(action)}),200);${signedOut ? "setTimeout(()=>window.stateChanged({status:'signed-out',organizations:[],teams:[],assetCatalog:[]}),300);" : ''}setTimeout(()=>{document.getElementById('root').dataset.audience=document.getElementById('audience')?.value||'';document.getElementById('root').dataset.team=document.getElementById('team')?.value||'';document.getElementById('root').dataset.capture=String(!!document.getElementById('capture'))},500);`);
      const html = execFileSync(chrome!, ['--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=700', '--dump-dom', `file://${join(directory, 'index.html')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      expect(html).toContain(`data-audience="${expected}"`);
      if (expected === 'team') expect(html).toContain('data-team="team-1"');
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
      setTimeout(()=>{const root=document.getElementById('root');root.dataset.nameDisabled=String(document.getElementById('asset-name').disabled);root.dataset.audienceDisabled=String(document.getElementById('audience').disabled);root.dataset.organizationAvailable=String(!!document.getElementById('organization'));root.dataset.signOutAvailable=String(!!document.getElementById('sign-out'));},450);
      setTimeout(()=>{const root=document.getElementById('root');root.dataset.review=String(!!document.getElementById('review'));root.dataset.reviewName=document.querySelector('#review .plan-summary-text small')?.textContent||'';},1050);
    `);
    const html = execFileSync(chrome!, ['--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=1200', '--dump-dom', `file://${join(directory, 'index.html')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const attribute of ['name', 'audience']) expect(html).toContain(`data-${attribute}-disabled="true"`);
    for (const attribute of ['organization', 'sign-out']) expect(html).toContain(`data-${attribute}-available="false"`);
    expect(html).toContain('data-review="true"');
    expect(html).toContain('data-review-name="Document · Document"');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it.skipIf(!chrome)('returns home immediately when an idle edit cleanup is pending', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tray-idle-edit-'));
  try {
    buildSync({ entryPoints: [resolve('src/launcher.jsx')], bundle: true, format: 'iife', jsx: 'automatic', minify: true,
      define: { 'process.env.NODE_ENV': '"production"' }, outfile: join(directory, 'launcher.js') });
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'"></head><body><div id="root"></div><script src="preload.js"></script><script src="launcher.js"></script></body></html>');
    writeFileSync(join(directory, 'preload.js'), `
      const base={status:'signed-in',selectedId:'org-1',organizations:[{id:'org-1',name:'Organization'}],teams:[],assetCatalog:[]};
      const plans=[{id:'plan-1',name:'Plan'}];
      window.inheritiTray={state:async()=>({...base,edit:{status:'idle',available:true,plans:[],assets:[]}}),onStateChanged:()=>()=>{},onHidden:()=>()=>{},onAction:()=>()=>{},
        editablePlans:async()=>({...base,edit:{status:'idle',available:true,plans,assets:[]}}),
        listPlanAssets:async()=>({...base,edit:{status:'idle',available:true,planId:'plan-1',plans,assets:[]}}),
        cancelPlanEdit:()=>new Promise(()=>{}),openApp:async()=>{}};
      setTimeout(()=>document.getElementById('add-asset')?.click(),150);
      setTimeout(()=>document.getElementById('edit-plan')?.click(),300);
      setTimeout(()=>document.querySelector('[role="option"]')?.click(),400);
      setTimeout(()=>document.querySelector('.edit-screen .tray-footer .button-secondary')?.click(),550);
      setTimeout(()=>{document.getElementById('root').dataset.home=String(!!document.querySelector('.tray-hero'));},700);
    `);
    const html = execFileSync(chrome!, ['--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=900', '--dump-dom', `file://${join(directory, 'index.html')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    expect(html).toContain('data-home="true"');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it.skipIf(!chrome)('reenables home actions after canceling an active edit', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tray-cancel-edit-'));
  try {
    buildSync({ entryPoints: [resolve('src/launcher.jsx')], bundle: true, format: 'iife', jsx: 'automatic', minify: true,
      define: { 'process.env.NODE_ENV': '"production"' }, outfile: join(directory, 'launcher.js') });
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'"></head><body><div id="root"></div><script src="preload.js"></script><script src="launcher.js"></script></body></html>');
    writeFileSync(join(directory, 'preload.js'), `
      const base={status:'signed-in',selectedId:'org-1',organizations:[{id:'org-1',name:'Organization'}],teams:[],assetCatalog:[]};
      const plans=[{id:'plan-1',name:'Plan'}];
      let publish;
      window.confirm=()=>true;
      window.inheritiTray={state:async()=>({...base,edit:{status:'idle',available:true,plans:[],assets:[]}}),onStateChanged:(callback)=>{publish=callback;return()=>{}},onHidden:()=>()=>{},onAction:()=>()=>{},
        editablePlans:async()=>({...base,edit:{status:'idle',available:true,plans,assets:[]}}),
        listPlanAssets:()=>{publish({...base,edit:{status:'loading',available:true,planId:'plan-1',plans,assets:[]}});return new Promise(()=>{});},
        cancelPlanEdit:async()=>({...base,edit:{status:'idle',available:true,plans,assets:[]}}),openApp:async()=>{}};
      setTimeout(()=>document.getElementById('add-asset')?.click(),150);
      setTimeout(()=>document.getElementById('edit-plan')?.click(),300);
      setTimeout(()=>document.querySelector('[role="option"]')?.click(),400);
      setTimeout(()=>document.querySelector('.edit-screen .tray-footer .button-secondary')?.click(),550);
      setTimeout(()=>{const root=document.getElementById('root');root.dataset.home=String(!!document.querySelector('.tray-hero'));root.dataset.createEnabled=String(!document.getElementById('save-plan')?.disabled);root.dataset.editEnabled=String(!document.getElementById('add-asset')?.disabled);root.dataset.signOutEnabled=String(!document.getElementById('sign-out')?.disabled);},750);
    `);
    const html = execFileSync(chrome!, ['--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=900', '--dump-dom', `file://${join(directory, 'index.html')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const attribute of ['home', 'create-enabled', 'edit-enabled', 'sign-out-enabled']) expect(html).toContain(`data-${attribute}="true"`);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it.skipIf(!chrome)('keeps revealed assets and selection when switching edit tabs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tray-edit-tabs-'));
  try {
    buildSync({ entryPoints: [resolve('src/launcher.jsx')], bundle: true, format: 'iife', jsx: 'automatic', minify: true,
      define: { 'process.env.NODE_ENV': '"production"' }, outfile: join(directory, 'launcher.js') });
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'"></head><body><div id="root"></div><script src="preload.js"></script><script src="launcher.js"></script></body></html>');
    writeFileSync(join(directory, 'preload.js'), `
      const base={status:'signed-in',selectedId:'org-1',organizations:[{id:'org-1',name:'Organization'}],teams:[],assetCatalog:[]};
      const plans=[{id:'plan-1',name:'Plan'}];
      const assets=[{id:'asset-1',name:'First',type:'PLAIN-TEXT'},{id:'asset-2',name:'Second',type:'PLAIN-TEXT'}];
      window.assetLoads=0;
      window.inheritiTray={state:async()=>({...base,edit:{status:'idle',available:true,plans:[],assets:[]}}),onStateChanged:()=>()=>{},onHidden:()=>()=>{},onAction:(callback)=>{window.action=callback;return()=>{}},
        editablePlans:async()=>({...base,edit:{status:'idle',available:true,plans,assets:[]}}),
        listPlanAssets:async()=>{window.assetLoads++;return {...base,edit:{status:'idle',available:true,planId:'plan-1',plans,assets}}},
        cancelPlanEdit:async()=>{},openApp:async()=>{}};
      setTimeout(()=>window.action('Add or edit an asset'),150);
      setTimeout(()=>document.getElementById('edit-plan')?.click(),300);
      setTimeout(()=>document.querySelector('[role="option"]')?.click(),400);
      setTimeout(()=>document.querySelector('input[value="asset-2"]')?.click(),500);
      setTimeout(()=>document.querySelector('.edit-mode button:first-child')?.click(),600);
      setTimeout(()=>document.querySelector('.edit-mode button:last-child')?.click(),700);
      setTimeout(()=>{const root=document.getElementById('root');root.dataset.assetLoads=String(window.assetLoads);root.dataset.selectedAsset=document.querySelector('input[value="asset-2"]')?.checked?'asset-2':'';root.dataset.editVisible=String(!!document.querySelector('.edit-asset-list'));root.dataset.comingLater=String(document.body.textContent.includes('coming in the next release'));},850);
    `);
    const html = execFileSync(chrome!, ['--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=950', '--dump-dom', `file://${join(directory, 'index.html')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    expect(html).toContain('data-asset-loads="1"');
    expect(html).toContain('data-selected-asset="asset-2"');
    expect(html).toContain('data-edit-visible="true"');
    expect(html).toContain('data-coming-later="false"');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it.skipIf(!chrome)('keeps a selected image file inside the edit panel', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tray-file-width-'));
  try {
    buildSync({ entryPoints: [resolve('src/launcher.jsx')], bundle: true, format: 'iife', jsx: 'automatic', minify: true,
      define: { 'process.env.NODE_ENV': '"production"' }, outfile: join(directory, 'launcher.js') });
    for (const name of ['launcher.css', 'plan-screens.css']) writeFileSync(join(directory, name), readFileSync(resolve('src', name)));
    writeFileSync(join(directory, 'edit-screen.css'), readFileSync(resolve('src/modules/quick-plan/ui/edit-screen.css')));
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html style="width:380px;height:608px"><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'self\'; img-src \'self\' data:"><link rel="stylesheet" href="launcher.css"><link rel="stylesheet" href="plan-screens.css"><link rel="stylesheet" href="edit-screen.css"></head><body style="width:380px;height:608px"><div id="root"></div><script src="preload.js"></script><script src="launcher.js"></script></body></html>');
    writeFileSync(join(directory, 'preload.js'), `
      const base={status:'signed-in',selectedId:'org-1',organizations:[{id:'org-1',name:'Organization'}],teams:[],assetCatalog:[{id:'IMAGE',category:'MEDIA-FILES',fields:['data','mimeType']}]};
      const plans=[{id:'plan-1',name:'Plan'}];
      window.inheritiTray={state:async()=>({...base,edit:{status:'idle',available:true,plans:[],assets:[]}}),onStateChanged:()=>()=>{},onHidden:()=>()=>{},onAction:()=>()=>{},
        editablePlans:async()=>({...base,edit:{status:'idle',available:true,plans,assets:[]}}),
        listPlanAssets:async()=>({...base,edit:{status:'idle',available:true,planId:'plan-1',plans,assets:[]}}),
        cancelPlanEdit:async()=>{},openApp:async()=>{}};
      setTimeout(()=>document.getElementById('add-asset')?.click(),150);
      setTimeout(()=>document.getElementById('edit-plan')?.click(),250);
      setTimeout(()=>document.querySelector('[role="option"]')?.click(),350);
      setTimeout(()=>document.querySelector('.edit-mode button:first-child')?.click(),450);
      setTimeout(()=>{const input=document.getElementById('asset-type');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,'IMAGE');input.dispatchEvent(new Event('change',{bubbles:true}));},550);
      setTimeout(()=>{const input=document.getElementById('asset-file');const transfer=new DataTransfer();transfer.items.add(new File(['png'],'Captura desde 2026-09-25 11-34 con nombre muy largo.png',{type:'image/png'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));},650);
      setTimeout(()=>{const root=document.getElementById('root');const scroll=document.querySelector('.edit-scroll');const file=document.querySelector('.dropzone-selection');const buttons=document.querySelector('.edit-screen #capture .buttons');const right=root.getBoundingClientRect().right;root.dataset.viewport=String(root.clientWidth);root.dataset.styled=String(getComputedStyle(scroll).overflowX==='auto');root.dataset.fileVisible=String(!!file);root.dataset.horizontalOverflow=String(scroll.scrollWidth>scroll.clientWidth);root.dataset.fileInside=String(file.getBoundingClientRect().right<=right);root.dataset.buttonsInside=String(buttons.getBoundingClientRect().right<=right);},850);
    `);
    const html = execFileSync(chrome!, ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=380,608', '--virtual-time-budget=950', '--dump-dom', `file://${join(directory, 'index.html')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    expect(html).toContain('data-viewport="380"');
    expect(html).toContain('data-styled="true"');
    expect(html).toContain('data-file-visible="true"');
    expect(html).toContain('data-horizontal-overflow="false"');
    expect(html).toContain('data-file-inside="true"');
    expect(html).toContain('data-buttons-inside="true"');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
