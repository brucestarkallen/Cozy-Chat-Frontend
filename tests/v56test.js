// TEST FILE — run with: node tests/v56test.js
// Guards v5.6.0: with runs mode on, a Hermes send travels the Runs API — the
// conversation maps to input/history/instructions, deltas and tool events
// stream in, and when the agent asks permission a card appears IN THE CHAT.
// Tapping a choice posts it and the run resumes; stopping the stream stops
// the agent server-side; a failed run surfaces as an error; a turn carrying
// an image falls back to the plain stream; unresolved cards expire honestly.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=(o={})=>Object.assign({
  providers:[{id:'h1',preset:'hermes',kind:'openai',name:'Hermes Agent',url:'http://127.0.0.1:8642/v1',apiKey:'k',model:'hermes-agent',ctx:200000,hermesRuns:true}],
  activeProvider:'h1',presets:[{id:'d',name:'D',system:'BE KIND',injections:[],order:['__main__','__chat__']}],
  activePreset:'d',prompts:[],projects:[],temperature:1,maxTokens:4096,effort:'off',squashSystem:true,
  showThinking:true,showTools:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}},o);
const ev=(w,el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true}));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
/* A tiny Hermes runs server: POST /runs hands out an id, GET /events is a
   hand-stepped SSE, POST /approval and /stop are captured. */
function runsServer(w,events){
  const enc=t=>new TextEncoder().encode(t);
  let i=0; w.__step=null; w.__calls=[];
  const next=()=>new Promise(res=>{w.__step=()=>{w.__step=null;res();};});
  return (url,opts)=>{
    opts=opts||{};
    const rec={url:url,method:opts.method||'GET',headers:opts.headers||{},body:opts.body?JSON.parse(opts.body):null};
    w.__calls.push(rec);
    if (/\/runs$/.test(url)) return Promise.resolve({ok:true,json:async()=>({run_id:'run_9',status:'started'})});
    if (/\/approval$/.test(url)){ w.__approved=rec.body; return Promise.resolve({ok:true,json:async()=>({ok:true})}); }
    if (/\/stop$/.test(url)){ w.__stopped=true; return Promise.resolve({ok:true,json:async()=>({status:'stopping'})}); }
    if (/\/events$/.test(url)){
      const sig=opts.signal;
      return Promise.resolve({ok:true,body:{getReader(){return{read(){
        return new Promise((res,rej)=>{
          const bail=()=>rej(Object.assign(new Error('aborted'),{name:'AbortError'}));
          if(sig&&sig.aborted)return bail();
          if(sig)sig.addEventListener('abort',bail,{once:true});
          /* a real run holds its stream open while waiting on approval —
             an exhausted script parks until stepped again or aborted */
          if(i>=events.length){ next().then(()=>res({done:true})); return; }
          next().then(()=>{ if(sig&&sig.aborted)return; res({done:false,value:enc(events[i++])}); });
        });}};}}});
    }
    // plain-stream fallback path
    const sig=opts.signal;
    return Promise.resolve({ok:true,body:{getReader(){return{read(){
      return new Promise((res)=>{ if(w.__fellBack){ res({done:true}); return; } w.__fellBack=true;
        res({done:false,value:enc('data: '+JSON.stringify({choices:[{delta:{content:'plain path'}}]})+'\n\n')}); });
    }};}}});
  };
}
const re=o=>'data: '+JSON.stringify(o)+'\n\n';
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
async function drain(w,n){for(let k=0;k<n;k++){await sleep(60);w.__step&&w.__step();}await sleep(300);}

