// TEST FILE — run with: node tests/v5291uitest.js
// The interface, through what a user does (typing, tapping, a reply
// arriving, Settings), never through the source text:
//   1. an open Edit box, and what was typed in it, survives a redraw
//   2. one key press sends at most once, and the keyboard never stops a reply
//   3. a picture from another address waits for a tap before it is fetched
//   4. a connection picked, saved or deleted in Settings redraws what depends
//      on it - the thinking levels and the prefill verdict - as Quick switch does
//   5. the magnifier is not offered where its search cannot run, and says why
//   6. Settings says "belongs to this chat" only with the settings that do
//   7. the full-screen editor's X keeps what was typed; "This chat only" waits
//      for a chat to be open; closing Settings keeps a connection being typed
//   8. a model list loaded for a connection is kept when the connection is saved;
//      "Add a connection" starts without the key of the one looked at before
//   9. Copy (a message, a code block, the thinking) says when the clipboard
//      refused, and falls back as "What the model saw" does
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{ok=!!ok;console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const nodeErrs=[];
// every page error is recorded; one left over at the end fails the run
process.on('unhandledRejection',e=>nodeErrs.push('unhandledRejection: '+((e&&e.message)||e)));
// a page error thrown from a frame callback (requestAnimationFrame runs on a Node timer here) lands here
process.on('uncaughtException',e=>nodeErrs.push('uncaught: '+((e&&e.message)||e)));
const base=(o)=>Object.assign({
  providers:[{id:'o',preset:'custom',kind:'openai',name:'O',url:'https://o.test/v1',apiKey:'k',model:'m',ctx:200000}],
  activeProvider:'o',presets:[{id:'d',name:'D',system:'',injections:[],order:['__main__','__chat__']}],activePreset:'d',prompts:[],
  maxTokens:1024,effort:'off',showThinking:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}},o||{});
function boot(st,f,opts){opts=opts||{};return new Promise(res=>{
  const errors=[];
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',beforeParse(w){
    w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;w.navigator.storage={estimate:async()=>({usage:0})};
    w.requestAnimationFrame=cb=>setTimeout(cb,0);w.confirm=()=>true;
    if (!opts.noClipboard) w.navigator.clipboard={writeText:async(t)=>{w.__clip=t;}};
    w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
    w.addEventListener('error',e=>errors.push('error: '+e.message));
    w.addEventListener('unhandledrejection',e=>errors.push('unhandledrejection: '+((e.reason&&e.reason.message)||e.reason)));
    if(f)w.fetch=f(w);
    if(opts.before)opts.before(w);
  }});
  dom.virtualConsole.on('jsdomError',e=>errors.push('jsdomError: '+((e&&e.message)||e)));
  dom.errors=errors;
  setTimeout(async()=>{try{
    await dom.window.eval('Promise.all([DB.clear(),DB.docClear()])');
    dom.window.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();');
  }catch(_){}res(dom);},800);});}
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
const gone=dom=>dom.window.document.createElement('div');   // what a missing element stands in for, so a failure is reported, not thrown

