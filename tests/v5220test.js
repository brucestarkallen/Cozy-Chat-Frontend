// TEST FILE — run with: node tests/v5220test.js
// Guards v5.22.0: a project's instructions are blocks in the instruction-set
// format — named, toggleable, draggable into order — that live on the project
// (a set switch can never touch them), and a pre-v5.22 single text migrates
// into the first block with the wire byte-for-byte unchanged. And the effort
// picker offers the rungs above High that current models take — Xhigh and Max
// where the wire has them, never a name the endpoint would reject.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=(o={})=>Object.assign({
  providers:[
    {id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000},
    {id:'pA',preset:'anthropic',kind:'anthropic',name:'C',url:'https://c/v1',apiKey:'k',model:'claude-opus-5',ctx:100000},
    {id:'pZ',preset:'zai',kind:'openai',name:'Z',url:'https://z/v1',apiKey:'k',model:'glm-5.3',ctx:100000},
    {id:'pO',preset:'openrouter',kind:'openai',name:'O',url:'https://o/v1',apiKey:'k',model:'x/y',ctx:100000},
    {id:'pQ',preset:'custom',kind:'openai',name:'Q',url:'https://q/v1',apiKey:'k',model:'qwen-3',ctx:100000},
    {id:'pH',preset:'hermes',kind:'openai',name:'H',url:'http://h/v1',apiKey:'k',model:'hermes-agent',ctx:100000},
    {id:'pB',preset:'custom',kind:'anthropic',name:'B',url:'https://b/v1',apiKey:'k',model:'claude',ctx:100000,reason:'anthropic-budget'}],
  activeProvider:'p1',
  presets:[{id:'d',name:'D',system:'BASE',injections:[],order:['__main__','__chat__']},
           {id:'w',name:'Writer',system:'WRITER SET',injections:[],order:['__main__','__chat__']}],
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

console.log('=== 1. A PROJECT\'S OLD TEXT BECOMES ITS FIRST BLOCK, WIRE UNCHANGED ===');
{
  const dom=await boot(base());const w=dom.window;
  w.eval(`S.projects=[{id:"pr1",name:"Bleach RP",instructions:"PROJECT LAW: stay in canon.",presetId:null,docIds:[]}];
    saveSettings(); newConvo(null,"pr1");
    current.messages.push({id:uid(),role:"user",content:"who is the hero?",ts:Date.now()});`);
  const sys=w.eval('assembleMessages("openai").system');
  ck('the request is byte-for-byte the one the old text produced', sys==='BASE\n\nPROJECT LAW: stay in canon.', JSON.stringify(sys));
  const shape=w.eval('JSON.stringify({inj:S.projects[0].injections,order:S.projects[0].order,old:"instructions" in S.projects[0]})');
  const sh=JSON.parse(shape);
  ck('the text migrated into one named block', sh.inj.length===1 && sh.inj[0].text==='PROJECT LAW: stay in canon.' && sh.inj[0].enabled===true);
  ck('with an order holding it before the conversation marker', sh.order.length===2 && sh.order[0]===sh.inj[0].id && sh.order[1]==='__chat__', sh.order.join(','));
  ck('and the old field is gone', sh.old===false);
  w.eval('newConvo()'); // outside the project
  w.eval('current.messages.push({id:uid(),role:"user",content:"hi",ts:Date.now()})');
  ck('an outside chat gets none of it', w.eval('assembleMessages("openai").system')==='BASE');
}

console.log('=== 2. BLOCKS SEND IN THE PROJECT\'S ORDER — ENABLED AND NON-EMPTY ONLY ===');
{
  const dom=await boot(base());const w=dom.window;
  w.eval(`S.projects=[{id:"pr1",name:"P",presetId:null,docIds:[],
    injections:[
      {id:"b1",name:"one",text:"FIRST LAW",enabled:true},
      {id:"b2",name:"two",text:"SECOND LAW",enabled:false},
      {id:"b3",name:"three",text:"THIRD LAW",enabled:true},
      {id:"b4",name:"four",text:"   ",enabled:true}],
    order:["b1","b3","b2","b4"]}];
    saveSettings(); newConvo(null,"pr1");
    current.messages.push({id:uid(),role:"user",content:"go",ts:1});`);
  const sys=w.eval('assembleMessages("openai").system');
  ck('enabled blocks ride, in the project\'s order', sys==='BASE\n\nFIRST LAW\n\nTHIRD LAW', JSON.stringify(sys));
  ck('a switched-off block stays home', sys.indexOf('SECOND LAW')<0);
  ck('a blank block sends nothing', sys.indexOf('b4')<0 && !/\\n\\n\\n/.test(sys));
  w.eval('S.projects[0].order=orderMoveTo(S.projects[0].order,"b3",0)');
  const sys2=w.eval('assembleMessages("openai").system');
  ck('reordering the list reorders the wire', sys2==='BASE\n\nTHIRD LAW\n\nFIRST LAW', JSON.stringify(sys2));
}

