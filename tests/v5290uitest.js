// TEST FILE — run with: node tests/v5290uitest.js
// The interface, through what a user does (Import, Restore, tapping a
// message, a reply arriving), never through the source text:
//   1. no stored or imported value reaches the page's HTML as markup: an
//      instruction set or a backup carrying quotes and tags in its ids, roles,
//      version numbers or switches draws as text, and every control still works
//   2. a code block inside a > quote draws inside the quote, and a quote's
//      text is escaped once (Don't, "Stay," <quietly>, code, nested quotes)
//   3. a linked image [![x](img)](link) is an image inside a link
//   4. Delete on a reply still arriving (or on the message it answers) stops
//      that request, and Send comes back
//   5. on a phone, a tap on actions that were not showing only shows them
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{ok=!!ok;console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const nodeErrs=[];
// every page error is recorded for the checks that look for one; one left over at the end fails the run
process.on('unhandledRejection',e=>nodeErrs.push('unhandledRejection: '+((e&&e.message)||e)));
// a page error thrown from a frame callback (requestAnimationFrame runs on a Node timer here) lands here
process.on('uncaughtException',e=>nodeErrs.push('uncaught: '+((e&&e.message)||e)));
const base=(o)=>Object.assign({
  providers:[{id:'o',preset:'custom',kind:'openai',name:'O',url:'https://o.test/v1',apiKey:'k',model:'m',ctx:200000}],
  activeProvider:'o',presets:[{id:'d',name:'D',system:'',injections:[],order:['__main__','__chat__']}],activePreset:'d',prompts:[],
  maxTokens:1024,effort:'off',showThinking:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}},o||{});
function boot(st,f){return new Promise(res=>{
  const errors=[];
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',beforeParse(w){
    w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;w.navigator.storage={estimate:async()=>({usage:0})};
    w.requestAnimationFrame=cb=>setTimeout(cb,0);w.confirm=()=>true;w.navigator.clipboard={writeText:async(t)=>{w.__clip=t;}};
    w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
    w.addEventListener('error',e=>errors.push('error: '+e.message));
    w.addEventListener('unhandledrejection',e=>errors.push('unhandledrejection: '+((e.reason&&e.reason.message)||e.reason)));
    if(f)w.fetch=f(w);
  }});
  dom.virtualConsole.on('jsdomError',e=>errors.push('jsdomError: '+((e&&e.message)||e)));
  dom.errors=errors;
  setTimeout(async()=>{try{
    await dom.window.eval('Promise.all([DB.clear(),DB.docClear()])');
    dom.window.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();');
  }catch(_){}res(dom);},800);});}
function bootKeep(st){return new Promise(res=>{
  const errors=[];
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',beforeParse(w){
    w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;w.navigator.storage={estimate:async()=>({usage:0})};
    w.requestAnimationFrame=cb=>setTimeout(cb,0);w.confirm=()=>true;
    w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
    w.addEventListener('error',e=>errors.push('error: '+e.message));
    w.addEventListener('unhandledrejection',e=>errors.push('unhandledrejection: '+((e.reason&&e.reason.message)||e.reason)));
  }});
  dom.virtualConsole.on('jsdomError',e=>errors.push('jsdomError: '+((e&&e.message)||e)));
  dom.errors=errors;
  setTimeout(()=>res(dom),900);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ev=(w,el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true}));
const tap=el=>{ if(!el) return false; el.click(); return true; };
const enc=t=>new TextEncoder().encode(t);
const oa=t=>'data: '+JSON.stringify({choices:[{delta:{content:t}}]})+'\n\n';
// a reply that arrives one piece every 150 ms, and stops when its request is aborted
const slow=(chunks,sig,log,tag)=>{let i=0;return{ok:true,status:200,headers:{get:()=>null},body:{getReader(){return{read(){
  return new Promise((res,rej)=>{
    if(sig&&sig.aborted){const e=new Error('aborted');e.name='AbortError';return rej(e);}
    const t=setTimeout(()=>{ if(log) log.push(tag+' piece '+i); res(i<chunks.length?{done:false,value:enc(chunks[i++])}:{done:true}); },150);
    if(sig) sig.addEventListener('abort',()=>{clearTimeout(t);if(log) log.push(tag+' aborted');const e=new Error('aborted');e.name='AbortError';rej(e);});});},cancel(){}};}}};};
// what a hostile value would put on the page if it ever became markup
const X=tag=>'"><img id="pwn-'+tag+'" src="x">';
const A=tag=>'" data-pwn="'+tag;
const planted=d=>[...d.querySelectorAll('img[id^="pwn-"]')].map(e=>e.id).concat([...d.querySelectorAll('[data-pwn]')].map(e=>'data-pwn='+e.getAttribute('data-pwn')));

