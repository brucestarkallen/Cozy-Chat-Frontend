// TEST FILE — run with: node tests/v52test.js
// Guards v5.2.0: a stream is bound to its conversation, a superseded stream
// yields cleanly, a late paint can no longer clobber the finished message,
// a failed swipe keeps its versions, backups carry files, restore runs the
// settings migrations, copy/import keep a set's order, provider changes drop
// stale per-chat model picks, archive exists, dropped files attach.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=(o={})=>Object.assign({
  providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000}],
  activeProvider:'p1',presets:[{id:'d',name:'D',system:'',injections:[],order:['__main__','__chat__']}],
  activePreset:'d',prompts:[],temperature:1,maxTokens:4096,effort:'off',squashSystem:true,
  showThinking:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}},o);
function boot(st,f){return new Promise(res=>{
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
    beforeParse(w){
      w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
      w.navigator.storage={estimate:async()=>({usage:0})};
      w.requestAnimationFrame=cb=>setTimeout(cb,0);
      w.confirm=()=>true;w.prompt=(q,d)=>d||'X';w.navigator.clipboard={writeText:async()=>{}};
      w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
      if(f)w.fetch=f(w);
    }});
  setTimeout(async()=>{try{
    await dom.window.eval('Promise.all([DB.clear(),DB.docClear()])');
    dom.window.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();');
  }catch(_){}res(dom);},750);});}
const ev=(w,el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true}));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// a stream the test steps through by hand; respects the abort signal
function gated(w,chunks){
  const enc=t=>new TextEncoder().encode(t);
  let i=0;
  w.__step=null;
  const next=()=>new Promise(res=>{w.__step=()=>{w.__step=null;res();};});
  return (url,opts)=>{
    const sig=opts&&opts.signal;
    return Promise.resolve({ok:true,body:{getReader(){return{read(){
      return new Promise((res,rej)=>{
        const bail=()=>rej(Object.assign(new Error('aborted'),{name:'AbortError'}));
        if(sig&&sig.aborted)return bail();
        if(sig)sig.addEventListener('abort',bail,{once:true});
        if(i>=chunks.length)return res({done:true});
        next().then(()=>{ if(sig&&sig.aborted)return; res({done:false,value:enc(chunks[i++])}); });
      });}};}}});
  };
}
const oa=t=>'data: '+JSON.stringify({choices:[{delta:{content:t}}]})+'\n\n';

