// TEST FILE — run with: node tests/v512test.js
// Guards v5.12.0: one Undo on a reply's edit header reverts the most recent
// applied batch on EVERY file it touched. Strict top-match: a file changed
// since the batch is skipped with a note — per-file undo still reaches it.
// Single Apply taps form their own one-edit batch. Per-file undo unchanged.
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
  ck('applied statuses stay as history (existing per-file-undo law)',
    w.eval(`current.messages.find(m=>m.id==='A1').edits.every(e=>e.status==='applied')`));
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
  await w.eval(`undoBatch('e1')`); await sleep(50);
  ck('batch undo after per-file undo finds nothing and breaks nothing', w.eval(`docs[0].text`)==='alpha');
  dom.window.close();
}

console.log('\nRESULT:',fail?('FAILURES: '+fail):'ALL PASS','('+pass+' checks)');
process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