console.log('=== 3. THE SET CANNOT TOUCH THE PROJECT\'S BLOCKS ===');
{
  const dom=await boot(base());const w=dom.window;
  w.eval(`S.projects=[{id:"pr1",name:"P",presetId:null,docIds:[],
    injections:[{id:"b1",name:"one",text:"PROJECT LAW",enabled:true}],order:["b1"]}];
    saveSettings(); newConvo(null,"pr1");
    current.messages.push({id:uid(),role:"user",content:"go",ts:1});`);
  w.eval('switchPreset("w")');
  await sleep(60);
  const sys=w.eval('assembleMessages("openai").system');
  ck('switching the set swaps the set\'s prompt only', sys==='WRITER SET\n\nPROJECT LAW', JSON.stringify(sys));
  ck('the project\'s blocks are where they were', w.eval('S.projects[0].injections.length')===1 && w.eval('S.projects[0].injections[0].text')==='PROJECT LAW');
  ck('and the set never absorbed one', w.eval('PS().injections.length')===0);
}

console.log('=== 4. THE EDITOR: RENDER, ADD, ARROWS, TOGGLE, RENAME, DELETE ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document;
  w.eval(`S.projects=[{id:"pr1",name:"P",presetId:null,docIds:[],
    injections:[
      {id:"b1",name:"Alpha",text:"A",enabled:true},
      {id:"b2",name:"Beta",text:"B",enabled:true},
      {id:"b3",name:"Gamma",text:"C",enabled:true}],
    order:["b1","b2","b3"]}];
    saveSettings(); openProjEditor("pr1");`);
  await sleep(60);
  ck('every block renders a row, plus the conversation marker', d.querySelectorAll('#projInjList [data-row]').length===4);
  ck('every row has a grip', d.querySelectorAll('#projInjList [data-grip]').length===4);
  ev(w,d.querySelector('#projAddInjBtn'),'click'); await sleep(40);
  ck('add makes a block and opens it for editing', w.eval('S.projects[0].injections.length')===4
      && !!d.querySelector('#projInjList .ord-editor [data-pinjname]'));
  const nid=w.eval('S.projects[0].order[3]');
  ck('the new block landed at the end of the order', w.eval('S.projects[0].injections[3].id')===nid);
  // arrows move a row one step
  d.querySelector('#projInjList [data-up="b2"]').dispatchEvent(new w.Event('click',{bubbles:true})); await sleep(40);
  ck('arrow-up swaps with the row above', w.eval('S.projects[0].order.slice(0,3).join(",")')==='b2,b1,b3', w.eval('S.projects[0].order.join(",")'));
  // toggle switches a block off
  d.querySelector('#projInjList [data-pinjon="b1"]').dispatchEvent(new w.Event('click',{bubbles:true})); await sleep(40);
  ck('the toggle switches the block off', w.eval('S.projects[0].injections.find(x=>x.id==="b1").enabled')===false);
  ck('and the row shows it', !!d.querySelector('#projInjList [data-row="b1"].off'));
  // rename writes through to the row
  ev(w,d.querySelector('#projInjList [data-edit="b2"]'),'click'); await sleep(40);
  const nm=d.querySelector('#projInjList [data-pinjname="b2"]');
  nm.value='Renamed'; ev(w,nm,'input'); await sleep(40);
  ck('renaming updates the block and its row', w.eval('S.projects[0].injections.find(x=>x.id==="b2").name')==='Renamed'
      && d.querySelector('#projInjList [data-row="b2"] .ord-name').textContent==='Renamed');
  // the big editor writes through the one save path
  const ta=d.querySelector('#projInjList [data-pinjtext="b2"]');
  ev(w,ta,'click'); await sleep(40);
  ck('the text opens in the big editor', d.querySelector('#bigModal').classList.contains('show'));
  d.querySelector('#bigArea').value='B, rewritten long.';
  ev(w,d.querySelector('#bigSave'),'click'); await sleep(40);
  ck('and saves onto the block', w.eval('S.projects[0].injections.find(x=>x.id==="b2").text')==='B, rewritten long.',
     w.eval('S.projects[0].injections.find(x=>x.id==="b2").text'));
  // delete removes it from both the list and the order
  ev(w,d.querySelector('#projInjList [data-edit="b3"]'),'click'); await sleep(40);
  d.querySelector('#projInjList [data-pinjdel="b3"]').dispatchEvent(new w.Event('click',{bubbles:true})); await sleep(40);
  ck('delete removes the block and its slot', w.eval('S.projects[0].injections.some(x=>x.id==="b3")')===false
      && w.eval('S.projects[0].order.indexOf("b3")')<0);
  ck('everything persisted', JSON.parse(w.localStorage.getItem('cozychat:settings')).projects[0].injections.length===3);
}

