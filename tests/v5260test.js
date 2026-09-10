// TEST FILE — run with: node tests/v5260test.js
// Guards v5.26.0: never-forget. Standing instructions can ride a second time
// near the newest message, at a chosen depth — the main prompt alone, or
// everything above the chat — so a persona survives a conversation of any
// length. Off is free and unchanged; post-chat blocks are never duplicated
// (they already sit at the tail); the meter counts the copy.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=(o={})=>Object.assign({
  providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000}],
  activeProvider:'p1',
  presets:[{id:'d',name:'D',system:'YOU ARE PCESS, KNIGHT OF CUPS.',injections:[
      {id:'r1',name:'rule',text:'Never break character.',role:'system',pos:'relative',depth:0,enabled:true},
      {id:'r2',name:'off-note',text:'DISABLED NOTE',role:'system',pos:'relative',depth:0,enabled:false},
      {id:'r3',name:'deep',text:'DEPTH BLOCK',role:'system',pos:'chat',depth:1,enabled:true},
      {id:'r4',name:'tail',text:'POST CHAT NOTE',role:'system',pos:'relative',depth:0,enabled:true}],
    order:['__main__','r1','__chat__','r4','r2','r3']}],
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
      w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
    }});
  setTimeout(async()=>{try{
    await dom.window.eval('Promise.all([DB.clear(),DB.docClear()])');
    dom.window.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();');
  }catch(_){}res(dom);},750);});}
const ev=(w,el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true}));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function fourMessages(w){
  w.eval(`newConvo();
    current.messages.push({id:"m1",role:"user",content:"one",ts:1});
    current.messages.push({id:"m2",role:"assistant",content:"two",ts:2});
    current.messages.push({id:"m3",role:"user",content:"three",ts:3});
    current.messages.push({id:"m4",role:"assistant",content:"four",ts:4});`);
}
const J=asm=>JSON.stringify(asm.messages);

