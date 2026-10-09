// TEST FILE — run with: node tests/v5291wiretest.js
// Guards the second round of fixes to what goes to the model and what comes
// back, through the live path (the buttons a person taps, send(), the request
// that leaves, the stream that comes back, what was saved):
//   1. More carries on the reply: the request is the one Send makes, with the
//      reply itself last, word for word
//   2. Hermes is never sent a started reply: no prefill, no More
//   3. an action in one chat never cuts off a reply arriving in another
//   4. Save & resend with new words searches for the new words
//   5. Hermes runs: no stored history comes back, the model and thinking level
//      go with the run, and an answer or an interruption that only the end
//      of the run carries is read
//   6. a refused thinking parameter or max_tokens costs a retry, not the message
//   7. a fresh install sends nothing about thinking until a level is chosen
//   8. squash keeps the system prompt one message; Never forget does not
//      repeat it next to itself
//   9. the meter counts the web results a request carries
//  10. More on a connection that refuses it, Claude's search tool, a
//      connection with no key, a deleted chat's record
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const PROVIDERS=[
  {id:'o',preset:'custom',kind:'openai',name:'O',url:'https://o.test/v1',apiKey:'k',model:'m',ctx:200000},
  {id:'a',preset:'anthropic',kind:'anthropic',name:'C',url:'https://api.anthropic.com/v1',apiKey:'k',model:'claude-sonnet-4-6',ctx:200000},
  {id:'h',preset:'hermes',kind:'openai',name:'Hermes Agent',url:'http://127.0.0.1:8642/v1',apiKey:'hk',model:'hermes-agent',ctx:200000,hermesRuns:true},
  {id:'hr',preset:'hermes',kind:'openai',name:'Hermes route',url:'http://127.0.0.1:8642/v1',apiKey:'hk',model:'my-route',ctx:200000,hermesRuns:true},
  {id:'hp',preset:'hermes',kind:'openai',name:'Hermes plain',url:'http://127.0.0.1:8642/v1',apiKey:'hk',model:'hermes-agent',ctx:200000},
  {id:'hc',preset:'custom',kind:'openai',name:'My agent',url:'http://127.0.0.1:8642/v1',apiKey:'hk',model:'agent',ctx:200000},
  {id:'or',preset:'openrouter',kind:'openai',name:'OpenRouter',url:'https://openrouter.ai/api/v1',apiKey:'k',model:'x/y',ctx:128000},
  {id:'oa',preset:'openai',kind:'openai',name:'OpenAI',url:'https://api.openai.com/v1',apiKey:'k',model:'gpt-4o',ctx:128000},
  {id:'z',preset:'zai',kind:'openai',name:'GLM',url:'https://api.z.ai/api/paas/v4',apiKey:'k',model:'glm-4.6',ctx:200000},
  {id:'q',preset:'custom',kind:'openai',name:'Qwen',url:'https://q.test/v1',apiKey:'k',model:'qwen3-235b-a22b',ctx:128000}];
const base=(o)=>Object.assign({
  providers:JSON.parse(JSON.stringify(PROVIDERS)),
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
  if(i>=chunks.length) return Promise.resolve({done:true});
  const c=chunks[i++]; return typeof c==='function'?c():Promise.resolve({done:false,value:enc(c)});}};}}};};
const oa=t=>'data: '+JSON.stringify({choices:[{delta:{content:t}}]})+'\n\n';
const an=(type,o)=>'event: '+type+'\ndata: '+JSON.stringify(Object.assign({type},o))+'\n\n';
const anth=t=>[an('message_start',{message:{usage:{input_tokens:10}}}),an('content_block_start',{index:0,content_block:{type:'text',text:''}}),
  an('content_block_delta',{index:0,delta:{type:'text_delta',text:t}}),an('message_stop',{})];
const abortErr=()=>Object.assign(new Error('The user aborted a request.'),{name:'AbortError'});
const refusal=(status,msg)=>({ok:false,status,text:async()=>JSON.stringify({error:{message:msg,type:'invalid_request_error'}})});
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
const msgs=w=>JSON.parse(w.eval('JSON.stringify(current.messages.map(m=>({id:m.id,role:m.role,content:m.content,thinking:m.thinking||"",vi:m.vi,versions:(m.variants||[]).map(v=>v.content),sources:m.sources||null,searchedFor:m.searchedFor||null})))'));
const short=m=>JSON.stringify(m.map(x=>x.role+': '+String(x.content).slice(0,40)));
const turn=m=>m.role+': '+(typeof m.content==='string'?m.content:JSON.stringify(m.content)).replace(/\n/g,' | ').slice(0,90);
const switchTo=async(w,pid)=>{const s=w.document.querySelector('#quickSwitch');s.value=pid;ev(w,s,'change');await sleep(150);};
const openChat=async(w,id)=>{const d=w.document;const row=Array.from(d.querySelectorAll('.convo[data-id]')).find(e=>e.getAttribute('data-id')===id);if(row) row.querySelector('.convo-title').click();await sleep(200);};