(async()=>{

console.log('=== 1. THE STREAM BELONGS TO ITS CHAT ===');
{
  const dom=await boot(base(),w=>gated(w,[oa('part one. '),oa('part two.')]));
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  const aId=w.eval('current.id');
  d.querySelector('#input').value='hello'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await sleep(80); w.__step(); await sleep(80);           // first chunk arrives
  w.eval('newConvo()');                                   // user walks away mid-stream
  const bId=w.eval('current.id');
  w.__step(); await sleep(80);                            // second chunk while elsewhere
  w.__step&&w.__step();                                   // let the reader see done
  await sleep(250);
  const A=w.eval(`convos.find(c=>c.id==='${aId}')`);
  const B=w.eval(`convos.find(c=>c.id==='${bId}')`);
  ck('reply finished into the chat that asked', A.messages.length===2&&A.messages[1].content==='part one. part two.',
     JSON.stringify(A.messages[1]&&A.messages[1].content));
  ck('the other chat stayed empty', B.messages.length===0, String(B.messages.length));
  const inDb=await new Promise(res=>{const r=w.indexedDB.open('cozychat',2);r.onsuccess=()=>{
    const t=r.result.transaction('convos').objectStore('convos').get(aId);
    t.onsuccess=()=>res(t.result);};});
  ck('and was persisted, not lost on reload', inDb&&inDb.messages.length===2&&/part two\.$/.test(inDb.messages[1].content));
  ck('stop button released', d.querySelector('#sendBtn').classList.contains('stop')===false);
}

console.log('\n=== 2. AN ERROR LANDS IN THE CHAT THAT SENT ===');
{
  const dom=await boot(base(),w=>()=>Promise.reject(new TypeError('Failed to fetch')));
  const w=dom.window,d=w.document;
  w.eval('newConvo()'); const aId=w.eval('current.id');
  d.querySelector('#input').value='hi'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  w.eval('newConvo()');                                   // switch before it fails
  await sleep(300);
  const A=w.eval(`convos.find(c=>c.id==='${aId}')`);
  const B=w.eval('current');
  ck('error message in the sending chat', A.messages.some(m=>m.role==='error'));
  ck('nothing leaked into the open chat', B.messages.length===0, String(B.messages.length));
}

console.log('\n=== 3. A NEWER SEND SUPERSEDES CLEANLY ===');
{
  const dom=await boot(base(),w=>{
    let call=0;
    const g=gated(w,[oa('first, never finishes')]);
    return (u,o)=>{ call++; if(call===1) return g(u,o);
      return Promise.resolve({ok:true,body:{getReader(){let done=false;return{read(){
        if(done)return Promise.resolve({done:true});
        done=true;return Promise.resolve({done:false,value:new TextEncoder().encode(oa('second wins'))});}};}}});};
  });
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  d.querySelector('#input').value='one'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await sleep(80);
  w.eval('send("two")');                                  // regen/continue path: supersede directly
  await sleep(350);
  const msgs=w.eval('current.messages');
  const lastA=msgs.filter(m=>m.role==='assistant').pop();
  ck('second reply completed', !!lastA&&lastA.content==='second wins', lastA&&lastA.content);
  ck('first was aborted, not errored', !msgs.some(m=>m.role==='error'));
  ck('send button back to idle after the survivor', d.querySelector('#sendBtn').classList.contains('stop')===false);
  ck('exactly one stream owns the controls', w.eval('streaming')===null);
}

console.log('\n=== 4. A FAILED SWIPE KEEPS ITS VERSIONS ===');
{
  const dom=await boot(base(),w=>{
    let call=0;
    return ()=>{ call++;
      if(call===1) return Promise.resolve({ok:true,body:{getReader(){let d1=false;return{read(){
        if(d1)return Promise.resolve({done:true});
        d1=true;return Promise.resolve({done:false,value:new TextEncoder().encode(oa('the good answer'))});}};}}});
      return Promise.reject(new TypeError('Failed to fetch')); };
  });
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  d.querySelector('#input').value='q'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await sleep(300);
  ck('setup: one good reply', w.eval('current.messages[1].content')==='the good answer');
  const btn=d.querySelector('[data-regen]');
  btn.dispatchEvent(new w.Event('click',{bubbles:true}));
  await sleep(350);
  const msgs=w.eval('current.messages');
  const back=msgs.find(m=>m.role==='assistant');
  ck('original reply restored after the failure', !!back&&back.content==='the good answer',
     JSON.stringify(msgs.map(m=>m.role)));
  ck('its versions survived', back&&back.variants&&back.variants.length===1&&back.variants[0].content==='the good answer');
  ck('the error is still shown, after it', msgs[msgs.length-1].role==='error');
}

console.log('\n=== 5. A LATE PAINT CANNOT CLOBBER THE FINISHED MESSAGE ===');
{
  const reply='Fixed.\n<docedits>[{"find":"old","replace":"new","reason":"asked"}]</docedits>';
  const chunks=reply.match(/[\s\S]{1,24}/g).map(oa);
  const dom=await boot(base(),w=>()=>Promise.resolve({ok:true,body:(function(){let i=0;return{getReader(){return{read(){
    if(i>=chunks.length)return Promise.resolve({done:true});
    return Promise.resolve({done:false,value:new TextEncoder().encode(chunks[i++])});}};}};})()}));
  const w=dom.window,d=w.document;
  await w.eval('(async()=>{const doc=await newDoc("s.md","old");newConvo();await attachDoc(doc.id);})()');
  await sleep(200);
  d.querySelector('#input').value='fix'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await sleep(600);                                        // well past any queued frame
  const m=w.eval('current.messages[current.messages.length-1]');
  ck('edits parsed', m.edits&&m.edits.length===1);
  ck('block stays stripped from the message', !/docedits/.test(m.content), JSON.stringify(m.content));
  ck('and from what is on screen', !/docedits/.test(d.querySelector('.msg.assistant .msg-body').textContent));
}
{
  const dom=await boot(base(),w=>()=>Promise.resolve({ok:true,body:(function(){let i=0;
    const cs=[oa('<think>only '),oa('thinking here</think>')];return{getReader(){return{read(){
    if(i>=cs.length)return Promise.resolve({done:true});
    return Promise.resolve({done:false,value:new TextEncoder().encode(cs[i++])});}};}};})()}));
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  d.querySelector('#input').value='?'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await sleep(500);
  const m=w.eval('current.messages[1]');
  ck('an all-thinking reply leaks no tags into the text', !/<\/?think>/.test(m.content), JSON.stringify(m.content));
  ck('the thinking itself was kept', /only thinking here/.test(m.thinking));
}

console.log('\n=== 6. BACKUPS CARRY THE FILES ===');
{
  const dom=await boot(base());
  const w=dom.window;
  let saved=null;
  w.eval('window.URL.createObjectURL=function(){return "blob:x"}; window.URL.revokeObjectURL=function(){}');
  w.Blob=function(parts){saved=parts.join('');};
  w.HTMLAnchorElement.prototype.click=function(){};
  await w.eval('(async()=>{await newDoc("kept.md","file body survives");newConvo();current.messages.push({id:"1",role:"user",content:"hi"});await persist();})()');
  await w.eval('backup()'); await sleep(200);
  const data=JSON.parse(saved);
  ck('backup includes the docs store', Array.isArray(data.docs)&&data.docs.length===1&&data.docs[0].name==='kept.md');
  ck('and the conversations as before', data.conversations.length===1);

  // wipe, then restore the same file — the doc must come back
  await w.eval('DB.clear()'); await w.eval('DB.docClear()');
  w.eval('convos=[];docs=[];current=null;');
  const file={text:async()=>JSON.stringify(data)};
  await w.eval('window.__f=null'); w.__f=file;
  await w.eval('handleRestore(window.__f)'); await sleep(300);
  ck('restore brings the file back', w.eval('docs.length')===1&&w.eval('docs[0].text')==='file body survives');
  ck('and the chats', w.eval('convos.length')===1);
}

console.log('\n=== 7. RESTORE RUNS THE SETTINGS MIGRATIONS ===');
{
  const dom=await boot(base());
  const w=dom.window;
  const legacy={ system:'LEGACY MASTER PROMPT',
    injections:[{id:'t1',name:'Top',text:'top text',role:'system',pos:'top',depth:0,enabled:true},
                {id:'b1',name:'Bottom',text:'bottom text',role:'system',pos:'bottom',depth:0,enabled:true}],
    providers:[],prompts:[] };                             // pre-v3: no presets at all
  const file={text:async()=>JSON.stringify({app:'cozy-chat',conversations:[],settings:legacy})};
  w.__f=file; await w.eval('handleRestore(window.__f)'); await sleep(300);
  ck('legacy system prompt became the default set', w.eval('PS().system')==='LEGACY MASTER PROMPT', w.eval('PS().system'));
  const ord=w.eval('PS().order');
  const ids=w.eval('PS().injections.map(i=>[i.name,i.id])');
  const at=n=>ord.indexOf((ids.find(x=>x[0]===n)||[])[1]);
  ck('old top block sits before the conversation', at('Top')>-1&&at('Top')<ord.indexOf('__chat__'), JSON.stringify(ord));
  ck('old bottom block sits after it', at('Bottom')>ord.indexOf('__chat__'));
}

console.log('\n=== 8. COPY AND IMPORT KEEP THE ORDER ===');
{
  const st=base();
  st.presets=[{id:'d',name:'D',system:'sys',order:['a1','__main__','__chat__','a2'],
    injections:[{id:'a1',name:'Leads',text:'x',role:'system',pos:'relative',depth:0,enabled:true},
                {id:'a2',name:'Trails',text:'y',role:'user',pos:'relative',depth:0,enabled:true}]}];
  const dom=await boot(st);
  const w=dom.window,d=w.document;
  ev(w,d.querySelector('#presetDupBtn'),'click'); await sleep(100);
  const copy=w.eval('S.presets[S.presets.length-1]');
  const shape=p=>p.order.map(id=>id==='__main__'?'M':id==='__chat__'?'C':(p.injections.find(i=>i.id===id)||{}).name);
  ck('a copied set keeps its arrangement', shape(copy).join(',')==='Leads,M,C,Trails', shape(copy).join(','));
  ck('with genuinely fresh ids', copy.injections.every(i=>i.id!=='a1'&&i.id!=='a2'));

  const exp={app:'cozy-chat',kind:'instruction-set',preset:st.presets[0]};
  const file={text:async()=>JSON.stringify(exp)};
  w.__f=file;
  await w.eval(`(async()=>{const j=JSON.parse(await window.__f.text());const p=j.preset;
    p.id=uid();p.name=p.name||'Imported set';reidPreset(p);S.presets.push(p);switchPreset(p.id);})()`);
  const imp=w.eval('S.presets[S.presets.length-1]');
  ck('an imported set keeps its arrangement too', shape(imp).join(',')==='Leads,M,C,Trails', shape(imp).join(','));
}

console.log('\n=== 9. A MODEL PICK DIES WITH ITS CONNECTION ===');
{
  const st=base();
  st.providers.push({id:'p2',preset:'custom',kind:'openai',name:'U',url:'https://b/v1',apiKey:'k2',model:'m2',ctx:9000});
  const dom=await boot(st);
  const w=dom.window,d=w.document;
  w.eval('newConvo(); cfgSet("model","my-special-pick");');
  // editing the SAME connection keeps the pick
  w.eval('editProv("p1")');
  ev(w,d.querySelector('#saveProvBtn'),'click');
  ck('editing the same connection keeps the pick', w.eval('cfgGet("model",null)')==='my-special-pick');
  // switching the chat to a different connection clears it
  w.eval('editProv("p2")');
  ev(w,d.querySelector('#saveProvBtn'),'click');
  ck('saving a different connection clears it', w.eval('cfgGet("model",null)')===null,
     String(w.eval('cfgGet("model",null)')));
  ck('so the request uses that connection\'s model', w.eval('activeProv().model')==='m2');
  // deleting a connection clears the picks of every chat that used it
  w.eval('cfgSet("providerId","p1"); cfgSet("model","another-pick");');
  w.eval('editingProv="p1"');
  ev(w,d.querySelector('#delProvBtn'),'click'); await sleep(100);
  ck('deleting a connection clears its chats\' picks', w.eval('current.cfg.model')===null,
     String(w.eval('current.cfg.model')));
}

console.log('\n=== 10. ARCHIVE EXISTS, AND WORKS ===');
{
  const dom=await boot(base());
  const w=dom.window,d=w.document;
  w.eval('newConvo(); current.title="Keep me around"; persist();'); await sleep(100);
  const btn=d.querySelector('[data-arch]');
  ck('every row offers archive', !!btn);
  btn.dispatchEvent(new w.Event('click',{bubbles:true})); await sleep(150);
  ck('the chat is marked archived', w.eval('convos[0].archived')===true);
  ck('it leaves the list', !d.querySelector('#convoList').textContent.includes('Keep me around'));
  ck('the list says where it went', /archived — search/.test(d.querySelector('#convoList').textContent));
  ck('an archived current falls back', w.eval('current')===null||w.eval('current.archived')!==true);
  d.querySelector('#convoSearch').value='Keep me'; ev(w,d.querySelector('#convoSearch'),'input');
  const row=d.querySelector('[data-arch]');
  ck('search still finds it', d.querySelector('#convoList').textContent.includes('Keep me around'));
  ck('where it can be unarchived', row&&row.getAttribute('aria-label')==='Unarchive');
  row.dispatchEvent(new w.Event('click',{bubbles:true})); await sleep(150);
  ck('and it comes back', w.eval('convos[0].archived')===false);
  const inDb=await new Promise(res=>{const r=w.indexedDB.open('cozychat',2);r.onsuccess=()=>{
    const t=r.result.transaction('convos').objectStore('convos').getAll();t.onsuccess=()=>res(t.result);};});
  ck('the flag is persisted', inDb.length===1&&inDb[0].archived===false);
}

console.log('\n=== 11. STORAGE FAILURES REJECT INSTEAD OF HANGING ===');
{
  const dom=await boot(base());
  const w=dom.window;
  const out=await w.eval(`(async()=>{
    try { await Promise.race([ DB.put({id:'bad', poison:function(){} }),
                               new Promise((_,rj)=>setTimeout(()=>rj(new Error('HUNG')),500)) ]);
          return 'resolved'; }
    catch(e){ return e.message==='HUNG' ? 'HUNG' : 'rejected'; }
  })()`);
  ck('an unstorable write rejects promptly', out==='rejected', out);
}

console.log('\n=== 12. A DROPPED FILE ATTACHES INSTEAD OF NAVIGATING ===');
{
  const dom=await boot(base());
  const w=dom.window,d=w.document;
  const f=new w.File(['dropped body'],'dropped.txt',{type:'text/plain'});
  const e=new w.Event('drop',{bubbles:true,cancelable:true});
  e.dataTransfer={files:[f]};
  d.dispatchEvent(e);
  await sleep(200);
  ck('the browser default was cancelled', e.defaultPrevented===true);
  ck('the file is waiting in the tray', w.eval('pendingAtts.length')===1&&w.eval('pendingAtts[0].name')==='dropped.txt');
  ck('with its contents read', w.eval('pendingAtts[0].text')==='dropped body');
  const g=new w.Event('dragover',{bubbles:true,cancelable:true});
  d.dispatchEvent(g);
  ck('dragover is neutralised too', g.defaultPrevented===true);
}

console.log('\n=== 13. EXPORT NAMES AN ERROR AN ERROR ===');
{
  const dom=await boot(base());
  const w=dom.window;
  let saved=null;
  w.eval('window.URL.createObjectURL=function(){return "blob:x"}; window.URL.revokeObjectURL=function(){}');
  w.Blob=function(parts){saved=parts.join('');};
  w.HTMLAnchorElement.prototype.click=function(){};
  w.eval(`newConvo(); current.title="T";
    current.messages.push({id:"1",role:"user",content:"q"});
    current.messages.push({id:"2",role:"error",content:"it broke"});
    exportMd();`);
  ck('the transcript labels it Error, not Assistant', /## Error\n\nit broke/.test(saved), (saved.match(/## \w+/g)||[]).join(' '));
}

console.log('\nRESULT:',fail?('FAILURES: '+fail):'ALL PASS','('+pass+' checks)');
process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
