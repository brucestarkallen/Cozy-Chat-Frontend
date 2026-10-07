// TEST FILE — run with: node tests/v5284test.js
// Guards v5.28.4, every check through the live path (send(), buildPayload(),
// renderThread()) with the service mocked at fetch:
//   1. a reply that never came is never sent as the model's own words, and a
//      reply that was all reasoning is never an empty turn (Claude refuses one)
//   2. More on such a reply starts it instead of carrying on from Cozy's line
//   3. Hermes not running does not switch its Runs API off for good
//   4. an error that is not JSON still says what the service said
//   5. a search service Cozy does not know cannot crash a send
//   6. a redraw keeps a sources list open and a table where it was swiped
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=(o)=>Object.assign({
  providers:[{id:'a',preset:'anthropic',kind:'anthropic',name:'Claude',url:'https://api.anthropic.com/v1',apiKey:'k',model:'claude-sonnet-4-6',ctx:200000},
             {id:'o',preset:'custom',kind:'openai',name:'O',url:'https://o.test/v1',apiKey:'k',model:'m',ctx:100000},
             {id:'h',preset:'hermes',kind:'openai',name:'Hermes Agent',url:'http://127.0.0.1:8642/v1',apiKey:'k',model:'hermes-agent',ctx:200000,hermesRuns:true}],
  activeProvider:'o',presets:[{id:'d',name:'D',system:'Be kind.',injections:[],order:['__main__','__chat__']}],
  activePreset:'d',prompts:[],maxTokens:4096,effort:'off',showThinking:true,catchThinkTags:true,thinkTags:'think',
  enterSends:false,autoTitle:false,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}},o||{});
function boot(st,f){return new Promise(res=>{
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
    beforeParse(w){
      w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
      w.navigator.storage={estimate:async()=>({usage:0})};
      w.requestAnimationFrame=cb=>setTimeout(cb,0);
      w.confirm=()=>true;w.navigator.clipboard={writeText:async()=>{}};
      w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
      if(f)w.fetch=f(w);
    }});
  setTimeout(async()=>{try{
    await dom.window.eval('Promise.all([DB.clear(),DB.docClear()])');
    dom.window.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();');
  }catch(_){}res(dom);},750);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ev=(w,el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true}));
const enc=t=>new TextEncoder().encode(t);
const oa=t=>'data: '+JSON.stringify({choices:[{delta:{content:t}}]})+'\n\n';
// a streamed reply made of these SSE chunks
const stream=chunks=>{let i=0;return{ok:true,status:200,body:{getReader(){return{read(){
  return Promise.resolve(i<chunks.length?{done:false,value:enc(chunks[i++])}:{done:true});}};}}};};
function sendText(w,t){const d=w.document;d.querySelector('#input').value=t;ev(w,d.querySelector('#input'),'input');ev(w,d.querySelector('#sendBtn'),'click');}
const NOTE_HEAD='[cozy \u2014 machine state written by the app about the reply above.';

