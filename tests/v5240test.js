// TEST FILE — run with: node tests/v5240test.js
// Guards v5.24.0: the boundary. A chat inside a project uses the project's
// own instruction set — main prompt, blocks, markers — and NOTHING global:
// global sets only serve chats outside projects, each remembering its own
// pin. Moving a chat across the boundary swaps the whole layer. A global set
// can start a project's set as a real copy that shares nothing afterwards.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=(o={})=>Object.assign({
  providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000}],
  activeProvider:'p1',
  presets:[
    {id:'d',name:'D',system:'GLOBAL BASE',injections:[
      {id:'g1',name:'gb',text:'GLOBAL BLOCK',role:'system',pos:'relative',depth:0,enabled:true}],order:['__main__','g1','__chat__']},
    {id:'w',name:'Writer',system:'WRITER SET',injections:[
      {id:'w1',name:'wb',text:'WRITER BLOCK',role:'user',pos:'relative',depth:0,enabled:true}],order:['__main__','w1','__chat__']}],
  activePreset:'d',prompts:[],projects:[],temperature:1,maxTokens:4096,effort:'off',squashSystem:true,
  showThinking:true,showTools:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}},o);
function boot(st){return new Promise(res=>{
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
    beforeParse(w){
      w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
      w.navigator.storage={estimate:async()=>({usage:0})};
      w.requestAnimationFrame=cb=>setTimeout(cb,0);
      w.confirm=()=>true;w.prompt=(q,d)=>d||'X';w.navigator.clipboard={writeText:async()=>{}};
      w.navigator.vibrate=()=>true;
      w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
    }});
  setTimeout(async()=>{try{
    await dom.window.eval('Promise.all([DB.clear(),DB.docClear()])');
    dom.window.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();');
  }catch(_){}res(dom);},750);});}
const ev=(w,el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true}));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const projFixture=()=>[{id:'pr1',name:'P',docIds:[],
  system:'PROJECT PROMPT',
  injections:[{id:'b1',name:'law',text:'PROJECT LAW',role:'system',pos:'relative',depth:0,enabled:true}],
  order:['__main__','b1','__chat__']}];