(async()=>{

console.log('=== 1. NOTHING STORED OR IMPORTED BECOMES MARKUP ===');
{
  // an instruction set someone shared, through Settings > Instructions > Import
  const dom=await boot(base());const w=dom.window,d=w.document;
  w.eval('newConvo()');
  const set={app:'cozy-chat',kind:'instruction-set',preset:{name:'Shared RP set',system:'You narrate.',
    injections:[{id:'a',name:'Style',text:'Write vividly.',role:'system',pos:'relative',enabled:'true'+X('enabled')},
                {id:'b',name:'Off block',text:'x',role:'system',pos:'relative',enabled:false}],
    order:['__main__','a','b','__chat__']}};
  d.querySelector('#settingsBtn').click(); d.querySelector('.tab[data-tab=inst]').click();
  const picker=d.querySelector('#presetPicker');
  Object.defineProperty(picker,'files',{value:[{text:async()=>JSON.stringify(set)}],configurable:true});
  ev(w,picker,'change'); await sleep(300);
  ck('setup: the set is imported', /Imported Shared RP set/.test(d.querySelector('#toast').textContent), d.querySelector('#toast').textContent);
  ck('an imported block\'s switch value puts no markup on the page', planted(d).length===0, JSON.stringify(planted(d)));
  const tg=[...d.querySelectorAll('#injList [data-injon]')];
  ck('its switches read on and off, nothing else', tg.length===2 && tg[0].getAttribute('aria-checked')==='true' && tg[1].getAttribute('aria-checked')==='false',
     JSON.stringify(tg.map(t=>t.getAttribute('aria-checked'))));
  tap(tg[0]); await sleep(50);
  const tg2=d.querySelectorAll('#injList [data-injon]')[0];
  ck('and the switch still turns the block off', !!tg2 && tg2.getAttribute('aria-checked')==='false' && w.eval('PS().injections[0].enabled')===false);
  // copied into a project, the same block draws in the project's list
  w.eval('S.projects=[{id:"pj",name:"Story",injections:[],order:[],docIds:[],createdAt:Date.now()}]; saveSettings(); openProjEditor("pj")');
  w.eval('(v)=>{ PS().injections[0].enabled=v; saveSettings(); }')('1'+X('projenabled'));
  const from=d.querySelector('#projCopyFrom'); from.value=w.eval('PS().id'); d.querySelector('#projCopyBtn').click(); await sleep(50);
  ck('a project\'s copy of it puts no markup on the page either', d.querySelectorAll('#projInjList .ord-row').length===4 && planted(d).length===0, JSON.stringify(planted(d)));
  ck('no error while drawing any of it', dom.errors.length===0, JSON.stringify(dom.errors));
}
{
  // a backup whose records carry markup in every id the restore lets through (a chat's or a file's
  // own id it refuses: see the next block), a role, a version number and a switch
  const dom=await boot(base());const w=dom.window,d=w.document;
  const st=base({
    providers:[{id:'o'+X('prov'),preset:'custom',kind:'openai',name:'O',url:'https://o.test/v1',apiKey:'k',model:'m',ctx:200000},
               {id:'o2'+A('prov2'),preset:'custom',kind:'openai',name:'Second',url:'https://o2.test/v1',apiKey:'k',model:'m2',ctx:200000}],
    activeProvider:'o'+X('prov'),
    presets:[{id:'d'+X('preset'),name:'D',system:'',
              injections:[{id:'b1'+X('block'),name:'Block',text:'t',role:'system',pos:'relative',enabled:'yes'+X('enabled')},
                          {id:'b2$`'+A('grip'),name:'Second block',text:'u',role:'system',pos:'relative',enabled:true}],
              order:['__main__','b1'+X('block'),'b2$`'+A('grip'),'__chat__']},
             {id:'e'+A('preset2'),name:'Other set',system:'',injections:[],order:['__main__','__chat__']}],
    activePreset:'d'+X('preset'),
    prompts:[{id:'p1'+X('prompt'),title:'Greeting',text:'hello'}],
    projects:[{id:'pj'+X('proj'),name:'Story',createdAt:1,docIds:['f1'],
               injections:[{id:'pb'+X('projblock'),name:'PB',text:'x',role:'system',pos:'relative',enabled:'1'+X('projenabled')}],
               order:['__main__','pb'+X('projblock'),'__chat__']}]});
  const backup={app:'cozy-chat',settings:st,docs:[{id:'f1',name:'notes.md',text:'hello',updatedAt:1},{id:'f2',name:'other.md',text:'x',updatedAt:2}],
    conversations:[
      {id:'c1',title:'Shared chat',createdAt:1,updatedAt:Date.now(),cfg:{},docIds:['f1','f2'],filesOn:true,
       messages:[{id:'m1'+X('msg'),role:'user',content:'hi'},
                 {id:'m2',role:'assistant'+X('role'),content:'an odd one'},
                 {id:'m3'+A('msg3'),role:'user',content:'again'},
                 {id:'m4'+X('msg4'),role:'assistant',content:'hello',model:'m',sent:{chat:'c',id:'s',tokens:3},
                  approvals:[{id:'ap'+X('appr'),status:'pending',choices:['once'+X('choice'),'deny'],command:'ls',tool:'t'}],
                  variants:[{content:'first'},{content:'hello'}],vi:'1'+X('vi')}]},
      {id:'c2',title:'Old chat',archived:true,createdAt:1,updatedAt:1,cfg:{},messages:[{id:'x'+X('archmsg'),role:'user',content:'old'}]},
      {id:'c3',title:'Project chat',createdAt:1,updatedAt:Date.now()-5000,cfg:{},projectId:'pj'+X('proj'),messages:[]}]};
  // a chat or a file whose own id carries markup is refused at the door, with nothing restored
  await w.handleRestore({text:async()=>JSON.stringify({app:'cozy-chat',conversations:[{id:'c9'+X('chatid'),title:'x',messages:[]}]})}); await sleep(200);
  ck('a backup whose chat id carries markup is refused, nothing restored, nothing on the page', /Nothing was restored/.test(d.querySelector('#toast').textContent) && planted(d).length===0,
     d.querySelector('#toast').textContent);
  await w.handleRestore({text:async()=>JSON.stringify(backup)}); await sleep(300);
  ck('setup: the backup is restored', /Restored/.test(d.querySelector('#toast').textContent), d.querySelector('#toast').textContent);
  ck('the sidebar puts no markup on the page (chats, projects)', planted(d).length===0, JSON.stringify(planted(d)));
  // open the shared chat from the sidebar, as a user would
  tap([...d.querySelectorAll('#convoList .convo')].find(r=>/Shared chat/.test(r.textContent))); await sleep(150);
  ck('tapping the chat opens it', w.eval('current && current.title')==='Shared chat', w.eval('current && current.title'));
  ck('the chat draws all four messages', d.querySelectorAll('#threadInner .msg').length===4, d.querySelectorAll('#threadInner .msg').length);
  ck('the thread puts no markup on the page (ids, role, version, approval, What the model saw)', planted(d).length===0, JSON.stringify(planted(d)));
  const roleCls=[...d.querySelectorAll('#threadInner .msg')].map(e=>e.className);
  ck('a message is drawn as you, the assistant or an error, never as a stored role', roleCls.length===4 && roleCls.every(c=>/^msg (user|assistant|error)$/.test(c)), JSON.stringify(roleCls));
  const cnt=d.querySelector('#threadInner .swipe .count');
  ck('the version counter reads 2/2', !!cnt && cnt.textContent==='2/2', cnt && cnt.textContent);
  tap(d.querySelector('#fileBtn')); await sleep(50);
  ck('the chat\'s file list puts no markup on the page', d.querySelectorAll('#fileList .fl-row').length===2 && planted(d).length===0, JSON.stringify(planted(d)));
  // every control still finds its record
  const editBtn=[...d.querySelectorAll('#threadInner [data-edit]')].find(b=>b.closest('.msg').textContent.includes('again'));
  tap(editBtn); await sleep(50);
  const ta=d.querySelector('#threadInner .msg-edit');
  ck('Edit on a message with such an id opens its editor', !!ta && ta.value==='again');
  tap(d.querySelector('[data-canceledit]')); await sleep(50);
  w.__clip=null; tap(d.querySelector('#threadInner [data-copy]')); await sleep(50);
  ck('Copy copies that message', w.__clip==='hi', JSON.stringify(w.__clip));
  tap(d.querySelector('#threadInner [data-delmsg]')); await sleep(100);
  ck('Delete deletes that message', w.eval('current ? current.messages.length : -1')===3 && !w.eval('current && current.messages.some(m=>m.content==="hi")'));
  // Settings: connections, sets, blocks, projects
  tap(d.querySelector('#settingsBtn')); await sleep(50);
  ck('Settings > Connection puts no markup on the page', d.querySelectorAll('#provList .prov').length===2 && planted(d).length===0, JSON.stringify(planted(d)));
  tap(d.querySelector('#provList [data-editprov]')); await sleep(50);
  ck('a connection\'s edit button opens that connection', !d.querySelector('#provEditor').hidden && w.eval('editingProv')===w.eval('S.providers.slice().sort((a,b)=>nameOrder(a.name,b.name))[0].id'), w.eval('editingProv'));
  tap(d.querySelector('#cancelProvBtn'));
  tap([...d.querySelectorAll('#provList .prov')].find(r=>/Second/.test(r.textContent))); await sleep(50);
  ck('tapping a connection picks it for this chat', w.eval('activeProv() && activeProv().name')==='Second', w.eval('activeProv() && activeProv().name'));
  tap(d.querySelector('.tab[data-tab=chat]'));
  ck('the Chat tab\'s project list puts no markup on the page', d.querySelectorAll('#chatProj option').length===2 && planted(d).length===0, JSON.stringify(planted(d)));
  tap(d.querySelector('.tab[data-tab=inst]'));
  ck('the Instructions tab puts no markup on the page', d.querySelectorAll('#injList .ord-row').length===4 && d.querySelectorAll('#presetSel option').length===2 && planted(d).length===0, JSON.stringify(planted(d)));
  ck('the set picker holds the sets\' own ids', [...d.querySelector('#presetSel').options].map(o=>o.value).join('|')===w.eval('S.presets.map(p=>p.id).join("|")'));
  const grips=[...d.querySelectorAll('#injList [data-grip]')].map(g=>g.getAttribute('data-grip'));
  ck('each block\'s handle carries its own id, exactly', JSON.stringify(grips)===JSON.stringify(w.eval('PS().order')), JSON.stringify(grips));
  // open the block and rename it: the row's name follows and the name is kept
  tap([...d.querySelectorAll('#injList [data-edit]')].find(e=>/^Block$/.test(e.querySelector('.ord-name').textContent))); await sleep(50);
  const nm=d.querySelector('#injList [data-injname]');
  if (nm){ nm.value='Renamed block'; ev(w,nm,'input'); await sleep(50); }
  let kept=''; try { kept=JSON.parse(w.localStorage.getItem('cozychat:settings')).presets[0].injections[0].name; } catch(_){}
  ck('renaming a block with such an id keeps the name', !!nm && w.eval('PS().injections[0].name')==='Renamed block' && kept==='Renamed block', kept);
  ck('and its row shows the new name', [...d.querySelectorAll('#injList .ord-name')].some(e=>e.textContent==='Renamed block'));
  const g=d.querySelectorAll('#injList [data-grip]')[2];
  if (g) g.dispatchEvent(new w.PointerEvent('pointerdown',{bubbles:true,pointerId:1,clientY:5}));
  const dragging=d.querySelector('#injList .ord-row.dragging');
  ck('picking a block up by its handle marks that row', !!g && !!dragging && dragging.getAttribute('data-row')===g.getAttribute('data-grip'));
  if (g) g.dispatchEvent(new w.PointerEvent('pointercancel',{bubbles:true,pointerId:1})); await sleep(50);
  tap(d.querySelector('#closeSettings'));
  // the project editor, the Files sheet, saved prompts, the archive
  tap(d.querySelector('#convoList [data-projedit]')); await sleep(50);
  ck('the project\'s settings button opens its editor', d.querySelector('#projModal').classList.contains('show'));
  if (!d.querySelector('#projModal').classList.contains('show')) w.eval('openProjEditor(S.projects[0].id)');
  ck('the project editor puts no markup on the page', d.querySelectorAll('#projInjList .ord-row').length===3 && d.querySelectorAll('#projFiles .doc-row').length===2 && planted(d).length===0, JSON.stringify(planted(d)));
  tap(d.querySelector('#projInjList [data-edit]')); await sleep(50);
  const pnm=d.querySelector('#projInjList [data-pinjname]');
  if (pnm){ pnm.value='Project block'; ev(w,pnm,'input'); await sleep(50); }
  ck('renaming a project block with such an id keeps the name', !!pnm && w.eval('S.projects[0].injections[0].name')==='Project block');
  tap(d.querySelector('#closeProj'));
  tap(d.querySelector('#docsBtn')); await sleep(50);
  ck('the Files sheet puts no markup on the page', d.querySelectorAll('#docList .doc-row').length===2 && planted(d).length===0, JSON.stringify(planted(d)));
  tap(d.querySelector('#closeDocs'));
  tap(d.querySelector('#promptsBtn')); await sleep(50);
  ck('saved prompts put no markup on the page', d.querySelectorAll('#promptList .prompt-row').length===1 && planted(d).length===0, JSON.stringify(planted(d)));
  d.querySelector('#input').value='';
  tap(d.querySelector('#promptList [data-use]')); await sleep(50);
  ck('tapping the saved prompt drops it into the message box', d.querySelector('#input').value==='hello', JSON.stringify(d.querySelector('#input').value));
  tap(d.querySelector('#archBtn')); await sleep(50);
  ck('the archive puts no markup on the page', d.querySelectorAll('#archList .arch-row').length===1 && planted(d).length===0, JSON.stringify(planted(d)));
  tap(d.querySelector('#archList [data-archopen]')); await sleep(100);
  ck('tapping an archived chat opens it', w.eval('current && current.title')==='Old chat', w.eval('current && current.title'));
  ck('no error while drawing or using any of it', dom.errors.length===0, JSON.stringify(dom.errors));
}

console.log('\n=== 2. A CODE BLOCK INSIDE A QUOTE, AND A QUOTE ESCAPED ONCE ===');
{
  // a reply arriving with a code block inside a quote, the way a model writes one
  const reply='Here is how:\n\n> Run this:\n> ```bash\n> ls -la\n> ```\n\nDone.';
  const pieces=[reply.slice(0,30),reply.slice(30,52),reply.slice(52)];
  let calls=0;
  const dom=await boot(base(),w=>(url,init)=>{calls++;return Promise.resolve(slow(calls===1?pieces.map(oa):['Sorted.'].map(oa),init&&init.signal));});
  const w=dom.window,d=w.document;
  w.eval('newConvo(); current.title="Older chat"; current.messages.push({id:"o1",role:"user",content:"older question"},{id:"o2",role:"assistant",content:"older answer"}); persist();');
  await sleep(50);
  w.eval('newConvo(); current.title="Shell help";');
  d.querySelector('#input').value='how do I list files?'; ev(w,d.querySelector('#input'),'input');
  d.querySelector('#sendBtn').click(); await sleep(400);
  const live=d.querySelector('#threadInner .msg.assistant .msg-body');
  ck('while it arrives, the reply is drawn as it comes (the quote and its code block)', !!live && /Run this/.test(live.textContent) && !!live.querySelector('blockquote .codeblock'), live && JSON.stringify(live.textContent.slice(0,60)));
  await sleep(500);
  const body=d.querySelector('#threadInner .msg.assistant .msg-body');
  const code=body && body.querySelector('blockquote .codeblock code');
  ck('when it has arrived, the code block is drawn inside the quote', !!code, body && body.innerHTML.slice(0,120));
  ck('holding the code itself, without the quote marks', !!code && code.textContent==='ls -la', code && JSON.stringify(code.textContent));
  ck('under its language', !!body && !!body.querySelector('blockquote .codeblock .lang') && body.querySelector('blockquote .codeblock .lang').textContent==='bash');
  ck('and the words around it are drawn too', !!body && /Here is how/.test(body.textContent) && /Run this/.test(body.querySelector('blockquote').textContent) && /Done\./.test(body.textContent));
  ck('the reply is saved and Send is back', d.querySelector('#sendBtn').getAttribute('aria-label')==='Send' && (await w.eval('DB.all()')).some(c=>c.title==='Shell help' && c.messages.length===2));
  // switching away and back draws each chat's own messages
  const rowOf=t=>[...d.querySelectorAll('#convoList .convo')].find(r=>r.querySelector('.convo-title').textContent===t);
  tap(rowOf('Older chat')); await sleep(100);
  tap(rowOf('Shell help')); await sleep(100);
  const texts=[...d.querySelectorAll('#threadInner .msg .msg-body')].map(e=>e.textContent.slice(0,20));
  ck('reopening the chat shows its own messages under its own title', d.querySelector('#chatTitle').textContent==='Shell help' && texts.length===2 && /how do I list/.test(texts[0]) && /Here is how/.test(texts[1]), JSON.stringify(texts));
  // a message in that chat goes out like any other
  d.querySelector('#input').value='and sorted by size?'; ev(w,d.querySelector('#input'),'input');
  d.querySelector('#sendBtn').click(); await sleep(600);
  const saved=(await w.eval('DB.all()')).find(c=>c.title==='Shell help');
  ck('a message sent in that chat goes out, is saved, and Send comes back', calls===2 && saved && saved.messages.length===4 && d.querySelector('#sendBtn').getAttribute('aria-label')==='Send',
     'requests '+calls+', saved '+(saved&&saved.messages.length)+', button '+d.querySelector('#sendBtn').getAttribute('aria-label'));
  ck('no error while any of it was drawn', dom.errors.length===0 && nodeErrs.length===0, JSON.stringify(dom.errors.concat(nodeErrs)));
}
{
  // the newest chat holds such a reply: the app opens on it, drawn
  const dom=await boot(base());const w=dom.window;
  await w.eval(`(async()=>{ await DB.put({id:'old1',title:'Older chat',createdAt:1,updatedAt:Date.now()-60000,cfg:defaultCfg(),messages:[{id:'u0',role:'user',content:'hello'},{id:'a0',role:'assistant',content:'hi there'}]});
    await DB.put({id:'new1',title:'Shell help',createdAt:2,updatedAt:Date.now(),cfg:defaultCfg(),messages:[{id:'u1',role:'user',content:'how?'},{id:'a1',role:'assistant',content:'Like this:\\n\\n> \`\`\`bash\\n> ls\\n> \`\`\`',variants:[],vi:0}]}); })()`);
  const errsBefore=nodeErrs.length;
  const again=await bootKeep(base());const d2=again.window.document;
  ck('opening the app on that chat draws it', d2.querySelector('#chatTitle').textContent==='Shell help' && d2.querySelectorAll('#threadInner .msg').length===2 && !!d2.querySelector('#threadInner blockquote .codeblock'),
     d2.querySelector('#chatTitle').textContent+' / '+d2.querySelectorAll('#threadInner .msg').length+' messages');
  ck('and nothing stops the app from finishing its start', again.errors.length===0 && nodeErrs.length===errsBefore, JSON.stringify(again.errors.concat(nodeErrs.slice(errsBefore))));
}
{
  const dom=await boot(base());const w=dom.window,d=w.document;
  const none=d.createElement('div');   // what a chat that could not be drawn shows: nothing
  const shown=md=>{ try { w.eval('(t)=>{ current={id:"q",title:"Q",cfg:defaultCfg(),messages:[{id:"u",role:"user",content:"?"},{id:"a",role:"assistant",content:t}]}; renderThread(); }')(md); }
                    catch(e){ dom.errors.push('drawing threw: '+e.message); return none; }
                    return d.querySelector('#threadInner .msg.assistant .msg-body') || none; };
  let b=shown('> Don\'t worry, "Stay," she said. <quietly> & more');
  ck('a quote shows apostrophes, quote marks, <, > and & as written', b.querySelector('blockquote') && b.querySelector('blockquote').textContent==='Don\'t worry, "Stay," she said. <quietly> & more',
     JSON.stringify(b.textContent));
  b=shown('> use `a<b && c` here');
  ck('code inside a quote shows as written', !!b.querySelector('blockquote code') && b.querySelector('blockquote code').textContent==='a<b && c', JSON.stringify(b.textContent));
  b=shown('> outer line\n> > inner line');
  const inner=b.querySelector('blockquote blockquote');
  ck('a quote inside a quote is a quote inside a quote', !!inner && inner.textContent==='inner line' && !/&gt;/.test(b.textContent), JSON.stringify(b.innerHTML.slice(0,140)));
  b=shown('> see ```x``` there');
  ck('three backticks inside a quoted sentence draw without breaking the chat', !!b && /see/.test(b.textContent) && /there/.test(b.textContent));
  b=shown('> > ```js\n> > let x = 1;\n> > ```');
  const nc=b.querySelector('blockquote blockquote .codeblock code');
  ck('a code block two quotes deep keeps its code without the marks', !!nc && nc.textContent==='let x = 1;', nc && JSON.stringify(nc.textContent));
  b=shown('```\n> not a quote\n```');
  ck('a code block that holds > lines keeps them', !!b.querySelector('.codeblock code') && b.querySelector('.codeblock code').textContent==='> not a quote' && !b.querySelector('blockquote'));
  b=shown('stray \u0000B7\u0000 and \u0000C3\u0000 and \u0000L2\u0000 markers');
  ck('stray placeholder characters in a reply draw as text, not as a crash', !!b && /stray/.test(b.textContent) && /markers/.test(b.textContent) && !/undefined/.test(b.textContent), JSON.stringify(b && b.textContent));
  b=shown('**b** `c` and a table:\n\n| a | b |\n|---|---|\n| 1 | `x<y` |\n\n- item with `code`');
  ck('everything outside quotes draws as before', !!b.querySelector('strong') && !!b.querySelector('table td code') && b.querySelector('table td code').textContent==='x<y' && !!b.querySelector('li code'));
  ck('no error while any of it was drawn', dom.errors.length===0, JSON.stringify(dom.errors));
}

console.log('\n=== 3. A LINKED IMAGE ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document;
  const none=d.createElement('div');
  // since v5.29.1 a picture from another address waits for a tap (tests/v5291uitest.js):
  // each is tapped here, and what the tap leaves is what these checks look at
  const shown=md=>{ try { w.eval('(t)=>{ current={id:"q",title:"Q",cfg:defaultCfg(),messages:[{id:"u",role:"user",content:"?"},{id:"a",role:"assistant",content:t}]}; renderThread(); }')(md); }
                    catch(e){ dom.errors.push('drawing threw: '+e.message); return none; }
                    for (const p of [...d.querySelectorAll('#threadInner .md-img-ph')]) p.dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true}));
                    return d.querySelector('#threadInner .msg.assistant .msg-body') || none; };
  let b=shown('Build status: [![badge](https://img.test/b.png)](https://site.test/) — all green.');
  const img=b.querySelector('img[src="https://img.test/b.png"]'), a=img && img.closest('a');
  ck('a linked image is the image, inside its link', !!a && a.getAttribute('href')==='https://site.test/' && img.getAttribute('alt')==='badge', b.innerHTML.slice(0,160));
  ck('with no placeholder text beside it', !/L\d/.test(b.textContent) && /Build status:/.test(b.textContent) && /all green/.test(b.textContent), JSON.stringify(b.textContent));
  ck('and no link inside a link', b.querySelectorAll('a a').length===0 && b.querySelectorAll('a').length===1, b.querySelectorAll('a').length);
  b=shown('[![logo](data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==)](https://site.test/home)');
  const di=b.querySelector('img[src^="data:image/png;base64,"]');
  ck('a linked picture the agent sent inline is the picture, inside its link', !!di && !!di.closest('a') && di.closest('a').getAttribute('href')==='https://site.test/home', b.innerHTML.slice(0,140));
  b=shown('[see ![i](https://img.test/i.png) here](https://site.test/page)');
  const li=b.querySelector('a[href="https://site.test/page"] img[src="https://img.test/i.png"]');
  ck('words and an image in one link stay one link', !!li && b.querySelectorAll('a').length===1 && /see/.test(b.textContent) && /here/.test(b.textContent), b.innerHTML.slice(0,160));
  b=shown('Look: ![Ichigo](https://img.x/ichigo.png) and [a link](https://x.y/z) and https://bare.test/p');
  const own=b.querySelector('img[src="https://img.x/ichigo.png"]');
  ck('an image on its own still opens itself, and links stay links', !!own && own.closest('a') && own.closest('a').getAttribute('href')==='https://img.x/ichigo.png'
     && !!b.querySelector('a[href="https://x.y/z"]') && b.querySelector('a[href="https://x.y/z"]').textContent==='a link' && !!b.querySelector('a[href="https://bare.test/p"]'));
  ck('no error while any of it was drawn', dom.errors.length===0, JSON.stringify(dom.errors));
}