console.log('=== 5. DRAG REORDERS THE PROJECT\'S LIST, SAME GESTURE AS THE SET\'S ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document;
  w.eval(`S.projects=[{id:"pr1",name:"P",presetId:null,docIds:[],
    injections:[
      {id:"b1",name:"Alpha",text:"A",enabled:true},
      {id:"b2",name:"Beta",text:"B",enabled:true},
      {id:"b3",name:"Gamma",text:"C",enabled:true}],
    order:["b1","b2","b3"]}];
    saveSettings(); openProjEditor("pr1");`);
  await sleep(60);
  const ordNow=()=>w.eval('S.projects[0].order.join(",")');
  layout(w,'#projInjList');
  const g=d.querySelector('#projInjList [data-grip="b1"]');
  g.dispatchEvent(pev(w,'pointerdown',20));
  ck('the row is grabbed on contact', g.classList.contains('armed'));
  g.dispatchEvent(pev(w,'pointermove',150));
  ck('the drop slot highlights mid-drag', !!d.querySelector('#projInjList .drop-target'));
  g.dispatchEvent(pev(w,'pointerup',150));
  ck('released below the rest, it lands last', ordNow()==='b2,b3,__chat__,b1', ordNow());
  // a tap on the grip is a no-op
  layout(w,'#projInjList');
  const g2=d.querySelector('#projInjList [data-grip="b2"]');
  g2.dispatchEvent(pev(w,'pointerdown',20)); g2.dispatchEvent(pev(w,'pointerup',20));
  ck('a tap moves nothing', ordNow()==='b2,b3,__chat__,b1', ordNow());
  // a cancelled pointer leaves the order alone
  layout(w,'#projInjList');
  const g3=d.querySelector('#projInjList [data-grip="b3"]');
  g3.dispatchEvent(pev(w,'pointerdown',60));
  g3.dispatchEvent(pev(w,'pointermove',5));
  g3.dispatchEvent(pev(w,'pointercancel',5));
  ck('a cancelled drag changes nothing', ordNow()==='b2,b3,__chat__,b1', ordNow());
  ck('no drag styling survives the cancel', !d.querySelector('#projInjList .armed, #projInjList .dragging, #projInjList .drop-target'));
}

