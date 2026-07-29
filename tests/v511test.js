// TEST FILE — run with: node tests/v511test.js
// Guards v5.11.0: "all": true on a find/replace changes EVERY exact
// occurrence in one undoable edit — the rename card. Literal match only, on
// purpose: no punctuation normalization, no fuzzy — a global edit that
// guessed would write the wrong thing N times instead of once. Zero
// occurrences fails cleanly and changes nothing. The card and the model's
// own state note both say the scope out loud.
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

console.log('=== 1. THE RENAME: EVERY EXACT OCCURRENCE, ONCE, UNDOABLE ===');
{
  const dom=await boot(base()); const w=dom.window;
  const text='Argent said hi. Argent left. Then Argent, again Argent.';
  await rigChat(w,[{name:'a.md',text}]);
  // through the REAL pipeline: parse → stage → apply
  w.eval(`(()=>{
    current.messages.push({id:'U1',role:'user',content:'rename him',ts:Date.now()});
    const pd=parseDocEdits('ok<docedits>[{"find":"Argent","replace":"Jovan","all":true,"reason":"rename"}]</docedits>');
    current.messages.push({id:'A1',role:'assistant',content:'ok',ts:Date.now(),edits:pd.edits});
  })()`);
  ck('parser carried the flag', w.eval(`current.messages.find(m=>m.id==='A1').edits[0].all`)===true);
  await w.eval(`applyEdit('A1', current.messages.find(m=>m.id==='A1').edits[0].id)`); await sleep(50);
  const e=w.eval(`current.messages.find(m=>m.id==='A1').edits[0]`);
  ck('applied', e.status==='applied', e.status);
  ck('card note counts the occurrences', /replaced 4 occurrences/.test(e.note), e.note);
  const t=w.eval(`docs[0].text`);
  ck('every occurrence changed', t==='Jovan said hi. Jovan left. Then Jovan, again Jovan.', JSON.stringify(t));
  await w.eval(`undoDoc(docs[0].id)`); await sleep(50);
  ck('one undo restores the whole rename', w.eval(`docs[0].text`)===text);
  dom.window.close();
}

console.log('=== 2. FOOLPROOF BY CONSTRUCTION ===');
{
  const dom=await boot(base()); const w=dom.window;
  ck('zero occurrences fails cleanly, file untouched',
    w.eval(`JSON.stringify(applyEditToText('alpha beta',{type:'replace',all:true,find:'gamma',replace:'x'}))`)
      ===JSON.stringify({text:null,note:"couldn't find that text in the file"}));
  ck('NO normalization for global: curly quote is not a straight quote',
    w.eval(`applyEditToText('it\\u2019s here, it\\u2019s there',{type:'replace',all:true,find:"it's",replace:'x'}).text`)===null);
  ck("the SAME find non-global still normalizes (targeted stays lenient)",
    w.eval(`applyEditToText('it\\u2019s here',{type:'replace',find:"it's",replace:'x'}).text`)==='x here');
  ck('single occurrence notes it as one',
    /replaced 1 occurrence$/.test(w.eval(`applyEditToText('only once',{type:'replace',all:true,find:'once',replace:'twice'}).note`)));
  ck('regex characters in find are inert (split/join, not regex)',
    w.eval(`applyEditToText('a.*b a.*b',{type:'replace',all:true,find:'a.*b',replace:'Z'}).text`)==='Z Z');
  dom.window.close();
}

console.log('=== 3. SCOPE IS SAID OUT LOUD — CARD AND WIRE ===');
{
  const dom=await boot(base()); const w=dom.window,d=w.document;
  await rigChat(w,[{name:'a.md',text:'x x x'}]);
  w.eval(`(()=>{
    current.messages.push({id:'U1',role:'user',content:'go',ts:Date.now()});
    current.messages.push({id:'A1',role:'assistant',content:'ok',ts:Date.now(),edits:[
      {id:'e1',type:'replace',file:'a.md',find:'x',replace:'y',all:true,reason:'',status:'pending'},
      {id:'e2',type:'replace',file:'a.md',find:'q',replace:'y',reason:'',status:'pending'}]});
    renderThread();
  })()`);
  const kinds=[...d.querySelectorAll('.edit-card .kind')].map(k=>k.textContent);
  ck('card labeled Replace everywhere', /Replace everywhere/.test(kinds[0]), kinds[0]);
  ck('plain replace card unchanged', /^Replace \u2014/.test(kinds[1]), kinds[1]);
  const p=w.eval(`JSON.stringify(assembleMessages('openai'))`);
  ck('model state note marks (every occurrence)', /find \\"x\\" \(every occurrence\) in \\"a.md\\": pending/.test(p));
  const proto=w.eval(`doceditProtocol([{name:'a.md'}])`);
  ck('protocol teaches the flag', /"all": true/.test(proto) && /every exact occurrence/.test(proto));
  dom.window.close();
}

console.log('=== 4. SUPERSEDE STILL BITES: SAME FIND, GLOBAL VS TARGETED ===');
{
  const dom=await boot(base()); const w=dom.window;
  await rigChat(w,[{name:'a.md',text:'x x'}]);
  w.eval(`(()=>{
    const m1={id:'A1',role:'assistant',content:'a',ts:Date.now(),edits:[
      {id:'e1',type:'replace',file:'a.md',find:'x',replace:'old',reason:'',status:'pending'}]};
    current.messages.push(m1);
    const m2={id:'A2',role:'assistant',content:'b',ts:Date.now(),edits:[
      {id:'e2',type:'replace',file:'a.md',find:'x',replace:'new',all:true,reason:'',status:'pending'}]};
    current.messages.push(m2); supersedeStale(current, m2);
  })()`);
  ck('older targeted replace superseded by the fresh global one',
    w.eval(`current.messages.find(m=>m.id==='A1').edits[0].status`)==='superseded');
  dom.window.close();
}

console.log('\nRESULT:',fail?('FAILURES: '+fail):'ALL PASS','('+pass+' checks)');
process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
