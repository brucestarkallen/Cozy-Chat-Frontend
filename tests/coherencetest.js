// The whole-organism check: the panel must never display a value that is not
// the one actually in use. Every visible control is compared against the
// resolver that feeds the request.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync('./out/index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=()=>({
  providers:[{id:'pa',preset:'custom',kind:'openai',name:'Alpha',url:'https://a/v1',apiKey:'k',model:'m1',ctx:9000},
             {id:'pb',preset:'custom',kind:'openai',name:'Beta', url:'https://b/v1',apiKey:'k',model:'m2',ctx:9000}],
  activeProvider:'pa',
  presets:[{id:'s1',name:'Doctor Love',system:'# DOCTOR LOVE',injections:[],order:['__main__','__chat__']},
           {id:'s2',name:'Instruction Architect',system:'# INSTRUCTION ARCHITECT',injections:[],order:['__main__','__chat__']}],
  activePreset:'s1',prompts:[],temperature:1,maxTokens:4096,effort:'off',squashSystem:true,
  showThinking:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}});
function boot(st){return new Promise(res=>{
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
    beforeParse(w){
      w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
      w.navigator.storage={estimate:async()=>({usage:0})};
      w.requestAnimationFrame=cb=>setTimeout(cb,0);
      w.confirm=()=>true;w.prompt=(q,d)=>d||'X';w.navigator.clipboard={writeText:async()=>{}};
      w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
    }});
  setTimeout(()=>{try{dom.window.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();');}catch(_){}res(dom);},750);});}
const ev=(w,el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true}));

(async()=>{
console.log('=== 1. THE REPORTED BUG: dropdown vs content ===');
{
  const dom=await boot(base());const w=dom.window,d=dom.window.document;
  w.eval('newConvo(); current.title="Charlemagne";'); await new Promise(r=>setTimeout(r,150));
  ev(w,d.querySelector('#settingsBtn'),'click');
  d.querySelectorAll('.tab')[2].dispatchEvent(new w.Event('click',{bubbles:true}));

  const sel=d.querySelector('#presetSel');
  sel.value='s2'; ev(w,sel,'change');
  await new Promise(r=>setTimeout(r,200));
  ck('the set in use changed', w.eval('PS().name')==='Instruction Architect', w.eval('PS().name'));
  ck('the dropdown shows the same one', d.querySelector('#presetSel').value==='s2',
     d.querySelector('#presetSel').value);
  ck('the system prompt below matches it',
     d.querySelector('#sysPrompt').value==='# INSTRUCTION ARCHITECT', d.querySelector('#sysPrompt').value);
  ck('and so does what is sent',
     w.eval('(function(){current.messages=[{id:"1",role:"user",content:"U"}];return assembleMessages("openai").system;})()')==='# INSTRUCTION ARCHITECT');

  sel.value='s1'; ev(w,sel,'change');
  await new Promise(r=>setTimeout(r,200));
  ck('switching back keeps all three together',
     w.eval('PS().name')==='Doctor Love'
     && d.querySelector('#presetSel').value==='s1'
     && d.querySelector('#sysPrompt').value==='# DOCTOR LOVE',
     w.eval('PS().name')+' / '+d.querySelector('#presetSel').value+' / '+d.querySelector('#sysPrompt').value.slice(0,16));
}

console.log('\n=== 2. THE SAME CHECK, FOR EVERY CONTROL ===');
{
  const dom=await boot(base());const w=dom.window,d=dom.window.document;
  w.eval('newConvo()'); await new Promise(r=>setTimeout(r,150));
  // set this chat to the non-default of everything
  w.eval('cfgSet("presetId","s2");cfgSet("providerId","pb");cfgSet("temperature",0.31);cfgSet("maxTokens",777);cfgSet("effort","high");cfgSet("squashSystem",false)');
  await new Promise(r=>setTimeout(r,200));
  ev(w,d.querySelector('#settingsBtn'),'click');

  const shown = {
    preset:   d.querySelector('#presetSel').value,
    provider: (d.querySelector('.prov.active')||{}).dataset && d.querySelector('.prov.active').dataset.prov,
    temp:     Number(d.querySelector('#temp').value),
    maxTok:   Number(d.querySelector('#maxTok').value),
    effort:   (d.querySelector('#effortSeg button.on')||{}).dataset && d.querySelector('#effortSeg button.on').dataset.effort,
    squash:   d.querySelector('#tgSquash').classList.contains('on')
  };
  const used = {
    preset:   w.eval('PS().id'),
    provider: w.eval('activeProv().id'),
    temp:     w.eval('chatTemp()'),
    maxTok:   w.eval('chatMaxTok()'),
    effort:   w.eval('chatEffort()'),
    squash:   w.eval('chatSquash()')
  };
  for (const k of Object.keys(shown))
    ck('panel agrees with what is used: '+k, shown[k]===used[k], JSON.stringify(shown[k])+' vs '+JSON.stringify(used[k]));
}

console.log('\n=== 3. DELETE REMOVES THE SET YOU ARE LOOKING AT ===');
{
  const dom=await boot(base());const w=dom.window,d=dom.window.document;
  w.eval('newConvo()'); await new Promise(r=>setTimeout(r,150));
  w.eval('cfgSet("presetId","s2")'); await new Promise(r=>setTimeout(r,150));
  ev(w,d.querySelector('#settingsBtn'),'click');
  d.querySelectorAll('.tab')[2].dispatchEvent(new w.Event('click',{bubbles:true}));
  ck('the chat is on the second set', w.eval('PS().id')==='s2');
  ev(w,d.querySelector('#presetDelBtn'),'click');
  await new Promise(r=>setTimeout(r,250));
  ck('the one on screen was deleted', w.eval('S.presets.some(p=>p.id==="s2")')===false);
  ck('the other survived', w.eval('S.presets.some(p=>p.id==="s1")')===true);
  ck('the chat fell back to a set that exists', w.eval('PS().id')==='s1', w.eval('PS().id'));
  ck('the dropdown followed', d.querySelector('#presetSel').value==='s1');
}

console.log('\n=== 4. A CHAT POINTING AT A DELETED SET RECOVERS ===');
{
  const dom=await boot(base());const w=dom.window,d=dom.window.document;
  w.eval('newConvo(); current.title="A"; cfgSet("presetId","s2");');
  const a=w.eval('current.id');
  w.eval('newConvo(); current.title="B"; cfgSet("presetId","s1");');
  await new Promise(r=>setTimeout(r,200));
  ev(w,d.querySelector('#settingsBtn'),'click');
  d.querySelectorAll('.tab')[2].dispatchEvent(new w.Event('click',{bubbles:true}));
  // delete s1 while chat B is open; chat A still points at s2
  ev(w,d.querySelector('#presetDelBtn'),'click');
  await new Promise(r=>setTimeout(r,250));
  w.eval('current = convos.find(c=>c.id==="'+a+'")');
  ck('the other chat still resolves a set', !!w.eval('PS()'));
  ck('and it is one that exists', w.eval('S.presets.some(p=>p.id===PS().id)')===true, w.eval('PS().id'));
}

console.log('\n=== 5. CONNECTIONS BEHAVE THE SAME ===');
{
  const dom=await boot(base());const w=dom.window,d=dom.window.document;
  w.eval('newConvo()'); await new Promise(r=>setTimeout(r,150));
  ev(w,d.querySelector('#settingsBtn'),'click');
  d.querySelectorAll('[data-prov]')[1].dispatchEvent(new w.Event('click',{bubbles:true}));
  await new Promise(r=>setTimeout(r,200));
  ck('picking one applies to the chat', w.eval('activeProv().id')==='pb', w.eval('activeProv().id'));
  ck('the list marks the same one', d.querySelector('.prov.active').dataset.prov==='pb');
  ck('the header shows its model', d.querySelector('#modelChip').textContent.includes('m2'),
     d.querySelector('#modelChip').textContent);
  // deleting the connection a chat uses must not strand it
  w.eval('editingProv="pb"'); 
  ev(w,d.querySelector('#delProvBtn'),'click');
  await new Promise(r=>setTimeout(r,250));
  ck('the chat repoints to one that exists',
     w.eval('S.providers.some(p=>p.id===activeProv().id)')===true, w.eval('activeProv().id'));
}
console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})();