console.log('\n=== 4. DELETE ON A REPLY STILL ARRIVING ===');
async function arriving(){
  const log=[];let calls=0;
  const dom=await boot(base(),w=>(url,init)=>{const n=++calls;return Promise.resolve(slow(['a ','b ','c ','d ','e ','f ','g.'].map(oa),init&&init.signal,log,'request #'+n));});
  const w=dom.window,d=w.document;
  w.eval('newConvo(); current.messages.push({id:"u0",role:"user",content:"an older question"},{id:"a0",role:"assistant",content:"an older answer"}); renderThread();');
  d.querySelector('#input').value='count to seven'; ev(w,d.querySelector('#input'),'input');
  d.querySelector('#sendBtn').click(); await sleep(450);
  return {dom,w,d,log,calls:()=>calls};
}
const delOn=(d,text)=>tap([...d.querySelectorAll('#threadInner .msg')].filter(m=>m.querySelector('.msg-body').textContent.includes(text)).map(m=>m.querySelector('[data-delmsg]'))[0]);
{
  const {w,d,log}=await arriving();
  ck('setup: the reply is arriving', w.eval('current.messages[3] && current.messages[3].pending===true') && d.querySelector('#sendBtn').getAttribute('aria-label')==='Stop');
  const piecesBefore=log.filter(x=>/piece/.test(x)).length;
  delOn(d,'a b'); await sleep(250);
  ck('Delete on the reply stops its request', log.includes('request #1 aborted'), JSON.stringify(log));
  ck('Send is Send again', d.querySelector('#sendBtn').getAttribute('aria-label')==='Send');
  await sleep(1300);
  ck('nothing more of it is read', log.filter(x=>/piece/.test(x)).length<=piecesBefore+1, log.filter(x=>/piece/.test(x)).length+' pieces, '+piecesBefore+' before Delete');
  const stored=(await w.eval('DB.all()'))[0];
  ck('the reply stays deleted, on screen and saved', d.querySelectorAll('#threadInner .msg').length===3 && stored.messages.length===3 && !stored.messages.some(m=>/a b/.test(m.content||'')),
     stored.messages.map(m=>m.role+':'+String(m.content).slice(0,12)).join(' | '));
}
{
  const {w,d,log}=await arriving();
  delOn(d,'count to seven'); await sleep(250);
  ck('Delete on the message the reply answers stops its request too', log.includes('request #1 aborted'), JSON.stringify(log));
  ck('and Send is Send again', d.querySelector('#sendBtn').getAttribute('aria-label')==='Send');
}
{
  const {w,d,log}=await arriving();
  delOn(d,'an older question'); await sleep(1500);
  ck('Delete on an older message leaves the reply arriving, and it arrives whole', !log.some(x=>/aborted/.test(x)) && w.eval('current.messages.slice(-1)[0].content')==='a b c d e f g.',
     JSON.stringify(w.eval('current.messages.slice(-1)[0].content')));
}
{
  // while the message is being made ready (a web search), before any reply exists
  let chat=0, searched=0;
  const st=base({search:{on:true,provider:'tavily',key:'tk',count:3,relay:'',always:true,images:false,auto:true,model:false}});
  const dom=await boot(st,w=>(url,init)=>{
    if (String(url).includes('tavily')){ searched++;
      return new Promise((res,rej)=>{ const t=setTimeout(()=>res({ok:true,status:200,json:async()=>({results:[{title:'r',url:'https://r.test/',content:'r'}]})}),800);
        init.signal && init.signal.addEventListener('abort',()=>{clearTimeout(t);const e=new Error('aborted');e.name='AbortError';rej(e);}); }); }
    chat++; return Promise.resolve(slow([oa('ok')],init&&init.signal)); });
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  d.querySelector('#input').value='what is new today?'; ev(w,d.querySelector('#input'),'input');
  d.querySelector('#sendBtn').click(); await sleep(250);
  ck('setup: the message is being made ready (searching), Send is Stop', searched===1 && d.querySelector('#sendBtn').getAttribute('aria-label')==='Stop');
  delOn(d,'what is new today'); await sleep(1300);
  ck('Delete on it while it is made ready sends nothing', chat===0, chat+' requests');
  ck('and Send is Send again', d.querySelector('#sendBtn').getAttribute('aria-label')==='Send');
  ck('and the chat is empty', w.eval('current.messages.length')===0, w.eval('current.messages.length'));
}

