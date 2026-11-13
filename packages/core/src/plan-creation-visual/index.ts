import type { LocalPlanCreationPhase } from '../local-plan-browser.js';
import { BLUES, buildTiles, describeArc, describeArcR, makeArtwork, polarRing, seededRng } from './geometry.js';

const gates = [
  { key: 'orgKey', label: 'Org Key', mid: 315 },
  { key: 'teams', label: 'Governance', mid: 45 },
  { key: 'protocol', label: 'Split & Encrypt', mid: 135 },
  { key: 'storage', label: 'Storage', mid: 225 },
] as const;
const phases: LocalPlanCreationPhase[] = ['preparing-key', 'awaiting-key', 'securing', 'creating_plan', 'encrypting', 'generating_shares', 'preflighting', 'distributing', 'configuring', 'verifying'];
const lock = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

type Result = 'READY' | 'PENDING' | 'FAILED' | 'CANCELED';
type GateState = 'done' | 'active' | 'denied' | '';
function model(phase: LocalPlanCreationPhase, result?: Result) {
  const n = phases.indexOf(phase);
  const ready = result === 'READY';
  const failed = result === 'FAILED' || result === 'CANCELED';
  const gate: Record<string, GateState> = {
    orgKey: n < 2 ? 'active' : 'done',
    teams: n < 2 ? '' : n < 4 ? 'active' : 'done',
    protocol: n < 4 ? '' : n < 7 ? 'active' : 'done',
    storage: n < 7 ? '' : ready ? 'done' : 'active',
  };
  if (failed) gate[n < 2 ? 'orgKey' : n < 4 ? 'teams' : n < 7 ? 'protocol' : 'storage'] = 'denied';
  if (ready) for (const item of gates) gate[item.key] = 'done';
  return {
    gate,
    colored: n >= 4 || ready,
    out: n === 7 ? [0] : n === 8 ? [0, 1, 2, 3] : [],
    badge: ready ? 'sealed' : n >= 4 && n < 6 ? 'cipher' : n >= 6 ? 'sealed' : 'plain',
    pulse: ready,
  };
}

export function renderPlanCreationVisual(phase: LocalPlanCreationPhase, result?: Result, observedPhases: readonly LocalPlanCreationPhase[] = [phase]): string {
  const m = model(phase, result);
  const fill = makeArtwork(seededRng('creation-fill'), 'creation-mf-', { cx: 400, cy: 400, half: 86 });
  const blue = makeArtwork(seededRng('creation-blue'), 'creation-mb-', { cx: 400, cy: 400, half: 86 }, BLUES);
  const tiles = buildTiles(400, 400, 86, 50).map((tile, i) => `<g class="mtile${m.colored ? ' colored' : ''}${m.out.includes(i) ? ' out' : ''}" data-i="${i}" style="--dx:${tile.dx * 26}px;--dy:${tile.dy * 26}px"><path class="pfill" d="${tile.path}" fill="${fill.fills[i]}"/><path class="pblue" d="${tile.path}" fill="${blue.fills[i]}"/></g>`).join('');
  const arcs = gates.map(({ key, label, mid }) => {
    const reverse = mid > 120 && mid < 240;
    const radius = reverse ? 226 : 211;
    const id = `creation-label-${key}`;
    const pos = polarRing(185, mid, 400);
    const path = reverse ? describeArcR(radius, mid - 45, mid + 45, 400) : describeArc(radius, mid - 45, mid + 45, 400);
    return `<g class="mgate garc ${m.gate[key]}" data-key="${key}"><path class="gline" d="${describeArc(185, mid - 31, mid + 31, 400)}"/><path id="${id}" d="${path}" fill="none"/><text class="glabel"><textPath href="#${id}" xlink:href="#${id}" startOffset="50%">${label}</textPath></text><g class="gnode" transform="translate(${pos.x.toFixed(1)},${pos.y.toFixed(1)})"><circle class="gpulse" r="10"/><circle class="ghalo" r="10"/><circle class="gcore" r="5.5"/></g></g>`;
  }).join('');
  const history = observedPhases.filter((item) => phases.includes(item)).map((item) => ({ phase: item, ...model(item) }));
  const historyAttr = JSON.stringify(history).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const modelAttr = JSON.stringify(m).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<div class="plan-mosaic" data-plan-visual data-visual-phase="${phase}" data-visual-result="${result ?? ''}" data-visual-history="${historyAttr}" data-visual-model="${modelAttr}"><div class="plan-mosaic-stage"><svg class="mscene" viewBox="138 128 524 544" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" role="img" aria-label="Plan creation progress"><defs>${fill.defs}${blue.defs}</defs><g class="mtiles">${tiles}</g><g class="mgates">${arcs}</g></svg><div class="mosaic-cpulse${m.pulse ? ' run' : ''}"></div><div class="mosaic-badge ${m.badge}">${m.badge === 'cipher' ? '<div class="ciphergrid">A7F<br>2C9<br>E41</div>' : lock}</div></div></div>`;
}

