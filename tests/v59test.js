// TEST FILE — run with: node tests/v59test.js
// Guards v5.9.0: stale proposals can no longer double-apply. When a fresh
// reply stages edit cards, older still-pending cards that provably collide
// are marked superseded — newest wins, visibly. And every version of a reply
// now keeps its OWN cards: swiping saves the outgoing version's cards and
// restores the incoming version's, so one version's prose never sits over
// another version's cards, and a regenerate no longer drops them.
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

// Build a chat with attached file(s) inside the real app, entirely through
// its own functions. Returns nothing; state lives in the window.
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
// Stage an assistant reply carrying edits, exactly as stream-finish does:
// set edits, then run the supersede pass with the new message.
function stage(w, edits){
  return w.eval(`(()=>{
    const m = { id:uid(), role:'assistant', content:'ok', ts:Date.now(),
                edits: ${JSON.stringify(edits)}.map(e => Object.assign({id:uid(),status:'pending'}, e)) };
    current.messages.push(m);
    supersedeStale(current, m);
    return m.id;
  })()`);
}
const statuses=(w,msgId)=>w.eval(`current.messages.find(m=>m.id==='${msgId}').edits.map(e=>e.status)`);
const docText=(w,name)=>w.eval(`(docs.find(d=>d.name==='${name}')||{}).text`);

