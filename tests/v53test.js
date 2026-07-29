// TEST FILE — run with: node tests/v53test.js
// Guards v5.3.0: SSE frames are read whole (event name + joined data lines),
// Hermes tool-progress events become a live activity log that survives on the
// message and its variants, a stopped stream marks unfinished tools honestly,
// mid-stream error objects surface instead of truncating silently, a failed
// native web search no longer destroys the reply, the Hermes reasoning shape
// goes out as model_options, and the opt-in session headers are stable, sent
// only when asked for, and only on Hermes connections.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=(o={})=>Object.assign({
  providers:[{id:'p1',preset:'hermes',kind:'openai',name:'Hermes Agent',url:'http://127.0.0.1:8642/v1',apiKey:'k',model:'hermes-agent',ctx:200000}],
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
function gated(w,chunks){
  const enc=t=>new TextEncoder().encode(t);
  let i=0;
  w.__step=null;
  const next=()=>new Promise(res=>{w.__step=()=>{w.__step=null;res();};});
  return (url,opts)=>{
    w.__req={url:url,headers:(opts&&opts.headers)||{},body:opts&&opts.body?JSON.parse(opts.body):null};
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
const tp=(o)=>'event: hermes.tool.progress\ndata: '+JSON.stringify(o)+'\n\n';
async function drain(w,n){for(let k=0;k<n;k++){await sleep(60);w.__step&&w.__step();}await sleep(300);}

(async()=>{

console.log('=== 1. HERMES TOOL ACTIVITY, SEEN LIVE AND KEPT ===');
{
  const dom=await boot(base(),w=>gated(w,[
    tp({tool:'web_search',emoji:'\u{1F50D}',label:'web_search: bali tides',toolCallId:'c1',status:'running'}),
    oa('Looking that up. '),
    tp({tool:'web_search',toolCallId:'c1',status:'completed'}),
    // one JSON payload split across two data lines — the spec joins them
    'data: {"choices":[{"delta":\ndata: {"content":"Low tide at nine."}}]}\n\n'
  ]));
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  d.querySelector('#input').value='tides?'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await sleep(80); w.__step(); await sleep(120);          // running event arrives
  const live=d.querySelector('.tool-log .tool-row');
  ck('running tool appears while streaming', !!live && live.className.indexOf('running')>=0,
     live?live.className:'no row');
  const det=d.querySelector('details.tool-log');
  ck('the log arrives folded, not sprawled', !!det && !det.open);
  ck('the summary line itself carries the live call', (function(){
    const sm=det.querySelector('.tl-sum');
    return sm && sm.className.indexOf('running')>=0 && sm.textContent.indexOf('web_search: bali tides')>=0;
  })());
  // the reader opens it; the next tool event must not slam it shut
  det.open=true;
  await drain(w,4);
  const m=w.eval('current.messages[1]');
  ck('reply text assembled, split frame included', m.content==='Looking that up. Low tide at nine.',
     JSON.stringify(m.content));
  ck('tool kept on the message', m.tools&&m.tools.length===1&&m.tools[0].id==='c1', JSON.stringify(m.tools));
  ck('completed event settled it', m.tools[0].status==='done', m.tools[0].status);
  ck('label carried through', m.tools[0].label==='web_search: bali tides', m.tools[0].label);
  const row=d.querySelector('.tool-log .tl-body .tool-row');
  ck('settled row rendered as done', !!row && row.className.indexOf('done')>=0, row?row.className:'no row');
  ck('the drawer the reader opened stayed open through repaints', d.querySelector('details.tool-log').open===true);
  ck('a settled summary counts instead of listing', (function(){
    const html2=w.eval('msgHtml({id:"mx",role:"assistant",content:"x",tools:[{id:"1",tool:"a",label:"a",status:"done"},{id:"2",tool:"b",label:"b",status:"done"}]},true)');
    return html2.indexOf('2 tool calls')>=0 && html2.indexOf('<details class="tool-log">')>=0;
  })());
  ck('the version snapshot carries it too', (function(){const v=m.variants[m.vi];return v&&v.tools&&v.tools[0]&&v.tools[0].status==='done';})(),
     JSON.stringify(m.variants[m.vi]&&m.variants[m.vi].tools));
}

console.log('=== 2. STOPPING MID-TOOL SAYS SO ===');
{
  const dom=await boot(base(),w=>gated(w,[
    tp({tool:'terminal',emoji:'\u2699',label:'terminal: npm test',toolCallId:'t1',status:'running'}),
    oa('Running the tests. '),
    oa('never delivered — the stop lands while this one is still pending')
  ]));
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  d.querySelector('#input').value='run tests'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await sleep(80); w.__step(); await sleep(80); w.__step(); await sleep(120);
  ev(w,d.querySelector('#sendBtn'),'click');              // stop
  await sleep(300);
  const m=w.eval('current.messages[1]');
  ck('partial text kept', /Running the tests/.test(m.content||''), JSON.stringify(m.content));
  ck('unfinished tool marked stopped, not left spinning', m.tools&&m.tools[0].status==='stopped',
     JSON.stringify(m.tools));
}

console.log('=== 3. A MID-STREAM ERROR OBJECT IS AN ERROR, NOT A SHORT REPLY ===');
{
  const dom=await boot(base(),w=>gated(w,[
    oa('Starting. '),
    'data: {"error":{"message":"upstream fell over"}}\n\n'
  ]));
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  d.querySelector('#input').value='go'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await drain(w,3);
  const msgs=w.eval('current.messages');
  const last=msgs[msgs.length-1];
  ck('the failure is shown as an error', last.role==='error', last.role);
  ck('with the service\'s own words', /upstream fell over/.test(last.content), JSON.stringify(last.content));
  ck('no half reply left pretending to be complete', !msgs.some(m=>m.role==='assistant'),
     msgs.map(m=>m.role).join(','));
}

console.log('=== 4. A FAILED NATIVE SEARCH NO LONGER SINKS THE REPLY ===');
{
  const st=base({providers:[{id:'a1',preset:'anthropic',kind:'anthropic',name:'Claude',url:'https://api.anthropic.com/v1',apiKey:'k',model:'claude-sonnet-4-6',ctx:200000}],activeProvider:'a1'});
  const dom=await boot(st,w=>gated(w,[
    'data: {"type":"content_block_start","content_block":{"type":"web_search_tool_result","content":{"type":"web_search_tool_result_error","error_code":"max_uses_exceeded"}}}\n\n',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"All fine regardless."}}\n\n'
  ]));
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  d.querySelector('#input').value='hi'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await drain(w,3);
  const msgs=w.eval('current.messages');
  ck('reply text survives the error result', msgs[1]&&msgs[1].role==='assistant'&&msgs[1].content==='All fine regardless.',
     JSON.stringify(msgs[1]&&msgs[1].content));
  ck('no error row appeared', !msgs.some(m=>m.role==='error'), msgs.map(m=>m.role).join(','));
}

console.log('=== 5. THE HERMES REQUEST SHAPE ===');
{
  const dom=await boot(base(),w=>gated(w,[oa('ok')]));
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  ck('the preset resolves to the hermes style', w.eval('reasonStyle(activeProv())')==='hermes',
     w.eval('reasonStyle(activeProv())'));
  ck('a bare hermes-agent model on a custom endpoint does too',
     w.eval('reasonStyle({preset:"custom",kind:"openai",model:"hermes-agent"})')==='hermes');
  ck('an explicit override wins as everywhere else',
     w.eval('reasonStyle({preset:"custom",kind:"openai",model:"x",reason:"hermes"})')==='hermes');
  const hi=w.eval('(function(){const b={};current.cfg.effort="high";applyReasoning(b,activeProv(),current);return JSON.stringify(b.model_options);})()');
  ck('effort goes out as a reasoning object', hi==='{"reasoning":{"enabled":true,"effort":"high"}}', hi);
  const off=w.eval('(function(){const b={};current.cfg.effort="off";applyReasoning(b,activeProv(),current);return JSON.stringify(b.model_options);})()');
  ck('off sends nothing — the agent decides', off===undefined||off==='undefined', String(off));

  // headers are opt-in, per connection
  d.querySelector('#input').value='hello'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await drain(w,2);
  const h1=w.eval('JSON.stringify(__req.headers)');
  ck('by default no session headers go out', h1.indexOf('X-Hermes')<0, h1);
  w.eval('S.providers[0].hermesHeaders=true;saveSettings()');
  d.querySelector('#input').value='again'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await drain(w,2);
  const h2=w.eval('__req.headers');
  ck('opting in sends the session id, scoped to this chat',
     h2['X-Hermes-Session-Id']===('cozy-'+w.eval('current.id')), h2['X-Hermes-Session-Id']);
  ck('and a memory key', /^cozy-/.test(h2['X-Hermes-Session-Key']||''), h2['X-Hermes-Session-Key']);
  const key1=h2['X-Hermes-Session-Key'];
  d.querySelector('#input').value='third'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await drain(w,2);
  ck('the key is stable across requests', w.eval('__req.headers')['X-Hermes-Session-Key']===key1);
  ck('and persisted for next boot', w.eval('JSON.parse(localStorage.getItem("cozychat:settings")).hermesKey')===key1);
  // a non-hermes connection never sends them, even with the flag set
  w.eval('S.providers.push({id:"p2",preset:"openai",kind:"openai",name:"OpenAI",url:"https://api.openai.com/v1",apiKey:"k",model:"gpt-4o",ctx:128000,hermesHeaders:true});saveSettings();cfgSet("providerId","p2");cfgSet("model",null)');
  d.querySelector('#input').value='plain'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await drain(w,2);
  const h3=w.eval('JSON.stringify(__req.headers)');
  ck('other services never see hermes headers', h3.indexOf('X-Hermes')<0, h3);
}

console.log('=== 6. THE EDITOR ROUND-TRIPS THE OPT-IN ===');
{
  const dom=await boot(base(),w=>gated(w,[oa('ok')]));
  const w=dom.window,d=w.document;
  w.eval('editProv("p1")');
  ck('editor shows the header choice off', d.querySelector('#pHdrs').value==='', d.querySelector('#pHdrs').value);
  d.querySelector('#pHdrs').value='on';
  w.eval('saveProv()');
  ck('saving keeps it', w.eval('S.providers[0].hermesHeaders')===true);
  w.eval('editProv("p1")');
  ck('reopening shows it on', d.querySelector('#pHdrs').value==='on');
  w.eval('editProv(null)');
  ck('a new connection starts with it off', d.querySelector('#pHdrs').value==='');
  const html2=w.eval('msgHtml({id:"m1",role:"assistant",content:"x",tools:[{id:"1",emoji:"\u{1F50D}",label:"web_search: q",status:"running"}]},true)');
  ck('a rebuilt message renders its activity log', html2.indexOf('tool-log')>=0 && html2.indexOf('tool-row running')>=0);
  ck('the hermes preset is offered', w.eval('typeof PRESETS.hermes')==='object' && w.eval('PRESETS.hermes.url')==='http://127.0.0.1:8642/v1',
     w.eval('PRESETS.hermes.url'));
}

console.log('');
console.log(fail?('FAILED '+fail):'ALL PASS','('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})();