export const planCreationVisualStyles = `
.plan-mosaic{--m-blue:#2962ff;--m-green:#22c55e;--m-danger:#dc3545;--m-arc:#cbe7ff;--m-faint:#a3b3bf;display:flex;justify-content:center;align-items:center;width:100%}
.plan-mosaic-stage{position:relative;width:100%;max-width:420px;aspect-ratio:1;min-height:0}
.plan-mosaic svg.mscene{position:absolute;inset:0;display:block;width:100%;height:100%;overflow:visible}
.plan-mosaic .mtile{transition:transform .7s cubic-bezier(.22,1,.36,1)}
.plan-mosaic .mtile>path{stroke:#fff;stroke-width:2.4;stroke-linejoin:round}
.plan-mosaic .pblue{transition:opacity .6s ease}.plan-mosaic .colored .pblue{opacity:0}
.plan-mosaic .mtile.out{transform:translate(var(--dx),var(--dy))}
.plan-mosaic .gline{fill:none;stroke:var(--m-arc);stroke-width:13;stroke-linecap:round;transition:stroke .4s}
.plan-mosaic .active .gline{stroke:var(--m-blue);stroke-dasharray:16 14;animation:creationMarch 1s linear infinite}
.plan-mosaic .done .gline{stroke:var(--m-green)}.plan-mosaic .denied .gline{stroke:var(--m-danger)}
.plan-mosaic .glabel{fill:var(--m-faint);font-family:AppFont,system-ui,sans-serif;font-size:23px;font-weight:600;letter-spacing:1px;text-anchor:middle;transition:fill .4s,font-size .3s}
.plan-mosaic .active .glabel{fill:var(--m-blue);font-size:26px;font-weight:700}.plan-mosaic .done .glabel{fill:var(--m-green)}.plan-mosaic .denied .glabel{fill:var(--m-danger)}
.plan-mosaic .gnode{opacity:0}.plan-mosaic .mosaic-badge{position:absolute;left:50%;top:50%;width:17%;aspect-ratio:1;transform:translate(-50%,-50%);display:grid;place-items:center;border-radius:50%;background:white;border:1.5px solid #eaecf0;color:var(--m-blue);opacity:1;transition:opacity .4s,transform .5s cubic-bezier(.34,1.5,.5,1)}
.plan-mosaic .mosaic-badge svg{width:56%}.plan-mosaic .mosaic-badge.cipher{border-color:var(--m-blue)}
.plan-mosaic .ciphergrid{font:700 8.5px/1.28 monospace;letter-spacing:1.5px;text-align:center;color:var(--m-blue)}
.plan-mosaic .mosaic-cpulse{position:absolute;left:50%;top:50%;width:15%;aspect-ratio:1;border:2px solid var(--m-green);border-radius:50%;transform:translate(-50%,-50%) scale(.7);opacity:0;pointer-events:none}
.plan-mosaic .mosaic-cpulse.run{animation:creationPulse 1.1s ease-out forwards}
@keyframes creationMarch{to{stroke-dashoffset:-40}}@keyframes creationPulse{0%{opacity:.5;transform:translate(-50%,-50%) scale(.7)}100%{opacity:0;transform:translate(-50%,-50%) scale(2.4)}}
@media(prefers-reduced-motion:reduce){.plan-mosaic *{animation:none!important;transition:none!important}}
`;

