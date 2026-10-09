// TEST FILE — run with: node tests/v5290filestest.js        (one section: node tests/v5290filestest.js 3)
// Guards the files the model edits, through the live path: the model's reply
// comes back through send(), its edit block becomes cards, the cards are
// tapped, and what is read back is the file text and the next request.
//   1. a project's files are this chat's files: their edits become cards, and
//      the "Let the assistant write files" switch, its toast and what is sent
//      agree (a chat that turns files off gets none of the project's either)
//   2. insert_after with an anchor quoted together with its line break puts
//      the text right under it, not one line lower inside the next block
//   3. an anchor that occurs more than once is refused, not applied at its
//      first occurrence - exact, or the same words with other spacing
//   4. a file another tab attached is not dropped by this tab's drawing of
//      the chat (device mode: the chat or the settings arrive before the file)
//   5. an edit that would leave a JSON file invalid is repaired or refused
//   6. a full rewrite proposed before the file last changed is refused
//   7. an edit knows the file it was proposed for: a file attached since
//      cannot take it over, and a rename does not lose it
//   8. a stored record cannot put HTML into an edit card
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const ONLY=(process.argv[2]||'').split(',').filter(Boolean);
const want=n=>!ONLY.length||ONLY.includes(String(n));
const base=(o)=>Object.assign({
  providers:[{id:'o',preset:'custom',kind:'openai',name:'O',url:'https://o.test/v1',apiKey:'k',model:'m',ctx:200000}],
  activeProvider:'o',presets:[{id:'d',name:'D',system:'',injections:[],order:['__main__','__chat__']}],activePreset:'d',prompts:[],
  maxTokens:1024,effort:'off',showThinking:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}},o||{});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ev=(w,el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true}));
const enc=t=>new TextEncoder().encode(t);
const sse=t=>'data: '+JSON.stringify({choices:[{delta:{content:t}}]})+'\n\n';
const OPEN='<'+'docedits'+'>', CLOSE='</'+'docedits'+'>';
const block=arr=>OPEN+'\n'+JSON.stringify(arr)+'\n'+CLOSE;
const J=(w,expr)=>{const v=w.eval('JSON.stringify('+expr+')');return v===undefined?undefined:JSON.parse(v);};
async function until(fn,ms){const t=Date.now();for(;;){let v;try{v=fn();}catch(_){v=false;}if(v||Date.now()-t>(ms||6000))return v;await sleep(25);}}
/* The model: every chat request is answered with the next queued reply. A
   reply given as an array streams one chunk per w.__step() call. */
function model(w,store){
  w.__reqs=[];w.__replies=[];
  return (url,opts)=>{
    const u=String(url);
    if(store){const r=store(u,opts);if(r)return r;}
    if(!/\/chat\/completions$/.test(u))return Promise.resolve({ok:false,status:404,json:()=>Promise.resolve({}),text:()=>Promise.resolve('')});
    w.__reqs.push(JSON.parse(opts.body));
    const r=w.__replies.length?w.__replies.shift():'ok';
    const chunks=Array.isArray(r)?r.map(sse):[sse(r)], stepped=Array.isArray(r);
    let i=0;
    return Promise.resolve({ok:true,status:200,body:{getReader(){return{read(){
      if(i>=chunks.length)return Promise.resolve({done:true});
      if(!stepped||i===0)return Promise.resolve({done:false,value:enc(chunks[i++])});
      return new Promise(res=>{w.__step=()=>{w.__step=null;res({done:false,value:enc(chunks[i++])});};});
    }};}}});
  };
}
function boot(st,store,pageHtml){return new Promise(res=>{
  const dom=new JSDOM(pageHtml||html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',beforeParse(w){
    w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;w.navigator.storage={estimate:async()=>({usage:0})};
    w.requestAnimationFrame=cb=>setTimeout(cb,0);w.confirm=()=>true;w.navigator.clipboard={writeText:async()=>{}};
    if(st)w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
    w.fetch=model(w,store);
  }});
  setTimeout(async()=>{try{
    if(!store){
      await dom.window.eval('Promise.all([DB.clear(),DB.docClear()])');
      dom.window.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();');
    }
  }catch(_){}res(dom);},800);});}
function watchToasts(w){const out=[];const t=w.document.querySelector('#toast');
  new w.MutationObserver(()=>{if(t.textContent&&out[out.length-1]!==t.textContent)out.push(t.textContent);}).observe(t,{childList:true,characterData:true,subtree:true});return out;}
async function say(w,text,reply){
  if(reply!==undefined)w.__replies.push(reply);
  const d=w.document,n=w.__reqs.length;
  d.querySelector('#input').value=text;ev(w,d.querySelector('#input'),'input');
  d.querySelector('#sendBtn').click();
  await until(()=>w.__reqs.length>n&&!w.eval('streaming')&&!w.eval('current.messages.some(m=>m.pending)'));
  await sleep(60);
}
const sysOf=w=>{const r=w.__reqs[w.__reqs.length-1];const s=r&&r.messages.find(m=>m.role==='system');return s?s.content:'';};
const wireOf=w=>JSON.stringify(w.__reqs[w.__reqs.length-1]);
const lastReply=w=>J(w,'current.messages.filter(m=>m.role==="assistant").slice(-1)[0]');
const cardsOf=(w,mid)=>w.document.querySelectorAll('.msg[data-mid="'+mid+'"] .edit-card[data-eid]');
async function tap(w,el){if(!el){console.log('    (nothing to tap)');return false;}el.click();await sleep(120);return true;}
async function applyCard(w,mid,i){const c=cardsOf(w,mid)[i],b=c&&c.querySelector('[data-apply]');if(!b){console.log('    (card '+i+' has no Apply button)');return false;}await tap(w,b);return true;}
const docText=(w,name)=>J(w,'(docs.find(d=>d.name==='+JSON.stringify(name)+')||{}).text');
const edits=(w,mid)=>J(w,'current.messages.find(m=>m.id==='+JSON.stringify(mid)+').edits');
const stateLine=(w,k)=>{/* the state note the next request carries for the k-th assistant turn */
  const a=w.__reqs[w.__reqs.length-1].messages.filter(m=>m.role==='assistant')[k];
  const s=typeof a.content==='string'?a.content:JSON.stringify(a.content);
  const m=/\[state of the edits you proposed in this reply\]\n([\s\S]*?)\n\[\/state\]/.exec(s);return m?m[1]:'';};