(async()=>{

console.log('=== 1. THE REPORTED CLASS: DUPLICATE APPEND ACROSS TWO REPLIES ===');
{
  const dom=await boot(base()); const w=dom.window;
  await rigChat(w,[{name:'a.md',text:'alpha'}]);
  const m1=stage(w,[{type:'append',file:'',find:null,replace:'NEW SECTION',reason:'r'}]);
  const m2=stage(w,[{type:'append',file:'',find:null,replace:'NEW SECTION',reason:'r'}]);
  ck('older identical append is superseded', statuses(w,m1)[0]==='superseded', statuses(w,m1)[0]);
  ck('fresh append stays pending', statuses(w,m2)[0]==='pending');
  await w.eval(`applyAll('${m2}')`); await sleep(50);
  await w.eval(`applyAll('${m1}')`); await sleep(50); // stale Apply-all must be a no-op
  const t=docText(w,'a.md');
  ck('file got the append exactly once', t.split('NEW SECTION').length===2, JSON.stringify(t));
  const el=w.eval(`current.messages.find(m=>m.id==='${m1}').edits[0].status`);
  ck('old card still shows superseded after the attempt', el==='superseded', el);
  dom.window.close();
}

console.log('=== 2. THE NESTING CLASS: SAME FIND, REPLACEMENT CONTAINS IT ===');
{
  const dom=await boot(base()); const w=dom.window;
  await rigChat(w,[{name:'a.md',text:'the king rules'}]);
  const m1=stage(w,[{type:'replace',file:'',find:'king',replace:'king of ash',reason:'r'}]);
  const m2=stage(w,[{type:'replace',file:'',find:'king',replace:'king of embers',reason:'r'}]);
  ck('older same-find replace is superseded', statuses(w,m1)[0]==='superseded');
  await w.eval(`applyAll('${m2}')`); await sleep(50);
  await w.eval(`applyEdit('${m1}', current.messages.find(m=>m.id==='${m1}').edits[0].id)`); await sleep(50);
  const t=docText(w,'a.md');
  ck('no nested garbage — fresh replacement only', t==='the king of embers rules', JSON.stringify(t));
  dom.window.close();
}

console.log('=== 3. WHAT MUST BE LEFT ALONE ===');
{
  const dom=await boot(base()); const w=dom.window;
  await rigChat(w,[{name:'a.md',text:'one two three anchor line four'}]);
  const m1=stage(w,[
    {type:'replace',file:'',find:'one two',replace:'ONE',reason:'rephrased target'},
    {type:'insert',file:'',find:'anchor line',replace:'inserted',reason:'insert side'},
    {type:'insert',file:'',find:'anchor line',replace:'other text',reason:'same anchor diff text'},
    {type:'append',file:'',find:null,replace:'tail A',reason:'append diff text'},
    {type:'replace_all',file:'',find:null,replace:'REWRITE',reason:'older rewrite'}]);
  const m2=stage(w,[
    {type:'replace',file:'',find:'two three',replace:'ONE',reason:'different find, same aim'},
    {type:'replace',file:'',find:'anchor line',replace:'replaced',reason:'replace sharing insert anchor'},
    {type:'append',file:'',find:null,replace:'tail B',reason:'different append'}]);
  const st=statuses(w,m1);
  ck('rephrased find NOT superseded', st[0]==='pending', st[0]);
  ck('insert vs replace on one anchor NOT superseded', st[1]==='pending', st[1]);
  ck('same-anchor different-text insert NOT superseded', st[2]==='pending', st[2]);
  ck('different-text append NOT superseded', st[3]==='pending', st[3]);
  ck('OLDER full rewrite vs newer targeted edit NOT superseded', st[4]==='pending', st[4]);
  dom.window.close();
}

console.log('=== 4. FULL-REWRITE AND CREATE COLLISIONS ===');
{
  const dom=await boot(base()); const w=dom.window;
  await rigChat(w,[{name:'a.md',text:'alpha'},{name:'b.md',text:'beta'}]);
  const m1=stage(w,[
    {type:'replace',file:'a.md',find:'alpha',replace:'x',reason:'on a'},
    {type:'insert',file:'a.md',find:'alpha',replace:'y',reason:'on a'},
    {type:'replace',file:'b.md',find:'beta',replace:'z',reason:'on b'},
    {type:'create',find:null,name:'notes.md',replace:'n1',reason:'make notes'}]);
  const m2=stage(w,[
    {type:'replace_all',file:'a.md',find:null,replace:'ALL NEW',reason:'rewrite a'},
    {type:'create',find:null,name:'NOTES.md',replace:'n2',reason:'make notes again'}]);
  const st=statuses(w,m1);
  ck('pending replace on rewritten file superseded', st[0]==='superseded', st[0]);
  ck('pending insert on rewritten file superseded', st[1]==='superseded', st[1]);
  ck('pending edit on the OTHER file untouched', st[2]==='pending', st[2]);
  ck('duplicate create (case-insensitive name) superseded', st[3]==='superseded', st[3]);
  dom.window.close();
}

console.log('=== 5. MULTI-FILE PROOF RULES + SETTLED CARDS ===');
{
  const dom=await boot(base()); const w=dom.window;
  await rigChat(w,[{name:'a.md',text:'same words'},{name:'b.md',text:'same words'}]);
  const m1=stage(w,[
    {type:'replace',file:'a.md',find:'same words',replace:'x',reason:'file a'},
    {type:'replace',file:'ghost.md',find:'same words',replace:'x',reason:'unresolvable'},
    {type:'replace',file:'b.md',find:'gone',replace:'x',reason:'will be applied-state'}]);
  w.eval(`(()=>{const m=current.messages.find(m=>m.id==='${m1}');
    m.edits[2].status='applied';})()`);
  const m2=stage(w,[
    {type:'replace',file:'b.md',find:'same words',replace:'y',reason:'same find, other file'},
    {type:'replace',file:'b.md',find:'gone',replace:'y',reason:'same find as an applied card'}]);
  const st=statuses(w,m1);
  ck('same find on a DIFFERENT file not superseded', st[0]==='pending', st[0]);
  ck('unresolvable target not superseded (cannot prove)', st[1]==='pending', st[1]);
  ck('non-pending cards never touched', st[2]==='applied', st[2]);
  dom.window.close();
}

console.log('=== 6. EVERY VERSION KEEPS ITS OWN CARDS (SWIPE, THROUGH THE REAL UI) ===');
{
  const dom=await boot(base()); const w=dom.window,d=w.document;
  await rigChat(w,[{name:'a.md',text:'alpha'}]);
  // a last-assistant reply with two versions, each carrying its own edits
  await w.eval(`(()=>{
    current.messages.push({id:'U1',role:'user',content:'hi',ts:Date.now()});
    const m={id:'A1',role:'assistant',content:'v2 prose',ts:Date.now(),
      edits:[{id:'e2',type:'append',find:null,file:'',replace:'from v2',reason:'',status:'pending'}],
      variants:[
        {content:'v1 prose',edits:[{id:'e1',type:'append',find:null,file:'',replace:'from v1',reason:'',status:'pending'}]},
        {content:'v2 prose',edits:null}
      ],vi:1};
    current.messages.push(m); renderThread();
  })()`);
  const btnPrev=d.querySelector('[data-swipe="A1"][data-dir="-1"]');
  ck('swipe control renders on the versioned reply', !!btnPrev);
  btnPrev.dispatchEvent(new w.Event('click',{bubbles:true})); await sleep(80);
  let live=w.eval(`current.messages.find(m=>m.id==='A1')`);
  ck('back on v1: v1 prose', live.content==='v1 prose', live.content);
  ck('back on v1: v1 CARDS', live.edits && live.edits[0].id==='e1', live.edits&&live.edits[0].id);
  ck('leaving v2 saved v2 cards into its version', w.eval(`(current.messages.find(m=>m.id==='A1').variants[1].edits||[]).map(e=>e.id)[0]`)==='e2');
  const cardTxt=d.querySelector('.edit-card .add'); 
  ck('DOM shows v1 card text', !!cardTxt && /from v1/.test(cardTxt.textContent), cardTxt&&cardTxt.textContent);
  const btnNext=d.querySelector('[data-swipe="A1"][data-dir="1"]');
  btnNext.dispatchEvent(new w.Event('click',{bubbles:true})); await sleep(80);
  live=w.eval(`current.messages.find(m=>m.id==='A1')`);
  ck('forward again: v2 prose over v2 cards', live.content==='v2 prose' && live.edits[0].id==='e2');
  dom.window.close();
}

console.log('=== 7. RENDERER: SUPERSEDED IS VISIBLE AND EXCLUDED FROM APPLY-ALL ===');
{
  const dom=await boot(base()); const w=dom.window,d=w.document;
  await rigChat(w,[{name:'a.md',text:'alpha'}]);
  const m1=stage(w,[{type:'append',file:'',find:null,replace:'dup',reason:'r'}]);
  const m2=stage(w,[{type:'append',file:'',find:null,replace:'dup',reason:'r'}]);
  w.eval('renderThread()');
  const cards=[...d.querySelectorAll('.edit-card')];
  ck('two cards rendered', cards.length===2, cards.length);
  const supers=cards.find(c=>/Superseded/.test(c.textContent));
  ck('superseded card says so', !!supers);
  ck('superseded card styled as done', supers && supers.className.includes('done'));
  const heads=[...d.querySelectorAll('.edits')];
  const oldHead=heads[0], newHead=heads[1];
  ck('old reply has NO Apply-all (nothing pending)', oldHead && !oldHead.querySelector('[data-applyall]'));
  ck('fresh reply keeps its Apply-all', newHead && !!newHead.querySelector('[data-applyall]'));
  dom.window.close();
}

console.log('=== 8. THE REAL WIRING: A STREAMED REPLY SUPERSEDES THROUGH send() ===');
{
  // not the stage() mirror — the actual pipeline: fetch stream → splitReasoning
  // → parseDocEdits → strip → supersedeStale, exactly as stream-finish runs it.
  const reply='sure<docedits>[{"append":true,"replace":"dup","reason":"again"}]</docedits>';
  const sse='data: '+JSON.stringify({choices:[{delta:{content:reply}}]})+'\n\ndata: [DONE]\n\n';
  const dom=await boot(base()); const w=dom.window;
  w.fetch=()=>Promise.resolve({ok:true,body:{getReader(){let done=false;return{read(){
    if(done)return Promise.resolve({done:true});
    done=true;return Promise.resolve({done:false,value:new TextEncoder().encode(sse)});
  }};}}});
  await rigChat(w,[{name:'a.md',text:'alpha'}]);
  const m1=stage(w,[{type:'append',file:'',find:null,replace:'dup',reason:'first'}]);
  w.document.querySelector('#input').value='again please';
  await w.eval('send()'); await sleep(400);
  ck('older pending append superseded by the STREAMED reply', statuses(w,m1)[0]==='superseded', statuses(w,m1)[0]);
  const last=w.eval('current.messages[current.messages.length-1]');
  ck('streamed reply staged its own pending card', last.edits && last.edits[0].status==='pending');
  ck('docedits block stripped from the shown prose', last.content==='sure', JSON.stringify(last.content));
  dom.window.close();
}

console.log('\nRESULT:',fail?('FAILURES: '+fail):'ALL PASS','('+pass+' checks)');
process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