export const planCreationVisualScript = `
(function(){
  var holds={ 'preparing-key':550,'awaiting-key':550,securing:550,creating_plan:550,encrypting:900,generating_shares:900,preflighting:800,distributing:800,configuring:700,verifying:700 };
  var order=${JSON.stringify(phases)},queue=[],timer=null,cipherTimer=null,shown='',seen=0,highest=-1,until=0,resolveFinish=[],activeRoot=null;
  window.resetPlanCreationVisual=function(){if(timer)clearTimeout(timer);if(cipherTimer)clearInterval(cipherTimer);timer=null;cipherTimer=null;queue=[];shown='';seen=0;highest=-1;until=0;activeRoot=null;resolveFinish.splice(0).forEach(function(done){done()})};
  new MutationObserver(function(){if(activeRoot&&!activeRoot.isConnected)window.resetPlanCreationVisual()}).observe(document.documentElement,{childList:true,subtree:true});
  function visual(main){return main&&main.querySelector('[data-plan-visual]')}
  function apply(step){
    var current=visual(document.querySelector('main'));if(!current||current!==activeRoot)return;
    var m=step.model;
    current.dataset.visualPhase=step.phase;current.dataset.visualResult=step.result||'';
    current.querySelectorAll('.mtile').forEach(function(el,i){el.setAttribute('class','mtile'+(m.colored?' colored':'')+(m.out.indexOf(i)>=0?' out':''))});
    current.querySelectorAll('.mgate').forEach(function(el){el.setAttribute('class','mgate garc '+(m.gate[el.dataset.key]||''))});
    var badge=current.querySelector('.mosaic-badge');
    if(!badge.classList.contains(m.badge)){if(cipherTimer){clearInterval(cipherTimer);cipherTimer=null}badge.className='mosaic-badge '+m.badge;badge.innerHTML=m.badge==='cipher'?'<div class="ciphergrid"></div>':${JSON.stringify(lock)};if(m.badge==='cipher'&&!matchMedia('(prefers-reduced-motion: reduce)').matches){var grid=badge.querySelector('.ciphergrid'),chars='0123456789ABCDEF';var draw=function(){var rows=[];for(var r=0;r<3;r++){var row='';for(var c=0;c<3;c++)row+=chars[Math.floor(Math.random()*16)];rows.push(row)}grid.textContent=rows.join(String.fromCharCode(10))};draw();cipherTimer=setInterval(draw,70)}}
    var pulse=current.querySelector('.mosaic-cpulse');if(m.pulse){pulse.classList.remove('run');void pulse.offsetWidth;pulse.classList.add('run')}
    shown=step.phase;until=Date.now()+(matchMedia('(prefers-reduced-motion: reduce)').matches?0:(holds[shown]||0));
  }
  function play(){timer=null;if(!activeRoot||!activeRoot.isConnected){window.resetPlanCreationVisual();return}if(!queue.length){resolveFinish.splice(0).forEach(function(done){done()});return}
    apply(queue.shift());timer=setTimeout(play,Math.max(0,until-Date.now()));
  }
  function enqueue(entry){var index=order.indexOf(entry.phase);if(index<highest)return;if(index===highest){var tail=queue[queue.length-1];if(tail&&tail.phase===entry.phase)tail.model=entry;return}highest=index;queue.push({phase:entry.phase,result:'',model:entry})}
  window.initializePlanCreationVisual=function(main){
    var root=visual(main);if(!root)return;
    window.resetPlanCreationVisual();activeRoot=root;
    var history=JSON.parse(root.dataset.visualHistory||'[]'),terminalResult=root.dataset.visualResult,terminalPhase=root.dataset.visualPhase,terminalModel=JSON.parse(root.dataset.visualModel);
    var first=history[0]||JSON.parse(root.dataset.visualModel);
    apply({phase:first.phase||root.dataset.visualPhase,result:'',model:first});
    seen=history.length;highest=order.indexOf(first.phase||terminalPhase);
    history.slice(1).forEach(enqueue);
    if(terminalResult)queue.push({phase:terminalPhase,result:terminalResult,model:terminalModel});
    if(queue.length)timer=setTimeout(play,Math.max(0,until-Date.now()));
  };
  window.updatePlanCreationVisual=function(currentMain,nextMain){
    var current=visual(currentMain),next=visual(nextMain);if(!current||!next)return false;
    if(current!==activeRoot){window.resetPlanCreationVisual();activeRoot=current}
    var result=next.dataset.visualResult;
    var oldCard=currentMain.querySelector('.result-card'),newCard=nextMain.querySelector('.result-card');
    if(oldCard&&newCard){['h1','p'].forEach(function(tag){var oldText=oldCard.querySelector(tag),newText=newCard.querySelector(tag);if(oldText&&newText)oldText.textContent=newText.textContent})}
    if(result==='FAILED'||result==='CANCELED'){
      queue=[];if(timer)clearTimeout(timer);timer=null;
      apply({phase:next.dataset.visualPhase,result:result,model:JSON.parse(next.dataset.visualModel)});
      resolveFinish.splice(0).forEach(function(done){done()});return true;
    }
    var history=JSON.parse(next.dataset.visualHistory||'[]');
    if(history.length<seen){seen=0;shown='';highest=-1;queue=[];if(timer)clearTimeout(timer);timer=null;until=0}
    history.slice(seen).forEach(enqueue);seen=history.length;
    if(result && current.dataset.visualResult!==result && !queue.some(function(step){return step.result===result}))queue.push({phase:next.dataset.visualPhase,result:result,model:JSON.parse(next.dataset.visualModel)})
    if(!timer&&queue.length)timer=setTimeout(play,Math.max(0,until-Date.now()));return true;
  };
  window.finishPlanCreationVisual=function(currentMain,nextMain){
    if(!visual(currentMain)&&visual(nextMain)){var fresh=visual(nextMain).cloneNode(true);currentMain.appendChild(fresh);window.initializePlanCreationVisual(currentMain)}
    if(!window.updatePlanCreationVisual(currentMain,nextMain))return Promise.resolve();
    if(!timer&&!queue.length)return Promise.resolve();
    return new Promise(function(resolve){var timeout=setTimeout(function(){window.resetPlanCreationVisual();resolve()},12000);resolveFinish.push(function(){clearTimeout(timeout);resolve()})});
  };
})();`;
