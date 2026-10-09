// TEST FILE — run with: node tests/v5290wiretest.js
// Guards what goes to the model and what comes back, through the live path
// (the buttons a person taps, send(), the stream parsers, what was saved):
//   1. a reply that fails after text has arrived keeps that text, and the
//      error is said after it; an error chunk that also carries `choices`
//      (OpenRouter mid-stream, Hermes' failed turn) is the error it says it is
//   2. a reply still arriving is left to arrive: More, Swipe, the version
//      arrows and Retry do nothing to it
//   3. Stop during a lookup the model asked for calls the lookup off
//   4. More after a failed More or Swipe carries the reply on
//   5. Hermes' Runs API is used only when the request ends with your message
//   6. a reasoning delta that carries the text in two fields is read once
//   7. a reply that mentions a thinking tag is not cut
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=(o)=>Object.assign({
  providers:[{id:'o',preset:'custom',kind:'openai',name:'O',url:'https://o.test/v1',apiKey:'k',model:'m',ctx:200000},
             {id:'a',preset:'anthropic',kind:'anthropic',name:'C',url:'https://api.anthropic.com/v1',apiKey:'k',model:'claude-sonnet-4-6',ctx:200000},
             {id:'h',preset:'hermes',kind:'openai',name:'Hermes Agent',url:'http://127.0.0.1:8642/v1',apiKey:'hk',model:'hermes-agent',ctx:200000,hermesRuns:true},
             {id:'hp',preset:'hermes',kind:'openai',name:'Hermes plain',url:'http://127.0.0.1:8642/v1',apiKey:'hk',model:'hermes-agent',ctx:200000},
             {id:'or',preset:'openrouter',kind:'openai',name:'OpenRouter',url:'https://openrouter.ai/api/v1',apiKey:'k',model:'x/y',ctx:128000}],
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
// a body read chunk by chunk; an item that is a function supplies its own read
const stream=chunks=>{let i=0;return{ok:true,status:200,body:{getReader(){return{read(){
  if(i>=chunks.length) return Promise.resolve({done:true});
  const c=chunks[i++]; return typeof c==='function'?c():Promise.resolve({done:false,value:enc(c)});}};}}};};
const oa=t=>'data: '+JSON.stringify({choices:[{delta:{content:t}}]})+'\n\n';
const abortErr=()=>Object.assign(new Error('The user aborted a request.'),{name:'AbortError'});
// a reply that arrives in two parts: `first` at once, the rest when release(text) is called; Stop aborts it
function held(first,signal){
  let open; const gate=new Promise(r=>open=r); let i=0, last=false;
  const res={ok:true,status:200,body:{getReader(){return{read(){
    if(i<first.length) return Promise.resolve({done:false,value:enc(first[i++])});
    if(last) return Promise.resolve({done:true});
    last=true;
    return new Promise((resolve,reject)=>{
      gate.then(t=>resolve({done:false,value:enc(oa(t))}));
      if(signal){ if(signal.aborted) reject(abortErr()); else signal.addEventListener('abort',()=>reject(abortErr())); }
    });
  }};}}};
  return {res, release:t=>open(t)};
}
const toasts=w=>{const out=[];const t=w.document.querySelector('#toast');new w.MutationObserver(()=>out.push(t.textContent)).observe(t,{childList:true,characterData:true,subtree:true});return out;};
const say=async(w,text,ms)=>{const d=w.document;d.querySelector('#input').value=text;ev(w,d.querySelector('#input'),'input');d.querySelector('#sendBtn').click();await sleep(ms||500);};
const msgs=w=>JSON.parse(w.eval('JSON.stringify(current.messages.map(m=>({role:m.role,content:m.content,thinking:m.thinking||"",vi:m.vi,versions:(m.variants||[]).map(v=>v.content)})))'));
const short=m=>JSON.stringify(m.map(x=>x.role+': '+String(x.content).slice(0,40)));

(async()=>{

console.log('=== 1. A REPLY THAT FAILS AFTER TEXT HAS ARRIVED KEEPS THAT TEXT ===');
{
  const long='The knight rode north through the snow. '.repeat(20).trim();
  const an=(type,o)=>'event: '+type+'\ndata: '+JSON.stringify(Object.assign({type},o))+'\n\n';
  {
    // Claude sends text, then an error event (overloaded) in the middle of the reply
    const dom=await boot(base({activeProvider:'a'}),w=>()=>Promise.resolve(stream([
      an('message_start',{message:{usage:{input_tokens:10}}}),an('content_block_start',{index:0,content_block:{type:'text',text:''}}),
      an('content_block_delta',{index:0,delta:{type:'text_delta',text:long}}),an('error',{error:{type:'overloaded_error',message:'Overloaded'}})])));
    const w=dom.window;
    w.eval('newConvo()'); await say(w,'tell me a story');
    const m=msgs(w);
    ck('Claude overloaded mid-reply: the text that came is kept', m.length===3 && m[1].role==='assistant' && m[1].content===long, short(m));
    ck('and the error is said after it', !!m[2] && m[2].role==='error' && /Overloaded/.test(m[2].content), m[2] && m[2].content);
    const stored=(await w.eval('DB.all()')).find(c=>c.id===w.eval('current.id'));
    ck('the kept text is saved with the chat', !!stored && stored.messages.some(x=>x.role==='assistant' && x.content===long));
    ck('and What the model saw is on it', !!w.eval('current.messages[1].sent'));
    ck('and Send is back', !w.eval('streaming') && !w.document.querySelector('#sendBtn').classList.contains('stop'));
  }
  {
    // the phone's connection drops in the middle of the reply (Chrome: TypeError "network error")
    const dom=await boot(base(),w=>()=>Promise.resolve(stream([oa(long),()=>Promise.reject(new TypeError('network error'))])));
    const w=dom.window;
    w.eval('newConvo()'); await say(w,'tell me a story');
    const m=msgs(w);
    ck('the connection drops mid-reply: the text that came is kept', m.length===3 && m[1].content===long, short(m));
    ck('and the error says the connection dropped', !!m[2] && m[2].role==='error' && /dropped/.test(m[2].content), m[2] && JSON.stringify(m[2].content));
  }
  {
    // Swipe: a new version that fails after text arrived
    let n=0;
    const dom=await boot(base(),w=>()=>{ n++; return Promise.resolve(stream(n===1?[oa('First version.')]:[oa(long),()=>Promise.reject(new TypeError('network error'))])); });
    const w=dom.window,d=w.document;
    w.eval('newConvo()'); await say(w,'tell me a story');
    d.querySelector('.msg.assistant [data-regen]').click(); await sleep(500);
    const m=msgs(w);
    ck('Swipe that fails after text arrived: what came is kept as a new version',
       !!m[1] && JSON.stringify(m[1].versions)===JSON.stringify(['First version.',long]) && m[1].vi===1 && m[1].content===long,
       m[1] && JSON.stringify({versions:m[1].versions.map(v=>String(v).slice(0,20)),vi:m[1].vi}));
    ck('and the error is said after it', !!m[2] && m[2].role==='error', JSON.stringify(m.map(x=>x.role)));
  }
  {
    // More: what the continuation added before the failure stays on the reply
    const dom=await boot(base(),w=>()=>Promise.resolve(stream([oa(' and the second half.'),()=>Promise.reject(new TypeError('network error'))])));
    const w=dom.window,d=w.document;
    w.eval('newConvo(); current.messages.push({id:"u0",role:"user",content:"go"},{id:"a0",role:"assistant",content:"The first half",variants:[{content:"The first half",thinking:""}],vi:0}); renderThread();');
    d.querySelector('[data-continue]').click(); await sleep(500);
    const m=msgs(w);
    ck('More that fails after text arrived keeps what it added',
       m[1].content==='The first half and the second half.' && JSON.stringify(m[1].versions)===JSON.stringify(['The first half and the second half.']), JSON.stringify(m[1]));
    ck('and says the error after it', !!m[2] && m[2].role==='error');
  }
  {
    // what never began is still taken back, as before
    let n=0;
    const dom=await boot(base(),w=>()=>{ n++; return Promise.resolve(n===1?stream([oa('First version.')]):{ok:false,status:500,text:async()=>'{"error":{"message":"boom"}}'}); });
    const w=dom.window,d=w.document;
    w.eval('newConvo()'); await say(w,'hi');
    d.querySelector('.msg.assistant [data-regen]').click(); await sleep(400);
    let m=msgs(w);
    ck('a Swipe refused before any text goes back to the version it was showing',
       JSON.stringify(m[1].versions)===JSON.stringify(['First version.']) && m[1].vi===0 && m[1].content==='First version.' && m[2].role==='error', short(m));
    await say(w,'again');
    m=msgs(w);
    ck('a new reply refused before any text is taken back, and its error said',
       m.length===5 && m[3].role==='user' && m[4].role==='error' && /boom/.test(m[4].content), short(m));
  }
  {
    // OpenRouter's documented mid-stream error: an `error` object on a chunk that still carries `choices`
    const chunks=[oa('Once upon a time, '),oa('there was a '),
      'data: '+JSON.stringify({id:'gen-1',object:'chat.completion.chunk',model:'x/y',provider:'openai',error:{code:502,message:'Provider disconnected unexpectedly'},
        choices:[{index:0,delta:{content:''},finish_reason:'error'}]})+'\n\n'];
    const dom=await boot(base({activeProvider:'or'}),w=>()=>Promise.resolve(stream(chunks)));
    const w=dom.window;
    w.eval('newConvo()'); await say(w,'tell me a story');
    const m=msgs(w);
    ck("OpenRouter's mid-stream error is said as an error", !!m[2] && m[2].role==='error' && /Provider disconnected unexpectedly/.test(m[2].content), short(m));
    ck('after the text that came before it', !!m[1] && m[1].role==='assistant' && m[1].content==='Once upon a time, there was a ');
  }
  {
    // Hermes' finish chunk for a turn that failed (gateway/platforms/api_server_openai_routes.py), nothing streamed before it
    const chunks=['data: '+JSON.stringify({id:'c1',object:'chat.completion.chunk',model:'hermes-agent',choices:[{index:0,delta:{role:'assistant'},finish_reason:null}]})+'\n\n',
      'data: '+JSON.stringify({id:'c1',object:'chat.completion.chunk',model:'hermes-agent',choices:[{index:0,delta:{},finish_reason:'error'}],
        usage:{prompt_tokens:10,completion_tokens:0,total_tokens:10},error:{message:'agent crashed: KeyError tools',type:'KeyError'},
        hermes:{completed:false,partial:false,failed:true,error:'agent crashed: KeyError tools',error_code:'agent_error'}})+'\n\n','data: [DONE]\n\n'];
    const dom=await boot(base({activeProvider:'hp'}),w=>()=>Promise.resolve(stream(chunks)));
    const w=dom.window;
    w.eval('newConvo()'); await say(w,'hello');
    const m=msgs(w);
    ck("Hermes' failed turn says why, instead of an empty reply", m.length===2 && m[1].role==='error' && /KeyError tools/.test(m[1].content), short(m));
  }
  {
    // finish_reason "error" with no reason attached is still not a finished reply
    const dom=await boot(base(),w=>()=>Promise.resolve(stream([oa('Partial answer'),'data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'error'}]})+'\n\n','data: [DONE]\n\n'])));
    const w=dom.window;
    w.eval('newConvo()'); await say(w,'hello');
    const m=msgs(w);
    ck('a reply the service ends with finish_reason "error" keeps its text and says it failed', m.length===3 && m[1].content==='Partial answer' && m[2].role==='error', short(m));
  }
}

console.log('\n=== 2. A REPLY STILL ARRIVING IS LEFT TO ARRIVE ===');
{
  {
    // More on a reply still arriving
    let h=null; const calls=[];
    const dom=await boot(base(),w=>(url,o)=>{ calls.push(String(url)); if(calls.length===1){ h=held([oa('Hello, the first half')],o.signal); return Promise.resolve(h.res); } return Promise.resolve(stream([oa(' [continued]')])); });
    const w=dom.window,d=w.document;
    w.eval('newConvo()'); await say(w,'hi',300);
    const more=d.querySelector('.msg.assistant [data-continue]');
    ck('setup: a reply is arriving, with its More button', !!more && !!h);
    if (more){ more.click(); await sleep(300); }
    ck('More on a reply still arriving starts nothing', calls.length===1, calls.length+' requests');
    ck('and does not cut it off', w.eval('!!streaming && !streaming.signal.aborted'));
    h.release(' and the second half.'); await sleep(400);
    ck('it comes in whole', w.eval('current.messages.slice(-1)[0].content')==='Hello, the first half and the second half.', JSON.stringify(w.eval('current.messages.slice(-1)[0].content')));
  }
  {
    // while More carries a reply on: the version arrows, Swipe and More again
    let h=null; const calls=[];
    const dom=await boot(base(),w=>(url,o)=>{ calls.push(String(url)); h=held([oa(' and more')],o.signal); return Promise.resolve(h.res); });
    const w=dom.window,d=w.document;
    w.eval('newConvo(); current.messages.push({id:"u0",role:"user",content:"go"},{id:"a0",role:"assistant",content:"Version two",variants:[{content:"Version one",thinking:""},{content:"Version two",thinking:""}],vi:1}); renderThread();');
    d.querySelector('[data-continue]').click(); await sleep(300);
    ck('setup: More is carrying the reply on', calls.length===1 && w.eval('streaming && streaming.asstId')==='a0');
    const back=d.querySelector('[data-swipe="a0"][data-dir="-1"]');
    ck('setup: the version arrows are on screen', !!back);
    if (back){ back.click(); await sleep(200); }
    ck('the version arrows do nothing meanwhile', w.eval('current.messages[1].vi')===1, 'version '+w.eval('current.messages[1].vi'));
    const sw=d.querySelector('.msg.assistant [data-regen]');
    if (sw){ sw.click(); await sleep(200); }
    ck('Swipe does nothing meanwhile', calls.length===1 && w.eval('!!streaming && !streaming.signal.aborted'), calls.length+' requests');
    const mo=d.querySelector('.msg.assistant [data-continue]');
    if (mo){ mo.click(); await sleep(200); }
    ck('a second More does nothing meanwhile', calls.length===1 && w.eval('!!streaming && !streaming.signal.aborted'), calls.length+' requests');
    h.release('.'); await sleep(400);
    const m=msgs(w);
    ck('both versions survive: the first untouched, the second carried on',
       JSON.stringify(m[1].versions)===JSON.stringify(['Version one','Version two and more.']) && m[1].vi===1, JSON.stringify(m[1].versions));
  }
  {
    // Retry on an older reply while a later one is arriving
    let h=null; const calls=[];
    const dom=await boot(base(),w=>(url,o)=>{ calls.push(String(url)); h=held([oa('New reply, first half')],o.signal); return Promise.resolve(h.res); });
    const w=dom.window,d=w.document;
    w.eval('newConvo(); current.messages.push({id:"u0",role:"user",content:"one"},{id:"a0",role:"assistant",content:"Old reply",variants:[{content:"Old reply",thinking:""}],vi:0}); renderThread();');
    await say(w,'two',300);
    const retry=d.querySelector('[data-regen="a0"]');
    ck('setup: a reply is arriving, and the older reply has Retry', !!retry && calls.length===1);
    if (retry){ retry.click(); await sleep(300); }
    ck('Retry on an older reply does nothing while a later one arrives',
       calls.length===1 && w.eval('current.messages.length')===4 && w.eval('!!streaming && !streaming.signal.aborted'), calls.length+' requests, '+w.eval('current.messages.length')+' messages');
    h.release(', second half.'); await sleep(400);
    ck('and the arriving reply comes in whole', w.eval('current.messages[3] && current.messages[3].content')==='New reply, first half, second half.', JSON.stringify(w.eval('current.messages[3] && current.messages[3].content')));
  }
}

console.log('\n=== 3. STOP DURING A LOOKUP THE MODEL ASKED FOR ===');
{
  let searchSignal='never given'; const calls=[];
  const dom=await boot(base({search:{on:true,provider:'tavily',key:'K',count:5,relay:'',always:false,images:false,auto:false,model:true}}),w=>(url,o)=>{
    url=String(url); calls.push(url);
    if(/tavily/.test(url)) return new Promise((res,rej)=>{ searchSignal=(o&&o.signal)||null; if(searchSignal) searchSignal.addEventListener('abort',()=>rej(abortErr())); });
    const n=calls.filter(u=>/chat\/completions/.test(u)).length;
    return Promise.resolve(stream([oa(n===1?'<websearch>weather in Bali today</websearch>':'ok')]));
  });
  const w=dom.window,d=w.document,btn=d.querySelector('#sendBtn');
  const t=toasts(w);
  w.eval('newConvo()'); await say(w,'what is the weather in Bali?');
  ck('setup: the model asked for a lookup and it is under way', calls.some(u=>/tavily/.test(u)) && btn.classList.contains('stop'));
  btn.click(); await sleep(300);
  ck('Stop calls the lookup off', !!searchSignal && searchSignal!=='never given' && searchSignal.aborted===true, String(searchSignal && searchSignal.aborted));
  ck('and Send is back', !w.eval('streaming') && !btn.classList.contains('stop'), btn.className);
  ck('the reply says it was stopped', w.eval('current.messages.slice(-1)[0].content')==='_(stopped)_', JSON.stringify(w.eval('current.messages.slice(-1)[0].content')));
  ck('and stopping is not reported as an error', !t.some(x=>/abort/i.test(x)), JSON.stringify(t));
  await say(w,'never mind');
  ck('the next message goes', calls.filter(u=>/chat\/completions/.test(u)).length===2 && w.eval('current.messages.slice(-1)[0].content')==='ok', JSON.stringify(calls.map(u=>u.replace(/^https:\/\/[^/]+/,''))));
}

console.log('\n=== 4. MORE AFTER A FAILED MORE OR SWIPE ===');
{
  {
    let n=0;
    const dom=await boot(base(),w=>()=>{ n++; return Promise.resolve(n===1?{ok:false,status:429,text:async()=>'{"error":{"message":"Rate limited, try again"}}'}:stream([oa(' and more.')])); });
    const w=dom.window,d=w.document;
    w.eval('newConvo(); current.messages.push({id:"u0",role:"user",content:"hi"},{id:"a0",role:"assistant",content:"Hello",variants:[{content:"Hello",thinking:""}],vi:0}); renderThread();');
    d.querySelector('[data-continue]').click(); await sleep(400);
    ck('setup: More was refused and said so', n===1 && w.eval('current.messages.slice(-1)[0].role')==='error');
    d.querySelector('[data-continue]').click(); await sleep(400);
    const m=msgs(w);
    ck('More again carries the reply on', n===2 && m[1].content==='Hello and more.', n+' requests; '+short(m));
    ck("and the failed attempt's error goes, as it does for Swipe", !m.some(x=>x.role==='error'), JSON.stringify(m.map(x=>x.role)));
  }
  {
    let n=0;
    const dom=await boot(base(),w=>()=>{ n++; return Promise.resolve(n===1?{ok:false,status:500,text:async()=>'{"error":{"message":"boom"}}'}:stream([oa(' and more.')])); });
    const w=dom.window,d=w.document;
    w.eval('newConvo(); current.messages.push({id:"u0",role:"user",content:"hi"},{id:"a0",role:"assistant",content:"Hello",variants:[{content:"Hello",thinking:""}],vi:0}); renderThread();');
    d.querySelector('.msg.assistant [data-regen]').click(); await sleep(400);
    ck('setup: Swipe was refused and said so', n===1 && w.eval('current.messages.slice(-1)[0].role')==='error');
    d.querySelector('[data-continue]').click(); await sleep(400);
    const m=msgs(w);
    ck('More after a failed Swipe carries the reply on', n===2 && m[1].content==='Hello and more.' && !m.some(x=>x.role==='error'), n+' requests; '+short(m));
  }
}

console.log("\n=== 5. HERMES' RUNS API ONLY WHEN THE REQUEST ENDS WITH YOUR MESSAGE ===");
{
  // a stand-in that applies Hermes' own rule: POST /v1/runs refuses an empty input
  // (gateway/platforms/api_server_runs.py: `if not raw_input: ... "Missing 'input' field", status=400`)
  const hermes=log=>w=>(url,o)=>{
    url=String(url); const body=o&&o.body?JSON.parse(o.body):null; log.push({url:url.replace('http://127.0.0.1:8642/v1',''),body});
    if(/\/runs$/.test(url)){
      if(!body.input) return Promise.resolve({ok:false,status:400,text:async()=>JSON.stringify({error:{message:"Missing 'input' field",type:'invalid_request_error'}})});
      return Promise.resolve({ok:true,status:200,json:async()=>({run_id:'R1'})});
    }
    if(/\/runs\/R1\/events$/.test(url)) return Promise.resolve(stream(['data: '+JSON.stringify({event:'message.delta',run_id:'R1',delta:'Run reply.'})+'\n\n','data: '+JSON.stringify({event:'run.completed',run_id:'R1',output:'Run reply.'})+'\n\n']));
    if(/\/chat\/completions$/.test(url)) return Promise.resolve(stream([oa('Plain reply.'),'data: [DONE]\n\n']));
    return Promise.resolve({ok:true,status:200,json:async()=>({})});
  };
  const after={id:'d',name:'D',system:'You are helpful.',injections:[{id:'j',name:'Post-history',text:'Answer briefly.',enabled:true,pos:'relative',role:'system',depth:0}],order:['__main__','__chat__','j']};
  const depth0={id:'d',name:'D',system:'You are helpful.',injections:[{id:'j',name:'Nudge',text:'Answer briefly.',enabled:true,pos:'chat',role:'system',depth:0}],order:['__main__','j','__chat__']};
  for (const [name,set] of [['a block after the conversation',after],['an in-chat block at depth 0',depth0]]){
    const log=[];
    const dom=await boot(base({activeProvider:'h',presets:[set]}),hermes(log));
    const w=dom.window;
    w.eval('newConvo()'); await say(w,'hello');
    const m=msgs(w);
    ck(name+': the message goes, over the plain stream', m.length===2 && m[1].role==='assistant' && m[1].content==='Plain reply.', short(m));
    ck(name+': and no run is started with an empty input', !log.some(x=>/\/runs$/.test(x.url)), JSON.stringify(log.map(x=>x.url)));
  }
  {
    const log=[];
    const dom=await boot(base({activeProvider:'h'}),hermes(log));
    const w=dom.window,d=w.document;
    w.eval('newConvo()'); await say(w,'hello');
    ck('a message that ends the request still goes as a run (approval cards)',
       log.some(x=>/\/runs$/.test(x.url) && x.body.input==='hello') && w.eval('current.messages[1].content')==='Run reply.', JSON.stringify(log.map(x=>x.url)));
    log.length=0;
    /* More is not offered on Hermes at all now (v5291wiretest.js, section 2):
       over either transport Hermes reads the reply being carried on as your
       message. It used to fall back to the plain stream - which is where
       Hermes answered the reply as if you had written it. */
    const more=d.querySelector('[data-continue]');
    if (more){ more.click(); await sleep(500); }
    ck('More, which Hermes cannot carry on, is not offered, so no run starts with an empty input',
       !more && !log.length, JSON.stringify(log.map(x=>x.url)));
  }
}

console.log('\n=== 6. A REASONING DELTA IS READ ONCE ===');
{
  {
    // vLLM 0.12+: DeltaMessage copies `reasoning` into `reasoning_content`, so every delta carries the text twice
    const ch=o=>'data: '+JSON.stringify({id:'c',object:'chat.completion.chunk',model:'Qwen/Qwen3-8B',choices:[{index:0,delta:o,finish_reason:null}]})+'\n\n';
    const dom=await boot(base(),w=>()=>Promise.resolve(stream([ch({role:'assistant',content:'',reasoning_content:null}),
      ch({reasoning:'The user',reasoning_content:'The user'}),ch({reasoning:' says hi.',reasoning_content:' says hi.'}),ch({content:'Hello!',reasoning_content:null}),'data: [DONE]\n\n'])));
    const w=dom.window;
    w.eval('newConvo()'); await say(w,'hi');
    ck('vLLM: thinking that arrives in both fields is shown once', w.eval('current.messages[1].thinking')==='The user says hi.', JSON.stringify(w.eval('current.messages[1].thinking')));
    ck('and the reply is the reply', w.eval('current.messages[1].content')==='Hello!');
  }
  for (const [name,f] of [['reasoning_content alone (DeepSeek, Hermes)','reasoning_content'],['reasoning alone (OpenRouter)','reasoning']]){
    const ch=o=>'data: '+JSON.stringify({choices:[{index:0,delta:o}]})+'\n\n';
    const dom=await boot(base(),w=>()=>Promise.resolve(stream([ch({[f]:'Plan A'}),ch({[f]:', then B.'}),ch({content:'Done.'})])));
    const w=dom.window;
    w.eval('newConvo()'); await say(w,'hi');
    ck(name+' still arrives', w.eval('current.messages[1].thinking')==='Plan A, then B.' && w.eval('current.messages[1].content')==='Done.', JSON.stringify(w.eval('current.messages[1].thinking')));
  }
}

console.log('\n=== 7. A REPLY THAT MENTIONS A THINKING TAG IS NOT CUT ===');
{
  const replies=[
    ['an opening tag named in a sentence','To make the model reason first, ask it to wrap its plan in <thinking> tags. Then it answers normally after the plan.'],
    ['a closing tag named in a sentence','Close the block with </think> on its own and everything before it is hidden. Everything after it is the reply.'],
    ['both tags named in a sentence','Wrap the plan in <think> and </think>, then write the answer.'],
    ['both tags around an ellipsis','Use <think>...</think> around the plan, then answer.'],
    ['tags inside a code fence','In your prompt, use this shape:\n\n```xml\n<reasoning>step by step</reasoning>\n<answer>final</answer>\n```\n\nThe model then fills both parts.'],
    ['tags in inline code','Use `<think>` to open the plan and `</think>` to close it.'],
    ['a tag in quotes','The "<thought>" tag is what that model uses.'],
  ];
  for (const [name,r] of replies){
    const dom=await boot(base({thinkTags:'think, thinking, reasoning, thought'}),w=>()=>Promise.resolve(stream([oa(r)])));
    const w=dom.window;
    w.eval('newConvo()'); await say(w,'how do thinking tags work?');
    const m=JSON.parse(w.eval('JSON.stringify(current.messages[1])'));
    ck(name+': the reply is kept whole', m.content===r && !m.thinking, JSON.stringify({content:String(m.content).slice(0,70),thinking:String(m.thinking||'').slice(0,40)}));
    ck(name+': and goes back to the model whole', w.eval('buildPayload({},current).body.messages.slice(-1)[0].content')===r);
  }
}
{
  // reasoning a model writes inline is caught as before
  const cases=[
    ['an opening tag that starts the reply','<think>Plan: be brief.</think>The answer is 4.','Plan: be brief.','The answer is 4.'],
    ['a reply cut off while still reasoning','<think>Still working it out','Still working it out',''],
    ['a closing tag whose opening tag was in the prompt (R1 style)','Okay, the user wants a sum.\n</think>\n\nThe answer is 4.','Okay, the user wants a sum.\n','The answer is 4.'],
    ['a closing tag right after the reasoning','fight me</think>Okay. You cracked the vault.','fight me','Okay. You cracked the vault.'],
    ['reasoning after a preamble, closed','Preamble. <think>r</think>After','r','Preamble. After'],
    ['spaces around the closing tag of reasoning that opened the reply','<think>Plan it. </think> The answer is 4.','Plan it. ','The answer is 4.'],
    ['reasoning that mentions a code fence it never closes','<think>I will answer in a ```python block.</think>Here it is.','I will answer in a ```python block.','Here it is.'],
  ];
  for (const [name,r,think,text] of cases){
    const dom=await boot(base({thinkTags:'think, thinking, reasoning, thought'}),w=>()=>Promise.resolve(stream([oa(r)])));
    const w=dom.window;
    w.eval('newConvo()'); await say(w,'q');
    const m=JSON.parse(w.eval('JSON.stringify(current.messages[1])'));
    ck(name+': still caught', m.thinking===think && m.content===text, JSON.stringify({content:m.content,thinking:m.thinking}));
  }
}

console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})();