(async()=>{

console.log('=== 1. THE RUN CARRIES THE CONVERSATION, AND ASKS IN THE CHAT ===');
{
  const dom=await boot(base(),w=>runsServer(w,[
    re({event:'message.delta',run_id:'run_9',delta:'Checking. '}),
    re({event:'tool.started',run_id:'run_9',tool:'terminal',preview:'terminal: ls ~/work'}),
    re({event:'approval.request',run_id:'run_9',tool:'terminal',command:'rm -r ~/work/old',choices:['once','session','always','deny']}),
    re({event:'tool.completed',run_id:'run_9',tool:'terminal',duration:0.4,error:false}),
    re({event:'message.delta',run_id:'run_9',delta:'Cleared it.'}),
    re({event:'run.completed',run_id:'run_9'})
  ]));
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  w.eval('current.messages.push({id:uid(),role:"user",content:"earlier turn",ts:1},{id:uid(),role:"assistant",content:"earlier reply",ts:2})');
  d.querySelector('#input').value='clean my work folder'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await sleep(150);
  const create=w.__calls.find(c=>/\/runs$/.test(c.url));
  ck('the send became a run', !!create && create.method==='POST');
  ck('the new message is the input', create.body.input==='clean my work folder');
  ck('everything before it is the history', create.body.conversation_history.length===2 && create.body.conversation_history[1].content==='earlier reply');
  ck('the system prompt rides as instructions', create.body.instructions.indexOf('BE KIND')>=0);
  ck('the run is tied to this chat', create.body.session_id==='cozy-'+w.eval('current.id'));
  await sleep(60); w.__step(); await sleep(80); w.__step(); await sleep(80); w.__step(); await sleep(150);
  const card=d.querySelector('.appr.pending');
  ck('the permission card appears mid-stream', !!card);
  ck('showing the exact command', card.textContent.indexOf('rm -r ~/work/old')>=0);
  ck('with every choice the server offered', card.querySelectorAll('[data-approve]').length===4);
  // answer it
  card.querySelector('[data-approve$="|once"]').dispatchEvent(new w.Event('click',{bubbles:true}));
  await sleep(150);
  ck('the tap posted the choice', w.__approved && w.__approved.choice==='once', JSON.stringify(w.__approved));
  ck('to the right endpoint', w.__calls.some(c=>/\/runs\/run_9\/approval$/.test(c.url)));
  ck('and the card settled', !!d.querySelector('.appr:not(.pending)'));
  await drain(w,4);
  const m=w.eval('current.messages[current.messages.length-1]');
  ck('the reply assembled across the approval', m.content==='Checking. Cleared it.', JSON.stringify(m.content));
  ck('the tool ran and settled in the log', m.tools.length===1 && m.tools[0].status==='done' && m.tools[0].label==='terminal: ls ~/work');
  ck('the answered card is kept on the message', m.approvals.length===1 && m.approvals[0].status==='once');
}

console.log('=== 2. STOPPING THE STREAM STOPS THE AGENT ===');
{
  const dom=await boot(base(),w=>runsServer(w,[
    re({event:'message.delta',run_id:'run_9',delta:'Working. '}),
    re({event:'message.delta',run_id:'run_9',delta:'never delivered'})
  ]));
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  d.querySelector('#input').value='go'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await sleep(120); w.__step(); await sleep(120);
  ev(w,d.querySelector('#sendBtn'),'click');       // stop
  await sleep(250);
  ck('stop reached the server', w.__stopped===true);
  ck('the partial text is kept', /Working/.test(w.eval('current.messages[1].content')));
}

console.log('=== 3. AN UNANSWERED CARD EXPIRES, NEVER DANGLES ===');
{
  const dom=await boot(base(),w=>runsServer(w,[
    re({event:'approval.request',run_id:'run_9',tool:'terminal',command:'sudo reboot',choices:['once','deny']})
  ]));
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  d.querySelector('#input').value='reboot it'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await sleep(120); w.__step(); await sleep(150);
  ck('a narrowed choice list renders as given', d.querySelectorAll('.appr.pending [data-approve]').length===2);
  ev(w,d.querySelector('#sendBtn'),'click');       // stop with the card open
  await sleep(250);
  const m=w.eval('current.messages[1]');
  ck('the pending card expired with the run', m.approvals[0].status==='expired');
  ck('and offers no dead buttons', !d.querySelector('.appr [data-approve]'));
  // tapping an expired-run card later cannot post anywhere
  const before=w.__calls.filter(c=>/approval$/.test(c.url)).length;
  w.eval('current.messages[1].approvals[0].status="pending";renderThread()');
  await sleep(60);
  d.querySelector('[data-approve]').dispatchEvent(new w.Event('click',{bubbles:true}));
  await sleep(120);
  ck('a card from a dead run expires on tap instead of posting', w.__calls.filter(c=>/approval$/.test(c.url)).length===before
     && w.eval('current.messages[1].approvals[0].status')==='expired');
}

console.log('=== 4. A FAILED RUN IS AN ERROR, AND IMAGES FALL BACK ===');
{
  const dom=await boot(base(),w=>runsServer(w,[
    re({event:'run.failed',run_id:'run_9',error:{message:'provider quota gone'}})
  ]));
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  d.querySelector('#input').value='go'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await sleep(120); w.__step(); await sleep(250);
  const last=w.eval('current.messages[current.messages.length-1]');
  ck('run.failed surfaces as an error row', last.role==='error' && /provider quota gone/.test(last.content));
}
{
  const dom=await boot(base(),w=>runsServer(w,[]));
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  w.eval('pendingAtts.push({kind:"image",name:"pic.png",mime:"image/png",data:"aGk="})');
  d.querySelector('#input').value='what is this'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await sleep(400);
  ck('an image turn skips the run and takes the plain stream',
     !w.__calls.some(c=>/\/runs$/.test(c.url)) && w.__calls.some(c=>/chat\/completions$/.test(c.url)));
  ck('and still gets its reply', w.eval('current.messages[1].content')==='plain path');
}

console.log('=== 5. A MISSING RUNS API COSTS NOTHING BUT THE CARDS ===');
{
  // the server has /chat/completions but no /v1/runs at all — network-level refusal
  const dom=await boot(base(),w=>{
    w.__calls=[];
    return (url,opts)=>{
      w.__calls.push(String(url));
      if(/\/runs/.test(url)) return Promise.reject(new TypeError('Failed to fetch'));
      const sig=opts&&opts.signal;let sent=false;
      return Promise.resolve({ok:true,body:{getReader(){return{read(){
        return new Promise(res=>{ if(sent){res({done:true});return;} sent=true;
          res({done:false,value:new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content:'fell back fine'}}]})+'\n\n')}); });
      }};}}});
    };
  });
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  d.querySelector('#input').value='go'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await sleep(600);
  const msgs=w.eval('current.messages');
  ck('the message still sends over the plain stream', msgs[1]&&msgs[1].content==='fell back fine', JSON.stringify(msgs[1]&&msgs[1].content));
  ck('no error row for a missing upgrade', !msgs.some(m=>m.role==='error'));
  ck('the plain endpoint was actually used', w.__calls.some(u=>/chat\/completions$/.test(u)));
}
{
  // /runs exists (created the run) but its event stream is refused — the run must be stopped
  const dom=await boot(base(),w=>{
    w.__calls=[];
    return (url,opts)=>{
      w.__calls.push(String(url));
      if(/\/runs$/.test(url)) return Promise.resolve({ok:true,json:async()=>({run_id:'run_9',status:'started'})});
      if(/\/stop$/.test(url)){ w.__stopped=true; return Promise.resolve({ok:true,json:async()=>({})}); }
      if(/\/events$/.test(url)) return Promise.resolve({ok:false,status:404,json:async()=>({}),text:async()=>''});
      const sig=opts&&opts.signal;let sent=false;
      return Promise.resolve({ok:true,body:{getReader(){return{read(){
        return new Promise(res=>{ if(sent){res({done:true});return;} sent=true;
          res({done:false,value:new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content:'reply'}}]})+'\n\n')}); });
      }};}}});
    };
  });
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  d.querySelector('#input').value='go'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await sleep(600);
  ck('the orphaned run was stopped, not left working unseen', w.__stopped===true);
  ck('and the message completed anyway', w.eval('current.messages[1].content')==='reply');
}
{
  // a server that HAS the API and fails on it still fails loudly — no silent downgrade
  const dom=await boot(base(),w=>(url,opts)=>{
    if(/\/runs$/.test(url)) return Promise.resolve({ok:false,status:500,json:async()=>({error:{message:'runs backend exploded'}}),text:async()=>''});
    return Promise.resolve({ok:true,body:{getReader(){return{read(){return Promise.resolve({done:true});}};}}});
  });
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  d.querySelector('#input').value='go'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await sleep(500);
  const last=w.eval('current.messages[current.messages.length-1]');
  ck('a real runs failure surfaces as an error', last.role==='error' && /runs backend exploded/.test(last.content), JSON.stringify(last.content));
}

console.log('');
console.log(fail?('FAILED '+fail):'ALL PASS','('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})();