(async()=>{

if(want(1)){
console.log('=== 1. A PROJECT\'S FILES ARE THIS CHAT\'S FILES ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document;
  const ts=watchToasts(w);
  await w.eval(`(async()=>{const doc=await newDoc("canon.md","The hero is Jovan Oda.");
    S.projects=[{id:"pr1",name:"Bleach RP",docIds:[doc.id],system:"",injections:[],order:["__main__","__chat__"]}];
    saveSettings(); newConvo(null,"pr1");})()`);
  await say(w,'rename the hero to Jovan Kato','Renaming him.\n\n'+block([{find:'Jovan Oda',replace:'Jovan Kato',reason:'rename'}]));
  ck('a project chat is sent the project file with the rules for editing it', /You can edit these attached files: "canon\.md"/.test(sysOf(w)) && sysOf(w).includes('[FILE: canon.md]'));
  let a=lastReply(w);
  ck('the reply\'s edit block becomes a card', Array.isArray(a.edits)&&a.edits.length===1, JSON.stringify(a.edits||null));
  ck('and is not left in the reply as text', !/docedits|Jovan Kato/.test(a.content), JSON.stringify(a.content));
  if(cardsOf(w,a.id).length) await applyCard(w,a.id,0);
  ck('Apply changes the project\'s file', docText(w,'canon.md')==='The hero is Jovan Kato.', JSON.stringify(docText(w,'canon.md')));
  await say(w,'thanks','Glad to help.');
  await say(w,'anything else?','No.');
  const asst=w.__reqs[w.__reqs.length-1].messages.filter(m=>m.role==='assistant');
  ck('a zero-edit reply in a project chat carries the "nothing was changed" note', /nothing was changed/.test(asst[1].content), JSON.stringify(asst[1].content.slice(0,80)));
  // the switch
  d.querySelector('#fileBtn').click();
  const sw=()=>d.querySelector('#filesOnBtn').getAttribute('aria-checked');
  ck('the switch is lit while the project\'s file is in play', sw()==='true', sw());
  ts.length=0; await tap(w,d.querySelector('#filesOnBtn')); await sleep(150);
  ck('turning it off says so, and names the project\'s file that goes with it', /off/i.test(ts.join(' '))&&/canon\.md/.test(ts.join(' ')), JSON.stringify(ts));
  ck('the switch goes dark', sw()==='false', sw());
  await say(w,'now?','ok');
  ck('and the project\'s file no longer rides the request', !wireOf(w).includes('[FILE: canon.md]') && !/You can edit these attached files/.test(sysOf(w)), sysOf(w).slice(0,120));
  ts.length=0; await tap(w,d.querySelector('#filesOnBtn')); await sleep(150);
  ck('turning it back on lights it and names the project\'s file', sw()==='true' && /canon\.md/.test(ts.join(' ')), sw()+' '+JSON.stringify(ts));
  await say(w,'and now?','ok');
  ck('and the project\'s file rides again', sysOf(w).includes('[FILE: canon.md]'));
  // "Use no files here"
  ts.length=0; await tap(w,d.querySelector('#docDetachBtn')); await sleep(150);
  await say(w,'no files?','ok');
  ck('"Use no files here" stops the project\'s file too, as its toast says', !wireOf(w).includes('[FILE: canon.md]') && /canon\.md/.test(ts.join(' ')), JSON.stringify(ts)+' '+sysOf(w).slice(0,80));
  // a branch of a chat with files off keeps them off
  const lastA=J(w,'current.messages.filter(m=>m.role==="assistant").slice(-1)[0].id');
  await tap(w,d.querySelector('.msg[data-mid="'+lastA+'"] [data-branch]')); await sleep(200);
  await say(w,'in the branch','ok');
  ck('a branch of it keeps its files off', !wireOf(w).includes('[FILE: canon.md]') && J(w,'current.filesOn')===false, JSON.stringify(J(w,'current.filesOn')));
}
{
  // the same question in the failure note: own file + project file, an edit that names neither
  const dom=await boot(base());const w=dom.window;
  await w.eval(`(async()=>{const a=await newDoc("canon.md","Canon.");const b=await newDoc("notes.md","Alpha beta.");
    S.projects=[{id:"pr1",name:"P",docIds:[a.id],system:"",injections:[],order:["__main__","__chat__"]}];saveSettings();
    newConvo(null,"pr1");await attachDoc(b.id);})()`);
  await say(w,'change beta','Done.\n'+block([{find:'beta',replace:'BETA'}]));
  let a=lastReply(w); await applyCard(w,a.id,0);
  let e=edits(w,a.id)[0];
  ck('with two files in play, an edit naming neither fails as "didn\'t say which file"', e.status==='failed'&&/didn't say which file/.test(e.note||''), e.status+' '+JSON.stringify(e.note));
  await say(w,'change it in notes','Done.\n'+block([{file:'notes',find:'beta',replace:'BETA'}]));
  a=lastReply(w); await applyCard(w,a.id,0);
  e=edits(w,a.id)[0];
  ck('and one naming a file that is not there says which name, not "no file is attached"', e.status==='failed'&&/no attached file called "notes"/.test(e.note||''), e.status+' '+JSON.stringify(e.note));
}
}

if(want(2)){
console.log('\n=== 2. INSERT_AFTER AN ANCHOR QUOTED WITH ITS LINE BREAK ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document;
  const tp='# SUMMARYCEPTION MEMORY TRANSPLANT\n<!-- SC-TRANSPLANT {"v":1} -->\n\n## MEMORY SNIPPETS (story order)\n<!-- SC-SNIPPET {"turns":"0-4"} -->\nThey met at the gate.\n<!-- /SC-SNIPPET -->\n';
  await w.eval(`(async()=>{const doc=await newDoc("memory.md",${JSON.stringify(tp)});newConvo();await attachDoc(doc.id);})()`);
  await say(w,'add a prologue before the first snippet','Added.\n'+block([{insert_after:'## MEMORY SNIPPETS (story order)\n',replace:'<!-- SC-SNIPPET {"turns":"?"} -->\nA prologue.\n<!-- /SC-SNIPPET -->'}]));
  const a=lastReply(w); await applyCard(w,a.id,0);
  const t=docText(w,'memory.md'), L=t.split('\n'), h=L.indexOf('## MEMORY SNIPPETS (story order)');
  ck('the new block goes directly under the anchor', L[h+1]==='<!-- SC-SNIPPET {"turns":"?"} -->', JSON.stringify(L.slice(h,h+4)));
  ck('and the block that was there stays whole', t.includes('<!-- SC-SNIPPET {"turns":"0-4"} -->\nThey met at the gate.\n<!-- /SC-SNIPPET -->'), JSON.stringify(t.slice(-120)));
  w.eval('openDocEditor(docs.find(x=>x.name==="memory.md").id)'); d.querySelector('#docCheckBtn').click(); await sleep(50);
  const out=d.querySelector('#docLintOut').textContent;
  ck('Check finds no marker damage and two snippets', /no marker damage/.test(out) && /2 snippet\(s\)/.test(out), JSON.stringify(out.slice(0,200)));
  w.eval('hideDocEdit()');
}
{
  const dom=await boot(base());const w=dom.window;
  const wb='[\n  {\n    "name": "A",\n    "content": "a"\n  },\n  {\n    "name": "B",\n    "content": "b"\n  }\n]';
  await w.eval(`(async()=>{const doc=await newDoc("world.json",${JSON.stringify(wb)});newConvo();await attachDoc(doc.id);})()`);
  await say(w,'add C after A','Added.\n'+block([{insert_after:'    "content": "a"\n  },\n',replace:'  {\n    "name": "C",\n    "content": "c"\n  },'}]));
  const a=lastReply(w); await applyCard(w,a.id,0);
  let names=null; try{names=JSON.parse(docText(w,'world.json')).map(e=>e.name).join(',');}catch(e){names='invalid JSON: '+e.message;}
  ck('in a worldbook, the entry lands between A and B and the file stays JSON', names==='A,C,B', names);
}
{
  const dom=await boot(base());const w=dom.window;
  await w.eval('(async()=>{const doc=await newDoc("log.md","Day 1\\r\\nDay 2\\r\\nDay 3\\r\\n");newConvo();await attachDoc(doc.id);})()');
  await say(w,'add 1b','Added.\n'+block([{insert_after:'Day 1\r\n',replace:'Day 1b'},{insert_after:'Day 2',replace:'Day 2b'}]));
  const a=lastReply(w); await applyCard(w,a.id,0); await applyCard(w,a.id,1);
  ck('a CRLF line quoted with its break, and a line quoted without one, both get the text right under them',
    docText(w,'log.md')==='Day 1\r\nDay 1b\nDay 2\r\nDay 2b\nDay 3\r\n', JSON.stringify(docText(w,'log.md')));
}
}

if(want(3)){
console.log('\n=== 3. AN ANCHOR THAT OCCURS MORE THAN ONCE IS REFUSED ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document;
  const sn=i=>'<!-- SC-SNIPPET {"turns":"'+(i*5)+'-'+(i*5+4)+'"} -->\nEvent '+i+' happened.\n<!-- /SC-SNIPPET -->\n';
  const tp='# SUMMARYCEPTION MEMORY TRANSPLANT\n<!-- SC-TRANSPLANT {"v":1} -->\n\n## MEMORY SNIPPETS (story order)\n'+Array.from({length:12},(_,i)=>sn(i)).join('\n');
  await w.eval(`(async()=>{const doc=await newDoc("memory.md",${JSON.stringify(tp)});newConvo();await attachDoc(doc.id);})()`);
  await say(w,'add the newest event at the end','Added.\n'+block([{insert_after:'<!-- /SC-SNIPPET -->',replace:'<!-- SC-SNIPPET {"turns":"?"} -->\nEvent 12 happened.\n<!-- /SC-SNIPPET -->'}]));
  const a=lastReply(w); await applyCard(w,a.id,0);
  const e=edits(w,a.id)[0];
  ck('a closer line that occurs 12 times is refused, with its real count', e.status==='failed' && e.note==='appears 12 times — quote a longer span that occurs once', e.status+' '+JSON.stringify(e.note));
  ck('the file is unchanged', docText(w,'memory.md')===tp);
  ck('the card offers Ask again', !!cardsOf(w,a.id)[0].querySelector('[data-reask]'));
  await say(w,'?','ok');
  ck('the next request tells the model why', /FAILED — appears 12 times — quote a longer span that occurs once/.test(stateLine(w,0)), JSON.stringify(stateLine(w,0)));
  w.__replies.push('Re-sent.');
  const n=w.__reqs.length;
  if(await tap(w,cardsOf(w,a.id)[0].querySelector('[data-reask]'))){ await until(()=>w.__reqs.length>n&&!w.eval('streaming')); await sleep(60); }
  const us=w.__reqs[w.__reqs.length-1].messages.filter(m=>m.role==='user');
  ck('Ask again sends the reason too', w.__reqs.length>n && /appears 12 times/.test(us[us.length-1].content), JSON.stringify(us[us.length-1].content.slice(0,120)));
}
{
  const dom=await boot(base());const w=dom.window;
  const wb=JSON.stringify([{name:'Alice',keys:['alice'],content:'Alice is a mage.',strategy:'green',order:100},
                          {name:'Bob',keys:['bob'],content:'Bob is a knight.',strategy:'green',order:100}],null,2);
  await w.eval(`(async()=>{const doc=await newDoc("world.json",${JSON.stringify(wb)});newConvo();await attachDoc(doc.id);})()`);
  await say(w,'make Bob blue','Done.\n'+block([{find:'"strategy": "green",\n"order": 100',replace:'"strategy": "blue",\n"order": 300'}]));
  let a=lastReply(w); await applyCard(w,a.id,0);
  let e=edits(w,a.id)[0];
  ck('the same words with other spacing, occurring twice, are refused too', e.status==='failed' && /^appears 2 times/.test(e.note||''), e.status+' '+JSON.stringify(e.note));
  ck('and the worldbook is unchanged', docText(w,'world.json')===wb);
  await say(w,'make Bob blue','Done.\n'+block([{find:'"content": "Bob is a knight.",\n"strategy": "green",',replace:'"content": "Bob is a knight.",\n    "strategy": "blue",'}]));
  a=lastReply(w); await applyCard(w,a.id,0);
  e=edits(w,a.id)[0];
  ck('a quote that occurs once, apart from spacing, still applies', e.status==='applied' && e.note==='matched apart from spacing' && JSON.parse(docText(w,'world.json'))[1].strategy==='blue', e.status+' '+JSON.stringify(e.note));
  await say(w,'rename Alice','Done.\n'+block([{find:'"name": "Alice"',replace:'"name": "Alicia"'}]));
  a=lastReply(w); await applyCard(w,a.id,0);
  e=edits(w,a.id)[0];
  ck('a quote that occurs once exactly applies with no note', e.status==='applied' && !e.note && JSON.parse(docText(w,'world.json'))[0].name==='Alicia', e.status+' '+JSON.stringify(e.note));
}
{
  const dom=await boot(base());const w=dom.window;
  await w.eval('(async()=>{const doc=await newDoc("tale.md","Bobby met Bob.");newConvo();await attachDoc(doc.id);})()');
  await say(w,'rename Bob','Done.\n'+block([{find:'Bob',replace:'Robert'}]));
  let a=lastReply(w); await applyCard(w,a.id,0);
  ck('a name that also occurs inside a longer word is refused, not applied to "Bobby"', edits(w,a.id)[0].status==='failed' && docText(w,'tale.md')==='Bobby met Bob.', JSON.stringify(edits(w,a.id)[0].note)+' '+JSON.stringify(docText(w,'tale.md')));
  await w.eval('(async()=>{docs[0].text="The Cat\\nsat down. Later the cat\\nsat up.";await saveDoc(docs[0]);})()');
  await say(w,'fix it','Done.\n'+block([{find:'the cat sat',replace:'the dog sat'}]));
  a=lastReply(w); await applyCard(w,a.id,0);
  ck('the one window that matches apart from spacing is used, though another differs only in letter case', edits(w,a.id)[0].status==='applied' && docText(w,'tale.md')==='The Cat\nsat down. Later the dog sat up.', JSON.stringify(edits(w,a.id)[0].note)+' '+JSON.stringify(docText(w,'tale.md')));
}
}

if(want(4)){
console.log('\n=== 4. A FILE ANOTHER TAB ATTACHED IS NOT DROPPED HERE (device mode) ===');
{
  // a stand-in for serve.py's store: records with revisions
  const now=Date.now();let revN=10;
  const S0=base(); const st={settings:{rev:1,data:S0},chat:{},file:{}};
  st.chat.c1={rev:2,data:{id:'c1',title:'Lore chat',createdAt:now,updatedAt:now,messages:[{id:'u0',role:'user',content:'hi'},{id:'a0',role:'assistant',content:'hello'}],cfg:{},docIds:[],filesOn:true}};
  const store=(u,opts)=>{
    u=u.replace(/^https:\/\/x\.com\//,'');const m=(opts&&opts.method)||'GET';
    const R=(o,s)=>Promise.resolve({ok:(s||200)<300,status:s||200,json:()=>Promise.resolve(o),text:()=>Promise.resolve(JSON.stringify(o))});
    if(u==='api/store/hello')return R({id:'srv1',dataDir:'/x'});
    if(u==='api/store/all')return R({settings:st.settings,chats:Object.values(st.chat),files:Object.values(st.file)});
    if(u==='api/store/manifest')return R({id:'srv1',settings:st.settings.rev,chats:Object.fromEntries(Object.entries(st.chat).map(([k,v])=>[k,v.rev])),files:Object.fromEntries(Object.entries(st.file).map(([k,v])=>[k,v.rev]))});
    const mm=/^api\/store\/(chat|file|settings)\/(.+)$/.exec(u);
    if(mm){const kind=mm[1],id=decodeURIComponent(mm[2]);
      if(m==='GET'){const r=kind==='settings'?st.settings:st[kind][id];return r?R(r):R({},404);}
      if(m==='PUT'){const rec={rev:++revN,data:JSON.parse(opts.body)};if(kind==='settings')st.settings=rec;else st[kind][id]=rec;return R({rev:rec.rev});}
    }
    if(/^api\//.test(u))return R({},404);
    return null;
  };
  const dom=await boot(null,store,html.replace('<head>','<head><meta name="cozy-store" content="1">'));const w=dom.window,d=w.document;
  await until(()=>w.eval('current&&current.id')==='c1');
  ck('this tab runs on the phone\'s store', w.eval('STORE_MODE')==='device');
  // another tab makes lore.md and attaches it to the chat open here
  st.file.f2={rev:++revN,data:{id:'f2',name:'lore.md',text:'The lore.',updatedAt:Date.now(),undo:[]}};
  const c=JSON.parse(JSON.stringify(st.chat.c1.data));c.docIds=['f2'];c.updatedAt=Date.now();st.chat.c1={rev:++revN,data:c};
  ev(w,d,'visibilitychange');                          // this tab comes back into view
  await until(()=>J(w,'docs.map(x=>x.id)').includes('f2'));await sleep(100);
  ck('after coming back, the chat here still has the file the other tab attached', J(w,'current.docIds').includes('f2'), JSON.stringify(J(w,'current.docIds')));
  d.querySelector('#fileBtn').click();
  ck('the file card lists it', /lore\.md/.test(d.querySelector('#fileList').textContent), JSON.stringify(d.querySelector('#fileList').textContent));
  await say(w,'what does the lore say?','It says lore.');
  ck('the next request carries it', sysOf(w).includes('[FILE: lore.md]'));
  await until(()=>(st.chat.c1.data.messages||[]).length>=4);
  ck('and the chat this tab saved keeps it on the phone', (st.chat.c1.data.docIds||[]).includes('f2'), JSON.stringify(st.chat.c1.data.docIds));
  // another tab adds proj.md to a project and moves the chat into it
  st.file.f3={rev:++revN,data:{id:'f3',name:'proj.md',text:'Project canon.',updatedAt:Date.now(),undo:[]}};
  const s2=JSON.parse(JSON.stringify(st.settings.data));s2.projects=[{id:'p1',name:'P',docIds:['f3'],system:'',injections:[],order:['__main__','__chat__']}];st.settings={rev:++revN,data:s2};
  const c3=JSON.parse(JSON.stringify(st.chat.c1.data));c3.projectId='p1';c3.updatedAt=Date.now();st.chat.c1={rev:++revN,data:c3};
  ev(w,d,'visibilitychange');
  await until(()=>J(w,'docs.map(x=>x.id)').includes('f3'));await sleep(100);
  ck('the project keeps the file another tab added to it', JSON.stringify(J(w,'S.projects[0].docIds'))==='["f3"]', JSON.stringify(J(w,'S.projects[0].docIds')));
  await w.eval('saveSettings()');await sleep(200);
  ck('and saving settings here keeps it on the phone', JSON.stringify(st.settings.data.projects[0].docIds)==='["f3"]', JSON.stringify(st.settings.data.projects[0].docIds));
  await say(w,'and the canon?','Canon.');
  ck('the project\'s file rides the next request', sysOf(w).includes('[FILE: proj.md]'));
}
{
  // deleting a file still takes it out of every chat and project
  const dom=await boot(base());const w=dom.window,d=w.document;
  await w.eval(`(async()=>{const a=await newDoc("gone.md","x");const b=await newDoc("kept.md","y");
    S.projects=[{id:"pr1",name:"P",docIds:[a.id,b.id],system:"",injections:[],order:["__main__","__chat__"]}];saveSettings();
    newConvo(null,"pr1");await attachDoc(a.id);await attachDoc(b.id);openDocEditor(a.id);})()`);
  await tap(w,d.querySelector('#docDelBtn'));await sleep(150);
  const gone=J(w,'docs.find(x=>x.name==="kept.md").id');
  ck('a deleted file leaves the chat and the project; the other stays', JSON.stringify(J(w,'current.docIds'))===JSON.stringify([gone]) && JSON.stringify(J(w,'S.projects[0].docIds'))===JSON.stringify([gone]), JSON.stringify([J(w,'current.docIds'),J(w,'S.projects[0].docIds')]));
}
}

if(want(5)){
console.log('\n=== 5. AN EDIT NEVER LEAVES A JSON FILE BROKEN ===');
{
  const dom=await boot(base());const w=dom.window;
  const wb=JSON.stringify([{name:'Alice',keys:['alice'],content:'Alice is a mage.',strategy:'green'}],null,2);
  await w.eval(`(async()=>{const doc=await newDoc("worldbook.json",${JSON.stringify(wb)});newConvo();await attachDoc(doc.id);})()`);
  await say(w,'add Bob','Added Bob.\n'+block([{file:'worldbook.json',append:true,replace:'{"name":"Bob","keys":["bob"],"content":"Bob is a knight.","strategy":"green"}'}]));
  let a=lastReply(w); await applyCard(w,a.id,0);
  let e=edits(w,a.id)[0];
  ck('an append after the closing bracket is refused', e.status==='failed' && /^would leave worldbook\.json as invalid JSON: /.test(e.note||''), e.status+' '+JSON.stringify(e.note));
  ck('and the worldbook is unchanged', docText(w,'worldbook.json')===wb);
  await say(w,'?','ok');
  ck('the model is told why', /FAILED — would leave worldbook\.json as invalid JSON/.test(stateLine(w,0)), JSON.stringify(stateLine(w,0).slice(0,140)));
  await say(w,'two lines for Alice','Done.\n'+block([{file:'worldbook.json',find:'Alice is a mage.',replace:'Alice is a mage.\nShe fears fire.'}]));
  a=lastReply(w); await applyCard(w,a.id,0);
  e=edits(w,a.id)[0];
  let parsed=null;try{parsed=JSON.parse(docText(w,'worldbook.json'));}catch(_){}
  ck('a line break inside a string is repaired, and the card says so', e.status==='applied' && /JSON repaired/.test(e.note||'') && parsed && parsed[0].content==='Alice is a mage.\nShe fears fire.', e.status+' '+JSON.stringify(e.note));
  await say(w,'start over','Rewritten.\n'+block([{file:'worldbook.json',replace_all:true,replace:'[{"name":"Zed",}'}]));
  a=lastReply(w); await applyCard(w,a.id,0);
  e=edits(w,a.id)[0];
  ck('a full rewrite into broken JSON is refused', e.status==='failed' && /^would leave worldbook\.json as invalid JSON/.test(e.note||''), e.status+' '+JSON.stringify(e.note));
}
{
  const dom=await boot(base());const w=dom.window;
  await w.eval('(async()=>{const a=await newDoc("lore.txt","[{\\"name\\":\\"A\\"}]");const b=await newDoc("notes.md","Notes.");newConvo();await attachDoc(a.id);await attachDoc(b.id);})()');
  await say(w,'log it','Done.\n'+block([{file:'lore.txt',append:true,replace:'{"name":"B"}'},{file:'notes.md',append:true,replace:'- more'}]));
  const a=lastReply(w); await applyCard(w,a.id,0); await applyCard(w,a.id,1);
  const e=edits(w,a.id);
  ck('a file that is JSON by its content (lore.txt) is guarded the same way', e[0].status==='failed' && docText(w,'lore.txt')==='[{"name":"A"}]', e[0].status+' '+JSON.stringify(e[0].note));
  ck('a note is not JSON and takes the append as before', e[1].status==='applied' && docText(w,'notes.md')==='Notes.\n- more', JSON.stringify(docText(w,'notes.md')));
}
{
  const dom=await boot(base());const w=dom.window;
  await w.eval('(async()=>{const doc=await newDoc("draft.json","{\\"a\\": 1 // a comment\\n}");newConvo();await attachDoc(doc.id);})()');
  await say(w,'change a','Done.\n'+block([{find:'"a": 1',replace:'"a": 2'}]));
  const a=lastReply(w); await applyCard(w,a.id,0);
  const e=edits(w,a.id)[0];
  ck('a .json file that was not valid JSON before still takes an edit, and the card says it is still not valid', e.status==='applied' && /not valid JSON/.test(e.note||'') && /"a": 2/.test(docText(w,'draft.json')), e.status+' '+JSON.stringify(e.note));
}
{
  const dom=await boot(base());const w=dom.window;
  w.eval('newConvo(); current.filesOn=true;');
  await say(w,'make two files','Made.\n'+block([{create_file:'bad.json',replace:'[{"name":"A"'},{create_file:'ok.json',replace:'[{"name":"A",},]'}]));
  const a=lastReply(w); await applyCard(w,a.id,0); await applyCard(w,a.id,1);
  const e=edits(w,a.id);
  ck('a new .json file that is not JSON is not made', e[0].status==='failed' && /^would leave bad\.json as invalid JSON/.test(e[0].note||'') && !J(w,'docs.some(d=>d.name==="bad.json")'), e[0].status+' '+JSON.stringify(e[0].note));
  ck('one with a trailing comma is made, repaired', e[1].status==='applied' && docText(w,'ok.json')==='[{"name":"A"}]', e[1].status+' '+JSON.stringify(docText(w,'ok.json')));
}
}

if(want(6)){
console.log('\n=== 6. A FULL REWRITE PROPOSED BEFORE THE FILE LAST CHANGED IS REFUSED ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document;
  await w.eval('(async()=>{const doc=await newDoc("plan.md","Act 1: the gate.\\nAct 2: the river.");newConvo();await attachDoc(doc.id);})()');
  await say(w,'rewrite the plan','Here is a new plan.\n'+block([{replace_all:true,replace:'Act 1: the gate.\nAct 2: the river.\nAct 3: the tower.'}]));
  const r1=lastReply(w);
  await say(w,'actually just freeze the river','Done.\n'+block([{find:'the river',replace:'the frozen river'}]));
  const r2=lastReply(w); await applyCard(w,r2.id,0);
  await applyCard(w,r1.id,0);
  const e=edits(w,r1.id)[0];
  ck('the older rewrite is refused', e.status==='failed' && e.note==='the file changed after this rewrite was proposed — ask for a fresh one', e.status+' '+JSON.stringify(e.note));
  ck('the newer change stays in the file, and its card is still true', docText(w,'plan.md')==='Act 1: the gate.\nAct 2: the frozen river.' && edits(w,r2.id)[0].status==='applied', JSON.stringify(docText(w,'plan.md')));
  await say(w,'?','ok');
  ck('the model is told why', /full rewrite: FAILED — the file changed after this rewrite was proposed/.test(stateLine(w,0)), JSON.stringify(stateLine(w,0)));
}
{
  const dom=await boot(base());const w=dom.window,d=w.document;
  w.prompt=()=>'plan-v2.md';
  await w.eval('(async()=>{const doc=await newDoc("plan.md","Act 1.");newConvo();await attachDoc(doc.id);})()');
  await say(w,'rewrite it','New.\n'+block([{replace_all:true,replace:'Act 1, rewritten.'}]));
  const r1=lastReply(w);
  // renaming the file and switching its mode change no words
  w.eval('openDocEditor(docs[0].id)'); await tap(w,d.querySelector('#docRenameBtn')); w.eval('hideDocEdit()');
  d.querySelector('#fileBtn').click(); await tap(w,d.querySelector('[data-fmode]')); await tap(w,d.querySelector('[data-fmode]'));
  await applyCard(w,r1.id,0);
  ck('a rename or a mode switch is not a change: the rewrite applies', edits(w,r1.id)[0].status==='applied' && docText(w,'plan-v2.md')==='Act 1, rewritten.', edits(w,r1.id)[0].status+' '+JSON.stringify(edits(w,r1.id)[0].note));
  await say(w,'again','Newer.\n'+block([{replace_all:true,replace:'Act 1, rewritten twice.'}]));
  const r2=lastReply(w);
  w.eval('openDocEditor(docs[0].id)'); d.querySelector('#docEditArea').value='Act 1, rewritten. And typed by hand.'; await tap(w,d.querySelector('#closeDocEdit'));
  await applyCard(w,r2.id,0);
  ck('typing in the file after the proposal is a change: the rewrite is refused', edits(w,r2.id)[0].status==='failed' && docText(w,'plan-v2.md')==='Act 1, rewritten. And typed by hand.', edits(w,r2.id)[0].status+' '+JSON.stringify(docText(w,'plan-v2.md')));
  await say(w,'once more','Newest.\n'+block([{replace_all:true,replace:'Act 1, final.'}]));
  const r3=lastReply(w);
  await say(w,'and a tweak','Done.\n'+block([{find:'typed by hand',replace:'typed with care'}]));
  const r4=lastReply(w); await applyCard(w,r4.id,0);
  d.querySelector('#fileBtn').click(); await tap(w,d.querySelector('[data-fundo]'));
  await applyCard(w,r3.id,0);
  ck('undone back to the words it was proposed against, the rewrite applies', edits(w,r3.id)[0].status==='applied' && docText(w,'plan-v2.md')==='Act 1, final.', edits(w,r3.id)[0].status+' '+JSON.stringify(edits(w,r3.id)[0].note));
}
{
  // the file changes while the reply that rewrites it is still coming in
  const dom=await boot(base());const w=dom.window,d=w.document;
  await w.eval('(async()=>{const doc=await newDoc("plan.md","alpha beta");newConvo();await attachDoc(doc.id);})()');
  await say(w,'cap alpha','Done.\n'+block([{find:'alpha',replace:'ALPHA'}]));
  const r1=lastReply(w);
  w.__replies.push(['Rewriting... ', 'done.\n'+block([{replace_all:true,replace:'gamma delta'}])]);
  const n=w.__reqs.length;
  d.querySelector('#input').value='rewrite it';ev(w,d.querySelector('#input'),'input');d.querySelector('#sendBtn').click();
  await until(()=>w.__reqs.length>n&&w.__step);
  await applyCard(w,r1.id,0);                                    // applied while the rewrite streams
  w.__step(); await until(()=>!w.eval('streaming')); await sleep(80);
  const r2=lastReply(w); await applyCard(w,r2.id,0);
  ck('a rewrite written while the file changed under it is refused', edits(w,r2.id)[0].status==='failed' && docText(w,'plan.md')==='ALPHA beta', edits(w,r2.id)[0].status+' '+JSON.stringify(docText(w,'plan.md')));
}
{
  // a rewrite card stored before rewrites recorded their text: the reply's time against the file's last save
  const dom=await boot(base());const w=dom.window;
  await w.eval('(async()=>{const doc=await newDoc("old.md","old text");newConvo();await attachDoc(doc.id);})()');
  const ed=JSON.stringify(J(w,'parseDocEdits('+JSON.stringify(block([{replace_all:true,replace:'NEW'}]))+').edits'));
  w.eval('current.messages.push({id:"u0",role:"user",content:"x",ts:Date.now()-60000},{id:"a0",role:"assistant",content:"ok",ts:Date.now()-60000,edits:'+ed+'},{id:"a1",role:"assistant",content:"ok",ts:Date.now()+60000,edits:'+ed.replace(/"id":"/g,'"id":"z')+'}); renderThread();');
  await applyCard(w,'a0',0);
  ck('an older stored rewrite of a file saved since is refused', edits(w,'a0')[0].status==='failed' && docText(w,'old.md')==='old text', edits(w,'a0')[0].status);
  await applyCard(w,'a1',0);
  ck('one from after the file\'s last save applies', edits(w,'a1')[0].status==='applied' && docText(w,'old.md')==='NEW', edits(w,'a1')[0].status);
}
}

if(want(7)){
console.log('\n=== 7. AN EDIT KNOWS THE FILE IT WAS PROPOSED FOR ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document;
  await w.eval(`(async()=>{const n=await newDoc("notes.md","Session notes.");const b=await newDoc("journal.md","Dear diary.");newConvo();await attachDoc(n.id);})()`);
  await say(w,'log it','Logged.\n'+block([{append:true,replace:'- Kira joined the party.'},{replace_all:true,replace:'# Notes\n- fresh start'}]));
  const a=lastReply(w);
  ck('a card for an edit that named no file says which file it is for', /notes\.md/.test(cardsOf(w,a.id)[0].querySelector('.kind').textContent), JSON.stringify(cardsOf(w,a.id)[0].querySelector('.kind').textContent));
  // the user swaps the files: notes.md out, journal.md in
  d.querySelector('#fileBtn').click(); await tap(w,d.querySelector('[data-fdetach]'));
  w.eval('openDocEditor(docs.find(x=>x.name==="journal.md").id)'); await tap(w,d.querySelector('#docAttachBtn')); await sleep(100);
  ck('(the chat now has journal.md only)', JSON.stringify(J(w,'allChatDocs(current).map(x=>x.name)'))==='["journal.md"]');
  await applyCard(w,a.id,0); await applyCard(w,a.id,1);
  const e=edits(w,a.id);
  ck('the cards refuse the file attached since', e.every(x=>x.status==='failed'&&x.note==='the file this was proposed for is no longer attached'), JSON.stringify(e.map(x=>x.status+': '+x.note)));
  ck('journal.md and notes.md are untouched', docText(w,'journal.md')==='Dear diary.' && docText(w,'notes.md')==='Session notes.', JSON.stringify([docText(w,'journal.md'),docText(w,'notes.md')]));
}
{
  // an edit made while one file was attached still goes to that file once a second one is attached
  const dom=await boot(base());const w=dom.window,d=w.document;
  await w.eval('(async()=>{const a=await newDoc("a.md","A.");const b=await newDoc("b.md","B.");newConvo();await attachDoc(a.id);})()');
  await say(w,'log it','Logged.\n'+block([{append:true,replace:'- one'}]));
  const r=lastReply(w);
  w.eval('openDocEditor(docs.find(x=>x.name==="b.md").id)'); await tap(w,d.querySelector('#docAttachBtn')); await sleep(100);
  await applyCard(w,r.id,0);
  ck('an edit that named no file, made with only a.md attached, goes to a.md after b.md is attached too',
    edits(w,r.id)[0].status==='applied' && docText(w,'a.md')==='A.\n- one' && docText(w,'b.md')==='B.', JSON.stringify(edits(w,r.id)[0].status+' '+edits(w,r.id)[0].note)+' '+JSON.stringify([docText(w,'a.md'),docText(w,'b.md')]));
}
{
  // an edit that named no file while two were attached never had a file
  const dom=await boot(base());const w=dom.window,d=w.document;
  await w.eval('(async()=>{const a=await newDoc("a.md","A.");const b=await newDoc("b.md","B.");newConvo();await attachDoc(a.id);await attachDoc(b.id);})()');
  await say(w,'log it','Logged.\n'+block([{append:true,replace:'- one'}]));
  const r=lastReply(w);
  d.querySelector('#fileBtn').click(); await tap(w,d.querySelector('[data-fdetach]'));        // a.md out, b.md stays
  await applyCard(w,r.id,0);
  ck('an edit that named neither of two files is not given to the one left', edits(w,r.id)[0].status==='failed' && /didn't say which file/.test(edits(w,r.id)[0].note||'') && docText(w,'b.md')==='B.', JSON.stringify(edits(w,r.id)[0].status+' '+edits(w,r.id)[0].note)+' '+JSON.stringify(docText(w,'b.md')));
}
{
  // a named edit follows its file through a rename
  const dom=await boot(base());const w=dom.window,d=w.document;
  w.prompt=()=>'kira.md';
  await w.eval('(async()=>{const n=await newDoc("notes.md","Kira is a mage.");const o=await newDoc("other.md","x");newConvo();await attachDoc(n.id);await attachDoc(o.id);})()');
  await say(w,'promote Kira','Done.\n'+block([{file:'notes.md',find:'mage',replace:'archmage'}]));
  const a=lastReply(w);
  w.eval('openDocEditor(docs.find(x=>x.name==="notes.md").id)'); await tap(w,d.querySelector('#docRenameBtn')); w.eval('hideDocEdit()');
  await applyCard(w,a.id,0);
  ck('a card for notes.md applies to it after it was renamed kira.md', edits(w,a.id)[0].status==='applied' && docText(w,'kira.md')==='Kira is a archmage.', JSON.stringify(edits(w,a.id)[0])+' '+JSON.stringify(docText(w,'kira.md')));
}
{
  // a card stored before this release (no file id) is found by name, as before
  const dom=await boot(base());const w=dom.window;
  await w.eval('(async()=>{const n=await newDoc("notes.md","alpha");newConvo();await attachDoc(n.id);})()');
  w.eval(`(()=>{const pd=parseDocEdits(${JSON.stringify(block([{find:'alpha',replace:'ALPHA'}]))});current.messages.push({id:"u0",role:"user",content:"x"},{id:"a0",role:"assistant",content:"ok",edits:pd.edits});renderThread();})()`);
  await applyCard(w,'a0',0);
  ck('an older card with no file id still applies to the one attached file', edits(w,'a0')[0].status==='applied' && docText(w,'notes.md')==='ALPHA');
}
}

if(want(8)){
console.log('\n=== 8. A STORED RECORD CANNOT PUT HTML INTO AN EDIT CARD ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document;
  await w.eval('(async()=>{const n=await newDoc("notes.md","alpha beta");newConvo();await attachDoc(n.id);})()');
  // what a restored backup can hold: ids and a batch that are not ids
  w.eval(`current.messages.push({id:"u0",role:"user",content:"x"},{id:"a0",role:"assistant",content:"ok",edits:[
    {id:'e1" onmouseover="window.__pwned=1',type:"replace",find:"alpha",replace:"ALPHA",status:"pending"},
    {id:'"><img src=x onerror="window.__pwned=2">',type:"replace",find:"beta",replace:"BETA",status:"applied",batch:'" onclick="window.__pwned=3'},
    {id:"e3",type:"replace",find:"x",replace:"y",status:'failed" onfocus="window.__pwned=4'}]}); renderThread();`);
  await sleep(150);
  const box=d.querySelector('.msg[data-mid="a0"] .edits');
  const bad=box?Array.from(box.querySelectorAll('*')).filter(el=>Array.from(el.attributes).some(at=>/^on/i.test(at.name))).length:-1;
  ck('no element in the cards carries an event handler', bad===0, bad);
  ck('the cards are all there', box && box.querySelectorAll('.edit-card[data-eid]').length===3);
  await tap(w,box.querySelector('[data-apply]'));
  ck('a card whose id holds a quote still applies when tapped', J(w,'current.messages[1].edits[0].status')==='applied' && docText(w,'notes.md')==='ALPHA beta', J(w,'current.messages[1].edits[0].status'));
  // the message id goes into the card's buttons too
  const t=d.createElement('template');
  t.innerHTML=w.eval(`editCardsHtml({id:'m" onclick="window.__pwned=5',role:"assistant",editWarn:"w",edits:[{id:"e9",type:"append",replace:"z",status:"pending"}]})`);
  const bad2=Array.from(t.content.querySelectorAll('*')).filter(el=>Array.from(el.attributes).some(at=>/^on/i.test(at.name))).length;
  ck('a message id cannot add an attribute to the card buttons', bad2===0, bad2);
  ck('and comes back out exactly', t.content.querySelector('[data-apply]').getAttribute('data-apply')==='m" onclick="window.__pwned=5|e9');
  // a record whose edits are not a list does not take the thread down with it
  w.eval('current.messages.push({id:"a1",role:"assistant",content:"still here",edits:"<b>not a list</b>"})');
  let threw='';try{w.eval('renderThread()');}catch(e){threw=String(e.message);}
  ck('edits that are not a list draw no cards and break nothing', !threw && /still here/.test(d.querySelector('.msg[data-mid="a1"]').textContent) && !d.querySelector('.msg[data-mid="a1"] .edits'), threw);
}
}

console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})();
