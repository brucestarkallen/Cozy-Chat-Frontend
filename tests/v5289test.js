// TEST FILE — run with: node tests/v5289test.js
// Guards v5.28.9, through the live path (buildPayload(), send(), the meter,
// the thread). What needs a real browser to decode or draw a picture is in
// tests/pictures_e2e.py; this is everything around it:
//   1. the rules for pictures: at most 100 in a request, JPEG/PNG/GIF/WebP
//      only (Claude, OpenAI and OpenRouter refuse a request over any other
//      kind); a picture with no data never breaks a request
//   2. the meter counts attached files and pictures; What the model saw counts
//      the pictures a request carried
//   3. a picture the browser cannot open is kept, marked, and not tried again
//   4. a stored record cannot put HTML into the thread through a picture
//   5. an emptied message is not sent
//   6. Hermes' reason for asking permission is on the card, on both transports
//   7. a text file keeps its own code blocks inside its fence
//   8. a chat deleted while its message is being prepared (the web search,
//      an older picture) stays deleted, and nothing is sent for it
//   9. getting a message ready is part of sending: Send is Stop meanwhile and
//      Stop ends it; Swipe on a reply still coming in leaves it coming in
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=(o)=>Object.assign({
  providers:[{id:'o',preset:'custom',kind:'openai',name:'O',url:'https://o.test/v1',apiKey:'k',model:'m',ctx:200000},
             {id:'a',preset:'anthropic',kind:'anthropic',name:'C',url:'https://api.anthropic.com/v1',apiKey:'k',model:'claude-sonnet-4-6',ctx:200000},
             {id:'h',preset:'hermes',kind:'openai',name:'Hermes Agent',url:'http://127.0.0.1:8642/v1',apiKey:'hk',model:'hermes-agent',ctx:200000,hermesRuns:true}],
  activeProvider:'o',presets:[{id:'d',name:'D',system:'',injections:[],order:['__main__','__chat__']}],activePreset:'d',prompts:[],
  maxTokens:1024,effort:'off',showThinking:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}},o||{});
function boot(st,f){return new Promise(res=>{
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',beforeParse(w){
    w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;w.navigator.storage={estimate:async()=>({usage:0})};
    w.requestAnimationFrame=cb=>setTimeout(cb,0);w.confirm=()=>true;w.navigator.clipboard={writeText:async()=>{}};
    w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
    if(f)w.fetch=f(w);
  }});
  setTimeout(async()=>{try{
    await dom.window.eval('Promise.all([DB.clear(),DB.docClear()])');
    dom.window.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();');
  }catch(_){}res(dom);},800);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ev=(w,el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true}));
const enc=t=>new TextEncoder().encode(t);
const stream=chunks=>{let i=0;return{ok:true,status:200,body:{getReader(){return{read(){
  return Promise.resolve(i<chunks.length?{done:false,value:enc(chunks[i++])}:{done:true});}};}}};};
const oa=t=>'data: '+JSON.stringify({choices:[{delta:{content:t}}]})+'\n\n';
// a picture as v5.28.9 stores one: measured, with its small copy
const pic=(name,chars,o)=>Object.assign({kind:'image',name,mime:'image/jpeg',data:'A'.repeat(chars),w:1500,h:2000,thumb:'data:image/webp;base64,UklG'},o||{});
const meter=w=>Number(w.document.querySelector('#ctxLabel').textContent.split(' / ')[0].replace(/[^0-9]/g,''));

