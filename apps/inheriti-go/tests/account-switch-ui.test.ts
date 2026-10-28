import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildSync } from 'esbuild';
import { expect, it } from 'vitest';

const chrome = ['google-chrome', 'chromium'].find((binary) => {
  try { execFileSync('which', [binary]); return true; } catch { return false; }
});

it.skipIf(!chrome)('confirms account and organisation before switching and keeps the original on cancel', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tray-account-switch-'));
  try {
    buildSync({ entryPoints: [resolve('src/launcher.jsx')], bundle: true, format: 'iife', jsx: 'automatic', minify: true,
      define: { 'process.env.NODE_ENV': '"production"' }, outfile: join(directory, 'launcher.js') });
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'"></head><body><div id="root"></div><script src="preload.js"></script><script src="launcher.js"></script></body></html>');
    writeFileSync(join(directory, 'preload.js'), `
      const accounts=[{subject:'a',name:'Alice',status:'ready',organizations:[{id:'org-a',name:'Shared Company'}]},
        {subject:'b',name:'Bob',status:'ready',organizations:[{id:'org-b',name:'Shared Company'}]}];
      const base={status:'signed-in',activeSubject:'a',accountName:'Alice',selectedId:'org-a',
        organizations:accounts[0].organizations,accounts,teams:[{id:'team-a',name:'Alice team'}],
        assetCatalog:[{id:'DOCUMENT',fields:[]}],edit:{status:'idle'}};
      let current=base,calls=0;
      window.inheritiTray={state:async()=>current,onStateChanged:(callback)=>{window.stateChanged=callback;return()=>{}},
        onHidden:()=>()=>{},onAction:()=>()=>{},onInboxChanged:()=>()=>{},onInboxStateChanged:()=>()=>{},
        inboxState:async()=>({status:'error'}),version:async()=>'',updateProgress:async()=>null,onUpdateProgress:()=>()=>{},
        activateAccount:async(subject)=>{calls++;current={...base,activeSubject:subject,accountName:'Bob',
          selectedId:undefined,organizations:accounts[1].organizations,teams:[{id:'team-b',name:'Bob team'}]};window.stateChanged(current);return current},
        select:async(id)=>{current={...current,selectedId:id};window.stateChanged(current);return current},
        signOut:async()=>current,openApp:async()=>{}};
      const bob=()=>Array.from(document.querySelectorAll('.tray-account-group')).find((card)=>card.textContent.includes('Bob'))?.querySelector('button');
      setTimeout(()=>bob()?.click(),150);
      setTimeout(()=>{const root=document.getElementById('root');root.dataset.confirm=String(document.body.textContent.includes('Account: Bob')&&document.body.textContent.includes('Organisation: Shared Company'));root.dataset.before=String(calls);document.querySelector('.tray-account-confirmation button')?.click()},300);
      setTimeout(()=>{document.getElementById('root').dataset.cancel=String(calls===0&&!!bob());bob()?.click()},450);
      setTimeout(()=>Array.from(document.querySelectorAll('.tray-account-confirmation button')).find((button)=>button.textContent==='Switch account')?.click(),600);
      setTimeout(()=>{const root=document.getElementById('root');root.dataset.after=String(calls);root.dataset.active=String(current.activeSubject);root.dataset.selected=String(current.selectedId)},850);
      setTimeout(()=>document.getElementById('save-plan')?.click(),950);
      setTimeout(()=>{document.getElementById('root').dataset.team=String(document.getElementById('team')?.value)},1100);
    `);
    const html = execFileSync(chrome!, ['--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=1250', '--dump-dom', `file://${join(directory, 'index.html')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    expect(html).toContain('data-confirm="true"');
    expect(html).toContain('data-before="0"');
    expect(html).toContain('data-cancel="true"');
    expect(html).toContain('data-after="1"');
    expect(html).toContain('data-active="b"');
    expect(html).toContain('data-selected="org-b"');
    expect(html).toContain('data-team="team-b"');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it.skipIf(!chrome)('offers a saved account after sign out and switches without OAuth', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tray-signed-out-switch-'));
  try {
    buildSync({ entryPoints: [resolve('src/launcher.jsx')], bundle: true, format: 'iife', jsx: 'automatic', minify: true,
      define: { 'process.env.NODE_ENV': '"production"' }, outfile: join(directory, 'launcher.js') });
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'"></head><body><div id="root"></div><script src="preload.js"></script><script src="launcher.js"></script></body></html>');
    writeFileSync(join(directory, 'preload.js'), `
      const accounts=[{subject:'a',name:'Alice',status:'ready',organizations:[]},
        {subject:'b',name:'Bob',status:'ready',organizations:[]}];
      let current={status:'signed-out',activeSubject:'a',accounts,organizations:[],teams:[],assetCatalog:[],edit:{status:'idle'}};
      let activations=0,signIns=0;
      window.inheritiTray={state:async()=>current,onStateChanged:(callback)=>{window.stateChanged=callback;return()=>{}},
        onHidden:()=>()=>{},onAction:()=>()=>{},onInboxChanged:()=>()=>{},onInboxStateChanged:()=>()=>{},
        inboxState:async()=>({status:'error'}),version:async()=>'',updateProgress:async()=>null,onUpdateProgress:()=>()=>{},
        activateAccount:async(subject)=>{activations++;current={...current,status:'signed-in',activeSubject:subject,accountName:'Bob'};window.stateChanged(current);return current},
        signIn:async()=>{signIns++;return current},openApp:async()=>{}};
      setTimeout(()=>{const root=document.getElementById('root');root.dataset.saved=String(document.body.textContent.includes('Saved accounts'));
        Array.from(document.querySelectorAll('.tray-recovery-accounts button')).find((button)=>button.textContent==='Switch')?.click()},150);
      setTimeout(()=>{const root=document.getElementById('root');root.dataset.confirm=String(document.body.textContent.includes('Account: Bob'));
        Array.from(document.querySelectorAll('.tray-account-confirmation button')).find((button)=>button.textContent==='Switch account')?.click()},300);
      setTimeout(()=>{const root=document.getElementById('root');root.dataset.activations=String(activations);
        root.dataset.signIns=String(signIns);root.dataset.active=String(current.activeSubject)},650);
    `);
    const html = execFileSync(chrome!, ['--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=800', '--dump-dom', `file://${join(directory, 'index.html')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    expect(html).toContain('data-saved="true"');
    expect(html).toContain('data-confirm="true"');
    expect(html).toContain('data-activations="1"');
    expect(html).toContain('data-sign-ins="0"');
    expect(html).toContain('data-active="b"');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it.skipIf(!chrome)('drops account A tray actions queued during Add Account before B becomes active', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tray-account-actions-'));
  try {
    buildSync({ entryPoints: [resolve('src/launcher.jsx')], bundle: true, format: 'iife', jsx: 'automatic', minify: true,
      define: { 'process.env.NODE_ENV': '"production"' }, outfile: join(directory, 'launcher.js') });
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'"></head><body><div id="root"></div><script src="preload.js"></script><script src="launcher.js"></script></body></html>');
    writeFileSync(join(directory, 'preload.js'), `
      const accounts=[{subject:'a',name:'Alice',status:'ready',organizations:[{id:'org-a',name:'Alice Company'}]},
        {subject:'b',name:'Bob',status:'ready',organizations:[{id:'org-b',name:'Bob Company'}]}];
      const base={status:'signed-in',activeSubject:'a',accountName:'Alice',selectedId:'org-a',accounts,
        organizations:accounts[0].organizations,teams:[],assetCatalog:[{id:'DOCUMENT',fields:[]}],edit:{status:'idle'}};
      let current=base;const actionCallbacks=new Set();
      window.inheritiTray={state:async()=>current,onStateChanged:(callback)=>{window.stateChanged=callback;return()=>{}},
        onHidden:()=>()=>{},onAction:(callback)=>{actionCallbacks.add(callback);return()=>actionCallbacks.delete(callback)},onInboxChanged:()=>()=>{},onInboxStateChanged:()=>()=>{},
        inboxState:async()=>({status:'error'}),version:async()=>'',updateProgress:async()=>null,onUpdateProgress:()=>()=>{},
        addAccount:async()=>{current={...current,status:'authorizing'};window.stateChanged(current);return new Promise((resolve)=>{window.finishAdd=resolve})},
        signOut:async()=>current,openApp:async()=>{}};
      setTimeout(()=>document.getElementById('add-account')?.click(),150);
      setTimeout(()=>{for(const callback of actionCallbacks) callback('Save privately');
        for(const callback of actionCallbacks) callback({kind:'OPEN_INBOX',organizationId:'org-a',conversationId:'conversation-a'})},300);
      setTimeout(()=>{current={...base,activeSubject:'b',accountName:'Bob',selectedId:'org-b',organizations:accounts[1].organizations};
        window.stateChanged(current);window.finishAdd(current)},350);
      setTimeout(()=>{const root=document.getElementById('root');root.dataset.active=String(current.activeSubject);
        root.dataset.capture=String(!!document.getElementById('capture'));
        root.dataset.inbox=String(!!document.querySelector('.tray-inbox'));
        root.dataset.home=String(!!document.getElementById('save-plan'))},650);
      setTimeout(()=>{for(const callback of actionCallbacks) callback('Save privately')},700);
      setTimeout(()=>{document.getElementById('root').dataset.bAction=String(!!document.getElementById('capture'))},900);
    `);
    const html = execFileSync(chrome!, ['--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=1050', '--dump-dom', `file://${join(directory, 'index.html')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    expect(html).toContain('data-active="b"');
    expect(html).toContain('data-capture="false"');
    expect(html).toContain('data-inbox="false"');
    expect(html).toContain('data-home="true"');
    expect(html).toContain('data-b-action="true"');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
