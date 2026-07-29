// TEST FILE — run with: node tests/v510test.js
// Guards v5.10.0: the model can now see the fate of its own edit cards. A
// request-time note is folded onto each SENT copy of a reply that proposed
// edits — applied / pending / skipped / superseded / FAILED-with-reason, and
// parse failures — so a failed locate tells the model to re-quote verbatim by
// itself, and it stops re-proposing applied or still-pending work. The note
// exists only on the wire: never stored, never rendered to the user.
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
const assembled=w=>w.eval(`JSON.stringify(assembleMessages('openai'))`);

(async()=>{

console.log('=== 1. EVERY STATUS SPEAKS, IN ONE NOTE ON THE RIGHT REPLY ===');
{
  const dom=await boot(base()); const w=dom.window;
  await rigChat(w,[{name:'a.md',text:'alpha beta gamma'}]);
  w.eval(`(()=>{
    current.messages.push({id:'U1',role:'user',content:'do things',ts:Date.now()});
    current.messages.push({id:'A1',role:'assistant',content:'done',ts:Date.now(),edits:[
      {id:'e1',type:'replace',file:'a.md',find:'alpha',replace:'x',reason:'',status:'applied'},
      {id:'e2',type:'replace',file:'a.md',find:'NOT IN FILE',replace:'x',reason:'',status:'failed',note:"couldn't find that text in the file"},
      {id:'e3',type:'append',file:'a.md',find:null,replace:'tail',reason:'',status:'pending'},
      {id:'e4',type:'insert',file:'a.md',find:'beta',replace:'y',reason:'',status:'skipped'},
      {id:'e5',type:'replace_all',file:'a.md',find:null,replace:'z',reason:'',status:'superseded'},
      {id:'e6',type:'create',find:null,name:'new.md',replace:'n',reason:'',status:'pending'}]});
  })()`);
  const p=assembled(w);
  ck('note is present on the wire', /\[state of the edits you proposed in this reply\]/.test(p));
  ck('applied is reported', /1\. find \\"alpha\\" in \\"a.md\\": applied/.test(p));
  ck('FAILED carries the reason', /FAILED \u2014 couldn't find that text in the file/.test(p));
  ck('FAILED instructs verbatim re-quote of that one edit', /character-for-character from the file below and re-send this one edit/.test(p));
  ck('pending says do not re-propose', /append in \\"a.md\\": pending \u2014 the user has not acted on it yet; do not re-propose it/.test(p));
  ck('skipped says do not re-send', /insert_after \\"beta\\" in \\"a.md\\": skipped by the user/.test(p));
  ck('superseded named', /full rewrite in \\"a.md\\": superseded by your newer proposal/.test(p));
  ck('create phrased by filename', /create_file \\"new.md\\": pending/.test(p));
  const body=JSON.parse(p).messages;
  const a1=body.find(m=>m.role==='assistant'&&/\[state of the edits/.test(String(m.content)));
  ck('note rides ON the assistant copy, after its prose', a1 && String(a1.content).indexOf('done')===0);
  dom.window.close();
}

console.log('=== 2. PARSE FAILURE FEEDS BACK TOO ===');
{
  const dom=await boot(base()); const w=dom.window;
  await rigChat(w,[{name:'a.md',text:'alpha'}]);
  w.eval(`(()=>{
    current.messages.push({id:'U1',role:'user',content:'go',ts:Date.now()});
    current.messages.push({id:'A1',role:'assistant',content:'here',ts:Date.now(),
      editError:"the edit block wasn't valid JSON \\u2014 ask for it again"});
  })()`);
  const p=assembled(w);
  ck('parse-failure note present', /your <docedits> block failed to parse/.test(p));
  ck('tells the model HOW to fix it', /strictly valid JSON/.test(p) && /no trailing commas/.test(p));
  dom.window.close();
}

console.log('=== 3. WIRE-ONLY: NEVER STORED, NEVER SHOWN, FREE WHEN CLEAN ===');
{
  const dom=await boot(base()); const w=dom.window,d=w.document;
  await rigChat(w,[{name:'a.md',text:'alpha'}]);
  w.eval(`(()=>{
    current.messages.push({id:'U1',role:'user',content:'hi',ts:Date.now()});
    current.messages.push({id:'A0',role:'assistant',content:'clean reply, no edits',ts:Date.now()});
    current.messages.push({id:'U2',role:'user',content:'edit it',ts:Date.now()});
    current.messages.push({id:'A1',role:'assistant',content:'sure',ts:Date.now(),edits:[
      {id:'e1',type:'append',file:'a.md',find:null,replace:'t',reason:'',status:'failed',note:'nope'}]});
    renderThread();
  })()`);
  const p=assembled(w);
  const body=JSON.parse(p).messages;
  const clean=body.find(m=>String(m.content)==='clean reply, no edits');
  ck('a reply without edits is sent byte-identical', !!clean);
  ck('stored message content untouched', w.eval(`current.messages.find(m=>m.id==='A1').content`)==='sure');
  ck('the user never sees the note in the thread', !/\[state of the edits/.test(d.querySelector('#thread').textContent));
  const notes=(p.match(/\[state of the edits/g)||[]).length;
  ck('exactly one note, on the one reply with edits', notes===1, notes);
  dom.window.close();
}

console.log('=== 4. THE LOOP END-TO-END: REAL FAILED APPLY → NOTE ON THE NEXT SEND ===');
{
  const dom=await boot(base()); const w=dom.window;
  await rigChat(w,[{name:'a.md',text:'the real file text'}]);
  // the model misquotes; the user taps Apply; locate fails FOR REAL
  w.eval(`(()=>{
    current.messages.push({id:'U1',role:'user',content:'fix it',ts:Date.now()});
    current.messages.push({id:'A1',role:'assistant',content:'ok',ts:Date.now(),edits:[
      {id:'e1',type:'replace',file:'a.md',find:'text the model imagined entirely on its own',replace:'x',reason:'',status:'pending'}]});
  })()`);
  await w.eval(`applyEdit('A1','e1')`); await sleep(50);
  const st=w.eval(`current.messages.find(m=>m.id==='A1').edits[0].status`);
  ck('the apply genuinely failed through the real path', st==='failed', st);
  let sentBody=null;
  w.fetch=(url,opt)=>{sentBody=opt&&opt.body;return Promise.resolve({ok:true,body:{getReader(){let d=false;return{read(){
    if(d)return Promise.resolve({done:true});d=true;
    return Promise.resolve({done:false,value:new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content:'redo'}}]})+'\n\ndata: [DONE]\n\n')});
  }};}}});};
  w.document.querySelector('#input').value='try again';
  await w.eval('send()'); await sleep(400);
  ck('the next request carries the failure', !!sentBody && /FAILED/.test(sentBody) && /couldn't find that text/.test(sentBody));
  ck('and the verbatim re-quote instruction', !!sentBody && /character-for-character/.test(sentBody));
  dom.window.close();
}

console.log('\nRESULT:',fail?('FAILURES: '+fail):'ALL PASS','('+pass+' checks)');
process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
