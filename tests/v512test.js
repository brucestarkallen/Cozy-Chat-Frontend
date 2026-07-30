// TEST FILE — run with: node tests/v512test.js
// Guards v5.12.0 as corrected in v5.15.0: one Undo on a reply's edit header
// reverts the most recent applied batch on EVERY file it touched — every edit
// of it, not just the last one on each file. Strict top-match: a file changed
// since the batch is skipped with a note — per-file undo still reaches it.
// Single Apply taps form their own one-edit batch.
//
// The old law here was "applied statuses stay as history". It was WRONG: it
// left a reverted card reading Applied, and editStateNote then told the model
// the edit was "already present in the file text" after the user had undone
// it. An undo frame now names the edits it covers, so undo returns those
// cards to pending and marks them undone. That is asserted below.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=()=>({
  providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000}],
  activeProvider:'p1',presets:[{id:'d',name:'D',system:'',injections:[],order:['__main__','__chat__']}],
  activePreset:'d',prompts:[],temperature:1,maxTokens:4096,effort:'off',squashSystem:true,
  showThinking:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}});
function boot(st){return new Promise(res=>{
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
    beforeParse(w){
      w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
      w.navigator.storage={estimate:async()=>({usage:0})};
      w.requestAnimationFrame=cb=>setTimeout(cb,0);
      w.confirm=()=>true;w.navigator.vibrate=()=>true;
      w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
    }});
  setTimeout(async()=>{try{
    await dom.window.eval('Promise.all([DB.clear(),DB.docClear()])');
    dom.window.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();');
  }catch(_){}res(dom);},750);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function rigChat(w, files){
  await w.eval(`(async()=>{
    current = null; convos = []; docs = [];
    const c = newConvo(); c.filesOn = true;
    for (const f of ${JSON.stringify(files)}){
      const d = await newDoc(f.name, f.text);
      chatDocIds(c).push(d.id);
    }
  })()`);
}

(async()=>{

console.log('=== 1. ONE UNDO, EVERY FILE THE BATCH TOUCHED — THROUGH THE UI ===');
{
  const dom=await boot(base()); const w=dom.window,d=w.document;
  await rigChat(w,[{name:'a.md',text:'alpha'},{name:'b.md',text:'beta'}]);
  w.eval(`(()=>{
    current.messages.push({id:'U1',role:'user',content:'go',ts:Date.now()});
    current.messages.push({id:'A1',role:'assistant',content:'ok',ts:Date.now(),edits:[
      {id:'e1',type:'replace',file:'a.md',find:'alpha',replace:'ALPHA',reason:'',status:'pending'},
      {id:'e2',type:'replace',file:'b.md',find:'beta',replace:'BETA',reason:'',status:'pending'}]});
    renderThread();
  })()`);
  await w.eval(`applyAll('A1')`); await sleep(60);
  const batches=w.eval(`current.messages.find(m=>m.id==='A1').edits.map(e=>e.batch)`);
  ck('both edits share ONE batch id', batches[0]&&batches[0]===batches[1], JSON.stringify(batches));
  ck('both undo tops stamped with it', w.eval(`docs.every(x=>x.undo[x.undo.length-1].batch==='${batches[0]}')`));
  w.eval('renderThread()');
  const btn=d.querySelector('[data-undobatch]');
  ck('header Undo renders after the batch applied', !!btn);
  btn.dispatchEvent(new w.Event('click',{bubbles:true})); await sleep(80);
  ck('a.md restored', w.eval(`docs.find(x=>x.name==='a.md').text`)==='alpha');
  ck('b.md restored', w.eval(`docs.find(x=>x.name==='b.md').text`)==='beta');
  ck('undo returns the cards to pending — an undone edit stops claiming to be applied',
    w.eval(`current.messages.find(m=>m.id==='A1').edits.every(e=>e.status==='pending')`),
    w.eval(`current.messages.find(m=>m.id==='A1').edits.map(e=>e.status).join()`));
  ck('and each is flagged undone, not merely never-acted-on',
    w.eval(`current.messages.find(m=>m.id==='A1').edits.every(e=>e.undone===true)`));
  ck('the note the model reads says it is NOT in the file',
    /UNDONE by the user/.test(w.eval(`editStateNote(current.messages.find(m=>m.id==='A1'))`)));
  ck('and the authorship line no longer counts it as applied',
    w.eval(`appliedByFile(current).size`)===0, 'size='+w.eval(`appliedByFile(current).size`));
  w.eval('renderThread()');
  ck('an undone card offers Re-apply', /Re-apply/.test(d.querySelector('[data-eid="e1"]').innerHTML));
  ck('the batch Undo button is gone once the batch is fully undone',
    !d.querySelector('[data-undobatch]'));
  dom.window.close();
}

console.log('=== 1b. MANY EDITS, ONE FILE: THE WHOLE BATCH COMES BACK ===');
{
  // The bug this covers: applyEdit pushed one undo frame PER EDIT and undoBatch
  // popped ONE, so three edits to one file rolled back only the third while the
  // toast reported the batch reverted. Every earlier case was one edit per file,
  // which is why the gate never saw it.
  const dom=await boot(base()); const w=dom.window;
  await rigChat(w,[{name:'a.md',text:'one\ntwo\nthree'}]);
  w.eval(`(()=>{
    current.messages.push({id:'A1',role:'assistant',content:'ok',ts:Date.now(),edits:[
      {id:'e1',type:'replace',file:'a.md',find:'one',replace:'ONE',reason:'',status:'pending'},
      {id:'e2',type:'replace',file:'a.md',find:'two',replace:'TWO',reason:'',status:'pending'},
      {id:'e3',type:'replace',file:'a.md',find:'three',replace:'THREE',reason:'',status:'pending'}]});
  })()`);
  await w.eval(`applyAll('A1')`); await sleep(80);
  ck('all three applied', w.eval(`docs[0].text`)==='ONE\nTWO\nTHREE');
  ck('the batch left ONE undo frame, not three', w.eval(`docs[0].undo.length`)===1,
     'frames='+w.eval(`docs[0].undo.length`));
  ck('that frame names all three edits', w.eval(`docs[0].undo[0].eids.join()`)==='e1,e2,e3');
  const bid=w.eval(`current.messages.find(m=>m.id==='A1').edits[0].batch`);
  await w.eval(`undoBatch('${bid}')`); await sleep(80);
  ck('one Undo reverts the WHOLE batch, not just its last edit',
     w.eval(`docs[0].text`)==='one\ntwo\nthree', JSON.stringify(w.eval(`docs[0].text`)));
  ck('every card came back pending',
     w.eval(`current.messages.find(m=>m.id==='A1').edits.every(e=>e.status==='pending'&&e.undone)`));
  // and re-applying one of them clears the undone flag
  await w.eval(`applyEdit('A1','e2')`); await sleep(60);
  ck('re-applying an undone edit works and clears the flag',
     w.eval(`docs[0].text`)==='one\nTWO\nthree' && w.eval(`current.messages.find(m=>m.id==='A1').edits[1].undone`)===undefined);
  dom.window.close();
}

console.log('=== 1c. A BATCH BIGGER THAN THE UNDO CAP STILL REACHES ITS START ===');
{
  // One frame per edit meant a 12-edit batch shifted its own starting state off
  // an 8-deep stack. One frame per batch cannot.
  const dom=await boot(base()); const w=dom.window;
  const lines=Array.from({length:12},(_,i)=>'L'+i).join('\n');
  await rigChat(w,[{name:'a.md',text:lines}]);
  w.eval(`(()=>{
    const es=[]; for(let i=0;i<12;i++) es.push({id:'e'+i,type:'replace',file:'a.md',find:'L'+i,replace:'X'+i,reason:'',status:'pending'});
    current.messages.push({id:'A1',role:'assistant',content:'ok',ts:Date.now(),edits:es});
  })()`);
  await w.eval(`applyAll('A1')`); await sleep(150);
  ck('12 edits, still one frame', w.eval(`docs[0].undo.length`)===1, 'frames='+w.eval(`docs[0].undo.length`));
  const bid=w.eval(`current.messages.find(m=>m.id==='A1').edits[0].batch`);
  await w.eval(`undoBatch('${bid}')`); await sleep(80);
  ck('the file returns to its true pre-batch state', w.eval(`docs[0].text`)===lines, JSON.stringify(w.eval(`docs[0].text`)));
  dom.window.close();
}

console.log('=== 2. STRICT TOP-MATCH: A FILE CHANGED SINCE IS SKIPPED, NOT UNWOUND ===');
{
  const dom=await boot(base()); const w=dom.window;
  await rigChat(w,[{name:'a.md',text:'alpha'},{name:'b.md',text:'beta'}]);
  w.eval(`(()=>{
    current.messages.push({id:'A1',role:'assistant',content:'ok',ts:Date.now(),edits:[
      {id:'e1',type:'replace',file:'a.md',find:'alpha',replace:'ALPHA',reason:'',status:'pending'},
      {id:'e2',type:'replace',file:'b.md',find:'beta',replace:'BETA',reason:'',status:'pending'}]});
  })()`);
  await w.eval(`applyAll('A1')`); await sleep(60);
  const bid=w.eval(`current.messages.find(m=>m.id==='A1').edits[0].batch`);
  // b.md gets a MANUAL change on top of the batch (its own undo entry, no batch)
  w.eval(`(()=>{const b=docs.find(x=>x.name==='b.md');
    b.undo.push({text:b.text,at:Date.now()}); b.text='BETA hand-edited';})()`);
  await w.eval(`undoBatch('${bid}')`); await sleep(60);
  ck('untouched file reverted', w.eval(`docs.find(x=>x.name==='a.md').text`)==='alpha');
  ck('changed-since file SKIPPED, hand edit intact', w.eval(`docs.find(x=>x.name==='b.md').text`)==='BETA hand-edited');
  ck('the batch entry stays buried for per-file undo', w.eval(`docs.find(x=>x.name==='b.md').undo.some(u=>u.batch==='${bid}')`));
  dom.window.close();
}

console.log('=== 3. A SINGLE TAP IS ITS OWN BATCH; PER-FILE UNDO UNCHANGED ===');
{
  const dom=await boot(base()); const w=dom.window,d=w.document;
  await rigChat(w,[{name:'a.md',text:'alpha'}]);
  w.eval(`(()=>{
    current.messages.push({id:'A1',role:'assistant',content:'ok',ts:Date.now(),edits:[
      {id:'e1',type:'append',file:'a.md',find:null,replace:'tail',reason:'',status:'pending'}]});
  })()`);
  await w.eval(`applyEdit('A1','e1')`); await sleep(50);
  ck('single apply stamped with its own batch', w.eval(`current.messages.find(m=>m.id==='A1').edits[0].batch`)==='e1');
  w.eval('renderThread()');
  ck('header Undo appears for it too', !!d.querySelector('[data-undobatch="e1"]'));
  await w.eval(`undoDoc(docs[0].id)`); await sleep(50);   // the old per-file path
  ck('per-file undo still pops it regardless of the stamp', w.eval(`docs[0].text`)==='alpha');
  ck('per-file undo also tells the truth about the card',
     w.eval(`current.messages.find(m=>m.id==='A1').edits[0].status`)==='pending'
     && w.eval(`current.messages.find(m=>m.id==='A1').edits[0].undone`)===true);
  await w.eval(`undoBatch('e1')`); await sleep(50);
  ck('batch undo after per-file undo finds nothing and breaks nothing', w.eval(`docs[0].text`)==='alpha');
  dom.window.close();
}

console.log('\nRESULT:',fail?('FAILURES: '+fail):'ALL PASS','('+pass+' checks)');
process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