(async()=>{

console.log('=== 1. A REPLY THAT NEVER CAME, ON THE WIRE ===');
{
  const dom=await boot(base());const w=dom.window;
  w.eval(`newConvo(); current.messages.push(
    {id:'u1',role:'user',content:'Write me a poem'},
    {id:'a1',role:'assistant',content:'',thinking:'All of the tokens went here'},
    {id:'u2',role:'user',content:'Hello?'},
    {id:'a2',role:'assistant',content:'_(stopped)_'},
    {id:'u3',role:'user',content:'Again'},
    {id:'a3',role:'assistant',content:'_(empty reply)_'},
    {id:'u4',role:'user',content:'Once more'},
    {id:'a4',role:'assistant',content:'A real answer.'},
    {id:'u5',role:'user',content:'Thanks'});`);
  for (const pid of ['a','o']){
    w.eval(`current.cfg.providerId='${pid}'`);
    const msgs=w.eval('buildPayload({},current)').body.messages.filter(m=>m.role==='assistant');
    const said=msgs.map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content));
    ck(pid+': no assistant turn goes out empty', said.every(t=>t.trim().length>0), JSON.stringify(said.map(t=>t.slice(0,20))));
    ck(pid+': the reasoning-only reply is Cozy\u2019s attributed note', said[0].startsWith(NOTE_HEAD) && /only the model's reasoning/.test(said[0]), said[0].slice(0,60));
    ck(pid+': "(stopped)" is never sent as the model\u2019s words', !said.some(t=>t==='_(stopped)_') && said[1].startsWith(NOTE_HEAD) && /stopped before any text/.test(said[1]));
    ck(pid+': nor "(empty reply)"', !said.some(t=>t==='_(empty reply)_') && said[2].startsWith(NOTE_HEAD));
    ck(pid+': a real reply goes exactly as written', said[3]==='A real answer.', said[3]);
  }
  // the same chat ending on the reply More would carry on
  w.eval(`current.cfg.providerId='o'; current.messages.push({id:'a5',role:'assistant',content:'_(stopped)_'});`);
  const tail=w.eval('buildPayload({mode:"continue"},current)').body.messages.slice(-1)[0];
  ck('as the turn More carries on, a placeholder starts from nothing', tail.role==='assistant' && tail.content==='', JSON.stringify(tail));
  w.eval(`current.messages[current.messages.length-1].content='Half a sente'`);
  const tail2=w.eval('buildPayload({mode:"continue"},current)').body.messages.slice(-1)[0];
  ck('and a real half reply is carried on as written', tail2.content==='Half a sente', JSON.stringify(tail2));
}

console.log('\n=== 2. MORE ON A REPLY THAT NEVER CAME ===');
{
  let reply=[oa('The fox '),oa('looked up.')];
  const dom=await boot(base(),w=>()=>Promise.resolve(stream(reply)));
  const w=dom.window;
  w.eval(`newConvo(); current.messages.push({id:'u1',role:'user',content:'Story'},{id:'a1',role:'assistant',content:'_(stopped)_',variants:[{content:'_(stopped)_',thinking:''}],vi:0}); renderThread();`);
  w.eval('send(null,"continue",current)'); await sleep(300);
  const c1=w.eval('current.messages[1].content');
  ck('it becomes the reply, not "(stopped)" followed by the reply', c1==='The fox looked up.', JSON.stringify(c1));
  w.eval(`current.messages[1].content='_(stopped)_'`);
  reply=[];                                      // nothing comes this time either
  w.eval('send(null,"continue",current)'); await sleep(300);
  const c2=w.eval('current.messages[1].content');
  ck('when nothing comes again, the reply still says what happened', /^_\((stopped|empty reply)\)_$/.test(c2), JSON.stringify(c2));
}

console.log('\n=== 3. HERMES NOT RUNNING DOES NOT SWITCH ITS RUNS API OFF ===');
{
  let up=false;
  const dom=await boot(base({activeProvider:'h'}),w=>{w.__calls=[];return (url)=>{
    w.__calls.push(String(url));
    if(!up) return Promise.reject(new TypeError('Failed to fetch'));       // nothing listening at all
    if(/\/runs$/.test(url)) return Promise.reject(new TypeError('Failed to fetch'));   // server up, no Runs API
    return Promise.resolve(stream([oa('plain stream answered')]));
  };});
  const w=dom.window;
  w.eval('newConvo()');
  sendText(w,'hello while Hermes is stopped'); await sleep(400);
  ck('the message fails with the reason', w.eval('current.messages.some(m=>m.role==="error")'));
  ck('the Runs API is not remembered as missing', !w.eval('S.providers.find(x=>x.id==="h").runsDownAt'),
     String(w.eval('S.providers.find(x=>x.id==="h").runsDownAt')));
  const runsTries=()=>w.__calls.filter(u=>/\/runs$/.test(u)).length;
  const before=runsTries();
  up=true;
  sendText(w,'hello again, Hermes is up'); await sleep(400);
  ck('so the next message tries the Runs API again', runsTries()===before+1, runsTries()+' vs '+before);
  ck('a server that answers without a Runs API is remembered as having none', !!w.eval('S.providers.find(x=>x.id==="h").runsDownAt'));
  ck('and that message still arrives over the plain stream', w.eval('current.messages.slice(-1)[0].content')==='plain stream answered',
     JSON.stringify(w.eval('current.messages.slice(-1)[0].content')));
}

console.log('\n=== 4. AN ERROR THAT IS NOT JSON STILL SAYS WHAT HAPPENED ===');
{
  // A real Response: its body can be read once, exactly like a browser's.
  const dom=await boot(base(),()=>()=>Promise.resolve(new Response('upstream timed out after 60s',{status:502})));
  const w=dom.window;
  w.eval('newConvo()');
  sendText(w,'hi'); await sleep(400);
  const err=w.eval('(current.messages.find(m=>m.role==="error")||{}).content')||'';
  ck('the service\u2019s own words reach the error', /upstream timed out after 60s/.test(err), JSON.stringify(err.slice(0,120)));
  ck('instead of "No details given."', !/No details given/.test(err));
  const dom2=await boot(base(),()=>()=>Promise.resolve(new Response(JSON.stringify({error:{message:'model not found: m'}}),{status:404})));
  const w2=dom2.window; w2.eval('newConvo()');
  sendText(w2,'hi'); await sleep(400);
  const err2=w2.eval('(current.messages.find(m=>m.role==="error")||{}).content')||'';
  ck('a JSON error still gives its message', /model not found: m/.test(err2), JSON.stringify(err2.slice(0,120)));
}

console.log('\n=== 5. A SEARCH SERVICE COZY DOES NOT KNOW ===');
{
  const toasts=[];
  const dom=await boot(base({search:{on:true,provider:'bing',key:'K',count:5,relay:'',always:true,images:false,auto:false,model:false}}),
    ()=>()=>Promise.resolve(stream([oa('answered anyway')])));
  const w=dom.window;
  const t=w.document.querySelector('#toast');
  new w.MutationObserver(()=>toasts.push(t.textContent)).observe(t,{childList:true,characterData:true,subtree:true});
  w.eval('newConvo()');
  sendText(w,'what is new'); await sleep(400);
  ck('no script error reaches the screen', !toasts.some(x=>/Cannot read|undefined/.test(x)), JSON.stringify(toasts));
  ck('the reply still arrives', w.eval('current.messages.slice(-1)[0].content')==='answered anyway');
}

console.log('\n=== 6. A REDRAW KEEPS WHAT THE READER OPENED OR SWIPED ===');
{
  const table='| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n';
  let i=0; const chunks=[oa(table),oa('and some prose'),oa(' that keeps coming.')];
  const dom=await boot(base(),w=>()=>Promise.resolve({ok:true,status:200,body:{getReader(){return{read(){
    if(i>=chunks.length) return Promise.resolve({done:true});
    return new Promise(r=>{w.__step=()=>r({done:false,value:enc(chunks[i++])});});
  }};}}}));
  const w=dom.window,d=w.document;
  w.eval(`newConvo(); current.messages.push({id:'u0',role:'user',content:'look',sources:[{title:'One',url:'https://one.test/',snippet:'x'}]}); renderThread();`);
  const src=d.querySelector('.msg.user details.sources');
  src.open=true;
  w.eval('renderThread()');
  ck('an opened sources list stays open through a redraw', d.querySelector('.msg.user details.sources').open===true);
  sendText(w,'a table please'); await sleep(80);
  w.__step(); await sleep(60);
  const tb=d.querySelector('.msg.assistant .msg-body table');
  ck('setup: the table is on screen', !!tb);
  tb.scrollLeft=90;                              // swiped sideways while the reply streams
  w.__step(); await sleep(60);
  const tb2=d.querySelector('.msg.assistant .msg-body table');
  ck('the next token rebuilt it', tb2!==tb);
  ck('and it is where it was swiped', tb2.scrollLeft===90, tb2.scrollLeft);
  w.__step(); await sleep(250);
  ck('still there when the reply finishes and the thread redraws', d.querySelector('.msg.assistant .msg-body table').scrollLeft===90,
     d.querySelector('.msg.assistant .msg-body table').scrollLeft);
  ck('the sources list is still open after all of it', d.querySelector('.msg.user details.sources').open===true);
}

console.log('\n=== 7. SMALLER THINGS FOUND IN THE SAME READ ===');
{
  const toasts=[];
  let modelsBody={object:'list'};
  const dom=await boot(base(),w=>(url)=>{
    if(/\/models$/.test(String(url))) return Promise.resolve(new Response(JSON.stringify(modelsBody),{status:200}));
    return Promise.resolve(new Response('key revoked by the owner',{status:401}));
  });
  const w=dom.window,d=w.document;
  const t=d.querySelector('#toast');
  new w.MutationObserver(()=>toasts.push(t.textContent)).observe(t,{childList:true,characterData:true,subtree:true});
  // a failed edit is saved as failed, so the next request and a reload both say so
  w.eval(`newConvo(); current.messages.push({id:'u1',role:'user',content:'edit it'},
    {id:'a1',role:'assistant',content:'done',edits:[{id:'e1',type:'replace',file:'gone.md',find:'a',replace:'b',status:'pending'}]}); renderThread();`);
  await w.eval('applyEdit("a1","e1")');
  const stored=(await w.eval('DB.all()')).find(c=>c.id===w.eval('current.id'));
  const se=stored&&stored.messages[1].edits[0];
  ck('an edit with no file to land in is saved as failed', se&&se.status==='failed', JSON.stringify(se&&{status:se.status,note:se.note}));
  // Test says what the service said, even in plain text
  w.eval('openSettings(); editProv("o")');
  await w.eval('testProv()'); await sleep(50);
  ck('Test shows the service\u2019s own words', toasts.some(x=>/key revoked by the owner/.test(x)), JSON.stringify(toasts.slice(-2)));
  // a model list in a shape Cozy does not know
  await w.eval('loadModels()'); await sleep(50);
  ck('an unknown list shape reads as empty, not as a script error',
     toasts.some(x=>/returned an empty list/.test(x)) && !toasts.some(x=>/is not a function/.test(x)), JSON.stringify(toasts.slice(-1)));
  modelsBody={data:[{id:'m2'},{id:'m1'}]};
  await w.eval('loadModels()'); await sleep(50);
  ck('the OpenAI shape still lists its models', toasts.some(x=>/Found 2 models/.test(x)), JSON.stringify(toasts.slice(-1)));
  // a chat cannot be renamed to nothing
  w.prompt=()=>'    ';
  const before=w.eval('current.title');
  ev(w,d.querySelector('#chatTitle'),'click'); await sleep(50);
  ck('renaming to spaces leaves the title alone', w.eval('current.title')===before, JSON.stringify(w.eval('current.title')));
  // a dropped file that is not text is not attached as text
  const pdf=new w.File(['%PDF-1.7\n\u0000\u0001\u0002 stream bytes'],'paper.pdf',{type:'application/pdf'});
  const md=new w.File(['# Notes\nplain words'],'notes.md',{type:'text/markdown'});
  await w.eval('(f1,f2)=>addAttachments([f1,f2])')(pdf,md);
  const att=w.eval('pendingAtts.map(a=>a.name)');
  ck('a PDF is not attached as text', att.indexOf('paper.pdf')<0, JSON.stringify(att));
  ck('and says so by name', toasts.some(x=>/paper\.pdf isn't a text file/.test(x)), JSON.stringify(toasts.slice(-2)));
  ck('a text file still attaches', att.indexOf('notes.md')>=0);
}

console.log('\n=== 8. THE FILE EDITOR KEEPS WHAT WAS TYPED ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document;
  const doc=await w.eval('newDoc("notes.md","first draft")');
  const textOf=()=>w.eval('docs.find(x=>x.id==="'+doc.id+'").text');
  w.eval('openDocEditor("'+doc.id+'")');
  d.querySelector('#docEditArea').value='second draft, typed';
  ev(w,d.querySelector('#closeDocEdit'),'click'); await sleep(150);
  ck('closing the editor keeps the typing', textOf()==='second draft, typed', JSON.stringify(textOf()));
  const stored=(await w.eval('DB.docAll()')).find(x=>x.id===doc.id);
  ck('saved where the file lives', !!stored && stored.text==='second draft, typed');
  ck('with the old text one undo away', w.eval('((docs.find(x=>x.id==="'+doc.id+'").undo||[]).slice(-1)[0]||{}).text')==='first draft');
  w.eval('newConvo(); openDocEditor("'+doc.id+'")');
  d.querySelector('#docEditArea').value='third draft, then Attach';
  ev(w,d.querySelector('#docAttachBtn'),'click'); await sleep(200);
  ck('Attach attaches what was typed, not the old text', w.eval('(chatDocs()[0]||{}).text')==='third draft, then Attach', JSON.stringify(w.eval('(chatDocs()[0]||{}).text')));
  w.eval('openDocEditor("'+doc.id+'")');
  d.querySelector('#docEditArea').value='fourth, then the phone switched apps';
  Object.defineProperty(d,'visibilityState',{configurable:true,get:()=>'hidden'});
  d.dispatchEvent(new w.Event('visibilitychange')); await sleep(150);
  ck('the page going to the background keeps it too', textOf()==='fourth, then the phone switched apps');
  ck('an untouched file is not saved again on close', (function(){ const n=w.eval('(docs.find(x=>x.id==="'+doc.id+'").undo||[]).length'); w.eval('closeDocEdit()'); return w.eval('(docs.find(x=>x.id==="'+doc.id+'").undo||[]).length')===n; })());
}

console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})();