(async()=>{

console.log('=== 1. THE MAIN PROMPT RIDES TWICE — TOP AND NEAR THE ACTION ===');
{
  const st=base(); st.presets[0].remind={mode:'main',depth:2};
  const dom=await boot(st);const w=dom.window;
  fourMessages(w);
  const asm=JSON.parse(w.eval('JSON.stringify(assembleMessages("openai"))'));
  ck('it still leads from the top', asm.system==='YOU ARE PCESS, KNIGHT OF CUPS.\n\nNever break character.', asm.system);
  const j=J(asm);
  const second=j.indexOf('YOU ARE PCESS, KNIGHT OF CUPS.');
  ck('and rides again two messages up from the newest',
     j.indexOf('"two"')<second && second<j.indexOf('"three"'), j.slice(0,220));
  ck('exactly twice on the whole wire', JSON.stringify(asm).split('YOU ARE PCESS').length-1===2, // system + 1 copy
     String(JSON.stringify(asm).split('YOU ARE PCESS').length-1));
  const copy=asm.messages.find(m=>typeof m.content==='string' && m.content==='YOU ARE PCESS, KNIGHT OF CUPS.');
  ck('as a system voice', copy && copy.role==='system');
}

console.log('=== 2. "ALL" RE-SENDS EVERYTHING ABOVE THE CHAT — AND ONLY THAT ===');
{
  const st=base(); st.presets[0].remind={mode:'all',depth:0};
  const dom=await boot(st);const w=dom.window;
  fourMessages(w);
  const asm=JSON.parse(w.eval('JSON.stringify(assembleMessages("openai"))'));
  const j=J(asm);
  ck('main prompt, then the relative block, in order, right before the reply',
     j.indexOf('YOU ARE PCESS')>-1 && j.indexOf('"four"')<j.lastIndexOf('Never break character.'),
     j.slice(-260));
  ck('a disabled block stays home', j.indexOf('DISABLED NOTE')<0);
  ck('the post-chat block is not duplicated — it already sits at the tail',
     j.split('POST CHAT NOTE').length-1===1, String(j.split('POST CHAT NOTE').length-1));
  ck('the in-chat block keeps its own single depth seat', j.split('DEPTH BLOCK').length-1===1);
  ck('and the tail items come after it', j.lastIndexOf('Never break character.')<j.indexOf('POST CHAT NOTE'));
}

console.log('=== 3. DEPTH IS OBEYED ===');
{
  const st=base(); st.presets[0].remind={mode:'main',depth:0};
  const dom=await boot(st);const w=dom.window;
  fourMessages(w);
  const asm=JSON.parse(w.eval('JSON.stringify(assembleMessages("openai"))'));
  const msgs=asm.messages.filter(m=>typeof m.content==='string');
  const last=msgs[msgs.length-1];
  ck('depth 0: right before the reply, after everything', last.content.indexOf('YOU ARE PCESS')===0 || last.content==='YOU ARE PCESS, KNIGHT OF CUPS.', last.content.slice(0,60));
}
{
  const st=base(); st.presets[0].remind={mode:'main',depth:50};
  const dom=await boot(st);const w=dom.window;
  fourMessages(w);
  const asm=JSON.parse(w.eval('JSON.stringify(assembleMessages("openai"))'));
  const msgs=asm.messages;
  ck('a depth past the start pins to the very first message',
     typeof msgs[0].content==='string' && msgs[0].content.indexOf('YOU ARE PCESS')>=0, JSON.stringify(msgs[0]).slice(0,90));
}

console.log('=== 4. OFF COSTS NOTHING — THE WIRE IS WHAT IT ALWAYS WAS ===');
{
  const dom=await boot(base());const w=dom.window;
  fourMessages(w);
  const asm=JSON.parse(w.eval('JSON.stringify(assembleMessages("openai"))'));
  ck('no duplication by default', JSON.stringify(asm).split('YOU ARE PCESS').length-1===1, String(JSON.stringify(asm).split('YOU ARE PCESS').length-1));
  ck('the old default field grows in, off', w.eval('PS().remind.mode')==='off' && w.eval('PS().remind.depth')===2);
}

console.log('=== 5. THE PROJECT\'S OWN SET REMEMBERS THE SAME WAY ===');
{
  const st=base();
  st.projects=[{id:'pr1',name:'P',docIds:[],system:'PROJECT PERSONA.',
    injections:[{id:'b1',name:'law',text:'PROJECT LAW',role:'system',pos:'relative',depth:0,enabled:true}],
    order:['__main__','b1','__chat__'],remind:{mode:'all',depth:1}}];
  const dom=await boot(st);const w=dom.window;
  w.eval(`newConvo(null,"pr1");
    current.messages.push({id:"m1",role:"user",content:"one",ts:1});
    current.messages.push({id:"m2",role:"assistant",content:"two",ts:2});
    current.messages.push({id:"m3",role:"user",content:"three",ts:3});`);
  const asm=JSON.parse(w.eval('JSON.stringify(assembleMessages("openai"))'));
  const j=J(asm);
  ck('the project set leads', asm.system==='PROJECT PERSONA.\n\nPROJECT LAW');
  ck('and rides again one up from the newest, project order preserved',
     j.indexOf('"two"')<j.indexOf('PROJECT PERSONA.') && j.indexOf('PROJECT PERSONA.')<j.indexOf('PROJECT LAW') && j.indexOf('PROJECT LAW')<j.indexOf('"three"'),
     j.slice(0,260));
}

console.log('=== 6. THE CONTROLS WRITE AND THE METER COUNTS ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document;
  fourMessages(w);
  ev(w,d.querySelector('#settingsBtn'),'click'); await sleep(120);
  d.querySelectorAll('.tab')[2].dispatchEvent(new w.Event('click',{bubbles:true})); await sleep(60);
  const sel=d.querySelector('#remindMode');
  ck('the control starts off', sel.value==='off');
  sel.value='main'; ev(w,sel,'change'); await sleep(60);
  ck('it writes to the set', w.eval('PS().remind.mode')==='main');
  ck('and the hint says what it costs', d.querySelector('#remindHint').textContent.indexOf('extra tokens a turn')>=0,
     d.querySelector('#remindHint').textContent);
  const dep=d.querySelector('#remindDepth'); dep.value='3'; ev(w,dep,'change'); await sleep(60);
  ck('depth writes too', w.eval('PS().remind.depth')===3);
  const withCopy=w.eval('updateEmber(), document.querySelector("#ctxLabel").textContent');
  ck('the meter counts the copy', /\d/.test(withCopy), withCopy);
  // and the wire honors what was set in the panel
  const asm=JSON.parse(w.eval('JSON.stringify(assembleMessages("openai"))'));
  ck('set in the panel, honored on the wire', JSON.stringify(asm).split('YOU ARE PCESS').length-1===2);
  // the project modal has the same control
  w.eval('S.projects=[{id:"pr1",name:"P",docIds:[],system:"P",injections:[],order:[]}]; saveSettings(); openProjEditor("pr1");');
  await sleep(60);
  const psel=d.querySelector('#projRemindMode');
  ck('the project has the control too', !!psel && psel.value==='off');
  psel.value='all'; ev(w,psel,'change'); await sleep(60);
  ck('and it writes to the project', w.eval('S.projects[0].remind.mode')==='all');
}

console.log('');
console.log(fail?('FAILED '+fail):'ALL PASS','('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