(async()=>{

console.log('=== 1. INSIDE A PROJECT: THE PROJECT\'S SET, NOTHING GLOBAL ===');
{
  const dom=await boot(base({projects:projFixture()}));const w=dom.window;
  w.eval(`newConvo(null,"pr1"); current.messages.push({id:uid(),role:"user",content:"hi",ts:1});`);
  const asm=JSON.parse(w.eval('JSON.stringify(assembleMessages("openai"))'));
  ck('the wire is the project\'s own set', asm.system==='PROJECT PROMPT\n\nPROJECT LAW', JSON.stringify(asm.system));
  ck('nothing global is anywhere on it', JSON.stringify(asm).indexOf('GLOBAL')<0, JSON.stringify(asm).slice(0,160));
  ck('the project editor offers no global-set pin', !w.document.querySelector('#projPreset'));
}

console.log('=== 2. OUTSIDE: THE CHAT\'S OWN PINNED SET, AS ALWAYS ===');
{
  const dom=await boot(base({projects:projFixture()}));const w=dom.window;
  w.eval(`newConvo(); current.messages.push({id:uid(),role:"user",content:"hi",ts:1});`);
  const asm=JSON.parse(w.eval('JSON.stringify(assembleMessages("openai"))'));
  ck('the global set rides', asm.system==='GLOBAL BASE\n\nGLOBAL BLOCK', JSON.stringify(asm.system));
  ck('nothing project-flavoured leaks out', JSON.stringify(asm).indexOf('PROJECT')<0);
  w.eval('switchPreset("w")'); await sleep(60);
  ck('each chat keeps its own pin — switching works outside', w.eval('assembleMessages("openai").system').indexOf('WRITER SET')===0);
}

console.log('=== 3. CROSSING THE BOUNDARY SWAPS THE WHOLE LAYER ===');
{
  const dom=await boot(base({projects:projFixture()}));const w=dom.window;
  w.eval(`newConvo(); current.messages.push({id:uid(),role:"user",content:"hi",ts:1});`);
  ck('outside, the global set', w.eval('assembleMessages("openai").system').indexOf('GLOBAL BASE')===0);
  await w.eval('(function(){current.projectId="pr1";return persist();})()');
  ck('moved in, only the project\'s set', w.eval('assembleMessages("openai").system')==='PROJECT PROMPT\n\nPROJECT LAW');
  await w.eval('(function(){delete current.projectId;return persist();})()');
  ck('moved back out, its own pin is right where it was left', w.eval('assembleMessages("openai").system')==='GLOBAL BASE\n\nGLOBAL BLOCK');
}

console.log('=== 4. BORN IN A PROJECT: NO GLOBAL PIN FOLLOWS IT IN ===');
{
  const dom=await boot(base({projects:projFixture()}));const w=dom.window;
  w.eval('switchPreset("w")'); await sleep(60);            // favourite set globally
  w.eval('newConvo(null,"pr1")');
  ck('the chat keeps the usual per-chat pin for life outside', w.eval('current.cfg.presetId')==='w');
  w.eval('current.messages.push({id:uid(),role:"user",content:"hi",ts:1})');
  ck('but while it lives in the project, only the project\'s set speaks', w.eval('assembleMessages("openai").system')==='PROJECT PROMPT\n\nPROJECT LAW');
  await w.eval('(function(){delete current.projectId;return persist();})()');
  ck('moved out, the pin wakes up exactly as saved', w.eval('assembleMessages("openai").system').indexOf('WRITER SET')===0);
}

console.log('=== 5. START FROM A GLOBAL SET — A REAL COPY ===');
{
  const st=base({projects:[{id:'pr1',name:'P',docIds:[],injections:[],order:[]}]});
  const dom=await boot(st);const w=dom.window,d=w.document;
  w.eval('openProjEditor("pr1")'); await sleep(60);
  const sel=d.querySelector('#projCopyFrom');
  ck('the copy-in picker lists the global sets', sel && sel.querySelectorAll('option').length===1+w.eval('S.presets.length'),
     sel && String(sel.querySelectorAll('option').length));
  sel.value='w';
  ev(w,d.querySelector('#projCopyBtn'),'click'); await sleep(60);
  const sh=JSON.parse(w.eval('JSON.stringify(S.projects[0])'));
  ck('the main prompt came across', sh.system==='WRITER SET');
  ck('the blocks came across, with fresh ids', sh.injections.length===1 && sh.injections[0].text==='WRITER BLOCK' && sh.injections[0].id!=='w1');
  ck('and the order maps them between the markers', sh.order.length===3 && sh.order[0]==='__main__' && sh.order[1]===sh.injections[0].id && sh.order[2]==='__chat__', sh.order.join(','));
  ck('the wire speaks the copy', w.eval('(function(){newConvo(null,"pr1");current.messages.push({id:uid(),role:"user",content:"hi",ts:1});return assembleMessages("openai").system;})()')==='WRITER SET');
  w.eval('S.presets.find(x=>x.id==="w").system="WRITER SET, EDITED GLOBALLY"; saveSettings();');
  ck('global edits never reach in', w.eval('S.projects[0].system')==='WRITER SET');
  w.eval('S.projects[0].injections[0].text="EDITED IN THE PROJECT"; saveSettings();');
  ck('and project edits never reach out', w.eval('S.presets.find(x=>x.id==="w").injections[0].text')==='WRITER BLOCK');
  // copying again replaces, with consent
  sel.value='d';
  ev(w,d.querySelector('#projCopyBtn'),'click'); await sleep(60);
  const sh2=JSON.parse(w.eval('JSON.stringify(S.projects[0])'));
  ck('a second copy replaces the first', sh2.system==='GLOBAL BASE' && sh2.injections.length===1 && sh2.injections[0].text==='GLOBAL BLOCK');
}

console.log('=== 6. THE MAIN PROMPT IS THE PROJECT\'S TOO ===');
{
  const dom=await boot(base({projects:projFixture()}));const w=dom.window,d=w.document;
  w.eval('openProjEditor("pr1")'); await sleep(60);
  ck('the main row leads the list', d.querySelector('#projInjList [data-row]').dataset.row==='__main__');
  ck('with its size', d.querySelector('#projInjList [data-row="__main__"] .ord-sub').textContent.indexOf('tokens')>=0);
  const ta=d.querySelector('#projSys');
  ck('the editor loads it', ta.value==='PROJECT PROMPT');
  ev(w,ta,'click'); await sleep(40);
  d.querySelector('#bigArea').value='PROJECT PROMPT, REVISED';
  ev(w,d.querySelector('#bigSave'),'click'); await sleep(40);
  ck('editing writes through and persists', w.eval('S.projects[0].system')==='PROJECT PROMPT, REVISED'
      && JSON.parse(w.localStorage.getItem('cozychat:settings')).projects[0].system==='PROJECT PROMPT, REVISED');
  ck('the wire speaks the revision', w.eval('(function(){newConvo(null,"pr1");current.messages.push({id:uid(),role:"user",content:"hi",ts:1});return assembleMessages("openai").system;})()')==='PROJECT PROMPT, REVISED\n\nPROJECT LAW');
}

console.log('=== 7. OLD SHAPES MIGRATE INTO THE FULL SET ===');
{
  const st=base();
  st.projects=[{id:'pr1',name:'Legacy',instructions:'PROJECT LAW: stay in canon.',presetId:'w',docIds:[]}];
  const dom=await boot(st);const w=dom.window;
  w.eval(`newConvo(null,"pr1"); current.messages.push({id:uid(),role:"user",content:"go",ts:1});`);
  ck('a pre-v5.22 text still sends exactly its text, as the project\'s whole set',
     w.eval('assembleMessages("openai").system')==='PROJECT LAW: stay in canon.');
  const sh=JSON.parse(w.eval('JSON.stringify(S.projects[0])'));
  ck('it grew a main prompt slot, empty', sh.system==='');
  ck('and both markers around its block', sh.order.join(',')==='__main__,'+sh.injections[0].id+',__chat__', sh.order.join(','));
  ck('and the old global pin is gone', !('presetId' in sh));
}

console.log('');
console.log(fail?('FAILED '+fail):'ALL PASS','('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
