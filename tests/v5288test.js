// TEST FILE — run with: node tests/v5288test.js
// Guards v5.28.8's picture rules that need no decoding (the decoding itself is
// measured in real Chromium by tests/pictures_e2e.py): which pictures ride a
// request, the size rules, the note left for one that does not, and no web
// search for a picture sent without words. Everything through buildPayload()
// and send(), the live path.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const st={providers:[{id:'o',preset:'custom',kind:'openai',name:'O',url:'https://o.test/v1',apiKey:'k',model:'m',ctx:200000},
                     {id:'a',preset:'anthropic',kind:'anthropic',name:'C',url:'https://api.anthropic.com/v1',apiKey:'k',model:'claude-sonnet-4-6',ctx:200000}],
  activeProvider:'o',presets:[{id:'d',name:'D',system:'',injections:[],order:['__main__','__chat__']}],activePreset:'d',prompts:[],
  maxTokens:1024,effort:'off',showThinking:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:true,provider:'tavily',key:'K',count:5,relay:'',always:true}};
const calls=[];
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',beforeParse(w){
  w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;w.navigator.storage={estimate:async()=>({usage:0})};
  w.requestAnimationFrame=cb=>setTimeout(cb,0);w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
  w.fetch=(url)=>{ calls.push(String(url)); return Promise.resolve({ok:true,status:200,json:async()=>({results:[]}),
    body:{getReader(){let d=false;return{read(){if(d)return Promise.resolve({done:true});d=true;
      return Promise.resolve({done:false,value:new TextEncoder().encode('data: {"choices":[{"delta":{"content":"I see it."}}]}\n\ndata: [DONE]\n\n')});}};}}}); };
}});
const pic=(name,chars)=>({kind:'image',name,mime:'image/jpeg',data:'A'.repeat(chars)});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
setTimeout(async()=>{
  const w=dom.window,d=w.document;
  const wire=()=>w.eval('buildPayload({},current)').body.messages.filter(m=>m.role==='user');
  const picsIn=m=>Array.isArray(m.content)?m.content.filter(p=>p.type==='image_url'||p.type==='image').length:0;
  const textOf=m=>Array.isArray(m.content)?m.content.filter(p=>p.type==='text').map(p=>p.text).join(''):m.content;

  console.log('=== 1. WHICH PICTURES RIDE A REQUEST ===');
  // eight 1 MB pictures in eight messages, then a question
  w.eval('newConvo()');
  for(let i=0;i<8;i++) w.eval('(a)=>{current.messages.push({id:"u'+i+'",role:"user",content:"photo '+i+'",attachments:[a]},{id:"a'+i+'",role:"assistant",content:"ok"});}')(pic('p'+i+'.jpg',1000000));
  w.eval('current.messages.push({id:"q",role:"user",content:"which was best?"})');
  let us=wire();
  const sentN=us.reduce((n,m)=>n+picsIn(m),0);
  ck('six fit the budget, newest first', sentN===6, sentN);
  ck('the two oldest are named instead, in their own messages',
     /\("p0\.jpg"\) was attached here; it is not sent again/.test(textOf(us[0])) && /\("p1\.jpg"\)/.test(textOf(us[1])) && picsIn(us[0])===0 && picsIn(us[1])===0,
     JSON.stringify([textOf(us[0]).slice(0,80),textOf(us[1]).slice(0,80)]));
  ck('their words stay after the note', /photo 0$/.test(textOf(us[0])), JSON.stringify(textOf(us[0])));
  ck('the newest ones go as pictures', picsIn(us[7])===1 && picsIn(us[2])===1);
  // the newest message's pictures always go, even past the budget
  w.eval('(a,b,c)=>{current.messages.push({id:"a8",role:"assistant",content:"ok"},{id:"u9",role:"user",content:"three more",attachments:[a,b,c]});}')(pic('n1.jpg',2500000),pic('n2.jpg',2500000),pic('n3.jpg',2500000));
  us=wire();
  ck('a message\u2019s own new pictures always go, all of them', picsIn(us[us.length-1])===3, picsIn(us[us.length-1]));
  ck('and the older ones make room for them', us.slice(0,-1).reduce((n,m)=>n+picsIn(m),0)===0, us.slice(0,-1).reduce((n,m)=>n+picsIn(m),0));
  // a picture past 5 MB never goes (Claude takes no more), even alone
  w.eval('newConvo()');
  w.eval('(a)=>{current.messages.push({id:"u0",role:"user",content:"old huge one",attachments:[a]},{id:"a0",role:"assistant",content:"ok"},{id:"q",role:"user",content:"and now?"});}')(pic('huge.jpg',5200000));
  us=wire();
  ck('an old picture past 5 MB is named, not sent', picsIn(us[0])===0 && /huge\.jpg/.test(textOf(us[0])), JSON.stringify(textOf(us[0]).slice(0,90)));

  console.log('\n=== 2. A PICTURE ON ITS OWN ===');
  for (const pid of ['o','a']){
    w.eval('newConvo(); current.cfg.providerId="'+pid+'"');
    w.eval('(a)=>{current.messages.push({id:"u0",role:"user",content:"",attachments:[a]});}')(pic('only.jpg',1200));
    const last=w.eval('buildPayload({},current)').body.messages.slice(-1)[0];
    ck(pid+': the picture is the whole message, with no whitespace text beside it',
       Array.isArray(last.content) && last.content.length===1 && /image/.test(last.content[0].type), JSON.stringify(last.content.map(p=>p.type)));
  }

  console.log('\n=== 3. NO WEB SEARCH FOR A PICTURE SENT WITHOUT WORDS ===');
  w.eval('newConvo(); current.cfg.providerId="o"');
  w.eval('(a)=>{pendingAtts=[a]; renderAttachTray();}')(pic('cat.jpg',1200));
  ck('Send is ready with a picture and no words', d.querySelector('#sendBtn').disabled===false);
  calls.length=0;
  d.querySelector('#sendBtn').click(); await sleep(400);
  ck('"search every message" does not search for nothing', !calls.some(u=>/tavily/.test(u)), JSON.stringify(calls));
  ck('the picture went to the model', calls.some(u=>/chat\/completions/.test(u)) && w.eval('current.messages[0].attachments.length')===1);
  ck('the tray is empty and Send greyed out again', w.eval('pendingAtts.length')===0 && d.querySelector('#sendBtn').disabled===true);
  calls.length=0;
  d.querySelector('#input').value='what is new in Bali'; d.querySelector('#input').dispatchEvent(new w.Event('input',{bubbles:true}));
  d.querySelector('#sendBtn').click(); await sleep(400);
  ck('words still search when it is set to search every message', calls.some(u=>/tavily/.test(u)), JSON.stringify(calls));

  console.log('\n=== 4. HERMES ASKS FOR APPROVAL ON THE PLAIN STREAM ===');
  // a chat that holds a picture goes over the plain stream (the Runs API
  // cannot carry pictures); Hermes still asks there, naming the completion
  // as the run to answer
  let release=null; const posts=[];
  w.eval("S.providers.push({id:'h',preset:'hermes',kind:'openai',name:'Hermes Agent',url:'http://127.0.0.1:8642/v1',apiKey:'hk',model:'hermes-agent',ctx:200000,hermesRuns:true})");
  w.fetch=(url,opts)=>{
    url=String(url);
    if(/\/runs\/chatcmpl-7\/approval$/.test(url)){ posts.push({url,auth:opts.headers.authorization,body:JSON.parse(opts.body)}); if(release) release(); return Promise.resolve({ok:true,status:200,json:async()=>({ok:true})}); }
    if(/\/runs$/.test(url)){ posts.push({url,runs:true}); return Promise.reject(new TypeError('Failed to fetch')); }
    let step=0;
    return Promise.resolve({ok:true,status:200,body:{getReader(){return{read(){
      step++;
      if(step===1) return Promise.resolve({done:false,value:new TextEncoder().encode('event: approval.request\ndata: {"event":"approval.request","run_id":"chatcmpl-7","command":"rm -rf build","choices":["once","session","always","deny"]}\n\n')});
      if(step===2) return new Promise(r=>{ release=()=>r({done:false,value:new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Removed it."}}]}\n\ndata: [DONE]\n\n')}); });
      return Promise.resolve({done:true});
    }};}}});
  };
  w.eval('newConvo(); current.cfg.providerId="h"; S.search.on=false;');
  w.eval('(a)=>{current.messages.push({id:"u0",role:"user",content:"look",attachments:[a]},{id:"a0",role:"assistant",content:"a cat"});}')(pic('cat.jpg',1200));
  d.querySelector('#input').value='clean the build folder'; d.querySelector('#input').dispatchEvent(new w.Event('input',{bubbles:true}));
  d.querySelector('#sendBtn').click(); await sleep(400);
  ck('the message went over the plain stream (a picture is in the chat)', !posts.some(x=>x.runs));
  const btn=d.querySelector('[data-approve$="|once"]');
  ck('the approval card is on screen while the agent waits', !!btn && /rm -rf build/.test(d.querySelector('.msg.assistant:last-of-type').textContent));
  if(btn){ btn.click(); await sleep(400); }
  ck('Allow once goes to the run Hermes named, with the key', posts.length===1 && posts[0].url==='http://127.0.0.1:8642/v1/runs/chatcmpl-7/approval' && posts[0].auth==='Bearer hk' && posts[0].body.choice==='once',
     JSON.stringify(posts));
  ck('and the agent carries on to its answer', w.eval('current.messages.slice(-1)[0].content')==='Removed it.', JSON.stringify(w.eval('current.messages.slice(-1)[0].content')));
  ck('the card records the answer', w.eval('current.messages.slice(-1)[0].approvals[0].status')==='once');

  console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
  process.exit(fail?1:0);
},800);