(async()=>{

console.log('=== 1. AN OPEN EDIT BOX SURVIVES A REDRAW ===');
{
  const bodies=[];let calls=0;
  const dom=await boot(base(),w=>(url,init)=>{calls++;bodies.push(JSON.parse(init.body));return Promise.resolve(slow(['Sure, ','here ','it ','is.'].map(oa),init&&init.signal));});
  const w=dom.window,d=w.document,none=gone(dom);
  w.eval('newConvo(); current.messages.push({id:"u0",role:"user",content:"first question"},{id:"a0",role:"assistant",content:"first answer"}); renderThread(); persist();');
  d.querySelector('#input').value='second question'; ev(w,d.querySelector('#input'),'input');
  d.querySelector('#sendBtn').click(); await sleep(250);
  // the reader opens Edit on their first message while the reply arrives, and types
  tap(d.querySelector('[data-edit="u0"]'));
  let ta=d.querySelector('#threadInner .msg-edit')||none;
  ta.value='first question, reworded carefully'; ev(w,ta,'input');
  if (ta.setSelectionRange) ta.setSelectionRange(6,14);
  ck('setup: the edit box is open while the reply arrives', ta!==none && d.activeElement===ta);
  await sleep(900);
  ta=d.querySelector('#threadInner .msg-edit')||none;
  ck('when the reply has arrived, the edit box is still open', ta!==none, d.querySelector('#threadInner [data-mid="u0"] .msg-body').innerHTML.slice(0,60));
  ck('holding what was typed', ta.value==='first question, reworded carefully', JSON.stringify(ta.value));
  ck('with the caret and selection where they were', ta.selectionStart===6 && ta.selectionEnd===14, ta.selectionStart+'-'+ta.selectionEnd);
  ck('and still in focus, so the typing carries on', d.activeElement===ta);
  // a redraw for another reason: a setting that redraws the thread
  d.querySelector('#input').focus();
  tap(d.querySelector('#tgTools')); await sleep(50);
  ta=d.querySelector('#threadInner .msg-edit')||none;
  ck('another redraw (a setting changed) keeps it too', ta!==none && ta.value==='first question, reworded carefully', JSON.stringify(ta.value));
  ck('without taking the focus from where the reader had moved it', d.activeElement===d.querySelector('#input'), d.activeElement && d.activeElement.id);
  // Save & resend sends what was typed
  tap(d.querySelector('[data-savedit]')); await sleep(900);
  const last=bodies[bodies.length-1], sentText=JSON.stringify(last.messages);
  ck('Save & resend sends what was typed', calls===2 && sentText.includes('first question, reworded carefully') && w.eval('current.messages[0].content')==='first question, reworded carefully',
     calls+' requests');
  ck('and the edit box is gone', !d.querySelector('#threadInner .msg-edit'));
  // Cancel drops it, and a later redraw does not bring it back
  tap(d.querySelector('[data-edit="u0"]'));
  ta=d.querySelector('#threadInner .msg-edit')||none; ta.value='thrown away'; ev(w,ta,'input');
  tap(d.querySelector('[data-canceledit]')); await sleep(20);
  w.eval('renderThread()');
  ck('Cancel closes it, and a redraw does not bring it back', !d.querySelector('#threadInner .msg-edit') && w.eval('current.messages[0].content')==='first question, reworded carefully');
  ck('no error', dom.errors.length===0, JSON.stringify(dom.errors));
}

console.log('\n=== 2. ONE KEY PRESS SENDS AT MOST ONCE, AND NEVER STOPS A REPLY ===');
async function keys(enterSends){
  const log=[];let calls=0;
  const dom=await boot(base({enterSends}),w=>(url,init)=>{const n=++calls;log.push('request #'+n);return Promise.resolve(slow(['One ','two ','three ','four.'].map(oa),init&&init.signal,log,'request #'+n));});
  const w=dom.window,d=w.document,inp=d.querySelector('#input');
  w.eval('newConvo()');
  const press=(k)=>{ const e=new w.KeyboardEvent('keydown',Object.assign({key:'Enter',bubbles:true,cancelable:true},k||{})); inp.dispatchEvent(e); return e; };
  const type=t=>{ inp.value=t; ev(w,inp,'input'); };
  return {dom,w,d,inp,log,press,type,calls:()=>calls,msgs:()=>w.eval('current.messages.map(m=>m.role+":"+m.content)')};
}
for (const [label, mod] of [['Ctrl+Enter',{ctrlKey:true}],['Cmd+Enter',{metaKey:true}]]){
  const k=await keys(true);
  k.type('hello there'); k.press(mod); await sleep(900);
  ck('"Enter sends" on: '+label+' sends the message once and its reply arrives whole', k.calls()===1 && JSON.stringify(k.msgs())===JSON.stringify(['user:hello there','assistant:One two three four.']),
     k.calls()+' requests, '+JSON.stringify(k.msgs())+' '+JSON.stringify(k.log));
}
{
  const k=await keys(true);
  k.type('hello'); const e=k.press(); await sleep(900);
  ck('"Enter sends" on: Enter sends once', e.defaultPrevented && k.calls()===1 && k.msgs().length===2, k.calls());
  k.type('a new line please'); const sh=k.press({shiftKey:true}); await sleep(50);
  ck('"Enter sends" on: Shift+Enter is a new line, nothing sent', !sh.defaultPrevented && k.calls()===1);
  const ime=k.press({isComposing:true}); await sleep(50);
  ck('an Enter that ends a word being composed sends nothing', !ime.defaultPrevented && k.calls()===1);
}
{
  const k=await keys(false);
  k.type('two lines'); const e=k.press(); await sleep(50);
  ck('"Enter sends" off: Enter is a new line, nothing sent', !e.defaultPrevented && k.calls()===0);
  const c=k.press({ctrlKey:true}); await sleep(900);
  ck('"Enter sends" off: Ctrl+Enter sends once', c.defaultPrevented && k.calls()===1 && k.msgs().length===2, k.calls());
}
for (const [label, mod] of [['Enter',{}],['Ctrl+Enter',{ctrlKey:true}]]){
  const k=await keys(true);
  k.type('tell me'); k.press(); await sleep(350);
  ck('setup ('+label+'): a reply is arriving and Send is Stop', k.w.eval('!!streaming') && k.d.querySelector('#sendBtn').getAttribute('aria-label')==='Stop');
  k.type('and next, this'); const e=k.press(mod); await sleep(800);
  ck(label+' while a reply arrives leaves the reply arriving, whole', !k.log.some(x=>/aborted/.test(x)) && k.w.eval('current.messages[1].content')==='One two three four.', JSON.stringify(k.log));
  ck(label+' while a reply arrives keeps the words in the box and sends nothing', k.inp.value==='and next, this' && k.calls()===1 && k.msgs().length===2 && e.defaultPrevented, JSON.stringify(k.inp.value));
  if (label==='Enter'){
    k.press(); await sleep(900);
    ck('once the reply is in, Enter sends those words', k.calls()===2 && k.msgs()[2]==='user:and next, this' && k.inp.value==='', JSON.stringify(k.msgs()));
  }
}
{
  // Stop stays the button's job
  const k=await keys(true);
  k.type('tell me'); k.press(); await sleep(350);
  k.d.querySelector('#sendBtn').click(); await sleep(300);
  ck('the Stop button still stops a reply', k.log.some(x=>/aborted/.test(x)) && k.d.querySelector('#sendBtn').getAttribute('aria-label')==='Send', JSON.stringify(k.log));
}

console.log('\n=== 3. A PICTURE FROM ANOTHER ADDRESS WAITS FOR A TAP ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document,none=gone(dom);
  const show=(md,extra)=>{ w.eval('(t,x)=>{ current={id:"q",title:"Q",cfg:defaultCfg(),messages:[{id:"u",role:"user",content:"?"},Object.assign({id:"a",role:"assistant",content:t},x||{})]}; renderThread(); }')(md,extra||null);
                           return d.querySelector('#threadInner .msg.assistant')||none; };
  let m=show('Here is the chart:\n\n![sales chart](https://pics.test/chart.png?q=the-users-words)\n\nDone.');
  const remote=()=>[...m.querySelectorAll('img')].filter(i=>/^https?:/.test(i.getAttribute('src')||''));
  const ph=m.querySelector('.md-img-ph')||none;
  ck('a picture from another address is not put on the page as a picture', remote().length===0, JSON.stringify(remote().map(i=>i.src)));
  ck('a button names the address it would come from, and offers to show it', ph!==none && /pics\.test/.test(ph.textContent) && /tap to show/i.test(ph.textContent), JSON.stringify(ph.textContent));
  const click=new w.MouseEvent('click',{bubbles:true,cancelable:true}); ph.dispatchEvent(click);
  m=d.querySelector('#threadInner .msg.assistant')||none;
  const img=m.querySelector('img[src="https://pics.test/chart.png?q=the-users-words"]');
  ck('tapping it shows the picture, opening itself as before', !!img && img.getAttribute('alt')==='sales chart' && !!img.closest('a') && img.closest('a').getAttribute('href')==='https://pics.test/chart.png?q=the-users-words', m.innerHTML.slice(0,200));
  w.eval('renderThread()'); m=d.querySelector('#threadInner .msg.assistant')||none;
  ck('once shown, it stays shown when the chat is drawn again', !!m.querySelector('img[src="https://pics.test/chart.png?q=the-users-words"]') && !m.querySelector('.md-img-ph'));
  // a linked picture: the tap shows it and does not follow the link
  m=show('[![badge](https://img.test/b.png)](https://site.test/)');
  const lph=m.querySelector('a[href="https://site.test/"] .md-img-ph')||none;
  ck('a linked picture from another address waits inside its link', lph!==none && remote().length===0, m.innerHTML.slice(0,160));
  const lclick=new w.MouseEvent('click',{bubbles:true,cancelable:true}); lph.dispatchEvent(lclick);
  m=d.querySelector('#threadInner .msg.assistant')||none;
  const limg=m.querySelector('a[href="https://site.test/"] img[src="https://img.test/b.png"]');
  ck('tapping it shows it inside the link, and the link is not followed by that tap', !!limg && lclick.defaultPrevented && m.querySelectorAll('a a').length===0, m.innerHTML.slice(0,160));
  // the button names the host the browser would really ask, not the one written first
  m=show('![a](https://pics.test@elsewhere.test/a.png) ![b](https://pics.test\\@x/b.png)');
  const names=[...m.querySelectorAll('.md-img-ph')].map(b=>b.textContent);
  ck('the button names the host the picture would really come from', names.length===2 && /from elsewhere\.test /.test(names[0]) && /from pics\.test /.test(names[1]), JSON.stringify(names));
  // what shows at once, as before
  m=show('Here: ![image](data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==)');
  ck('a picture the agent sent inline (data:) shows at once', !!m.querySelector('img[src^="data:image/png;base64,"]') && !m.querySelector('.md-img-ph'));
  m=show('Look at these.',{images:[{url:'https://search-images.test/a.jpg',link:'https://search-images.test/page',title:'A'}]});
  ck('the pictures of the app\'s own web search show at once', !!m.querySelector('.img-strip img[src="https://search-images.test/a.jpg"]'));
  ck('no error', dom.errors.length===0, JSON.stringify(dom.errors));
}

console.log('\n=== 4. A CONNECTION PICKED, SAVED OR DELETED IN SETTINGS REDRAWS WHAT DEPENDS ON IT ===');
{
  // O speaks OpenAI's levels (off to max); G is a GLM model (off, low, high, max); Q a Qwen one (off to high)
  const st=base({providers:[{id:'o',preset:'custom',kind:'openai',name:'O',url:'https://o.test/v1',apiKey:'k',model:'m',ctx:200000},
                            {id:'g',preset:'custom',kind:'openai',name:'G',url:'https://g.test/v1',apiKey:'k',model:'glm-5',ctx:200000}],activeProvider:'o'});
  // every prefill test is refused, so each test leaves a verdict naming the connection it was about
  const dom=await boot(st,w=>(url)=>Promise.resolve({ok:false,status:400,headers:{get:()=>null},
    text:async()=>JSON.stringify({error:{message:'refused by '+url}}),json:async()=>({error:{message:'refused by '+url}})}));
  const w=dom.window,d=w.document,none=gone(dom);
  w.eval('newConvo(); current.messages.push({id:"u0",role:"user",content:"hi"},{id:"a0",role:"assistant",content:"hello"}); renderThread(); persist();');
  const levels=()=>[...d.querySelectorAll('#effortSeg [data-effort]')].map(b=>b.dataset.effort).join(',');
  const verdict=()=>(d.querySelector('#pfTestStat')||none).textContent;
  const test=async()=>{ tap(d.querySelector('#pfTestBtn')); await sleep(300); return verdict(); };
  tap(d.querySelector('#settingsBtn'));
  let v=await test();
  ck('setup: O offers its levels, and a prefill test leaves a verdict about O', levels()==='off,low,medium,high,xhigh,max' && /^O refused/.test(v), levels()+' | '+v);
  // 1) picked in the list
  tap(d.querySelector('#provList [data-prov="g"] .prov-name'));
  ck('picking G in Settings: the thinking levels are the ones G can say', levels()==='off,low,high,max', levels());
  ck('and the verdict about O is gone', verdict()==='', JSON.stringify(verdict()));
  // 2) saved: G becomes a Qwen model
  v=await test();
  tap(d.querySelector('#provList [data-editprov="g"]'));
  const pm=d.querySelector('#pModel')||none; pm.value='qwen3-max'; ev(w,pm,'input');
  tap(d.querySelector('#saveProvBtn'));
  ck('saving G as a Qwen model: the thinking levels are Qwen\'s', /^G refused/.test(v) && levels()==='off,low,medium,high', v+' | '+levels());
  ck('and the verdict about the GLM model is gone', verdict()==='', JSON.stringify(verdict()));
  // 3) deleted: the chat falls back to O
  v=await test();
  tap(d.querySelector('#provList [data-editprov="g"]'));
  tap(d.querySelector('#delProvBtn'));
  ck('deleting G: the chat is on O, and the levels are O\'s', /^G refused/.test(v) && w.eval('activeProv().id')==='o' && levels()==='off,low,medium,high,xhigh,max', v+' | '+w.eval('activeProv().id')+' | '+levels());
  ck('and the verdict about G is gone', verdict()==='', JSON.stringify(verdict()));
  // 4) Quick switch, as before: the same redraw
  w.eval('S.providers.push({id:"g",preset:"custom",kind:"openai",name:"G",url:"https://g.test/v1",apiKey:"k",model:"glm-5",ctx:200000}); saveSettings(); renderThread();');
  v=await test();
  const qs=d.querySelector('#quickSwitch')||none; qs.value='g'; ev(w,qs,'change');
  ck('Quick switch to G does the same', /^O refused/.test(v) && levels()==='off,low,high,max' && verdict()==='', v+' | '+levels()+' | '+JSON.stringify(verdict()));
  ck('no error', dom.errors.length===0, JSON.stringify(dom.errors));
}

console.log('\n=== 5. THE MAGNIFIER IS NOT OFFERED WHERE ITS SEARCH CANNOT RUN ===');
{
  // the search built into Claude, and two chats: one on Claude, one on another service
  const st=base({providers:[{id:'c',preset:'anthropic',kind:'anthropic',name:'Claude',url:'https://api.anthropic.com/v1',apiKey:'k',model:'claude-opus-4-7',ctx:200000},
                            {id:'o',preset:'custom',kind:'openai',name:'GLM',url:'https://o.test/v1',apiKey:'k',model:'glm-5',ctx:200000}],activeProvider:'c',
                 search:{on:true,provider:'native',key:'',count:5,relay:'',always:false,images:true,auto:true,model:true}});
  const bodies=[];
  const dom=await boot(st,w=>(url,init)=>{bodies.push({url,body:JSON.parse(init.body)});return Promise.resolve(slow([oa('ok')],init&&init.signal));});
  const w=dom.window,d=w.document,none=gone(dom);
  w.eval('newConvo(); current.title="On Claude"; current.messages.push({id:"u0",role:"user",content:"hi"},{id:"a0",role:"assistant",content:"hello"}); persist();'
        +'newConvo(); current.title="On GLM"; current.cfg.providerId="o"; current.messages.push({id:"u1",role:"user",content:"hi"},{id:"a1",role:"assistant",content:"hello"}); persist(); renderSidebar(); renderThread();');
  const mag=()=>d.querySelector('#searchToggle')||none, toastTxt=()=>(d.querySelector('#toast')||none).textContent;
  const open=title=>{ const r=[...d.querySelectorAll('#convoList .convo')].find(x=>x.querySelector('.convo-title').textContent===title); tap(r&&r.querySelector('.convo-title')); };
  const unavailable=()=>mag().getAttribute('aria-disabled')==='true';
  open('On GLM');
  // (the chat's connection is named as everywhere else, by connLabel: "glm-5")
  ck('on a chat that is not on Claude, the magnifier shows it cannot search here', !mag().hidden && unavailable() && /Claude connection/.test(mag().title) && /glm-5/.test(mag().title), mag().getAttribute('aria-disabled')+' | '+mag().title);
  tap(mag());
  ck('tapping it says why, and does not promise a search', !mag().classList.contains('on') && mag().getAttribute('aria-pressed')==='false' && /only runs on a Claude connection/.test(toastTxt()) && !/Next message will search/.test(toastTxt()), JSON.stringify(toastTxt()));
  open('On Claude');
  ck('on the Claude chat it is offered', !unavailable() && mag().title==='Search the web for this message', mag().getAttribute('aria-disabled')+' | '+mag().title);
  tap(mag());
  ck('and tapping it readies a search, as before', mag().classList.contains('on') && /Next message will search the web/.test(toastTxt()), JSON.stringify(toastTxt()));
  // Quick switch this chat to GLM: the readied search cannot run there either
  const qs=d.querySelector('#quickSwitch')||none; qs.value='o'; ev(w,qs,'change');
  ck('moving the chat to GLM with Quick switch: not offered, and not lit', unavailable() && !mag().classList.contains('on'), mag().className+' | '+mag().getAttribute('aria-disabled'));
  // "Search every message" lights the magnifier only where it searches
  tap(d.querySelector('#settingsBtn')); tap(d.querySelector('.tab[data-tab="search"]'));
  tap(d.querySelector('#tgAlwaysSearch'));
  ck('with "Search every message" on, it is still not lit where it cannot search', unavailable() && !mag().classList.contains('on'), mag().className);
  // a search service of your own works on any connection: offered at once
  const sp=d.querySelector('#sProvider')||none; sp.value='tavily'; ev(w,sp,'change');
  ck('picking a search service of your own offers it on the GLM chat at once', !unavailable() && mag().classList.contains('on'), mag().className+' | '+mag().getAttribute('aria-disabled'));
  ck('no error', dom.errors.length===0, JSON.stringify(dom.errors));
}

console.log('\n=== 6. "BELONGS TO THIS CHAT" ONLY WITH THE SETTINGS THAT DO ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document,none=gone(dom);
  w.eval('newConvo(); current.title="Bleach"; renderThread();');
  tap(d.querySelector('#settingsBtn'));
  const note=d.querySelector('#scopeNote')||none;
  const shown=el=>{ for (let x=el; x && x.nodeType===1; x=x.parentNode) if (x.hidden) return false; return !!(el && el.isConnected); };
  const tab=t=>tap(d.querySelector('.tab[data-tab="'+t+'"]'));
  const panel=t=>d.querySelector('[data-panel="'+t+'"]')||none;
  const said=()=>note.textContent.replace(/\s+/g,' ').trim();
  tab('conn');
  ck('Connection: the note names the chat the picked connection belongs to', shown(note) && /The connection picked here belongs to Bleach\./.test(said()) && shown(d.querySelector('#useEverywhereBtn')), JSON.stringify(said()));
  tab('search');
  ck('Search: no note - search is the same in every chat', !shown(note), shown(note));
  tab('app');
  ck('App: no note either', !shown(note), shown(note));
  tab('inst');
  ck('Instructions: the note is about the set picked here', shown(note) && /The instruction set picked here belongs to Bleach\./.test(said()), JSON.stringify(said()));
  tab('chat');
  const before=(a,b)=>!!(a&&b) && !!(a.compareDocumentPosition(b) & w.Node.DOCUMENT_POSITION_FOLLOWING);
  const head=[...panel('chat').querySelectorAll('.lbl')].find(l=>l.textContent.trim()==='Every chat')||null;
  const perChat=['#tgSquash','#effortSeg','#chatProj','#chatSys','#temp','#maxTok','#tgPrefill','#pfTestBtn'].map(q=>d.querySelector(q));
  const global=['#tgThink','#tgTools','#tgThinkTags','#thinkTags','#tgEnter','#tgTitle'].map(q=>d.querySelector(q));
  ck('Chat: the note heads this chat\'s own settings, and scrolls away with them', shown(note) && /These settings belong to Bleach\./.test(said()) && note.parentNode===panel('chat') && perChat.every(x=>before(note,x)), JSON.stringify(said())+' in '+(note.parentNode&&note.parentNode.className));
  ck('the switches that are the same in every chat sit after them, under "Every chat"', !!head && perChat.every(x=>before(x,head)) && global.every(x=>before(head,x)),
     head ? JSON.stringify(global.filter(x=>!before(head,x)).map(x=>x&&x.id)) : 'no "Every chat" heading');
  // the per-chat controls still write to the chat, the global ones to every chat
  const t=d.querySelector('#temp')||none; t.value='0.42'; ev(w,t,'change'); tap(d.querySelector('#tgEnter'));
  ck('and they still do what they did: temperature to the chat, Enter sends to every chat', w.eval('current.cfg.temperature')===0.42 && w.eval('S.enterSends')===true, w.eval('current.cfg.temperature')+' '+w.eval('S.enterSends'));
  // with no chat open there is nothing to belong to
  tap(d.querySelector('#closeSettings')); w.eval('current=null; renderThread();'); tap(d.querySelector('#settingsBtn'));
  const any=['conn','chat','inst','search','app'].some(x=>{ tab(x); return shown(note); });
  ck('with no chat open, no tab shows the note', !any);
  ck('no error', dom.errors.length===0, JSON.stringify(dom.errors));
}

console.log('\n=== 7. THE FULL-SCREEN EDITOR\'S X KEEPS WHAT WAS TYPED ===');
{
  const st=base({presets:[{id:'d',name:'D',system:'Be kind.',injections:[{id:'blk',name:'Style',text:'Short lines.',enabled:true,pos:'relative',role:'system',depth:0}],order:['__main__','blk','__chat__']}]});
  const dom=await boot(st);const w=dom.window,d=w.document,none=gone(dom);
  const big=()=>d.querySelector('#bigModal').classList.contains('show'), area=()=>d.querySelector('#bigArea')||none, toastTxt=()=>(d.querySelector('#toast')||none).textContent;
  const type=t=>{ const a=area(); a.value=t; ev(w,a,'input'); };
  tap(d.querySelector('#settingsBtn'));
  // no chat open: "This chat only" has nowhere to go
  tap(d.querySelector('.tab[data-tab="chat"]'));
  const cs=d.querySelector('#chatSys')||none;
  tap(cs);
  ck('with no chat open, "This chat only" cannot be edited, as Project cannot', cs.disabled && d.querySelector('#chatProj').disabled && !big(), 'disabled '+cs.disabled+', editor open '+big());
  if (big()) tap(d.querySelector('#bigCancel'));
  // the main system prompt: typed, then X
  tap(d.querySelector('.tab[data-tab="inst"]'));
  tap(d.querySelector('#sysPrompt'));
  type('Be kind. Be brief.');
  tap(d.querySelector('#bigClose'));
  ck('X keeps what was typed in the main system prompt', !big() && w.eval('PS().system')==='Be kind. Be brief.' && d.querySelector('#sysPrompt').value==='Be kind. Be brief.', JSON.stringify(w.eval('PS().system')));
  ck('and says so', /Saved/.test(toastTxt()), JSON.stringify(toastTxt()));
  // Cancel is the way to drop it
  let was=w.eval('PS().system');
  tap(d.querySelector('#sysPrompt')); type('something else'); tap(d.querySelector('#bigCancel'));
  ck('Cancel still drops it', !big() && w.eval('PS().system')===was, JSON.stringify(w.eval('PS().system')));
  // nothing typed: X just closes
  w.eval('toast("-")');
  was=w.eval('PS().system');
  tap(d.querySelector('#sysPrompt')); tap(d.querySelector('#bigClose'));
  ck('with nothing typed, X just closes - nothing is saved, nothing said', !big() && w.eval('PS().system')===was && toastTxt()==='-', JSON.stringify(toastTxt()));
  // an instruction block
  tap(d.querySelector('#injList .ord-main[data-edit="blk"]'));
  tap(d.querySelector('#injList textarea[data-injtext="blk"]'));
  type('Short lines. No lists.');
  tap(d.querySelector('#bigClose'));
  ck('X keeps what was typed in an instruction', !big() && w.eval('injById("blk").text')==='Short lines. No lists.', JSON.stringify(w.eval('(injById("blk")||{}).text')));
  // a chat open: "This chat only" works, and X keeps it
  tap(d.querySelector('#closeSettings'));
  w.eval('newConvo(); renderThread();'); await sleep(50);
  tap(d.querySelector('#settingsBtn')); tap(d.querySelector('.tab[data-tab="chat"]'));
  tap(cs);
  ck('with a chat open, "This chat only" opens', !cs.disabled && big(), 'disabled '+cs.disabled+', editor open '+big());
  type('Call me Ada.');
  tap(d.querySelector('#bigClose')); await sleep(50);
  ck('and X keeps what was typed there, for this chat', !big() && w.eval('current.sysExtra')==='Call me Ada.', JSON.stringify(w.eval('current.sysExtra')));
  // the same X on Settings, while a connection is being typed in
  tap(d.querySelector('.tab[data-tab="conn"]'));
  tap(d.querySelector('#addProvBtn'));
  const field=(q,v)=>{ const e=d.querySelector(q)||none; e.value=v; ev(w,e,'input'); ev(w,e,'change'); };
  field('#pName','Mine'); field('#pKey','sk-typed-key');
  tap(d.querySelector('#closeSettings'));
  ck('closing Settings while a connection is being typed says it is kept', /kept/i.test(toastTxt()), JSON.stringify(toastTxt()));
  tap(d.querySelector('#settingsBtn')); tap(d.querySelector('.tab[data-tab="conn"]'));
  ck('and opening Settings again shows it as typed, ready to save', !d.querySelector('#provEditor').hidden && d.querySelector('#pName').value==='Mine' && d.querySelector('#pKey').value==='sk-typed-key',
     'editor hidden '+d.querySelector('#provEditor').hidden+', name '+JSON.stringify(d.querySelector('#pName').value));
  // a hidden button cannot be tapped: only a Save on the screen counts
  const onScreen=el=>{ for (let x=el; x && x.nodeType===1; x=x.parentNode) if (x.hidden) return false; return !!el; };
  const sv=d.querySelector('#saveProvBtn'), svShown=onScreen(sv); if (svShown) tap(sv);
  ck('Save then saves it', w.eval('S.providers.some(p=>p.name==="Mine" && p.apiKey==="sk-typed-key")'), 'Save on screen: '+svShown);
  // looked at, not typed in: it closes with Settings, as before
  tap(d.querySelector('#provList [data-editprov="o"]'));
  tap(d.querySelector('#closeSettings')); tap(d.querySelector('#settingsBtn'));
  ck('a connection only looked at closes with Settings, as before', d.querySelector('#provEditor').hidden);
  ck('no error', dom.errors.length===0, JSON.stringify(dom.errors));
}

console.log('\n=== 8. A MODEL LIST LOADED FOR A CONNECTION IS KEPT WHEN IT IS SAVED ===');
{
  // each /models answer lists what that address offers
  const offers={'https://new.test/v1':['n-small','n-large'],'https://o.test/v1':['o-1','o-2','o-3']};
  const st=base({providers:[{id:'o',preset:'custom',kind:'openai',name:'O',url:'https://o.test/v1',apiKey:'k',model:'m',ctx:200000,models:['old-a','old-b']}]});
  const dom=await boot(st,w=>(url)=>{ const b=String(url).replace(/\/models$/,''); const ids=offers[b]||[];
    return Promise.resolve({ok:true,status:200,headers:{get:()=>null},json:async()=>({data:ids.map(id=>({id}))})}); });
  const w=dom.window,d=w.document,none=gone(dom);
  const field=(q,v)=>{ const e=d.querySelector(q)||none; e.value=v; ev(w,e,'input'); ev(w,e,'change'); };
  const picker=()=>[...d.querySelectorAll('#pModelSel option')].map(o=>o.value).filter(Boolean).join(',');
  const stored=id=>JSON.stringify(w.eval('(S.providers.find(p=>p.id==="'+id+'")||{}).models||null'));
  tap(d.querySelector('#settingsBtn')); tap(d.querySelector('.tab[data-tab="conn"]'));
  // a new connection: Load list, then Save
  tap(d.querySelector('#addProvBtn'));
  const ps=d.querySelector('#pPreset')||none; ps.value='custom'; ev(w,ps,'change');
  field('#pName','New'); field('#pUrl','https://new.test/v1'); field('#pKey','nk'); field('#pModel','n-small');
  tap(d.querySelector('#loadModelsBtn')); await sleep(80);
  ck('setup: Load list offers what the new address has', picker()==='n-large,n-small', picker());
  tap(d.querySelector('#saveProvBtn'));
  const nid=w.eval('(S.providers.find(p=>p.name==="New")||{}).id');
  tap(d.querySelector('#provList [data-editprov="'+nid+'"]'));
  ck('a new connection saved after Load list offers its models when edited again', picker()==='n-large,n-small', 'picker '+JSON.stringify(picker())+', stored '+stored(nid));
  tap(d.querySelector('#cancelProvBtn'));
  // an existing one: Load list, then Cancel - nothing of it is kept
  tap(d.querySelector('#provList [data-editprov="o"]'));
  tap(d.querySelector('#loadModelsBtn')); await sleep(80);
  tap(d.querySelector('#cancelProvBtn'));
  ck('Cancel drops a list loaded meanwhile, as it drops the rest', stored('o')==='["old-a","old-b"]', stored('o'));
  // Load list, then Save: kept
  tap(d.querySelector('#provList [data-editprov="o"]'));
  tap(d.querySelector('#loadModelsBtn')); await sleep(80);
  tap(d.querySelector('#saveProvBtn'));
  ck('Load list then Save keeps the new list', stored('o')==='["o-1","o-2","o-3"]', stored('o'));
  // Load list, then close Settings: the edit waits, list and all
  offers['https://o.test/v1']=['o-4'];
  tap(d.querySelector('#provList [data-editprov="o"]'));
  tap(d.querySelector('#loadModelsBtn')); await sleep(80);
  tap(d.querySelector('#closeSettings')); tap(d.querySelector('#settingsBtn')); tap(d.querySelector('.tab[data-tab="conn"]'));
  ck('Load list then closing Settings: the edit is still open with that list', !d.querySelector('#provEditor').hidden && picker()==='o-4', 'hidden '+d.querySelector('#provEditor').hidden+', picker '+picker());
  tap(d.querySelector('#cancelProvBtn'));
  // a connection with a relay, looked at; then a new one
  w.eval('S.providers[0].proxy="https://relay.test"; saveSettings();');
  tap(d.querySelector('#provList [data-editprov="o"]')); tap(d.querySelector('#cancelProvBtn'));
  tap(d.querySelector('#addProvBtn'));
  const kNew=(d.querySelector('#pKey')||none).value, rNew=(d.querySelector('#pProxy')||none).value;
  ck('"Add a connection" starts with no key and no relay - not those of the connection looked at before', kNew==='' && rNew==='', JSON.stringify({key:kNew, relay:rNew}));
  // and a key arriving from the phone for the connection being edited is not "typing":
  // the Device client's adoptSettings (it runs only against a phone, so here its two
  // lines are done by hand) puts the new key in the field and marks it as loaded
  tap(d.querySelector('#cancelProvBtn'));
  tap(d.querySelector('#provList [data-editprov="o"]'));
  const kf=d.querySelector('#pKey')||none; kf.value='k2'; kf.dataset.loaded=kf.value;
  const toastTxt=()=>(d.querySelector('#toast')||none).textContent;
  w.eval('toast("-")');
  tap(d.querySelector('#closeSettings'));
  ck('a key the phone changed while the connection was open is not taken for typing: it closes with Settings', d.querySelector('#provEditor').hidden && toastTxt()==='-', 'hidden '+d.querySelector('#provEditor').hidden+', '+JSON.stringify(toastTxt()));
  ck('no error', dom.errors.length===0, JSON.stringify(dom.errors));
}

console.log('\n=== 9. COPY SAYS WHEN THE CLIPBOARD REFUSED, AND FALLS BACK ===');
for (const [label, clip, execOk] of [
    ['no clipboard in this browser (a phone over plain http), the old way works', 'none', true],
    ['the clipboard refuses, and so does the old way', 'refuses', false],
    ['the clipboard works', 'works', true]]){
  const got=[];
  const dom=await boot(base(),null,{noClipboard:true,before:w=>{
    if (clip==='refuses') w.navigator.clipboard={writeText:()=>Promise.reject(new Error('Write permission denied.'))};
    if (clip==='works') w.navigator.clipboard={writeText:async t=>{got.push(t);}};
    // the old way: what is selected in the page is copied
    w.document.execCommand=cmd=>{ if (cmd!=='copy' || !execOk) return false; const ta=[...w.document.querySelectorAll('body > textarea')].pop(); got.push(ta?ta.value:'?'); return true; };
  }});
  const w=dom.window,d=w.document,none=gone(dom);
  w.eval('current={id:"q",title:"Q",cfg:defaultCfg(),messages:[{id:"u",role:"user",content:"hi"},{id:"a",role:"assistant",content:"Here:\\n\\n```js\\nlet x = 1;\\n```\\n\\nDone.",thinking:"first I think"}]}; renderThread();');
  const toastTxt=()=>(d.querySelector('#toast')||none).textContent;
  w.eval('toast("-")');
  tap(d.querySelector('#threadInner [data-copy="a"]')); await sleep(30);
  const msgSaid=toastTxt();
  const code=d.querySelector('#threadInner [data-copycode]')||none; tap(code); await sleep(30);
  const codeSaid=code.textContent;
  const th=d.querySelector('#threadInner [data-copythink]')||none; tap(th); await sleep(30);
  const thinkSaid=th.textContent;
  if (execOk){
    ck(label+': each Copy copies its text', JSON.stringify(got)===JSON.stringify(['Here:\n\n```js\nlet x = 1;\n```\n\nDone.','let x = 1;','first I think']), JSON.stringify(got));
    ck(label+': and says "Copied"', msgSaid==='Copied' && codeSaid==='Copied' && thinkSaid==='Copied', JSON.stringify([msgSaid,codeSaid,thinkSaid]));
  } else {
    ck(label+': each Copy says it could not copy', /Couldn.t copy/.test(msgSaid) && /Couldn.t copy/.test(codeSaid) && /Couldn.t copy/.test(thinkSaid), JSON.stringify([msgSaid,codeSaid,thinkSaid]));
  }
  await sleep(1500);
  ck(label+': the buttons read "Copy" again afterwards', code.textContent==='Copy' && th.textContent==='Copy', JSON.stringify([code.textContent, th.textContent]));
  ck(label+': no error', dom.errors.length===0 && nodeErrs.length===0, JSON.stringify(dom.errors.concat(nodeErrs.splice(0))));
}

ck('no page error went unnoticed', nodeErrs.length===0, JSON.stringify(nodeErrs));
console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})().catch(e=>{ console.log('CRASHED part-way: '+((e&&e.stack)||e)); process.exit(1); });
