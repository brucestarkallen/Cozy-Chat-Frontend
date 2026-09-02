// TEST FILE — run with: node tests/v5230test.js
// Guards v5.23.0: a project's instructions are a full instruction set living
// on the project — role, position, depth, the conversation marker — walked
// with the same machinery as the chat's set, landing after it in each region:
// the system fold, before the chat, inside it at a depth, after it right
// before the reply. Older project shapes keep the wire they always had.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=(o={})=>Object.assign({
  providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000}],
  activeProvider:'p1',
  presets:[{id:'d',name:'D',system:'BASE',injections:[],order:['__main__','__chat__']}],
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
function pev(w,type,y){const e=new w.Event(type,{bubbles:true});e.clientY=y;e.pointerId=1;return e;}
function layout(w,sel){
  const rows=Array.from(w.document.querySelectorAll(sel+' [data-row]'));
  rows.forEach((el,i)=>{el.getBoundingClientRect=()=>({top:i*40,height:40,bottom:i*40+40,left:0,right:100,width:100});});
  return rows;
}

(async()=>{

console.log('=== 1. A PROJECT BLOCK AFTER THE MARKER LANDS AFTER THE CHAT ===');
{
  const st=base();
  st.presets[0].injections=[{id:'s1',name:'sp',text:'SET POST',role:'system',pos:'relative',depth:0,enabled:true}];
  st.presets[0].order=['__main__','__chat__','s1'];
  st.projects=[{id:'pr1',name:'P',presetId:null,docIds:[],
    injections:[{id:'b1',name:'arc',text:'CURRENT ARC: the siege begins.',role:'user',pos:'relative',depth:0,enabled:true}],
    order:['__chat__','b1']}];
  const dom=await boot(st);const w=dom.window;
  w.eval(`newConvo(null,"pr1"); current.messages.push({id:uid(),role:"user",content:"hello",ts:1});`);
  const asm=JSON.parse(w.eval('JSON.stringify(assembleMessages("openai"))'));
  const j=JSON.stringify(asm.messages);
  ck('the system fold holds neither post block', asm.system.indexOf('SET POST')<0 && asm.system.indexOf('CURRENT ARC')<0);
  ck('the global set\'s post block stays OUT of the project', j.indexOf('SET POST')<0, j.slice(0,200));
  ck('the project\'s lands after the chat', j.indexOf('hello')<j.indexOf('CURRENT ARC'));
  const tail=asm.messages[asm.messages.length-1];
  ck('the project block keeps its role — merging with the user\'s own last message, one user voice',
     tail.role==='user' && tail.content==='hello\n\nCURRENT ARC: the siege begins.', tail.role+': '+tail.content);
}

console.log('=== 2. A PROJECT BLOCK WEAVES IN AT A DEPTH, AFTER THE SET\'S ===');
{
  const st=base();
  st.presets[0].injections=[{id:'s1',name:'sd',text:'SET DEPTH',role:'system',pos:'chat',depth:1,enabled:true}];
  st.presets[0].order=['__main__','s1','__chat__'];
  st.projects=[{id:'pr1',name:'P',presetId:null,docIds:[],
    injections:[{id:'b1',name:'pd',text:'PROJECT DEPTH',role:'user',pos:'chat',depth:1,enabled:true}],
    order:['b1','__chat__']}];
  const dom=await boot(st);const w=dom.window;
  w.eval(`newConvo(null,"pr1");
    current.messages.push({id:uid(),role:"user",content:"first",ts:1});
    current.messages.push({id:uid(),role:"assistant",content:"second",ts:2});
    current.messages.push({id:uid(),role:"user",content:"newest",ts:3});`);
  const asm=JSON.parse(w.eval('JSON.stringify(assembleMessages("openai"))'));
  const j=JSON.stringify(asm.messages);
  ck('the project block weaves in one message up from the newest',
     j.indexOf('second')<j.indexOf('PROJECT DEPTH') && j.indexOf('PROJECT DEPTH')<j.indexOf('newest'), j.slice(0,240));
  ck('the global set\'s depth block stays OUT of the project', j.indexOf('SET DEPTH')<0);
  ck('and nothing leaks into the system fold', asm.system.indexOf('DEPTH')<0, asm.system);
}

console.log('=== 3. ROLES AND THE FOLD, INSIDE THE PROJECT LAYER ===');
{
  const st=base();
  st.projects=[{id:'pr1',name:'P',presetId:null,docIds:[],
    injections:[
      {id:'s0',name:'z',text:'PROJECT SYSTEM ZERO',role:'system',pos:'relative',depth:0,enabled:true},
      {id:'u1',name:'u',text:'PROJECT USER BLOCK',role:'user',pos:'relative',depth:0,enabled:true},
      {id:'s1',name:'o',text:'PROJECT SYSTEM ONE',role:'system',pos:'relative',depth:0,enabled:true}],
    order:['s0','u1','s1','__chat__']}];
  const dom=await boot(st);const w=dom.window;
  w.eval(`newConvo(null,"pr1"); current.messages.push({id:uid(),role:"user",content:"hello",ts:1});`);
  const asm=JSON.parse(w.eval('JSON.stringify(assembleMessages("openai"))'));
  ck('a leading system block folds — no global prompt beside it', asm.system==='PROJECT SYSTEM ZERO', JSON.stringify(asm.system));
  const j=JSON.stringify(asm.messages);
  ck('once a non-system block passes, later system blocks stay messages — order is never rewritten by the fold',
     j.indexOf('PROJECT USER BLOCK')<j.indexOf('PROJECT SYSTEM ONE') && j.indexOf('PROJECT SYSTEM ONE')<j.indexOf('hello'), j.slice(0,240));
  const mid=asm.messages[0];
  ck('the user block speaks as the user', mid.role==='user' && mid.content==='PROJECT USER BLOCK');
}

console.log('=== 4. OLDER PROJECT SHAPES KEEP THE WIRE THEY ALWAYS HAD ===');
{
  const st=base();
  st.projects=[{id:'pr1',name:'Legacy',instructions:'PROJECT LAW: stay in canon.',presetId:null,docIds:[]}];
  const dom=await boot(st);const w=dom.window;
  w.eval(`newConvo(null,"pr1"); current.messages.push({id:uid(),role:"user",content:"go",ts:1});`);
  ck('a pre-v5.22 text still lands as project-law system text', w.eval('assembleMessages("openai").system')==='PROJECT LAW: stay in canon.');
  const sh=JSON.parse(w.eval('JSON.stringify(S.projects[0])'));
  ck('and the block is the full format now', sh.injections[0].role==='system' && sh.injections[0].pos==='relative' && sh.injections[0].depth===0);
  ck('between the two markers', sh.order.join(',')==='__main__,'+sh.injections[0].id+',__chat__', sh.order.join(','));
}
{
  const st=base();
  st.projects=[{id:'pr1',name:'v522',presetId:null,docIds:[],
    injections:[{id:'b1',name:'x',text:'LAW TWO',enabled:true}],order:['b1']}];
  const dom=await boot(st);const w=dom.window;
  w.eval(`newConvo(null,"pr1"); current.messages.push({id:uid(),role:"user",content:"go",ts:1});`);
  ck('a v5.22 block list lands the same way', w.eval('assembleMessages("openai").system')==='LAW TWO');
  const sh=JSON.parse(w.eval('JSON.stringify(S.projects[0])'));
  ck('defaults filled, both markers in place', sh.injections[0].role==='system' && sh.order.join(',')==='__main__,b1,__chat__', sh.order.join(','));
}

console.log('=== 5. THE EDITOR IS THE INSTRUCTION-SET EDITOR ===');
{
  const st=base();
  st.projects=[{id:'pr1',name:'P',presetId:null,docIds:[],
    injections:[{id:'b1',name:'Alpha',text:'A',role:'system',pos:'relative',depth:0,enabled:true}],
    order:['b1','__chat__']}];
  const dom=await boot(st);const w=dom.window,d=w.document;
  w.eval('openProjEditor("pr1")'); await sleep(60);
  ck('the markers render, main first and conversation last', !!d.querySelector('#projInjList [data-row="__main__"]')
      && d.querySelectorAll('#projInjList [data-row]')[0].dataset.row==='__main__'
      && d.querySelectorAll('#projInjList [data-row]')[2].dataset.row==='__chat__');
  ev(w,d.querySelector('#projInjList [data-edit="b1"]'),'click'); await sleep(40);
  ck('sent-as and position are there', !!d.querySelector('#projInjList [data-pinjrole="b1"]') && !!d.querySelector('#projInjList [data-pinjpos="b1"]'));
  ck('no depth input while relative', !d.querySelector('#projInjList [data-pinjdepth="b1"]'));
  const pos=d.querySelector('#projInjList [data-pinjpos="b1"]');
  pos.value='chat'; ev(w,pos,'change'); await sleep(40);
  ck('switching to in-chat reveals depth', !!d.querySelector('#projInjList [data-pinjdepth="b1"]'));
  ck('and the row says so', d.querySelector('#projInjList [data-row="b1"] .ord-sub').textContent.indexOf('In-chat')>=0);
  const dep=d.querySelector('#projInjList [data-pinjdepth="b1"]');
  dep.value='2'; ev(w,dep,'input'); await sleep(40);
  ck('depth persists and explains itself', w.eval('S.projects[0].injections[0].depth')===2
      && d.querySelector('#projInjList .depth-viz').textContent.indexOf('2 messages up')>=0, d.querySelector('#projInjList .depth-viz').textContent);
  const role=d.querySelector('#projInjList [data-pinjrole="b1"]');
  role.value='user'; ev(w,role,'change'); await sleep(40);
  ck('role persists', w.eval('S.projects[0].injections[0].role')==='user');
  // drag the block below the marker
  ev(w,d.querySelector('#projInjList [data-edit="b1"]'),'click'); await sleep(40); // close the editor first
  layout(w,'#projInjList');
  const g=d.querySelector('#projInjList [data-grip="b1"]');
  g.dispatchEvent(pev(w,'pointerdown',60));
  g.dispatchEvent(pev(w,'pointermove',120));
  g.dispatchEvent(pev(w,'pointerup',120));
  await sleep(40);
  ck('dragged below the marker, it sits after the conversation', w.eval('S.projects[0].order.join(",")')==='__main__,__chat__,b1', w.eval('S.projects[0].order.join(",")'));
  w.eval('(function(){const i=S.projects[0].injections[0]; i.pos="relative"; i.role="system"; saveSettings();})()');
  ck('and the wire agrees', w.eval(`(function(){newConvo(null,"pr1");current.messages.push({id:uid(),role:"user",content:"hi",ts:1});
      const m=assembleMessages("openai").messages; return m[m.length-1].content;})()`)==='A');
  // new blocks land before the marker
  ev(w,d.querySelector('#projAddInjBtn'),'click'); await sleep(40);
  const sh=JSON.parse(w.eval('JSON.stringify({o:S.projects[0].order,n:S.projects[0].injections.map(i=>i.id)})'));
  ck('a new block lands just before the conversation marker', sh.o.length===4 && sh.o[0]==='__main__' && sh.n.indexOf(sh.o[1])>=0 && sh.o[2]==='__chat__' && sh.o[3]==='b1', sh.o.join(','));
}

console.log('');
console.log(fail?('FAILED '+fail):'ALL PASS','('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