console.log('=== 6. EFFORT — THE NEW RUNGS GO OUT WHERE THE WIRE HAS THEM ===');
{
  const dom=await boot(base());const w=dom.window;
  const ar=(pid,eff,maxTok)=>w.eval(`(function(){
    cfgSet('providerId','${pid}'); cfgSet('effort','${eff}');
    ${maxTok?`cfgSet('maxTokens',${maxTok});`:''}
    const body={}; applyReasoning(body, activeProv(), current||undefined);
    return JSON.stringify(body); })()`);
  w.eval('newConvo()');
  let b=JSON.parse(ar('pA','max'));
  ck('Claude takes max verbatim', b.thinking && b.thinking.type==='adaptive' && b.output_config && b.output_config.effort==='max', JSON.stringify(b));
  b=JSON.parse(ar('pA','xhigh'));
  ck('and xhigh verbatim', b.output_config && b.output_config.effort==='xhigh');
  b=JSON.parse(ar('p1','max'));
  ck('OpenAI-style takes max as reasoning_effort', b.reasoning_effort==='max', JSON.stringify(b));
  b=JSON.parse(ar('p1','xhigh'));
  ck('and xhigh', b.reasoning_effort==='xhigh');
  b=JSON.parse(ar('pO','max'));
  ck('OpenRouter takes max in its reasoning object', b.reasoning && b.reasoning.effort==='max', JSON.stringify(b));
  b=JSON.parse(ar('pO','off'));
  ck('and off still switches it off there', b.reasoning && b.reasoning.enabled===false);
  b=JSON.parse(ar('pZ','max'));
  ck('GLM takes max', b.reasoning_effort==='max' && b.thinking && b.thinking.type==='enabled', JSON.stringify(b));
  b=JSON.parse(ar('pZ','xhigh'));
  ck('a stored xhigh is said to GLM as max — its own mapping, and the one name it would reject is never sent', b.reasoning_effort==='max', JSON.stringify(b));
  b=JSON.parse(ar('pZ','medium'));
  ck('a stored medium is said to GLM as high — its own mapping', b.reasoning_effort==='high', JSON.stringify(b));
  b=JSON.parse(ar('pZ','low'));
  ck('low still sends no level to GLM, as before', !('reasoning_effort' in b) && b.thinking && b.thinking.type==='enabled', JSON.stringify(b));
  b=JSON.parse(ar('pZ','off'));
  ck('off still disables GLM thinking', b.thinking && b.thinking.type==='disabled' && !('reasoning_effort' in b));
  b=JSON.parse(ar('pQ','max'));
  ck('Qwen only knows the switch — max turns it on', b.enable_thinking===true && Object.keys(b).length===1, JSON.stringify(b));
  b=JSON.parse(ar('pH','max'));
  ck('the Hermes agent tops out at high — max is said as high', b.model_options && b.model_options.reasoning && b.model_options.reasoning.effort==='high', JSON.stringify(b));
  b=JSON.parse(ar('pB','max',60000));
  ck('a budget-model Claude spends its top budget on a stored max', b.thinking && b.thinking.budget_tokens===24576, JSON.stringify(b));
  b=JSON.parse(ar('pA','off'));
  ck('off on Claude still sends nothing', !b.thinking && !b.output_config, JSON.stringify(b));
}

console.log('=== 7. THE PICKER OFFERS WHAT THE CONNECTION CAN SAY ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document;
  w.eval('newConvo()');
  const ladder=pid=>{ w.eval(`cfgSet('providerId','${pid}');renderEffort()`);
    return Array.from(d.querySelectorAll('#effortSeg button')).map(x=>x.dataset.effort).join(','); };
  ck('a Claude connection offers the full ladder', ladder('pA')==='off,low,medium,high,xhigh,max', ladder('pA'));
  ck('an OpenAI-style one too', ladder('p1')==='off,low,medium,high,xhigh,max');
  ck('OpenRouter too', ladder('pO')==='off,low,medium,high,xhigh,max');
  ck('GLM tops out at max and has no xhigh', ladder('pZ')==='off,low,high,max', ladder('pZ'));
  ck('Qwen keeps the four it always had', ladder('pQ')==='off,low,medium,high');
  ck('so does the Hermes agent', ladder('pH')==='off,low,medium,high');
  ck('and the budget models', ladder('pB')==='off,low,medium,high');
  w.eval(`cfgSet('providerId','pA');cfgSet('effort','max');renderEffort()`);
  ck('a saved max lights on a connection that can say it', (d.querySelector('#effortSeg button.on')||{}).dataset.effort==='max');
  w.eval(`cfgSet('providerId','pQ');renderEffort()`);
  ck('on one that cannot, what it would send lights instead', (d.querySelector('#effortSeg button.on')||{}).dataset.effort==='high',
     (d.querySelector('#effortSeg button.on')||{}).dataset.effort);
  ck('and the saved choice is still there, not overwritten', w.eval('chatEffort()')==='max');
  w.eval(`cfgSet('providerId','pA');renderEffort()`);
  ck('back where it can be said, it lights again', (d.querySelector('#effortSeg button.on')||{}).dataset.effort==='max');
  d.querySelector('#effortSeg [data-effort="xhigh"]').dispatchEvent(new w.Event('click',{bubbles:true}));
  ck('tapping a rung saves it', w.eval('chatEffort()')==='xhigh');
}

console.log('');
console.log(fail?('FAILED '+fail):'ALL PASS','('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
