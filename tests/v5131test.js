// TEST FILE — run with: node tests/v5131test.js
// Guards v5.13.1: a docedits block can no longer hide. Blocks emitted inside
// inline think-tags OR on a separate reasoning channel are parsed, staged as
// cards, and scrubbed from the stored thinking; visible-text blocks win when
// both exist. And a zero-edit reply in a files chat says so on the wire, so
// a follow-up "is it done" reads machine truth instead of guessing "yes".
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const NL=String.fromCharCode(10);
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
// fetch stub: streams the given SSE chunks, records the request body
function stubStream(w, chunks){
  const rec={body:null};
  w.fetch=(url,opt)=>{rec.body=opt&&opt.body;let i=0;return Promise.resolve({ok:true,body:{getReader(){return{read(){
    if(i>=chunks.length)return Promise.resolve({done:true});
    const v=new TextEncoder().encode(chunks[i++]);
    return Promise.resolve({done:false,value:v});
  }};}}});};
  return rec;
}
const sse=o=>'data: '+JSON.stringify(o)+NL+NL;
const EDIT_BLOCK='<docedits>[{"file":"a.md","find":"alpha","replace":"ALPHA","reason":"fix"}]</docedits>';

(async()=>{

console.log('=== 1. BLOCK INSIDE INLINE <think> — STAGED, SCRUBBED, CARDED ===');
{
  const dom=await boot(base()); const w=dom.window,d=w.document;
  await rigChat(w,[{name:'a.md',text:'alpha beta'}]);
  stubStream(w,[
    sse({choices:[{delta:{content:'<think>planning the edit '+EDIT_BLOCK+' done planning</think>'}}]}),
    sse({choices:[{delta:{content:'Applied the fix to a.md.'}}]}),
    'data: [DONE]'+NL+NL]);
  d.querySelector('#input').value='fix it';
  await w.eval('send()'); await sleep(400);
  const m=JSON.parse(w.eval('JSON.stringify(current.messages[current.messages.length-1])'));
  ck('edits staged from thinking', m.edits&&m.edits.length===1, JSON.stringify(m.edits&&m.edits.map(e=>e.status)));
  ck('card is pending, awaiting the user', m.edits[0].status==='pending');
  ck('block scrubbed from stored thinking', !/docedits/.test(m.thinking||''), JSON.stringify(m.thinking));
  ck('prose reply untouched', m.content==='Applied the fix to a.md.');
  w.eval('renderThread()');
  ck('confirmation card visible in the DOM', !!d.querySelector('.edit-card'));
  dom.window.close();
}

console.log('=== 2. BLOCK ON THE SEPARATE reasoning CHANNEL — SAME RESCUE ===');
{
  const dom=await boot(base()); const w=dom.window,d=w.document;
  await rigChat(w,[{name:'a.md',text:'alpha beta'}]);
  stubStream(w,[
    sse({choices:[{delta:{reasoning_content:'let me stage this '+EDIT_BLOCK}}]}),
    sse({choices:[{delta:{content:'Done — a.md updated.'}}]}),
    'data: [DONE]'+NL+NL]);
  d.querySelector('#input').value='fix it';
  await w.eval('send()'); await sleep(400);
  const m=JSON.parse(w.eval('JSON.stringify(current.messages[current.messages.length-1])'));
  ck('edits staged from reasoning channel', m.edits&&m.edits.length===1);
  ck('reasoning scrubbed of the block', !/docedits/.test(m.thinking||''));
  dom.window.close();
}

console.log('=== 3. VISIBLE BLOCK STILL WINS — NO DOUBLE-STAGE ===');
{
  const dom=await boot(base()); const w=dom.window,d=w.document;
  await rigChat(w,[{name:'a.md',text:'alpha beta'}]);
  stubStream(w,[
    sse({choices:[{delta:{content:'<think>maybe '+EDIT_BLOCK+'</think>'}}]}),
    sse({choices:[{delta:{content:'Here: <docedits>[{"file":"a.md","find":"beta","replace":"BETA","reason":"r"}]</docedits>'}}]}),
    'data: [DONE]'+NL+NL]);
  d.querySelector('#input').value='fix it';
  await w.eval('send()'); await sleep(400);
  const m=JSON.parse(w.eval('JSON.stringify(current.messages[current.messages.length-1])'));
  ck('exactly one edit staged (visible wins)', m.edits&&m.edits.length===1, JSON.stringify(m.edits&&m.edits.length));
  ck('and it is the visible one', m.edits[0].find==='beta');
  dom.window.close();
}

console.log('=== 4. ZERO-EDIT REPLY IN A FILES CHAT SAYS SO ON THE WIRE ===');
{
  const dom=await boot(base()); const w=dom.window,d=w.document;
  await rigChat(w,[{name:'a.md',text:'alpha'}]);
  // reply that only TALKS about editing — the exact reported failure
  stubStream(w,[sse({choices:[{delta:{content:'Applying the three fixes now. Edit 1 done.'}}]}),'data: [DONE]'+NL+NL]);
  d.querySelector('#input').value='fix the file';
  await w.eval('send()'); await sleep(400);
  // next turn: "is it done" — inspect what actually goes to the model
  const rec=stubStream(w,[sse({choices:[{delta:{content:'No.'}}]}),'data: [DONE]'+NL+NL]);
  d.querySelector('#input').value='is it done';
  await w.eval('send()'); await sleep(400);
  ck('the wire carries the no-edits truth', !!rec.body && /no file edits were proposed/.test(rec.body));
  ck('and the NOT-been-made warning', /have NOT been made/.test(rec.body));
  const m=JSON.parse(w.eval('JSON.stringify(current.messages.filter(x=>x.role==="assistant")[0])'));
  ck('note is wire-only — stored content clean', !/no file edits/.test(m.content));
  w.eval('renderThread()');
  ck('and never rendered to the user', !/no file edits were proposed/.test(d.querySelector('#thread').textContent));
  dom.window.close();
}

console.log('=== 5. NO FILES ATTACHED → REPLIES BYTE-IDENTICAL (ZERO TAX) ===');
{
  const dom=await boot(base()); const w=dom.window,d=w.document;
  await w.eval('(async()=>{ current=null; convos=[]; docs=[]; const c=newConvo(); c.filesOn=false; })()');
  stubStream(w,[sse({choices:[{delta:{content:'Just chatting.'}}]}),'data: [DONE]'+NL+NL]);
  d.querySelector('#input').value='hi';
  await w.eval('send()'); await sleep(400);
  const rec=stubStream(w,[sse({choices:[{delta:{content:'ok'}}]}),'data: [DONE]'+NL+NL]);
  d.querySelector('#input').value='and?';
  await w.eval('send()'); await sleep(400);
  ck('no note anywhere without files', !!rec.body && !/no file edits/.test(rec.body));
  dom.window.close();
}

console.log('=== 6. PROTOCOL FORBIDS THE LIE AT THE SOURCE ===');
{
  const dom=await boot(base()); const w=dom.window;
  const proto=w.eval("doceditProtocol([{name:'a.md'}])");
  ck('block must live in the reply, never thinking', /NEVER inside/.test(proto)&&/thinking or reasoning/.test(proto));
  ck('never claim an unemitted edit', /Never say or imply an edit was\s+made unless you emitted the block/.test(proto));
  dom.window.close();
}

console.log(NL+'RESULT:',fail?('FAILURES: '+fail):'ALL PASS','('+pass+' checks)');
process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