(async()=>{

console.log('=== 1. THE RULES FOR PICTURES ===');
{
  const dom=await boot(base());const w=dom.window;
  const wire=pid=>{ w.eval('current.cfg.providerId="'+pid+'"'); return w.eval('buildPayload({},current)').body.messages.filter(m=>m.role==='user'); };
  const picsIn=m=>Array.isArray(m.content)?m.content.filter(p=>p.type==='image'||p.type==='image_url').length:0;
  const textOf=m=>Array.isArray(m.content)?m.content.filter(p=>p.type==='text').map(p=>p.text).join(''):m.content;
  // 120 small pictures over 120 messages: they fit the bytes, not the count
  w.eval('newConvo()');
  for(let i=0;i<120;i++) w.eval('(a)=>current.messages.push({id:"u'+i+'",role:"user",content:"p'+i+'",attachments:[a]},{id:"a'+i+'",role:"assistant",content:"ok"})')(pic('s'+i+'.jpg',4000));
  w.eval('current.messages.push({id:"q",role:"user",content:"which?"})');
  for (const pid of ['a','o']){
    const us=wire(pid), n=us.reduce((t,m)=>t+picsIn(m),0);
    ck(pid+': at most 100 pictures in one request', n===100, n);
    ck(pid+': the newest 100', picsIn(us[119])===1 && picsIn(us[20])===1 && picsIn(us[19])===0, [picsIn(us[119]),picsIn(us[20]),picsIn(us[19])].join(','));
    ck(pid+': the older ones are named in their messages', /\("s0\.jpg"\) was attached here; it is not sent again/.test(textOf(us[0])), JSON.stringify(textOf(us[0]).slice(0,90)));
  }
  // kinds of picture: Claude, OpenAI and OpenRouter take JPEG, PNG, GIF and WebP only
  w.eval('newConvo()');
  w.eval('(a,b)=>current.messages.push({id:"u0",role:"user",content:"from my iPhone",attachments:[a,b]})')(pic('x.heic',4000,{mime:'image/heic'}),pic('y.webp',4000,{mime:'image/webp'}));
  let us=wire('a');
  const heicNote=/\("x\.heic"\) was attached here; it is not sent — models are sent JPEG, PNG, GIF and WebP pictures only/;
  ck('Claude: a HEIC picture is named, not sent', picsIn(us[0])===1 && heicNote.test(textOf(us[0])), JSON.stringify(textOf(us[0]).slice(0,140)));
  ck('Claude: the WebP beside it goes', JSON.stringify(us[0].content).includes('"media_type":"image/webp"'));
  us=wire('o');
  ck('an OpenAI-compatible service is not sent the HEIC either, and is told of it', picsIn(us[0])===1 && heicNote.test(textOf(us[0])), picsIn(us[0])+' '+JSON.stringify(textOf(us[0]).slice(0,140)));
  ck('and gets the WebP', JSON.stringify(us[0].content).includes('data:image/webp;base64,'));
  // a picture with no data in it never breaks a request
  w.eval('newConvo()');
  w.eval('current.messages.push({id:"u0",role:"user",content:"broken",attachments:[{kind:"image",name:"gone.jpg",mime:"image/jpeg"}]})');
  let threw=''; try { us=wire('a'); } catch(e){ threw=String(e.message); }
  ck('a picture record with no data is named, and the request still builds', !threw && /\("gone\.jpg"\)[^\]]*data is missing/.test(textOf(us[0])), threw || JSON.stringify(textOf(us[0])));
}

console.log('\n=== 2. THE METER COUNTS FILES AND PICTURES ===');
{
  const dom=await boot(base(),w=>()=>Promise.resolve(stream([oa('I see it.')])));const w=dom.window,d=w.document;
  w.eval('newConvo(); current.messages.push({id:"u0",role:"user",content:"hi"},{id:"a0",role:"assistant",content:"hello"}); renderThread(); updateEmber();');
  const empty=meter(w);
  w.eval('(t)=>{current.messages[0].attachments=[{kind:"text",name:"notes.md",text:t}]; updateEmber();}')('x'.repeat(40000));
  const withFile=meter(w);
  ck('a 40,000-character file attached to a message moves the meter by about 10,000 tokens', withFile-empty>=10000 && withFile-empty<=10100, (withFile-empty)+' tokens');
  w.eval('(a)=>{current.messages.push({id:"u1",role:"user",content:"look",attachments:[a]}); updateEmber();}')(pic('one.jpg',900000));
  const withPic=meter(w);
  ck('a 1500x2000 picture counts what Claude would count for it (54 x 72 patches = 3888)', withPic-withFile>=3888 && withPic-withFile<=3900, (withPic-withFile)+' tokens');
  w.eval('(a)=>{pendingAtts=[a]; renderAttachTray();}')(pic('waiting.jpg',900000,{w:1000,h:1000}));
  const withTray=meter(w);
  ck('a picture waiting in the tray counts too (1000x1000 = 1296)', withTray-withPic===1296, (withTray-withPic)+' tokens');
  // What the model saw, when the service sends no count
  w.eval('pendingAtts=[]; renderAttachTray();');
  d.querySelector('#input').value='and this?'; ev(w,d.querySelector('#input'),'input');
  d.querySelector('#sendBtn').click(); await sleep(400);
  const rec=w.eval('current.messages.slice(-1)[0].sent');
  const textOnly=w.eval('(()=>{ const r=sentRecord(current,activeProv(),[{url:"https://o.test/v1/chat/completions",body:{messages:[]},parts:[]}],{}); return r.tokens; })()');
  ck('What the model saw counts the picture the request carried', rec && rec.tokens>=3888 && !rec.exact, rec && (rec.tokens+' tokens, exact '+rec.exact));
  ck('and nothing for a request that carried none', textOnly===0, textOnly);
}

console.log('\n=== 3. A PICTURE THE BROWSER CANNOT OPEN ===');
{
  // jsdom opens no picture at all, which is exactly the case
  let n=0;
  const dom=await boot(base(),w=>()=>{ n++; return Promise.resolve(stream([oa('ok')])); });const w=dom.window,d=w.document;
  const toasts=[]; const t=d.querySelector('#toast');
  new w.MutationObserver(()=>toasts.push(t.textContent)).observe(t,{childList:true,characterData:true,subtree:true});
  w.eval('newConvo(); current.messages.push({id:"u0",role:"user",content:"old",attachments:[{kind:"image",name:"old.jpg",mime:"image/jpeg",data:"QUJDRA=="}]},{id:"a0",role:"assistant",content:"ok"}); renderThread();');
  d.querySelector('#input').value='again'; ev(w,d.querySelector('#input'),'input');
  d.querySelector('#sendBtn').click(); await sleep(400);
  const a=w.eval('current.messages[0].attachments[0]');
  ck('it is tried once, then kept as it was and marked', a.raw===1 && a.data==='QUJDRA==' && !a.w, JSON.stringify({raw:a.raw,w:a.w,data:a.data}));
  const stored=(await w.eval('DB.all()')).find(c=>c.id===w.eval('current.id'));
  ck('the mark is saved with the chat', stored && stored.messages[0].attachments[0].raw===1);
  ck('it still goes to an OpenAI-compatible service, as before', n===1 && JSON.stringify(w.eval('buildPayload({},current)').body).includes('data:image/jpeg;base64,QUJDRA=='));
  const before=toasts.filter(x=>/older picture/.test(x)).length;
  d.querySelector('#input').value='and again'; ev(w,d.querySelector('#input'),'input');
  d.querySelector('#sendBtn').click(); await sleep(400);
  ck('and it is not tried again on the next message', before===1 && toasts.filter(x=>/older picture/.test(x)).length===1, JSON.stringify(toasts));
}

console.log('\n=== 4. A STORED RECORD CANNOT PUT HTML INTO THE THREAD ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document;
  w.eval(`newConvo(); current.messages.push({id:"u0",role:"user",content:"x",attachments:[
    {kind:"image",name:"a.png",mime:'image/png" onerror="window.__pwned=1',data:'QUJD'},
    {kind:"image",name:"b.png",mime:"image/png",data:'"><img src=x onerror="window.__pwned=2">'},
    {kind:"image",name:"c.png",mime:"image/png",data:'QUJD',thumb:'data:image/webp;base64,x" onerror="window.__pwned=3'},
    {kind:"image",name:"<b>d</b>",mime:"image/png",data:'QUJD'}]}); renderThread();`);
  await sleep(200);
  const box=d.querySelector('.msg.user .msg-atts');
  const imgs=box.querySelectorAll('img');
  ck('no attribute of a picture comes from the record unchecked', !Array.from(box.querySelectorAll('*')).some(e=>e.hasAttribute('onerror')), box.innerHTML.slice(0,300));
  ck('no script ran', !w.__pwned, String(w.__pwned));
  ck('bytes that are not a picture are shown by name, not drawn', imgs.length===3 && /b\.png/.test(box.textContent), imgs.length+' drawn; '+box.textContent);
  ck('a hostile name stays text', !box.querySelector('b') && /<b>d<\/b>/.test(Array.from(imgs).map(i=>i.alt).join('|')), Array.from(imgs).map(i=>i.alt).join('|'));
}

console.log('\n=== 5. AN EMPTIED MESSAGE IS NOT SENT ===');
{
  let n=0;
  const dom=await boot(base(),w=>()=>{ n++; return Promise.resolve(stream([oa('ok')])); });const w=dom.window,d=w.document;
  const toasts=[]; const t=d.querySelector('#toast');
  new w.MutationObserver(()=>toasts.push(t.textContent)).observe(t,{childList:true,characterData:true,subtree:true});
  w.eval('newConvo(); current.messages.push({id:"u0",role:"user",content:"hello"},{id:"a0",role:"assistant",content:"hi"}); renderThread();');
  w.eval('startEdit("u0")');
  d.querySelector('.msg-edit').value='   ';
  d.querySelector('[data-savedit]').click(); await sleep(300);
  ck('Save & resend with nothing in it sends nothing', n===0 && w.eval('current.messages.length')===2 && w.eval('current.messages[0].content')==='hello',
     n+' requests; '+JSON.stringify(w.eval('current.messages.map(m=>m.content)')));
  ck('and says why', toasts.some(x=>/needs words or something attached/.test(x)), JSON.stringify(toasts));
  ck('the editor stays open', !!d.querySelector('.msg-edit'));
  // a picture message can be emptied of words: the picture is the message
  w.eval('(a)=>{ current.messages=[{id:"u1",role:"user",content:"look",attachments:[a]},{id:"a1",role:"assistant",content:"a cat"}]; renderThread(); startEdit("u1"); }')(pic('cat.jpg',1200));
  d.querySelector('.msg-edit').value='';
  d.querySelector('[data-savedit]').click(); await sleep(400);
  ck('a picture with its words removed is still sent', n===1 && w.eval('current.messages[0].content')==='', n+' requests');
}

console.log('\n=== 6. HERMES SAYS WHY IT ASKS ===');
{
  const frame='{"event":"approval.request","run_id":"R1","command":"rm -rf build","description":"recursive delete","choices":["once","deny"]}';
  for (const transport of ['plain','runs']){
    let release=null;
    const dom=await boot(base({activeProvider:'h'}),w=>(url)=>{
      url=String(url);
      if(/\/approval$/.test(url)){ if(release) release(); return Promise.resolve({ok:true,status:200,json:async()=>({})}); }
      if(transport==='plain' && /\/runs$/.test(url)) return Promise.resolve({ok:false,status:404,json:async()=>({}),text:async()=>''});
      if(/\/runs$/.test(url)) return Promise.resolve({ok:true,status:200,json:async()=>({run_id:'R1'})});
      let step=0;
      return Promise.resolve({ok:true,status:200,body:{getReader(){return{read(){
        step++;
        if(step===1) return Promise.resolve({done:false,value:enc('event: approval.request\ndata: '+frame+'\n\n')});
        if(step===2) return new Promise(r=>{ release=()=>r({done:false,value:enc(transport==='runs'
          ? 'data: {"event":"run.completed"}\n\n' : oa('Done.')+'data: [DONE]\n\n')}); });
        return Promise.resolve({done:true});
      }};}}});
    });
    const w=dom.window,d=w.document;
    w.eval('newConvo()');
    d.querySelector('#input').value='clean up'; ev(w,d.querySelector('#input'),'input');
    d.querySelector('#sendBtn').click(); await sleep(400);
    const card=d.querySelector('.msg.assistant .appr');
    ck(transport+': the card says why Hermes asks', !!card && /recursive delete/.test(card.querySelector('.appr-why')?.textContent||''), card && card.textContent);
    ck(transport+': and offers only what Hermes offers', !!card && card.querySelectorAll('[data-approve]').length===2);
    const b=d.querySelector('[data-approve$="|once"]'); if(b){ b.click(); await sleep(300); }
    ck(transport+': the reason is kept with the answer', w.eval('current.messages.slice(-1)[0].approvals[0].why')==='recursive delete');
  }
}

console.log('\n=== 7. A TEXT FILE KEEPS ITS OWN CODE BLOCKS ===');
{
  const dom=await boot(base());const w=dom.window;
  const body='# Setup\n\n```bash\nnpm install\n```\n\nThat is all.';
  w.eval('(t)=>{newConvo(); current.messages.push({id:"u0",role:"user",content:"read this",attachments:[{kind:"text",name:"README.md",text:t}]});}')(body);
  const sent=w.eval('buildPayload({},current)').body.messages.find(m=>m.role==='user').content;
  ck('the file is fenced with more backticks than it holds', sent.startsWith('````README.md\n'+body+'\n````'), JSON.stringify(sent.slice(0,60)));
  const lines=sent.split('\n'), close=lines.indexOf('````', 1);
  ck('so its own fence cannot end it early: the file ends where the file ends', close===lines.indexOf('That is all.')+1, close);
  w.eval('newConvo(); current.messages.push({id:"u0",role:"user",content:"q",attachments:[{kind:"text",name:"n.md",text:"plain"}]})');
  ck('a file with no backticks is fenced as it always was', w.eval('buildPayload({},current)').body.messages.find(m=>m.role==='user').content.startsWith('```n.md\nplain\n```'));
}

console.log('\n=== 8. A CHAT DELETED WHILE ITS MESSAGE IS BEING PREPARED ===');
{
  // the web search before a message, and making older pictures ready, both
  // wait on something; a chat deleted meanwhile must stay deleted
  let releaseSearch=null; const calls=[];
  const dom=await boot(base({search:{on:true,provider:'tavily',key:'K',count:5,relay:'',always:true,images:false,auto:false,model:false}}),w=>(url)=>{
    url=String(url); calls.push(url);
    if(/tavily/.test(url)) return new Promise(r=>{ releaseSearch=()=>r({ok:true,status:200,json:async()=>({results:[]})}); });
    return Promise.resolve(stream([oa('ok')]));
  });
  const w=dom.window,d=w.document;
  w.eval('newConvo(); current.title="doomed"; renderSidebar();');
  const id=w.eval('current.id');
  d.querySelector('#input').value='search this'; ev(w,d.querySelector('#input'),'input');
  d.querySelector('#sendBtn').click(); await sleep(200);
  ck('setup: the search is under way', !!releaseSearch);
  d.querySelector('[data-del="'+id+'"]').click(); await sleep(200);
  releaseSearch(); await sleep(400);
  const stored=(await w.eval('DB.all()')).some(c=>c.id===id);
  ck('the deleted chat is not saved back', !stored && !w.eval('convos.some(c=>c.id==="'+id+'")'), 'stored '+stored);
  ck('and its message is not sent to the model', !calls.some(u=>/chat\/completions/.test(u)), JSON.stringify(calls));
}
{
  // the same while an older picture is being made ready
  let releasePic=null; const calls=[];
  const dom=await boot(base(),w=>(url)=>{ calls.push(String(url)); return Promise.resolve(stream([oa('ok')])); });
  const w=dom.window,d=w.document;
  ck('setup: the picture step can be held', typeof w.prepareImage==='function');
  w.prepareImage=()=>new Promise(r=>{ releasePic=()=>r({mime:'image/jpeg',data:'QUJD',w:10,h:10,thumb:''}); });
  w.eval('newConvo(); current.title="doomed too"; current.messages.push({id:"u0",role:"user",content:"old",attachments:[{kind:"image",name:"old.jpg",mime:"image/jpeg",data:"/9j/AAAA"}]},{id:"a0",role:"assistant",content:"seen"}); renderSidebar(); renderThread();');
  const id=w.eval('current.id');
  await w.eval('persistConvo(current)');
  d.querySelector('#input').value='and now?'; ev(w,d.querySelector('#input'),'input');
  d.querySelector('#sendBtn').click(); await sleep(200);
  ck('setup: the older picture is being made ready', !!releasePic);
  d.querySelector('[data-del="'+id+'"]').click(); await sleep(200);
  releasePic(); await sleep(400);
  const stored=(await w.eval('DB.all()')).some(c=>c.id===id);
  ck('the deleted chat is not saved back', !stored && !w.eval('convos.some(c=>c.id==="'+id+'")'), 'stored '+stored);
  ck('and its message is not sent to the model', !calls.some(u=>/chat\/completions/.test(u)), JSON.stringify(calls));
  ck('and the app is not left sending', !w.eval('streaming') && !d.querySelector('#sendBtn').classList.contains('stop'), d.querySelector('#sendBtn').className);
}

console.log('\n=== 9. GETTING A MESSAGE READY IS PART OF SENDING ===');
{
  // the web search before a message: Send is Stop meanwhile, and Stop ends it
  let searchSignal=null; const calls=[];
  const dom=await boot(base({search:{on:true,provider:'tavily',key:'K',count:5,relay:'',always:true,images:false,auto:false,model:false}}),w=>(url,opts)=>{
    url=String(url); calls.push(url);
    if(/tavily/.test(url)) return new Promise((res,rej)=>{ searchSignal=(opts&&opts.signal)||null;
      if(searchSignal) searchSignal.addEventListener('abort',()=>rej(new w.DOMException('The user aborted a request.','AbortError'))); });
    return Promise.resolve(stream([oa('ok')]));
  });
  const w=dom.window,d=w.document,btn=d.querySelector('#sendBtn');
  const toasts=[]; const t=d.querySelector('#toast');
  new w.MutationObserver(()=>toasts.push(t.textContent)).observe(t,{childList:true,characterData:true,subtree:true});
  w.eval('newConvo(); renderSidebar();');
  const id=w.eval('current.id');
  d.querySelector('#input').value='search this'; ev(w,d.querySelector('#input'),'input');
  btn.click(); await sleep(200);
  ck('while the search runs, Send is Stop', btn.classList.contains('stop') && !btn.disabled && btn.getAttribute('aria-label')==='Stop', btn.className);
  ck('and an update waiting for a quiet moment does not take this one', w.eval('quietNow()')===false);
  d.querySelector('#input').value='a second message'; ev(w,d.querySelector('#input'),'input');
  ck('typing does not turn it back into Send', btn.classList.contains('stop'));
  btn.click(); await sleep(300);
  ck('Stop ends it: nothing is sent to the model', !calls.some(u=>/chat\/completions/.test(u)), JSON.stringify(calls));
  ck('the search itself is called off', !!searchSignal && searchSignal.aborted);
  ck('Send is back', !btn.classList.contains('stop') && !w.eval('streaming') && btn.getAttribute('aria-label')==='Send');
  ck('"Searching the web" is gone', !d.querySelector('.searching'));
  ck('what was typed meanwhile is still in the box', d.querySelector('#input').value==='a second message');
  const stored=(await w.eval('DB.all()')).find(c=>c.id===id);
  ck('the stopped message stays in the chat, saved', !!stored && stored.messages.length===1 && stored.messages[0].content==='search this', stored && JSON.stringify(stored.messages.map(m=>m.role+':'+m.content)));
  ck('and stopping is not reported as an error', !toasts.some(x=>/abort/i.test(x)), JSON.stringify(toasts));
  // the next message goes as usual
  searchSignal=null;
  w.eval('S.search.always=false; syncSearchBtn();');
  btn.click(); await sleep(400);
  ck('the next Send goes as usual', calls.filter(u=>/chat\/completions/.test(u)).length===1 && w.eval('current.messages.slice(-1)[0].content')==='ok', JSON.stringify(calls));
}
{
  // a save that fails is said, and cuts nothing short: the message goes, the reply lands
  let n=0;
  const dom=await boot(base(),w=>()=>{ n++; return Promise.resolve(stream([oa('ok')])); });
  const w=dom.window,d=w.document,btn=d.querySelector('#sendBtn');
  const toasts=[]; const t=d.querySelector('#toast');
  new w.MutationObserver(()=>toasts.push(t.textContent)).observe(t,{childList:true,characterData:true,subtree:true});
  w.eval('newConvo(); renderSidebar(); window.__put=IDB.put; IDB.put=()=>Promise.reject(new Error("the browser storage is full"));');
  d.querySelector('#input').value='hello'; ev(w,d.querySelector('#input'),'input');
  btn.click(); await sleep(400);
  w.eval('IDB.put=window.__put;');
  ck('a save that fails is said', toasts.some(x=>/Couldn.t save this chat — the browser storage is full/.test(x)), JSON.stringify(toasts));
  ck('and the message still goes, and Send is not left on Stop', n===1 && w.eval('current.messages.slice(-1)[0].content')==='ok' && !btn.classList.contains('stop') && !w.eval('streaming'), n+' '+btn.className);
  ck('and the reply is drawn to its end (What the model saw is on it)', !!d.querySelector('.msg.assistant [data-sent]'), d.querySelector('.msg.assistant') && d.querySelector('.msg.assistant').innerHTML.slice(0,200));
  // a message saying something was done does not cover a save that failed
  toasts.length=0;
  w.eval('IDB.put=()=>Promise.reject(new Error("the browser storage is full"));');
  d.querySelector('.msg.assistant [data-branch]').click(); await sleep(300);
  w.eval('IDB.put=window.__put;');
  ck('Branch with a failed save says the save failed, not "Branched"', toasts.length>0 && /Couldn.t save this chat/.test(toasts[toasts.length-1]) && !toasts.some(x=>/Branched/.test(x)), JSON.stringify(toasts));
  toasts.length=0;
  d.querySelector('.msg.assistant [data-branch]').click(); await sleep(300);
  ck('and with the save working it says "Branched" as before', toasts.some(x=>/Branched into a new chat/.test(x)), JSON.stringify(toasts));
}
{
  // Swipe on a reply still coming in leaves it coming in
  let release=null; const calls=[];
  const dom=await boot(base(),w=>(url)=>{
    calls.push(String(url));
    let i=0; const chunks=[oa('Hello '),oa('there')];
    return Promise.resolve({ok:true,status:200,body:{getReader(){return{read(){
      if(i===0) return Promise.resolve({done:false,value:enc(chunks[i++])});
      if(i===1) return new Promise(r=>{ release=()=>r({done:false,value:enc(chunks[i++])}); });
      return Promise.resolve({done:true});}};}}});
  });
  const w=dom.window,d=w.document;
  w.eval('newConvo(); renderSidebar();');
  d.querySelector('#input').value='hi'; ev(w,d.querySelector('#input'),'input');
  d.querySelector('#sendBtn').click(); await sleep(300);
  const sw=d.querySelector('.msg.assistant [data-regen]');
  ck('setup: a reply is coming in, with its Swipe button', !!sw && !!release && w.eval('current.messages.slice(-1)[0].pending===true'));
  sw.click(); await sleep(200);
  ck('Swipe on it starts nothing', calls.length===1, calls.length);
  ck('and does not cut it off', !!w.eval('streaming') && !w.eval('streaming.signal.aborted'));
  release(); await sleep(400);
  ck('it comes in whole', w.eval('current.messages.slice(-1)[0].content')==='Hello there' && !w.eval('current.messages.slice(-1)[0].pending'), JSON.stringify(w.eval('current.messages.slice(-1)[0].content')));
  // and on the finished reply, Swipe makes a new version as before
  d.querySelector('.msg.assistant [data-regen]').click(); await sleep(200);
  ck('Swipe on a finished reply asks for a new version', calls.length===2, calls.length);
  release && release(); await sleep(400);
  ck('which comes in beside the first', w.eval('current.messages.slice(-1)[0].variants.length')>=1, w.eval('JSON.stringify(current.messages.slice(-1)[0].variants.map(v=>v.content))'));
}

console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})();