(async()=>{

console.log("=== 1. MORE: SEND'S REQUEST, WITH THE REPLY ITSELF LAST ===");
{
  const sets={
    'a block placed after the conversation':{id:'d',name:'D',system:'You are a storyteller.',injections:[{id:'j',name:'Post-history',text:'Write in present tense.',enabled:true,pos:'relative',role:'system',depth:0}],order:['__main__','__chat__','j']},
    'an in-chat block at depth 0':{id:'d',name:'D',system:'You are a storyteller.',injections:[{id:'j',name:'Nudge',text:'Write in present tense.',enabled:true,pos:'chat',role:'system',depth:0}],order:['__main__','j','__chat__']},
    'Never forget at depth 0':{id:'d',name:'D',system:'You are a storyteller.',injections:[],order:['__main__','__chat__'],remind:{mode:'main',depth:0}},
    'an in-chat block at depth 1':{id:'d',name:'D',system:'You are a storyteller.',injections:[{id:'j',name:'Nudge',text:'Write in present tense.',enabled:true,pos:'chat',role:'system',depth:1}],order:['__main__','j','__chat__']}
  };
  for (const [name,set] of Object.entries(sets)){
    for (const pid of ['o','a']){
      const bodies=[];
      const dom=await boot(base({activeProvider:pid,presets:[set]}),w=>(u,o)=>{ bodies.push(JSON.parse(o.body)); return Promise.resolve(stream(pid==='a'?anth(' who rode north.'):[oa(' who rode north.')])); });
      const w=dom.window,d=w.document;
      w.eval('newConvo(); current.messages.push({id:"u0",role:"user",content:"Tell me a story."},{id:"a0",role:"assistant",content:"Once upon a time, a knight",variants:[{content:"Once upon a time, a knight",thinking:""}],vi:0}); renderThread();');
      d.querySelector('[data-continue="a0"]').click(); await sleep(500);
      const more=bodies[0], tail=more && more.messages[more.messages.length-1];
      ck(name+' ('+(pid==='a'?'Claude':'OpenAI-compatible')+'): More ends with the reply itself, word for word',
         !!tail && tail.role==='assistant' && tail.content==='Once upon a time, a knight', more && JSON.stringify(more.messages.map(turn)));
      ck(name+' ('+(pid==='a'?'Claude':'OpenAI-compatible')+'): and the model carries it on', w.eval('current.messages[1].content')==='Once upon a time, a knight who rode north.', JSON.stringify(w.eval('current.messages[1].content')));
      d.querySelector('[data-regen="a0"]').click(); await sleep(500);     // Swipe: the request Send makes with the reply still to come
      const swipe=bodies[1];
      ck(name+' ('+(pid==='a'?'Claude':'OpenAI-compatible')+'): everything before it is exactly what Send sends',
         !!swipe && !!more && JSON.stringify(more.messages.slice(0,-1))===JSON.stringify(swipe.messages) && JSON.stringify(more.system)===JSON.stringify(swipe.system),
         swipe && JSON.stringify(swipe.messages.map(turn)));
    }
  }
  {
    // files on: Cozy's "no file edits" note goes where Send puts it, never onto the reply being carried on
    const bodies=[];
    const dom=await boot(base(),w=>(u,o)=>{ bodies.push(JSON.parse(o.body)); return Promise.resolve(stream([oa(' and the rain kept on.')])); });
    const w=dom.window,d=w.document;
    w.eval('newConvo(); current.filesOn=true; current.messages.push({id:"u0",role:"user",content:"Draft chapter one."},{id:"a0",role:"assistant",content:"Chapter one.",variants:[{content:"Chapter one.",thinking:""}],vi:0},{id:"u1",role:"user",content:"Now chapter two."},{id:"a1",role:"assistant",content:"The rain had not stopped, and Mara",variants:[{content:"The rain had not stopped, and Mara",thinking:""}],vi:0}); renderThread();');
    d.querySelector('[data-continue="a1"]').click(); await sleep(500);
    const tail=bodies[0] && bodies[0].messages.slice(-1)[0];
    ck('files on: the reply being carried on goes with nothing appended to it', !!tail && tail.content==='The rain had not stopped, and Mara', tail && JSON.stringify(tail.content));
    d.querySelector('[data-regen="a1"]').click(); await sleep(500);
    ck('files on: and the rest is what Send sends, the note where Send puts it', !!bodies[1] && JSON.stringify(bodies[0].messages.slice(0,-1))===JSON.stringify(bodies[1].messages),
       bodies[1] && JSON.stringify(bodies[1].messages.map(turn)));
  }
}

console.log('\n=== 2. HERMES IS NEVER SENT A STARTED REPLY ===');
{
  for (const [name,pid] of [['Hermes','hp'],['a connection on Hermes\' port','hc']]){
    const bodies=[];
    const dom=await boot(base({activeProvider:pid,prefill:{on:true}}),w=>(u,o)=>{ bodies.push(JSON.parse(o.body)); return Promise.resolve(stream([oa('Paris.'),'data: [DONE]\n\n'])); });
    const w=dom.window,d=w.document;
    w.eval('newConvo()'); await say(w,'What is the capital of France?');
    const last=bodies[0] && bodies[0].messages.slice(-1)[0];
    ck(name+': a prefill is not sent - your message is the last turn', !!last && last.role==='user' && last.content==='What is the capital of France?', last && JSON.stringify(last));
    ck(name+': and the reply is only the reply', w.eval('current.messages[1].content')==='Paris.', JSON.stringify(w.eval('current.messages[1].content')));
    d.querySelector('#settingsBtn').click(); await sleep(150);
    ck(name+': the prefill status says why', /Hermes/.test(d.querySelector('#pfStatus').textContent), JSON.stringify(d.querySelector('#pfStatus').textContent));
  }
  {
    const dom=await boot(base({activeProvider:'hp'}),w=>()=>Promise.resolve(stream([oa('x')])));
    const w=dom.window,d=w.document;
    w.eval('newConvo(); current.messages.push({id:"u0",role:"user",content:"Write a poem."},{id:"a0",role:"assistant",content:"Rain on the roof,",variants:[{content:"Rain on the roof,",thinking:""}],vi:0}); renderThread();');
    ck('More is not offered on a Hermes connection', !d.querySelector('[data-continue]') && !!d.querySelector('[data-regen="a0"]'));
    await switchTo(w,'o');
    ck('and is offered again on a connection that can carry a reply on', !!d.querySelector('[data-continue="a0"]'));
    await switchTo(w,'hc');
    ck('a connection on Hermes\' port is Hermes too', !d.querySelector('[data-continue]'));
  }
  {
    // Test prefill on Hermes: answered without a request
    let n=0;
    const dom=await boot(base({activeProvider:'hp',prefill:{on:true}}),w=>()=>{ n++; return Promise.resolve({ok:true,status:200,json:async()=>({choices:[{message:{content:'D E F'}}]})}); });
    const w=dom.window,d=w.document;
    w.eval('newConvo(); current.messages.push({id:"u0",role:"user",content:"hi"});');
    d.querySelector('#settingsBtn').click(); await sleep(100);
    d.querySelector('#pfTestBtn').click(); await sleep(400);
    const st=d.querySelector('#pfTestStat');
    ck('Test prefill on Hermes says why and spends no request', n===0 && /Hermes/.test(st.textContent) && !/pf-ok/.test(st.className), n+' requests; '+JSON.stringify(st.textContent));
  }
}

console.log('\n=== 3. ONE CHAT NEVER CUTS OFF A REPLY ARRIVING IN ANOTHER ===');
{
  let h=null; const calls=[];
  const dom=await boot(base(),w=>(url,o)=>{ calls.push(String(url)); if(calls.length===1){ h=held([oa('Chapter one: the long road')],o.signal); return Promise.resolve(h.res); } return Promise.resolve(stream([oa('more')])); });
  const w=dom.window,d=w.document,btn=d.querySelector('#sendBtn');
  const t=toasts(w);
  w.eval('newConvo(); window.B=current; current.title="Recipes"; current.messages.push({id:"bu0",role:"user",content:"soup?"},{id:"ba0",role:"assistant",content:"Soup answer",variants:[{content:"Soup answer",thinking:""}],vi:0},{id:"bu1",role:"user",content:"and bread?"},{id:"ba1",role:"assistant",content:"Bread answer",variants:[{content:"Bread answer",thinking:""}],vi:0}); renderSidebar();');
  w.eval('newConvo(); window.A=current; current.title="Novel"; renderSidebar();');
  await say(w,'write chapter one',300);
  ck('setup: a reply is arriving in "Novel", where Send is Stop', !!h && btn.classList.contains('stop'));
  await openChat(w,w.eval('B.id'));
  ck('in "Recipes" the composer button is Send, not a Stop for "Novel"', w.eval('current===B') && !btn.classList.contains('stop') && btn.getAttribute('aria-label')==='Send', btn.getAttribute('aria-label'));
  ck('and with nothing typed it is greyed out, as in any quiet chat', btn.disabled===true);
  const aRunning=()=>w.eval('!!streaming && streaming.convoId===A.id && !streaming.signal.aborted');
  const said=()=>t.some(x=>/still coming in/i.test(x) && /Novel/.test(x));
  t.length=0; d.querySelector('[data-regen="ba1"]').click(); await sleep(250);
  ck('Swipe in "Recipes" starts nothing, and says which chat is busy', calls.length===1 && said(), calls.length+' requests; '+JSON.stringify(t));
  ck('and the reply in "Novel" keeps arriving', aRunning());
  t.length=0; d.querySelector('[data-continue="ba1"]').click(); await sleep(250);
  ck('More in "Recipes": the same', calls.length===1 && said() && aRunning(), calls.length+' requests; '+JSON.stringify(t));
  t.length=0; d.querySelector('[data-regen="ba0"]').click(); await sleep(250);
  ck('Retry in "Recipes" removes nothing, starts nothing', calls.length===1 && w.eval('B.messages.length')===4 && said() && aRunning(), calls.length+' requests, '+w.eval('B.messages.length')+' messages; '+JSON.stringify(t));
  t.length=0; w.eval('B.messages.some(m=>m.id==="bu1") && startEdit("bu1")');
  const ed=d.querySelector('.msg-edit'); if (ed){ ed.value='and cake?'; d.querySelector('[data-savedit]').click(); await sleep(250); }
  ck('Save & resend in "Recipes" changes nothing, starts nothing', !!ed && calls.length===1 && w.eval('B.messages[2] && B.messages[2].content')==='and bread?' && w.eval('B.messages.length')===4 && said() && aRunning(),
     calls.length+' requests; '+JSON.stringify(w.eval('B.messages.map(m=>m.content)')));
  t.length=0; d.querySelector('#regenBtn').click(); await sleep(250);
  ck('the top Retry in "Recipes": the same', calls.length===1 && said() && aRunning(), calls.length+' requests; '+JSON.stringify(t));
  t.length=0; d.querySelector('#input').value='one more question'; ev(w,d.querySelector('#input'),'input'); btn.click(); await sleep(250);
  ck('Send in "Recipes" sends nothing, and says why', calls.length===1 && said() && aRunning(), calls.length+' requests; '+JSON.stringify(t));
  ck('and what was typed stays in the box', d.querySelector('#input').value==='one more question');
  await openChat(w,w.eval('A.id'));
  ck('back in "Novel" the button is Stop', btn.classList.contains('stop') && btn.getAttribute('aria-label')==='Stop', btn.getAttribute('aria-label'));
  btn.click(); await sleep(300);
  ck('and it stops the reply arriving there', !w.eval('streaming') && w.eval('A.messages.slice(-1)[0].content')==='Chapter one: the long road', JSON.stringify(w.eval('A.messages.slice(-1)[0].content')));
}
{
  // the refusal lasts exactly as long as the reply: once it is in, the other chat is free
  let h=null; const calls=[];
  const dom=await boot(base(),w=>(url,o)=>{ calls.push(String(url)); if(calls.length===1){ h=held([oa('Chapter one')],o.signal); return Promise.resolve(h.res); } return Promise.resolve(stream([oa('Flour and water.'),'data: [DONE]\n\n'])); });
  const w=dom.window,d=w.document,btn=d.querySelector('#sendBtn');
  w.eval('newConvo(); window.B=current; current.title="Recipes"; renderSidebar();');
  w.eval('newConvo(); window.A=current; current.title="Novel"; renderSidebar();');
  await say(w,'write chapter one',300);
  await openChat(w,w.eval('B.id'));
  h.release(', the end.'); await sleep(400);
  ck('a reply that finishes while another chat is open is kept whole', w.eval('A.messages[1].content')==='Chapter one, the end.', JSON.stringify(w.eval('A.messages[1].content')));
  await say(w,'how is bread made?');
  ck('and Send in the open chat goes out once it is in', calls.length===2 && w.eval('B.messages.length')===2 && w.eval('B.messages[1].content')==='Flour and water.', calls.length+' requests; '+JSON.stringify(w.eval('B.messages.map(m=>m.content)')));
}

console.log('\n=== 4. SAVE & RESEND WITH NEW WORDS SEARCHES FOR THE NEW WORDS ===');
{
  const SEARCH={on:true,provider:'tavily',key:'K',count:5,relay:'',always:true,images:true,auto:false,model:false};
  const service=(searched,bodies)=>w=>(url,o)=>{
    url=String(url);
    if(/tavily/.test(url)){ const q=JSON.parse(o.body).query; searched.push(q); return Promise.resolve({ok:true,status:200,json:async()=>({results:[{title:'Weather: '+q,url:'https://w.test/'+encodeURIComponent(q),content:'Sunny, for '+q}],images:['https://img.test/'+encodeURIComponent(q)+'.jpg']})}); }
    bodies.push(JSON.parse(o.body)); return Promise.resolve(stream([oa('ok')]));
  };
  const lastUser=b=>{const u=b.messages.filter(m=>m.role==='user').slice(-1)[0]; return u?u.content:'';};
  {
    const searched=[], bodies=[];
    const dom=await boot(base({search:SEARCH}),service(searched,bodies));
    const w=dom.window,d=w.document;
    w.eval('newConvo()'); await say(w,'weather in Paris today');
    w.eval('startEdit(current.messages[0].id)'); d.querySelector('.msg-edit').value='weather in Tokyo today'; d.querySelector('[data-savedit]').click(); await sleep(600);
    ck('the new words are searched for, as Send searches', searched.length===2 && searched[1]==='weather in Tokyo today', JSON.stringify(searched));
    const lu=bodies[1]?lastUser(bodies[1]):'';
    ck('the request carries the results for the new words, and none for the old', /for="weather in Tokyo today"/.test(lu) && !/Paris/.test(lu), JSON.stringify(lu.slice(0,160)));
    const m0=msgs(w)[0];
    ck('and the message keeps only those', !!m0.sources && m0.sources.length===1 && /Tokyo/.test(m0.sources[0].title) && JSON.stringify(m0.searchedFor)==='["weather in Tokyo today"]', JSON.stringify({sources:m0.sources,searchedFor:m0.searchedFor}));
    const imgs=w.eval('JSON.stringify(current.messages[0].images||null)');
    ck('and only the new pictures', /Tokyo/.test(imgs) && !/Paris/.test(imgs), imgs);
    w.eval('startEdit(current.messages[0].id)'); d.querySelector('[data-savedit]').click(); await sleep(600);
    ck('Save & resend with the same words searches nothing new and keeps its results', searched.length===2 && !!bodies[2] && /for="weather in Tokyo today"/.test(lastUser(bodies[2])), JSON.stringify(searched));
  }
  {
    // search switched off since: the old results go with the old words, nothing is searched
    const searched=[], bodies=[];
    const dom=await boot(base({search:SEARCH}),service(searched,bodies));
    const w=dom.window,d=w.document;
    w.eval('newConvo()'); await say(w,'weather in Paris today');
    d.querySelector('#tgSearch').click(); await sleep(50);
    w.eval('startEdit(current.messages[0].id)'); d.querySelector('.msg-edit').value='weather in Tokyo today'; d.querySelector('[data-savedit]').click(); await sleep(600);
    const lu=bodies[1]?lastUser(bodies[1]):'';
    ck('search switched off: new words drop the old results and nothing is searched', searched.length===1 && !/web_results/.test(lu) && !msgs(w)[0].sources, JSON.stringify(lu.slice(0,120)));
  }
  {
    // lookups that had run out for the old words do not hold the new ones back
    const searched=[], bodies=[];
    const dom=await boot(base({search:Object.assign({},SEARCH,{always:false})}),service(searched,bodies));
    const w=dom.window,d=w.document;
    w.eval('newConvo(); current.messages.push({id:"u0",role:"user",content:"who won the match",searchedFor:["who won the match","match result"],sources:[{title:"Old result",url:"https://old.test",snippet:"old"}],searchDone:true},{id:"a0",role:"assistant",content:"Team A.",variants:[{content:"Team A.",thinking:""}],vi:0}); renderThread();');
    w.eval('startEdit("u0")'); d.querySelector('.msg-edit').value='who scored the goals'; d.querySelector('[data-savedit]').click(); await sleep(600);
    const lu=bodies[0]?lastUser(bodies[0]):'';
    ck('reworded, a message whose lookups had run out goes without the old results or the "no further lookups" line', lu==='who scored the goals' && !msgs(w)[0].sources, JSON.stringify(lu.slice(0,200)));
  }
}

console.log('\n=== 5. HERMES RUNS ===');
{
  // a stand-in for Hermes' run endpoints; every run body is kept
  const hermes=(runs,events)=>w=>(url,o)=>{
    url=String(url); const body=o&&o.body?JSON.parse(o.body):null;
    if(/\/runs$/.test(url)){ runs.push(body); return Promise.resolve({ok:true,status:200,json:async()=>({run_id:'R'+runs.length})}); }
    if(/\/runs\/R\d+\/events$/.test(url)) return Promise.resolve(stream((events&&events())||['data: '+JSON.stringify({event:'message.delta',delta:'Run reply.'})+'\n\n','data: '+JSON.stringify({event:'run.completed',output:'Run reply.'})+'\n\n']));
    if(/\/chat\/completions$/.test(url)) return Promise.resolve(stream([oa('Plain reply.'),'data: [DONE]\n\n']));
    return Promise.resolve({ok:true,status:200,json:async()=>({})});
  };
  {
    const runs=[];
    const dom=await boot(base({activeProvider:'h'}),hermes(runs));
    const w=dom.window,d=w.document;
    w.eval('newConvo()');
    await say(w,'My name is Ana.');
    await say(w,'What is my name?');
    ck('a run that carries the history names its session', !!runs[1] && runs[1].conversation_history.length===2 && runs[1].session_id==='cozy-'+w.eval('current.id'), runs[1] && JSON.stringify({h:runs[1].conversation_history.length,s:runs[1].session_id}));
    ck('a run with no history before it names none, so Hermes cannot bring back what it stored', !!runs[0] && runs[0].conversation_history.length===0 && runs[0].session_id===undefined, runs[0] && JSON.stringify(runs[0]));
    d.querySelector('#clearBtn').click(); await sleep(300);
    await say(w,'Start over: who am I?');
    ck('after Clear, the first message names no session', !!runs[2] && runs[2].conversation_history.length===0 && runs[2].session_id===undefined, runs[2] && JSON.stringify({h:runs[2].conversation_history.length,s:runs[2].session_id}));
    d.querySelector('[data-regen]').click(); await sleep(500);
    ck('Swipe on the first reply names none either', !!runs[3] && runs[3].conversation_history.length===0 && runs[3].session_id===undefined, runs[3] && JSON.stringify({h:runs[3].conversation_history.length,s:runs[3].session_id}));
    w.eval('startEdit(current.messages[0].id)'); d.querySelector('.msg-edit').value='I am Bea.'; d.querySelector('[data-savedit]').click(); await sleep(500);
    ck('nor does editing the first message', !!runs[4] && runs[4].session_id===undefined && runs[4].input==='I am Bea.', runs[4] && JSON.stringify({input:runs[4].input,s:runs[4].session_id}));
  }
  {
    const runs=[];
    const dom=await boot(base({activeProvider:'hr'}),hermes(runs));
    const w=dom.window,d=w.document;
    w.eval('newConvo()');
    d.querySelector('#settingsBtn').click(); await sleep(100);
    const hi=d.querySelector('#effortSeg [data-effort="high"]'); if(hi) hi.click(); await sleep(100);
    d.querySelector('#closeSettings').click();
    await say(w,'hello');
    ck('the run carries the connection\'s model', !!runs[0] && runs[0].model==='my-route', runs[0] && JSON.stringify(runs[0].model));
    ck('and the thinking level, as the plain stream does', !!runs[0] && !!runs[0].model_options && JSON.stringify(runs[0].model_options.reasoning)==='{"enabled":true,"effort":"high"}', runs[0] && JSON.stringify(runs[0].model_options));
  }
  {
    // the answer arrives only at the end of the run (Hermes' recovery paths stream no delta)
    const runs=[];
    const dom=await boot(base({activeProvider:'h'}),hermes(runs,()=>['data: '+JSON.stringify({event:'run.completed',output:'The whole answer, at the end.'})+'\n\n']));
    const w=dom.window;
    w.eval('newConvo()'); await say(w,'hello');
    ck('an answer that only the end of the run carries is the reply', w.eval('current.messages[1].content')==='The whole answer, at the end.', JSON.stringify(w.eval('current.messages[1].content')));
  }
  {
    // the gateway restarts mid-run (hermesmodel does): run.interrupted
    const runs=[];
    const dom=await boot(base({activeProvider:'h'}),hermes(runs,()=>['data: '+JSON.stringify({event:'message.delta',delta:'Half an answer'})+'\n\n','data: '+JSON.stringify({event:'run.interrupted',error:'Gateway shutdown interrupted the run.'})+'\n\n']));
    const w=dom.window;
    w.eval('newConvo()'); await say(w,'hello');
    const m=msgs(w);
    ck('an interrupted run says so after what arrived', m.length===3 && m[1].content==='Half an answer' && m[2].role==='error' && /interrupted/.test(m[2].content), short(m));
  }
}

console.log('\n=== 6. A REFUSED PARAMETER COSTS A RETRY, NOT THE MESSAGE ===');
{
  {
    // gpt-4o refuses reasoning_effort itself
    const sent=[];
    const dom=await boot(base({activeProvider:'oa',effort:'high'}),w=>(u,o)=>{
      const b=JSON.parse(o.body); sent.push(b.reasoning_effort===undefined?'(none)':b.reasoning_effort);
      if(b.reasoning_effort!==undefined) return Promise.resolve(refusal(400,'Unrecognized request argument supplied: reasoning_effort'));
      return Promise.resolve(stream([oa('ok')]));
    });
    const w=dom.window; const t=toasts(w);
    w.eval('newConvo(); current.cfg.effort="high";'); await say(w,'hello',700);
    ck('a model that refuses the thinking parameter gets the message without it', JSON.stringify(sent)==='["high","(none)"]' && w.eval('current.messages[1].content')==='ok', JSON.stringify(sent)+' '+short(msgs(w)));
    ck('and Cozy says so', t.some(x=>/without/i.test(x) && /think/i.test(x)), JSON.stringify(t));
    ck('and leaves no "capped" mark on the connection', w.eval('S.providers.find(p=>p.id==="oa").effortCap')===undefined, JSON.stringify(w.eval('S.providers.find(p=>p.id==="oa").effortCap')));
  }
  {
    // a cap left by such a refusal before is dropped by the next one
    const st=base({activeProvider:'oa',effort:'high'}); st.providers.find(p=>p.id==='oa').effortCap='low';
    const dom=await boot(st,w=>(u,o)=>{ const b=JSON.parse(o.body);
      if(b.reasoning_effort!==undefined) return Promise.resolve(refusal(400,'Unrecognized request argument supplied: reasoning_effort'));
      return Promise.resolve(stream([oa('ok')])); });
    const w=dom.window;
    w.eval('newConvo(); current.cfg.effort="high";'); await say(w,'hello',700);
    ck('an old wrong cap goes', w.eval('S.providers.find(p=>p.id==="oa").effortCap')===undefined && w.eval('current.messages[1].content')==='ok', JSON.stringify(w.eval('S.providers.find(p=>p.id==="oa").effortCap')));
  }
  {
    // a level the model cannot think at still steps down, as before
    const sent=[];
    const dom=await boot(base({activeProvider:'oa',effort:'xhigh'}),w=>(u,o)=>{ const b=JSON.parse(o.body); sent.push(b.reasoning_effort||'(none)');
      if(b.reasoning_effort==='xhigh') return Promise.resolve(refusal(400,"Unsupported value: 'reasoning_effort' does not support 'xhigh' with this model. Supported values are: 'low', 'medium', and 'high'."));
      return Promise.resolve(stream([oa('ok')])); });
    const w=dom.window; const t=toasts(w);
    w.eval('newConvo(); current.cfg.effort="xhigh";'); await say(w,'hello',700);
    ck('a level too high still steps down one rung', JSON.stringify(sent)==='["xhigh","high"]' && t.some(x=>/XHigh/.test(x) && /High/.test(x)), JSON.stringify(sent)+' '+JSON.stringify(t));
  }
  {
    // OpenAI's reasoning models refuse max_tokens
    const sent=[];
    const st=base({activeProvider:'oa'}); st.providers.find(p=>p.id==='oa').model='gpt-5';
    const dom=await boot(st,w=>(u,o)=>{ const b=JSON.parse(o.body); sent.push('max_tokens' in b?'max_tokens':('max_completion_tokens' in b?'max_completion_tokens':'(none)'));
      if('max_tokens' in b) return Promise.resolve(refusal(400,"Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."));
      return Promise.resolve(stream([oa('ok')])); });
    const w=dom.window;
    w.eval('newConvo()'); await say(w,'hello',700);
    ck('a model that refuses max_tokens gets max_completion_tokens', JSON.stringify(sent)==='["max_tokens","max_completion_tokens"]' && w.eval('current.messages[1].content')==='ok', JSON.stringify(sent)+' '+short(msgs(w)));
    sent.length=0; await say(w,'again',700);
    ck('and the connection remembers it', JSON.stringify(sent)==='["max_completion_tokens"]', JSON.stringify(sent));
  }
  {
    // two things refused one after the other are both put right in the same message
    const sent=[];
    const st=base({activeProvider:'oa',effort:'xhigh'}); st.providers.find(p=>p.id==='oa').model='gpt-5';
    const dom=await boot(st,w=>(u,o)=>{ const b=JSON.parse(o.body); sent.push(('max_tokens' in b?'max_tokens':'max_completion_tokens')+'/'+(b.reasoning_effort||'(none)'));
      if(b.reasoning_effort==='xhigh') return Promise.resolve(refusal(400,"Unsupported value: 'reasoning_effort' does not support 'xhigh' with this model. Supported values are: 'low', 'medium', and 'high'."));
      if('max_tokens' in b) return Promise.resolve(refusal(400,"Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."));
      return Promise.resolve(stream([oa('ok')])); });
    const w=dom.window;
    w.eval('newConvo(); current.cfg.effort="xhigh";'); await say(w,'hello',800);
    ck('a level too high and then max_tokens: both put right, and the message goes', JSON.stringify(sent)==='["max_tokens/xhigh","max_tokens/high","max_completion_tokens/high"]' && w.eval('current.messages[1].content')==='ok', JSON.stringify(sent)+' '+short(msgs(w)));
  }
  {
    // Test in the connection editor
    const sent=[];
    const st=base({activeProvider:'oa'}); st.providers.find(p=>p.id==='oa').model='gpt-5';
    const dom=await boot(st,w=>(u,o)=>{ const b=JSON.parse(o.body); sent.push('max_tokens' in b?'max_tokens':('max_completion_tokens' in b?'max_completion_tokens':'(none)'));
      if('max_tokens' in b) return Promise.resolve(refusal(400,"Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."));
      return Promise.resolve({ok:true,status:200,json:async()=>({choices:[{message:{content:'hi'}}]})}); });
    const w=dom.window,d=w.document; const t=toasts(w);
    d.querySelector('#settingsBtn').click(); await sleep(100);
    w.eval('editProv("oa")'); await sleep(50);
    d.querySelector('#testProvBtn').click(); await sleep(500);
    ck('Test: max_tokens refused, max_completion_tokens works', JSON.stringify(sent)==='["max_tokens","max_completion_tokens"]' && t.some(x=>/Works/.test(x)), JSON.stringify(sent)+' '+JSON.stringify(t));
    d.querySelector('#cancelProvBtn').click(); d.querySelector('#closeSettings').click();
    sent.length=0; w.eval('newConvo()');
    // the same page: a message after the test
    w.fetch=(u,o)=>{ const b=JSON.parse(o.body); sent.push('max_tokens' in b?'max_tokens':('max_completion_tokens' in b?'max_completion_tokens':'(none)')); return Promise.resolve(stream([oa('ok')])); };
    await say(w,'hello',600);
    ck('and the connection it tested remembers it, so a message spends no refusal', JSON.stringify(sent)==='["max_completion_tokens"]', JSON.stringify(sent));
  }
  {
    // Test prefill
    const sent=[];
    const st=base({activeProvider:'oa',prefill:{on:true}}); st.providers.find(p=>p.id==='oa').model='gpt-5';
    const dom=await boot(st,w=>(u,o)=>{ const b=JSON.parse(o.body); sent.push('max_tokens' in b?'max_tokens':('max_completion_tokens' in b?'max_completion_tokens':'(none)'));
      if('max_tokens' in b) return Promise.resolve(refusal(400,"Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."));
      return Promise.resolve({ok:true,status:200,json:async()=>({choices:[{message:{content:'D E F'}}]})}); });
    const w=dom.window,d=w.document;
    w.eval('newConvo(); current.messages.push({id:"u0",role:"user",content:"hi"});');
    d.querySelector('#settingsBtn').click(); await sleep(100);
    d.querySelector('#pfTestBtn').click(); await sleep(600);
    const st2=d.querySelector('#pfTestStat');
    ck('Test prefill: max_tokens refused, the test goes through with max_completion_tokens', sent[0]==='max_tokens' && sent[1]==='max_completion_tokens' && /pf-ok/.test(st2.className), JSON.stringify(sent)+' '+JSON.stringify(st2.textContent.slice(0,90)));
  }
  {
    const dom=await boot(base({activeProvider:'oa'}));
    const w=dom.window,d=w.document;
    w.eval('newConvo()'); d.querySelector('#settingsBtn').click(); await sleep(100);
    ck('the OpenAI thinking hint no longer says a model that does not reason ignores it', !/Ignored by models that don.t reason/.test(d.querySelector('#effortHint').textContent), JSON.stringify(d.querySelector('#effortHint').textContent));
  }
}

console.log('\n=== 7. NOTHING ABOUT THINKING IS SENT UNTIL A LEVEL IS CHOSEN ===');
{
  const fresh=o=>{ const s=base(o); delete s.effort; return s; };
  const THINK=['reasoning','reasoning_effort','thinking','enable_thinking','model_options','output_config'];
  {
    const bodies=[];
    const dom=await boot(fresh(),w=>(u,o)=>{ bodies.push(JSON.parse(o.body)); return Promise.resolve(stream(/anthropic/.test(String(u))?anth('ok'):[oa('ok')])); });
    const w=dom.window,d=w.document;
    w.eval('newConvo()');
    for (const [name,pid] of [['OpenRouter','or'],['GLM','z'],['Qwen','q'],['OpenAI','oa'],['Claude','a'],['Hermes','hp']]){
      await switchTo(w,pid); bodies.length=0;
      await say(w,'hello '+pid,450);
      const b=bodies[0]||{};
      ck('a fresh install sends '+name+' nothing about thinking', !!bodies[0] && !THINK.some(k=>k in b), JSON.stringify(THINK.filter(k=>k in b).map(k=>k+'='+JSON.stringify(b[k]))));
    }
    d.querySelector('#settingsBtn').click(); await sleep(100);
    ck('and the picker does not claim a level is set', !d.querySelector('#effortSeg [data-effort].on'), (d.querySelector('#effortSeg [data-effort].on')||{}).textContent);
    ck('and says nothing is sent until one is chosen', /nothing about thinking is sent/.test(d.querySelector('#effortHint').textContent), JSON.stringify(d.querySelector('#effortHint').textContent));
  }
  {
    // Off, chosen, is an answer: where a service has an off-switch it is sent
    const bodies=[];
    const dom=await boot(fresh(),w=>(u,o)=>{ bodies.push(JSON.parse(o.body)); return Promise.resolve(stream([oa('ok')])); });
    const w=dom.window,d=w.document;
    w.eval('newConvo()');
    for (const [name,pid,key,val] of [['GLM','z','thinking','{"type":"disabled"}'],['OpenRouter','or','reasoning','{"enabled":false}'],['Qwen','q','enable_thinking','false']]){
      await switchTo(w,pid);
      d.querySelector('#settingsBtn').click(); await sleep(100);
      const off=d.querySelector('#effortSeg [data-effort="off"]'); if(off) off.click(); await sleep(50);
      d.querySelector('#closeSettings').click();
      bodies.length=0; await say(w,'hello',450);
      ck('Off, chosen, still switches '+name+'\'s thinking off', !!bodies[0] && JSON.stringify(bodies[0][key])===val, bodies[0] && JSON.stringify(bodies[0][key]));
    }
  }
  {
    // a stored "off" from before is left as it is - an explicit Off
    const bodies=[];
    const dom=await boot(base({activeProvider:'z',effort:'off'}),w=>(u,o)=>{ bodies.push(JSON.parse(o.body)); return Promise.resolve(stream([oa('ok')])); });
    const w=dom.window;
    w.eval('newConvo()'); await say(w,'hello');
    ck('a stored Off is still Off', !!bodies[0] && JSON.stringify(bodies[0].thinking)==='{"type":"disabled"}', bodies[0] && JSON.stringify(bodies[0].thinking));
  }
  {
    // Claude with nothing chosen: no thinking is on, so a prefill is not skipped for it
    const bodies=[];
    const dom=await boot(fresh({activeProvider:'a',prefill:{on:true}}),w=>(u,o)=>{ bodies.push(JSON.parse(o.body)); return Promise.resolve(stream(anth(' and so on.'))); });
    const w=dom.window;
    w.eval('newConvo()'); await say(w,'hello');
    const last=bodies[0] && bodies[0].messages.slice(-1)[0];
    ck('Claude with nothing chosen takes the prefill', !!last && last.role==='assistant', last && JSON.stringify(last).slice(0,90));
  }
}

console.log('\n=== 8. ONE SYSTEM MESSAGE WHEN SQUASH IS ON ===');
{
  const sysCount=b=>b.messages.filter(m=>m.role==='system').length;
  {
    const bodies=[];
    const set={id:'d',name:'D',system:'You are Kai.',injections:[],order:['__main__','__chat__'],remind:{mode:'main',depth:2}};
    const dom=await boot(base({presets:[set],squashSystem:true}),w=>(u,o)=>{ bodies.push(JSON.parse(o.body)); return Promise.resolve(stream([oa('ok')])); });
    const w=dom.window;
    w.eval('newConvo()'); await say(w,'hi');
    const b=bodies[0];
    ck('Never forget at its default depth does not repeat the main prompt next to itself', !!b && sysCount(b)===1 && (JSON.stringify(b.messages).match(/You are Kai\./g)||[]).length===1, b && JSON.stringify(b.messages.map(turn)));
    for (let i=0;i<3;i++){ await say(w,'more '+i); }
    const b2=bodies[bodies.length-1];
    ck('and in a longer chat it still rides near the newest message', !!b2 && (JSON.stringify(b2.messages).match(/You are Kai\./g)||[]).length===2, b2 && JSON.stringify(b2.messages.map(turn)));
  }
  for (const squash of [true,false]){
    const bodies=[];
    const set={id:'d',name:'D',system:'You are Kai.',injections:[{id:'j',name:'Far back',text:'Keep it short.',enabled:true,pos:'chat',role:'system',depth:4}],order:['__main__','j','__chat__']};
    const dom=await boot(base({presets:[set],squashSystem:squash}),w=>(u,o)=>{ bodies.push(JSON.parse(o.body)); return Promise.resolve(stream([oa('ok')])); });
    const w=dom.window;
    w.eval('newConvo(); current.cfg.squashSystem='+squash+';'); await say(w,'hi');
    const b=bodies[0];
    if (squash) ck('squash on: a system block that opens the chat joins the system prompt', !!b && sysCount(b)===1 && b.messages[0].content==='You are Kai.\n\nKeep it short.', b && JSON.stringify(b.messages.map(turn)));
    if (squash){
      const rec=await w.eval('Sent.load(current.id, current.messages[1].sent.id)');
      const part=rec && rec.parts.find(x=>x.name==='Far back');
      ck('and What the model saw says it went in the system prompt', !!part && part.where==='the system prompt', part && part.where);
    }
    else ck('squash off: it stays its own message', !!b && sysCount(b)===2, b && JSON.stringify(b.messages.map(turn)));
  }
  {
    // the meter counts the copy only when it rides
    const set=mode=>({id:'d',name:'D',system:'You are Kai, a careful assistant who answers in full sentences.',injections:[],order:['__main__','__chat__'],remind:{mode:mode,depth:2}});
    const meter=async(mode,count)=>{
      const dom=await boot(base({presets:[set(mode)],squashSystem:true})); const w=dom.window,d=w.document;
      w.eval('newConvo()');
      for (let i=0;i<count;i++) w.eval('current.messages.push({id:"m'+i+'",role:"'+(i%2?'assistant':'user')+'",content:"line '+i+'"})');
      w.eval('renderThread(); updateEmber()');
      return Number(d.querySelector('#ctxLabel').textContent.split('/')[0].replace(/\D/g,''));
    };
    const s1=[await meter('main',1), await meter('off',1)], s5=[await meter('main',5), await meter('off',5)];
    ck('the meter counts no copy in a chat too short for one, and counts it once the chat is long enough', s1[0]===s1[1] && s5[0]>s5[1], JSON.stringify({short:s1,long:s5}));
  }
}

console.log('\n=== 9. THE METER COUNTS WEB RESULTS ===');
{
  const dom=await boot(base());
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  const src=JSON.stringify(Array.from({length:5},(_,k)=>({title:'Result '+k,url:'https://r.test/'+k,snippet:'x'.repeat(600)})));
  for (let i=0;i<10;i++) w.eval('current.messages.push({id:"u'+i+'",role:"user",content:"question '+i+'",searchedFor:["question '+i+'"],sources:'+src+',images:[{url:"https://i.test/'+i+'.jpg",title:"pic"}]},{id:"a'+i+'",role:"assistant",content:"answer '+i+'"})');
  w.eval('renderThread(); updateEmber();');
  const meter=Number(d.querySelector('#ctxLabel').textContent.split(' / ')[0].replace(/[^0-9]/g,''));
  const wire=w.eval('(()=>{const b=buildPayload({},current).body; return Math.ceil(b.messages.map(m=>typeof m.content==="string"?m.content:"").join("").length/4);})()');
  ck('a chat of searched messages: the meter counts what goes out', meter>=wire*0.95 && meter<=wire*1.1, meter+' on the meter, about '+wire+' on the wire');
}
{
  // the lookup rules the system prompt carries while the model may search
  const meterWith=async search=>{ const dom=await boot(base({search:search})); const w=dom.window,d=w.document;
    w.eval('newConvo(); current.messages.push({id:"u0",role:"user",content:"hi"}); renderThread(); updateEmber();');
    return {n:Number(d.querySelector('#ctxLabel').textContent.split(' / ')[0].replace(/[^0-9]/g,'')), rules:w.eval('estTokens(searchProtocol())')}; };
  const on=await meterWith({on:true,provider:'tavily',key:'K',count:5,relay:'',always:false,images:true,auto:true,model:true});
  const off=await meterWith({on:false,provider:'tavily',key:'K',count:5,relay:'',always:false});
  ck('the meter counts the lookup rules that ride while the model may search', on.n-off.n===on.rules, (on.n-off.n)+' counted, '+on.rules+' sent');
}
{
  // Never forget "all" copies the blocks above the chat, never the ones below it
  const set=mode=>({id:'d',name:'D',system:'Main.',injections:[
      {id:'up',name:'Above',text:'A'.repeat(400),enabled:true,pos:'relative',role:'system'},
      {id:'down',name:'Below',text:'B'.repeat(800),enabled:true,pos:'relative',role:'system'}],
    order:['__main__','up','__chat__','down'],remind:{mode:mode,depth:0}});
  const meterWith=async mode=>{ const dom=await boot(base({presets:[set(mode)]})); const w=dom.window,d=w.document;
    w.eval('newConvo(); current.messages.push({id:"u0",role:"user",content:"hi"},{id:"a0",role:"assistant",content:"ok"}); renderThread(); updateEmber();');
    const n=Number(d.querySelector('#ctxLabel').textContent.split(' / ')[0].replace(/[^0-9]/g,''));
    return n; };
  const all=await meterWith('all'), off=await meterWith('off');
  ck('the meter counts the copy of the main prompt and the block above the chat, not the one below', all-off===Math.ceil('Main.'.length/4)+100, (all-off)+' counted, '+(Math.ceil('Main.'.length/4)+100)+' copied');
}

console.log('\n=== 10. SMALLER THINGS ===');
{
  {
    // More where the connection already refused a started reply
    let n=0;
    const st=base({activeProvider:'a'}); st.providers.find(p=>p.id==='a').prefillDownAt=Date.now();
    const dom=await boot(st,w=>()=>{ n++; return Promise.resolve(refusal(400,'This model does not support assistant message prefill. The conversation must end with a user message.')); });
    const w=dom.window,d=w.document; const t=toasts(w);
    w.eval('newConvo(); current.messages.push({id:"u0",role:"user",content:"hi"},{id:"a0",role:"assistant",content:"Hello there,",variants:[{content:"Hello there,",thinking:""}],vi:0}); renderThread();');
    const more=d.querySelector('[data-continue]');
    if (more){ more.click(); await sleep(400); }
    ck('More where the connection refuses a started reply spends no request', n===0, n+' requests');
    ck('and says why', t.some(x=>/refused a reply that had already started/.test(x)), JSON.stringify(t));
  }
  {
    const bodies=[];
    const dom=await boot(base({activeProvider:'a',search:{on:true,provider:'native',key:'',count:3,relay:'',always:false}}),w=>(u,o)=>{ bodies.push(JSON.parse(o.body)); return Promise.resolve(stream(anth('ok'))); });
    const w=dom.window;
    w.eval('newConvo()'); await say(w,'hello');
    const tool=bodies[0] && bodies[0].tools && bodies[0].tools[0];
    ck("Claude's own search tool is not sent the results-per-search number as a limit on searches", !!tool && tool.type==='web_search_20250305' && !('max_uses' in tool), tool && JSON.stringify(tool));
  }
  {
    const st=base(); st.providers.find(p=>p.id==='o').apiKey='';
    const dom=await boot(st,w=>()=>Promise.resolve(stream([oa('x')])));
    const w=dom.window; const t=toasts(w);
    w.eval('newConvo()'); await say(w,'hello',300);
    ck('a connection with no key says it needs one, by name', t.some(x=>/key/i.test(x) && /\bO\b/.test(x)) && !t.some(x=>/Add a connection first/.test(x)), JSON.stringify(t));
    const d=w.document;
    ck('and opens that connection at its key', !d.querySelector('#provEditor').hidden && d.querySelector('#pName').value==='O', d.querySelector('#pName').value);
    d.querySelector('#cancelProvBtn').click();
    d.querySelector('#pfTestBtn').click(); await sleep(200);
    ck('Test prefill says the same, by name', /\u201cO\u201d needs an API key/.test(d.querySelector('#pfTestStat').textContent), JSON.stringify(d.querySelector('#pfTestStat').textContent));
  }
  {
    // a chat deleted while its reply is arriving keeps no "What the model saw" record
    let h=null;
    const dom=await boot(base(),w=>(u,o)=>{ h=held([oa('Half a reply')],o.signal); return Promise.resolve(h.res); });
    const w=dom.window,d=w.document;
    w.eval('window.__kept=[]; const k=Sent.keep; Sent.keep=function(c){ window.__kept.push(c); return k.apply(this, arguments); };');
    w.eval('newConvo(); current.title="Doomed"; renderSidebar();');
    const id=w.eval('current.id');
    await say(w,'hello',300);
    const del=Array.from(d.querySelectorAll('[data-del]')).find(e=>e.getAttribute('data-del')===id);
    if (del){ del.click(); await sleep(500); }
    ck('setup: the chat is gone', !w.eval('convos.some(c=>c.id==="'+id+'")'));
    ck('and no record of what was sent is kept for it', w.eval('window.__kept.indexOf("'+id+'")')<0, JSON.stringify(w.eval('window.__kept')));
  }
}

console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})();