console.log('\n=== 5. ON A PHONE, A TAP ON HIDDEN ACTIONS ONLY SHOWS THEM ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document;
  w.eval(`newConvo(); current.messages.push({id:"u0",role:"user",content:"My careful question"},{id:"a0",role:"assistant",content:"An answer",variants:[{content:"First"},{content:"An answer"}],vi:1},{id:"u1",role:"user",content:"Follow-up"}); renderThread(); persist();`);
  await sleep(50);
  // a finger: touchstart on the spot, then the click the browser makes of the tap
  const fingerTap=el=>{ if(!el) return; el.dispatchEvent(new w.TouchEvent('touchstart',{bubbles:true,cancelable:true})); el.dispatchEvent(new w.TouchEvent('touchend',{bubbles:true,cancelable:true})); el.click(); };
  const gone=d.createElement('div');   // a message no longer on screen
  const msgOf=id=>[...d.querySelectorAll('#threadInner .msg')].find(m=>m.getAttribute('data-mid')===id)||gone;
  ck('setup: no message shows its actions yet', d.querySelectorAll('#threadInner .msg.touched').length===0);
  fingerTap(msgOf('u0').querySelector('[data-delmsg]')); await sleep(100);
  ck('a first tap where Delete sits deletes nothing', w.eval('current.messages.length')===3, w.eval('current.messages.map(m=>m.content).join(" | ")'));
  ck('it shows that message\'s actions', !!msgOf('u0') && msgOf('u0').classList.contains('touched'));
  fingerTap(msgOf('u0').querySelector('[data-branch]')); await sleep(150);
  ck('with them showing, a tap does what it says (Branch)', w.eval('convos.length')===2 && w.eval('current.title').endsWith('↗'), w.eval('convos.length')+' chats');
  tap([...d.querySelectorAll('#convoList .convo')].find(r=>!/↗/.test(r.textContent))); await sleep(100);
  fingerTap(msgOf('u1').querySelector('[data-copy]')); await sleep(50);
  ck('a first tap on another message\'s Copy copies nothing', w.__clip==null && msgOf('u1').classList.contains('touched'), JSON.stringify(w.__clip));
  ck('and the first message\'s actions hide again', !msgOf('u0').classList.contains('touched'));
  fingerTap(msgOf('u1').querySelector('[data-delmsg]')); await sleep(100);
  ck('a second tap, actions showing, deletes it', w.eval('current.messages.length')===2 && !w.eval('current.messages.some(m=>m.id==="u1")'));
  // the version arrows are always showing: they work on the first tap
  w.eval('renderThread()'); await sleep(20);
  fingerTap(msgOf('a0').querySelector('[data-swipe][data-dir="-1"]')); await sleep(100);
  ck('the version arrows, always showing, work on the first tap', w.eval('current.messages[1] && current.messages[1].vi')===0 && !!msgOf('a0').querySelector('.msg-body') && msgOf('a0').querySelector('.msg-body').textContent==='First', w.eval('current.messages[1] && current.messages[1].vi'));
  // a mouse shows them by hovering, so a click works at once - even right after a finger scrolled over the message
  w.eval('renderThread()'); await sleep(20);
  const body=msgOf('u0').querySelector('.msg-body');
  for (const t of ['touchstart','touchmove','touchend']) body && body.dispatchEvent(new w.TouchEvent(t,{bubbles:true,cancelable:true}));
  const del=msgOf('u0').querySelector('[data-delmsg]');
  if (del) del.dispatchEvent(new w.PointerEvent('click',{bubbles:true,cancelable:true,pointerType:'mouse'}));
  await sleep(100);
  ck('with a mouse, Delete works on the first click, even just after a finger scrolled over the message', w.eval('current.messages.length')===1, w.eval('current.messages.length'));
  ck('no error', dom.errors.length===0, JSON.stringify(dom.errors));
}

