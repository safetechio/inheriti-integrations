import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildSync } from 'esbuild';
import { expect, it } from 'vitest';

const chrome = ['google-chrome', 'chromium'].find((binary) => {
  try { execFileSync('which', [binary]); return true; } catch { return false; }
});

it.skipIf(!chrome)('single-account logout signs out that account without the all-accounts confirmation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tray-single-sign-out-'));
  try {
    buildSync({ entryPoints: [resolve('src/launcher.jsx')], bundle: true, format: 'iife', jsx: 'automatic', minify: true,
      define: { 'process.env.NODE_ENV': '"production"' }, outfile: join(directory, 'launcher.js') });
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'"></head><body><div id="root"></div><script src="preload.js"></script><script src="launcher.js"></script></body></html>');
    writeFileSync(join(directory, 'preload.js'), `
      const base={status:'signed-in',activeSubject:'a',accountName:'Alice',selectedId:'org-a',
        accounts:[{subject:'a',name:'Alice',status:'ready',organizations:[{id:'org-a',name:'Company A'}]}],
        organizations:[{id:'org-a',name:'Company A'}],teams:[],assetCatalog:[],edit:{status:'idle'}};
      let current=base, singleCalls=0, allCalls=0;
      window.inheritiTray={state:async()=>current,onStateChanged:(callback)=>{window.stateChanged=callback;return()=>{}},
        onHidden:()=>()=>{},onAction:()=>()=>{},onInboxChanged:()=>()=>{},onInboxStateChanged:()=>()=>{},
        inboxState:async()=>({status:'error'}),version:async()=>'',updateProgress:async()=>null,onUpdateProgress:()=>()=>{},
        signOut:async()=>{singleCalls++;current={...base,status:'signed-out',activeSubject:undefined,accounts:[],organizations:[],selectedId:undefined};window.stateChanged(current);return current},
        signOutAll:async()=>{allCalls++;return current},openApp:async()=>{}};
      setTimeout(()=>{const root=document.getElementById('root');root.dataset.oneButton=String(!!document.getElementById('sign-out')&&!document.getElementById('sign-out-all'));document.getElementById('sign-out')?.click()},150);
      setTimeout(()=>{const root=document.getElementById('root');root.dataset.single=String(singleCalls);root.dataset.all=String(allCalls);
        root.dataset.confirm=String(!!document.querySelector('.tray-sign-out-confirmation'))},450);
    `);
    const html = execFileSync(chrome!, ['--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=600', '--dump-dom', `file://${join(directory, 'index.html')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    expect(html).toContain('data-one-button="true"');
    expect(html).toContain('data-single="1"');
    expect(html).toContain('data-all="0"');
    expect(html).toContain('data-confirm="false"');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it.skipIf(!chrome)('requires confirmation before removing every saved account', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tray-sign-out-all-'));
  try {
    buildSync({ entryPoints: [resolve('src/launcher.jsx')], bundle: true, format: 'iife', jsx: 'automatic', minify: true,
      define: { 'process.env.NODE_ENV': '"production"' }, outfile: join(directory, 'launcher.js') });
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'"></head><body><div id="root"></div><script src="preload.js"></script><script src="launcher.js"></script></body></html>');
    writeFileSync(join(directory, 'preload.js'), `
      const base={status:'signed-in',activeSubject:'a',accountName:'Alice',selectedId:'org-a',
        accounts:[{subject:'a',name:'Alice',status:'ready',organizations:[{id:'org-a',name:'Company A'}]},
          {subject:'b',name:'Bob',status:'ready',organizations:[{id:'org-b',name:'Company B'}]}],
        organizations:[{id:'org-a',name:'Company A'}],teams:[],assetCatalog:[{id:'DOCUMENT',fields:[]}],edit:{status:'idle'}};
      let current=base,calls=0;
      window.inheritiTray={state:async()=>current,onStateChanged:(callback)=>{window.stateChanged=callback;return()=>{}},
        onHidden:()=>()=>{},onAction:()=>()=>{},onInboxChanged:()=>()=>{},onInboxStateChanged:()=>()=>{},
        inboxState:async()=>({status:'error'}),version:async()=>'',updateProgress:async()=>null,onUpdateProgress:()=>()=>{},
        signOutAll:async()=>{calls++;current={...base,status:'signed-out',activeSubject:undefined,accounts:[],organizations:[],selectedId:undefined};window.stateChanged(current);return current},
        signOut:async()=>current,openApp:async()=>{}};
      setTimeout(()=>{document.querySelector('.tray-account-menu summary')?.click();document.getElementById('sign-out-all')?.click()},150);
      setTimeout(()=>{const root=document.getElementById('root');root.dataset.confirm=String(document.body.textContent.includes('every saved account and its organisation keys'));
        root.dataset.menuClosed=String(!document.querySelector('.tray-account-menu')?.open);root.dataset.before=String(calls);document.querySelector('.tray-account-confirmation button')?.click()},300);
      setTimeout(()=>{const root=document.getElementById('root');root.dataset.cancel=String(calls===0&&!!document.getElementById('sign-out-all'));
        document.querySelector('.tray-account-menu summary')?.click();document.getElementById('sign-out-all')?.click()},450);
      setTimeout(()=>Array.from(document.querySelectorAll('.tray-account-confirmation button')).find((button)=>button.textContent==='Sign out all')?.click(),600);
      setTimeout(()=>{const root=document.getElementById('root');root.dataset.after=String(calls);root.dataset.saved=String(!!document.querySelector('.tray-recovery-accounts'))},850);
    `);
    const html = execFileSync(chrome!, ['--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=1000', '--dump-dom', `file://${join(directory, 'index.html')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    expect(html).toContain('data-confirm="true"');
    expect(html).toContain('data-menu-closed="true"');
    expect(html).toContain('data-before="0"');
    expect(html).toContain('data-cancel="true"');
    expect(html).toContain('data-after="1"');
    expect(html).toContain('data-saved="false"');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it.skipIf(!chrome)('unlinks one account after confirmation and offers a choice when the active account is removed', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tray-unlink-account-'));
  try {
    buildSync({ entryPoints: [resolve('src/launcher.jsx')], bundle: true, format: 'iife', jsx: 'automatic', minify: true,
      define: { 'process.env.NODE_ENV': '"production"' }, outfile: join(directory, 'launcher.js') });
    writeFileSync(join(directory, 'style.css'), readFileSync(resolve('src/launcher.css')));
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'self\'"><link rel="stylesheet" href="style.css"></head><body><div id="root"></div><script src="preload.js"></script><script src="launcher.js"></script></body></html>');
    writeFileSync(join(directory, 'preload.js'), `
      const accounts=[{subject:'a',name:'Alice',status:'ready',organizations:[{id:'org-a',name:'A'}]},
        {subject:'b',name:'Bob',status:'ready',organizations:[{id:'org-b',name:'B'}]},
        {subject:'c',name:'Carol',status:'ready',organizations:[{id:'org-c',name:'C'}]}];
      let current={status:'signed-in',activeSubject:'a',accountName:'Alice',selectedId:'org-a',
        accounts,organizations:accounts[0].organizations,teams:[],assetCatalog:[],edit:{status:'idle'}}, calls=[];
      window.inheritiTray={state:async()=>current,onStateChanged:(callback)=>{window.stateChanged=callback;return()=>{}},
        onHidden:()=>()=>{},onAction:()=>()=>{},onInboxChanged:()=>()=>{},onInboxStateChanged:()=>()=>{},
        inboxState:async()=>({status:'error'}),version:async()=>'',updateProgress:async()=>null,onUpdateProgress:()=>()=>{},
        removeAccount:async(subject)=>{calls.push(subject);current={...current,accounts:current.accounts.filter((account)=>account.subject!==subject)};
          if(subject===current.activeSubject) current={...current,status:'signed-out',activeSubject:undefined,selectedId:undefined,organizations:[]};
          window.stateChanged(current);return current},openApp:async()=>{}};
      const openMenu=()=>document.querySelector('.tray-account-menu summary')?.click();
      const remove=(name)=>Array.from(document.querySelectorAll('.tray-account-remove')).find((button)=>button.getAttribute('aria-label')?.includes(name))?.click();
      const confirm=()=>Array.from(document.querySelectorAll('dialog button')).find((button)=>button.textContent==='Unlink account')?.click();
      setTimeout(()=>{openMenu();const button=Array.from(document.querySelectorAll('.tray-account-remove')).find((item)=>item.getAttribute('aria-label')?.includes('Bob'));
        const root=document.getElementById('root');root.dataset.quiet=String(getComputedStyle(button).opacity===(matchMedia('(hover: none)').matches?'1':'0'));
        root.dataset.slot=String(button.getBoundingClientRect().width===28);
        root.dataset.align=String(Math.abs(document.querySelector('.tray-account-option .tray-account-avatar').getBoundingClientRect().left-document.querySelector('#add-account span').getBoundingClientRect().left)<1);
        button.focus();root.dataset.focus=String(getComputedStyle(button).opacity==='1');remove('Bob')},150);
      setTimeout(()=>{document.getElementById('root').dataset.before=String(calls.length);document.querySelector('.tray-account-dialog-cancel')?.click()},300);
      setTimeout(()=>{openMenu();remove('Bob')},450);
      setTimeout(confirm,550);
      setTimeout(()=>{const root=document.getElementById('root');root.dataset.secondary=String(calls.join(',')==='b'&&current.status==='signed-in'&&current.activeSubject==='a');
        openMenu();remove('Alice')},700);
      setTimeout(()=>{document.getElementById('root').dataset.modal=String(!!document.querySelector('dialog[open]')&&document.body.textContent.includes('Choose another saved account'));confirm()},850);
      setTimeout(()=>{const root=document.getElementById('root');root.dataset.calls=calls.join(',');root.dataset.chooser=String(!!document.querySelector('.tray-recovery-accounts')&&!!document.getElementById('sign-in')&&document.body.textContent.includes('Carol')&&!document.querySelector('dialog[open]'))},1050);
    `);
    const html = execFileSync(chrome!, ['--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=1200', '--dump-dom', `file://${join(directory, 'index.html')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    expect(html).toContain('data-before="0"');
    expect(html).toContain('data-quiet="true"');
    expect(html).toContain('data-slot="true"');
    expect(html).toContain('data-align="true"');
    expect(html).toContain('data-focus="true"');
    expect(html).toContain('data-secondary="true"');
    expect(html).toContain('data-modal="true"');
    expect(html).toContain('data-calls="b,a"');
    expect(html).toContain('data-chooser="true"');
  } finally { rmSync(directory, { recursive: true, force: true }); }
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
        activateAccount:async(subject)=>{calls++;await new Promise((resolve)=>setTimeout(resolve,150));current={...base,activeSubject:subject,accountName:'Bob',
          selectedId:undefined,organizations:accounts[1].organizations,teams:[{id:'team-b',name:'Bob team'}]};window.stateChanged(current);return current},
        select:async(id)=>{current={...current,selectedId:id};window.stateChanged(current);return current},
        signOut:async()=>current,openApp:async()=>{}};
      const bob=()=>Array.from(document.querySelectorAll('.tray-account-option')).find((button)=>button.textContent.includes('Bob'));
      setTimeout(()=>{document.querySelector('.tray-account-menu summary')?.click();bob()?.click()},150);
      setTimeout(()=>{const root=document.getElementById('root');root.dataset.confirm=String(!!document.querySelector('dialog[open]')&&!!document.querySelector('.tray-home')&&document.body.textContent.includes('Account: Bob')&&document.body.textContent.includes('Choose after switching'));root.dataset.before=String(calls);document.querySelector('.tray-account-confirmation button')?.click()},300);
      setTimeout(()=>{document.getElementById('root').dataset.cancel=String(calls===0&&!!bob());bob()?.click()},450);
      setTimeout(()=>Array.from(document.querySelectorAll('.tray-account-confirmation button')).find((button)=>button.textContent==='Switch account')?.click(),600);
      setTimeout(()=>{document.getElementById('root').dataset.progress=String(!!document.querySelector('dialog[open] .tray-account-dialog-progress')&&!document.querySelector('.tray-account-dialog-actions'))},675);
      setTimeout(()=>{const select=document.getElementById('organization');select.value='org-b';select.dispatchEvent(new Event('change',{bubbles:true}))},850);
      setTimeout(()=>{const root=document.getElementById('root');root.dataset.after=String(calls);root.dataset.active=String(current.activeSubject);root.dataset.selected=String(current.selectedId)},1000);
      setTimeout(()=>document.getElementById('save-plan')?.click(),1100);
      setTimeout(()=>{document.getElementById('root').dataset.team=String(document.getElementById('team')?.value)},1250);
    `);
    const html = execFileSync(chrome!, ['--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=1400', '--dump-dom', `file://${join(directory, 'index.html')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    expect(html).toContain('data-confirm="true"');
    expect(html).toContain('data-before="0"');
    expect(html).toContain('data-cancel="true"');
    expect(html).toContain('data-progress="true"');
    expect(html).toContain('data-after="1"');
    expect(html).toContain('data-active="b"');
    expect(html).toContain('data-selected="org-b"');
    expect(html).toContain('data-team="team-b"');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it.skipIf(!chrome)('disambiguates duplicate organisation names without changing their selected IDs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tray-duplicate-organizations-'));
  try {
    buildSync({ entryPoints: [resolve('src/launcher.jsx')], bundle: true, format: 'iife', jsx: 'automatic', minify: true,
      define: { 'process.env.NODE_ENV': '"production"' }, outfile: join(directory, 'launcher.js') });
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'"></head><body><div id="root"></div><script src="preload.js"></script><script src="launcher.js"></script></body></html>');
    writeFileSync(join(directory, 'preload.js'), `
      const managerOrganizations=[{id:'org-a-11111111',name:'Shared Company'},{id:'org-b-22222222',name:'Shared Company'}];
      const accounts=[{subject:'a',name:'Alice',status:'ready',organizations:[{id:'org-owner',name:'Shared Company'}]},
        {subject:'b',name:'Bob',status:'ready',organizations:managerOrganizations}];
      let current={status:'signed-in',activeSubject:'a',accountName:'Alice',selectedId:'org-owner',
        organizations:accounts[0].organizations,accounts,teams:[],assetCatalog:[],edit:{status:'idle'}};
      window.inheritiTray={state:async()=>current,onStateChanged:(callback)=>{window.stateChanged=callback;return()=>{}},
        onHidden:()=>()=>{},onAction:()=>()=>{},onInboxChanged:()=>()=>{},onInboxStateChanged:()=>()=>{},
        inboxState:async()=>({status:'error'}),version:async()=>'',updateProgress:async()=>null,onUpdateProgress:()=>()=>{},
        activateAccount:async(subject)=>{current={...current,activeSubject:subject,accountName:'Bob',selectedId:undefined,
          organizations:managerOrganizations};window.stateChanged(current);return current},
        select:async(id)=>{current={...current,selectedId:id};window.stateChanged(current);return current},
        signOut:async()=>current,openApp:async()=>{}};
      const manager=()=>Array.from(document.querySelectorAll('.tray-account-option')).find((button)=>button.textContent.includes('Bob'));
      setTimeout(()=>{const root=document.getElementById('root');root.dataset.rows=String(!!manager());manager()?.click()},150);
      setTimeout(()=>{const root=document.getElementById('root');root.dataset.confirm=String(!!document.querySelector('dialog[open]')&&document.body.textContent.includes('Account: Bob'));
        Array.from(document.querySelectorAll('.tray-account-confirmation button')).find((button)=>button.textContent==='Switch account')?.click()},300);
      setTimeout(()=>{const select=document.getElementById('organization');select.value='org-b-22222222';select.dispatchEvent(new Event('change',{bubbles:true}))},450);
      setTimeout(()=>{const root=document.getElementById('root');root.dataset.first=String(current.selectedId);
        const select=document.getElementById('organization');select.value='org-a-11111111';select.dispatchEvent(new Event('change',{bubbles:true}))},600);
      setTimeout(()=>{const root=document.getElementById('root');root.dataset.second=String(current.selectedId);
        root.dataset.options=String(Array.from(document.querySelectorAll('#organization option')).some((option)=>option.textContent.includes('11111111'))&&
          Array.from(document.querySelectorAll('#organization option')).some((option)=>option.textContent.includes('22222222')))},850);
    `);
    const html = execFileSync(chrome!, ['--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=1000', '--dump-dom', `file://${join(directory, 'index.html')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    expect(html).toContain('data-rows="true"');
    expect(html).toContain('data-confirm="true"');
    expect(html).toContain('data-first="org-b-22222222"');
    expect(html).toContain('data-options="true"');
    expect(html).toContain('data-second="org-a-11111111"');
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

for (const scenario of ['legacy', 'active', 'cross', 'cancel', 'expired', 'unknown', 'removed', 'stale-membership', 'different-account', 'signed-out-ready', 'signed-out-expired', 'unavailable-unknown']) {
  it.skipIf(!chrome)(`routes targeted inbox notification: ${scenario}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'tray-target-inbox-'));
    try {
      buildSync({ entryPoints: [resolve('src/launcher.jsx')], bundle: true, format: 'iife', jsx: 'automatic', minify: true,
        define: { 'process.env.NODE_ENV': '"production"' }, outfile: join(directory, 'launcher.js') });
      writeFileSync(join(directory, 'index.html'), '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'"></head><body><div id="root"></div><script src="preload.js"></script><script src="launcher.js"></script></body></html>');
      writeFileSync(join(directory, 'preload.js'), `
        const scenario=${JSON.stringify(scenario)};
        const accounts=[{subject:'a',name:'Alice',status:'ready',organizations:[{id:'org-a',name:'Alice Company'}]},
          {subject:'b',name:'Bob',status:scenario==='expired'||scenario==='different-account'||scenario==='signed-out-expired'?'sign-in-again':'ready',organizations:[{id:'org-b',name:'Bob Company'}]}];
        if(scenario==='unknown'||scenario==='unavailable-unknown') accounts.pop();
        let current={status:scenario.startsWith('signed-out')?'signed-out':scenario==='unavailable-unknown'?'session-unavailable':'signed-in',activeSubject:'a',accountName:'Alice',selectedId:'org-a',accounts,
          organizations:accounts[0].organizations,teams:[],assetCatalog:[],edit:{status:'idle'}};
        const callbacks=new Set();let activations=0,adds=0;
        window.inheritiTray={state:async()=>current,onStateChanged:(fn)=>{window.stateChanged=fn;return()=>{}},
          onHidden:()=>()=>{},onAction:(fn)=>{callbacks.add(fn);return()=>callbacks.delete(fn)},onInboxChanged:()=>()=>{},onInboxStateChanged:()=>()=>{},
          inboxState:async()=>({status:'error'}),version:async()=>'',updateProgress:async()=>null,onUpdateProgress:()=>()=>{},
          activateAccount:async(subject)=>{activations++;if(!current.accounts.some((account)=>account.subject===subject)) throw Error('Account no longer saved');
            current={...current,status:'signed-in',activeSubject:subject,accountName:'Bob',selectedId:undefined,
            organizations:scenario==='stale-membership'?[]:[{id:'org-b',name:'Bob Company'}]};window.stateChanged(current);return current},
          select:async(id)=>{current={...current,selectedId:id};window.stateChanged(current);return current},
          addAccount:async()=>{adds++;current={...current,activeSubject:scenario==='different-account'?'c':'b',
            organizations:[{id:'org-b',name:'Bob Company'}],selectedId:'org-b'};window.stateChanged(current);return current},
          signOut:async()=>current,openApp:async()=>{}};
        setTimeout(()=>{for(const callback of callbacks) callback({kind:'OPEN_INBOX',accountSubject:scenario==='active'?'a':scenario==='legacy'?undefined:'b',
          organizationId:scenario==='active'||scenario==='legacy'?'org-a':'org-b',conversationId:'conversation-1'})},150);
        setTimeout(()=>{const root=document.getElementById('root');root.dataset.confirm=String(!!document.querySelector('.tray-account-confirmation'));
          root.dataset.account=String(document.body.textContent.includes('Account: Bob'));
          root.dataset.organization=String(document.body.textContent.includes('Organisation: Bob Company'));
          if(scenario==='removed') {current={...current,accounts:[accounts[0]]};window.stateChanged(current)}
          if(scenario==='cross'||scenario==='stale-membership'||scenario==='removed'||scenario==='signed-out-ready')
            Array.from(document.querySelectorAll('.tray-account-confirmation button')).find((button)=>button.textContent==='Switch account')?.click();
          if(scenario==='cancel') document.querySelector('.tray-account-confirmation button')?.click();
          if(scenario==='expired'||scenario==='unknown'||scenario==='different-account')
            Array.from(document.querySelectorAll('button')).find((button)=>button.textContent==='Add account')?.click();},300);
        setTimeout(()=>{const root=document.getElementById('root');root.dataset.active=String(current.activeSubject);
          root.dataset.selected=String(current.selectedId);root.dataset.activations=String(activations);root.dataset.adds=String(adds);
          root.dataset.inbox=String(!!document.querySelector('.inbox-panel'));
          root.dataset.pending=String(document.body.textContent.includes('notification pending')||document.body.textContent.includes('no longer available')||document.body.textContent.includes('different account')||document.body.textContent.includes('no longer saved')||document.body.textContent.includes('Sign in again to open'));
          root.dataset.recovery=String(!!Array.from(document.querySelectorAll('button')).find((button)=>button.textContent==='Add account')&&!!Array.from(document.querySelectorAll('button')).find((button)=>button.textContent==='Dismiss'))},700);
      `);
      const html = execFileSync(chrome!, ['--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=850', '--dump-dom', `file://${join(directory, 'index.html')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (scenario === 'legacy' || scenario === 'active' || scenario === 'cross' || scenario === 'expired' || scenario === 'unknown' || scenario === 'signed-out-ready') expect(html).toContain('data-inbox="true"');
      if (scenario === 'cross') { expect(html).toContain('data-account="true"'); expect(html).toContain('data-organization="true"'); expect(html).toContain('data-activations="1"'); }
      if (scenario === 'cancel' || scenario === 'stale-membership' || scenario === 'different-account' || scenario === 'removed') expect(html).toContain('data-inbox="false"');
      if (scenario === 'cancel') { expect(html).toContain('data-active="a"'); expect(html).toContain('data-pending="true"'); }
      if (scenario === 'stale-membership') expect(html).toContain('data-pending="true"');
      if (scenario === 'different-account') expect(html).toContain('data-pending="true"');
      if (scenario === 'removed') { expect(html).toContain('data-active="a"'); expect(html).toContain('data-pending="true"'); }
      if (scenario === 'signed-out-expired' || scenario === 'unavailable-unknown') { expect(html).toContain('data-pending="true"'); expect(html).toContain('data-recovery="true"'); expect(html).toContain('data-inbox="false"'); }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}

for (const scenario of ['select', 'add', 'add-dismiss']) {
  it.skipIf(!chrome)(`ignores a stale ${scenario} completion after a newer inbox target`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'tray-target-race-'));
    try {
      buildSync({ entryPoints: [resolve('src/launcher.jsx')], bundle: true, format: 'iife', jsx: 'automatic', minify: true,
        define: { 'process.env.NODE_ENV': '"production"' }, outfile: join(directory, 'launcher.js') });
      writeFileSync(join(directory, 'index.html'), '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'"></head><body><div id="root"></div><script src="preload.js"></script><script src="launcher.js"></script></body></html>');
      writeFileSync(join(directory, 'preload.js'), `
        const scenario=${JSON.stringify(scenario)};
        const accounts=[{subject:'a',name:'Alice',status:'ready',organizations:[{id:'org-a',name:'Company A'},{id:'org-a2',name:'Company A2'},{id:'org-a3',name:'Company A3'}]}];
        let current={status:'signed-in',activeSubject:'a',accountName:'Alice',selectedId:'org-a',accounts,
          organizations:accounts[0].organizations,teams:[],assetCatalog:[],edit:{status:'idle'}};
        let finish,selectedOnce=false;const callbacks=new Set();
        window.inheritiTray={state:async()=>current,onStateChanged:(fn)=>{window.stateChanged=fn;return()=>{}},
          onHidden:()=>()=>{},onAction:(fn)=>{callbacks.add(fn);return()=>callbacks.delete(fn)},onInboxChanged:()=>()=>{},onInboxStateChanged:()=>()=>{},
          inboxState:async()=>({status:'error'}),version:async()=>'',updateProgress:async()=>null,onUpdateProgress:()=>()=>{},
          select:async(id)=>{if(scenario==='select'&&!selectedOnce) {selectedOnce=true;return new Promise((resolve)=>{finish=resolve})}
            current={...current,selectedId:id};window.stateChanged(current);return current},
          addAccount:async()=>new Promise((resolve)=>{finish=resolve}),signOut:async()=>current,openApp:async()=>{}};
        const emit=(accountSubject,organizationId)=>{for(const callback of callbacks) callback({kind:'OPEN_INBOX',accountSubject,organizationId,conversationId:'new-conversation'})};
        setTimeout(()=>emit(scenario==='select'?'a':'b',scenario==='select'?'org-a2':'org-b'),150);
        setTimeout(()=>{if(scenario!=='select') Array.from(document.querySelectorAll('button')).find((button)=>button.textContent==='Add account')?.click()},240);
        setTimeout(()=>{if(scenario==='add-dismiss') Array.from(document.querySelectorAll('button')).find((button)=>button.textContent==='Dismiss')?.click();
          else emit('a',scenario==='select'?'org-a3':'org-a')},330);
        setTimeout(()=>finish?.(scenario==='select'?current:{...current,activeSubject:'c'}),430);
        setTimeout(()=>{const root=document.getElementById('root');root.dataset.inbox=String(!!document.querySelector('.inbox-panel'));
          root.dataset.stale=String(document.body.textContent.includes('different account')||document.body.textContent.includes('no longer available'));
          root.dataset.pending=String(!!Array.from(document.querySelectorAll('button')).find((button)=>button.textContent==='Dismiss'))},700);
      `);
      const html = execFileSync(chrome!, ['--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=850', '--dump-dom', `file://${join(directory, 'index.html')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (scenario === 'select') expect(html).toContain('data-inbox="true"');
      expect(html).toContain('data-stale="false"');
      if (scenario === 'add-dismiss') expect(html).toContain('data-pending="false"');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}