{
  // the sidebar's Archive and Delete show on the open chat's row (or under a mouse): a finger on another row's hidden one opens that chat
  const dom=await boot(base());const w=dom.window,d=w.document;
  await w.eval(`(async()=>{ for (const t of ['First chat','Second chat','Third chat']){ newConvo(); current.title=t; current.messages.push({id:'u'+t.length+t[0],role:'user',content:t}); await persist(); } })()`);
  await sleep(50);
  const fingerTap=el=>{ if(!el) return; el.dispatchEvent(new w.TouchEvent('touchstart',{bubbles:true,cancelable:true})); el.dispatchEvent(new w.TouchEvent('touchend',{bubbles:true,cancelable:true})); el.click(); };
  const noRow=d.createElement('div');
  const rowOf=t=>[...d.querySelectorAll('#convoList .convo')].find(r=>r.querySelector('.convo-title').textContent===t)||noRow;
  const archived=t=>w.eval('(t)=>!!(convos.find(c=>c.title===t)||{}).archived')(t);
  ck('setup: the open chat is the third', w.eval('current.title')==='Third chat' && rowOf('Third chat').classList.contains('active') && !rowOf('First chat').classList.contains('active'));
  fingerTap(rowOf('First chat').querySelector('[data-arch]')); await sleep(100);
  ck('a finger on another chat\'s hidden Archive does not archive it', !archived('First chat'));
  ck('it opens that chat, as a tap on its row does', w.eval('current.title')==='First chat', w.eval('current.title'));
  let asked=0; w.confirm=()=>{asked++;return true;};
  fingerTap(rowOf('Second chat').querySelector('[data-del]')); await sleep(100);
  ck('a finger on another chat\'s hidden Delete asks nothing and deletes nothing', asked===0 && w.eval('convos.length')===3 && w.eval('current.title')==='Second chat', asked+' asked, '+w.eval('convos.length')+' chats');
  fingerTap(rowOf('Second chat').querySelector('[data-arch]')); await sleep(100);
  ck('on the open chat\'s row, where they show, Archive archives', archived('Second chat'));
  // a row that is not the open chat's, so its buttons are hidden from a finger
  const other=[...d.querySelectorAll('#convoList .convo')].find(r=>!r.classList.contains('active')) || noRow;
  const otherTitle=(other.querySelector('.convo-title')||{}).textContent;
  for (const t of ['touchstart','touchmove','touchend']) other.dispatchEvent(new w.TouchEvent(t,{bubbles:true,cancelable:true}));
  const arch=other.querySelector('[data-arch]');
  if (arch) arch.dispatchEvent(new w.PointerEvent('click',{bubbles:true,cancelable:true,pointerType:'mouse'}));
  await sleep(100);
  ck('with a mouse, Archive on any row archives, even just after a finger scrolled the list', !!otherTitle && archived(otherTitle), otherTitle);
  ck('no error', dom.errors.length===0, JSON.stringify(dom.errors));
}

ck('no page error went unnoticed', nodeErrs.length===0, JSON.stringify(nodeErrs));
console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})().catch(e=>{ console.log('CRASHED part-way: '+((e&&e.stack)||e)); process.exit(1); });
