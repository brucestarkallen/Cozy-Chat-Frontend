const fs=require('fs');
const {JSDOM}=require('jsdom');
require('fake-indexeddb/auto');
const html=fs.readFileSync('./out/index.html','utf8');

function sse(chunks){let i=0;return{getReader(){return{read(){
  if(i>=chunks.length)return Promise.resolve({done:true});
  return Promise.resolve({done:false,value:new TextEncoder().encode(chunks[i++])});}};}};}

let pass=0,fail=0;
const ck=(n,ok,extra)=>{console.log((ok?'  ok  ':'  FAIL'),n,extra||'');ok?pass++:fail++;};

async function boot(settings,fetchImpl){
  return new Promise(res=>{
    const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
      beforeParse(w){
        w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
        w.navigator.storage={estimate:async()=>({usage:0})};
        w.requestAnimationFrame=cb=>setTimeout(cb,0);
        w.confirm=()=>true;
        w.navigator.clipboard={writeText:async()=>{}};
        w.localStorage.setItem('cozychat:settings',JSON.stringify(settings));
        if(fetchImpl)w.fetch=fetchImpl;
      }});
    setTimeout(()=>{
      try{ dom.window.eval('convos=[];current=null;renderSidebar();renderThread();'); }catch(_){}
      res(dom);
    },700);
  });
}
const baseSettings=(o={})=>Object.assign({
  providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://api.t/v1',apiKey:'k',model:'m',ctx:100000}],
  activeProvider:'p1',system:'',injections:[],temperature:1,maxTokens:100,
  showThinking:true,catchThinkTags:true,thinkTags:'think, thinking, reasoning, thought',
  enterSends:false,autoTitle:true,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}},o);

(async()=>{
console.log('\n=== 1. REASONING TAG EXTRACTION (the reported bug) ===');
{
  const dom=await boot(baseSettings());
  const w=dom.window;
  const sr=w.eval('splitReasoning');
  const cases=[
    ['closing tag only, no opener (the reported case)',
      'Honorable mentions to Asguiaro Ebern.\nthat said I KNOW you have opinions so fight me</think>Okay. Okay. You just cracked open the Bleach vault.',
      'Okay. Okay. You just cracked open the Bleach vault.'],
    ['normal open+close','<think>reasoning here</think>The answer is 4.','The answer is 4.'],
    ['still streaming, open only','<think>reasoning so far','' ],
    ['no tags at all','Just a plain reply.','Just a plain reply.'],
    ['<thinking> variant','<thinking>hmm</thinking>Result','Result'],
    ['text before opener','Preamble. <think>r</think>After','Preamble. After'],
  ];
  for(const [n,inp,expText] of cases){
    const r=sr(inp);
    ck(n, r.text===expText, '→ '+JSON.stringify(r.text.slice(0,50)));
  }
  const r2=sr('<think>abc</think>xyz');
  ck('thinking captured', r2.think==='abc');
  const tp=w.eval('trimPartialTag');
  ck('partial tag hidden mid-stream', tp('hello </thin')==='hello ', '→ '+JSON.stringify(tp('hello </thin')));
  ck('real text untouched', tp('hello world')==='hello world');
  // window left open; closing mid-async trips jsdom
}

console.log('\n=== 2. STREAMING WITH INLINE THINK TAGS ===');
{
  const chunks=[
    'data: {"choices":[{"delta":{"content":"<think>let me "}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"work it out"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"</think>Here is the answer."}}]}\n\n'
  ];
  const dom=await boot(baseSettings(),()=>Promise.resolve({ok:true,body:sse(chunks)}));
  const d=dom.window.document;
  d.querySelector('#input').value='q';
  d.querySelector('#input').dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  d.querySelector('#sendBtn').dispatchEvent(new dom.window.Event('click',{bubbles:true}));
  await new Promise(r=>setTimeout(r,900));
  const bodyTxt=d.querySelectorAll('.msg.assistant .msg-body')[d.querySelectorAll('.msg.assistant .msg-body').length-1].textContent;
  const thinkTxt=(d.querySelectorAll('.msg.assistant .think-body')[0]||{}).textContent||'';
  ck('reply body has no leaked tag', !bodyTxt.includes('think'), '→ '+JSON.stringify(bodyTxt));
  ck('reasoning moved to think block', thinkTxt.includes('work it out'), '→ '+JSON.stringify(thinkTxt));
  // window left open; closing mid-async trips jsdom
}

console.log('\n=== 3. DEPTH INJECTION ASSEMBLY ===');
{
  const injs=[
    {id:'a',name:'top',text:'TOPSYS',role:'system',pos:'top',depth:0,enabled:true},
    {id:'b',name:'d0',text:'DEPTH0',role:'system',pos:'depth',depth:0,enabled:true},
    {id:'c',name:'d2',text:'DEPTH2',role:'user',pos:'depth',depth:2,enabled:true},
    {id:'d',name:'off',text:'DISABLED',role:'system',pos:'depth',depth:1,enabled:false}
  ];
  const dom=await boot(baseSettings({system:'MAIN',injections:injs}));
  const w=dom.window;
  w.eval(`current={id:'c',title:'t',messages:[
    {id:'1',role:'user',content:'U1'},{id:'2',role:'assistant',content:'A1'},
    {id:'3',role:'user',content:'U2'},{id:'4',role:'assistant',content:'A2'}]};`);
  const asm=w.eval('assembleMessages("openai")');
  const flat=asm.messages.map(m=>m.role[0]+':'+m.content).join(' | ');
  ck('main system + top injection merged', asm.system==='MAIN\n\nTOPSYS', '→ '+JSON.stringify(asm.system));
  ck('disabled injection excluded', !flat.includes('DISABLED'));
  ck('depth 0 lands at the very end', flat.endsWith('DEPTH0'), '→ '+flat);
  ck('depth 2 lands 2 messages up', flat.indexOf('DEPTH2')<flat.indexOf('U2'), '→ '+flat);

  // anthropic: system-role depth injections become user turns, neighbours merge
  const asmA=w.eval('assembleMessages("anthropic")');
  ck('anthropic has no system role in messages', !asmA.messages.some(m=>m.role==='system'));
  let alt=true;
  for(let i=1;i<asmA.messages.length;i++) if(asmA.messages[i].role===asmA.messages[i-1].role) alt=false;
  ck('anthropic roles never repeat back to back', alt, '→ '+asmA.messages.map(m=>m.role).join(','));
  // window left open; closing mid-async trips jsdom
}

console.log('\n=== 4. SWIPES / VARIANTS ===');
{
  let n=0;
  const f=()=>{n++;return Promise.resolve({ok:true,body:sse(['data: {"choices":[{"delta":{"content":"reply '+n+'"}}]}\n\n'])});};
  const dom=await boot(baseSettings(),f);
  const d=dom.window.document,w=dom.window;
  d.querySelector('#input').value='q';
  d.querySelector('#input').dispatchEvent(new w.Event('input',{bubbles:true}));
  d.querySelector('#sendBtn').dispatchEvent(new w.Event('click',{bubbles:true}));
  await new Promise(r=>setTimeout(r,800));
  ck('first reply rendered', d.querySelectorAll('.msg.assistant .msg-body')[d.querySelectorAll('.msg.assistant .msg-body').length-1].textContent.includes('reply 1'));
  const swipeBtn=d.querySelector('[data-regen]');
  ck('last assistant shows Swipe not Retry', swipeBtn.textContent==='Swipe');
  swipeBtn.dispatchEvent(new w.Event('click',{bubbles:true}));
  await new Promise(r=>setTimeout(r,1100));
  const cnt=d.querySelector('.swipe .count');
  ck('variant counter appears', !!cnt, '→ '+(cnt?cnt.textContent:'none'));
  ck('now showing 2 of 2', cnt && cnt.textContent==='2/2');
  const back=d.querySelector('[data-swipe][data-dir="-1"]');
  ck('back arrow present', !!back);
  if(back) back.dispatchEvent(new w.Event('click',{bubbles:true}));
  await new Promise(r=>setTimeout(r,300));
  ck('swiping back restores first reply', d.querySelectorAll('.msg.assistant .msg-body')[d.querySelectorAll('.msg.assistant .msg-body').length-1].textContent.includes('reply 1'),
     '→ '+d.querySelectorAll('.msg.assistant .msg-body')[d.querySelectorAll('.msg.assistant .msg-body').length-1].textContent.trim());
  // window left open; closing mid-async trips jsdom
}

console.log('\n=== 5. THEMES ===');
{
  const dom=await boot(baseSettings());
  const d=dom.window.document,w=dom.window;
  d.querySelector('#settingsBtn').dispatchEvent(new w.Event('click',{bubbles:true}));
  const cards=d.querySelectorAll('[data-theme-pick]');
  ck('six themes offered', cards.length===6, '→ '+cards.length);
  const names=Array.from(cards).map(c=>c.dataset.themePick);
  ck('cyber + normandy present', names.includes('cyber')&&names.includes('normandy'), '→ '+names.join(','));
  d.querySelector('[data-theme-pick="normandy"]').dispatchEvent(new w.Event('click',{bubbles:true}));
  ck('theme applies to root', d.documentElement.getAttribute('data-theme')==='normandy');
  ck('theme-color meta follows', d.querySelector('meta[name=theme-color]').content==='#050c13',
     '→ '+d.querySelector('meta[name=theme-color]').content);
  // window left open; closing mid-async trips jsdom
}

console.log('\n=== 6. WEB SEARCH ===');
{
  let searchCall=null,chatCall=null;
  const f=(url,opts)=>{
    if(String(url).includes('tavily')){searchCall={url,opts};
      return Promise.resolve({ok:true,json:async()=>({results:[{title:'T1',url:'https://a.com',content:'snippet text'}]})});}
    chatCall={url,opts};
    return Promise.resolve({ok:true,body:sse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'])});
  };
  const dom=await boot(baseSettings({search:{on:true,provider:'tavily',key:'tvly-x',count:3,relay:'',always:true}}),f);
  const d=dom.window.document,w=dom.window;
  d.querySelector('#input').value='who won';
  d.querySelector('#input').dispatchEvent(new w.Event('input',{bubbles:true}));
  d.querySelector('#sendBtn').dispatchEvent(new w.Event('click',{bubbles:true}));
  await new Promise(r=>setTimeout(r,1000));
  ck('search API called', !!searchCall, searchCall?'→ '+searchCall.url:'');
  ck('bearer auth sent', searchCall && searchCall.opts.headers.authorization==='Bearer tvly-x');
  ck('sources block rendered', !!d.querySelector('.sources'));
  const sent=JSON.parse(chatCall.opts.body);
  const lastUser=sent.messages[sent.messages.length-1].content;
  ck('results injected into the prompt', lastUser.includes('<web_results>')&&lastUser.includes('a.com'));
  ck('visible message stays clean', !d.querySelector('.msg.user .msg-body').textContent.includes('web_results'));
  // window left open; closing mid-async trips jsdom
}
{
  // native search on anthropic
  let call=null;
  const f=(u,o)=>{call={u,o};return Promise.resolve({ok:true,body:sse(['data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n\n'])});};
  const dom=await boot(baseSettings({
    providers:[{id:'p1',preset:'anthropic',kind:'anthropic',name:'C',url:'https://api.anthropic.com/v1',apiKey:'k',model:'claude',ctx:200000}],
    search:{on:true,provider:'native',key:'',count:4,relay:'',always:true}}),f);
  const d=dom.window.document,w=dom.window;
  d.querySelector('#input').value='news';
  d.querySelector('#input').dispatchEvent(new w.Event('input',{bubbles:true}));
  d.querySelector('#sendBtn').dispatchEvent(new w.Event('click',{bubbles:true}));
  await new Promise(r=>setTimeout(r,900));
  const b=JSON.parse(call.o.body);
  ck('native web_search tool attached', b.tools && b.tools[0].type==='web_search_20250305', '→ '+JSON.stringify(b.tools));
  ck('max_uses honours the count setting', b.tools[0].max_uses===4);
  // window left open; closing mid-async trips jsdom
}

console.log('\n=== 7. BRANCH + CONTINUE ===');
{
  const f=()=>Promise.resolve({ok:true,body:sse(['data: {"choices":[{"delta":{"content":" more"}}]}\n\n'])});
  const dom=await boot(baseSettings(),f);
  const d=dom.window.document,w=dom.window;
  w.eval(`current={id:'c1',title:'Orig',createdAt:1,updatedAt:1,messages:[
    {id:'m1',role:'user',content:'U1'},{id:'m2',role:'assistant',content:'A1',variants:[{content:'A1'}],vi:0}]};
    convos=[current];renderSidebar();renderThread();`);
  d.querySelector('[data-branch="m1"]').dispatchEvent(new w.Event('click',{bubbles:true}));
  await new Promise(r=>setTimeout(r,400));
  ck('branch made a new conversation', w.eval('convos.length')===2, '→ '+w.eval('convos.length'));
  ck('branch kept only messages up to that point', w.eval('current.messages.length')===1);
  ck('branch title marked', w.eval('current.title').includes('↗'), '→ '+w.eval('current.title'));
  // window left open; closing mid-async trips jsdom
}

console.log('\n=== 8. REGRESSION: v1 features still work ===');
{
  const dom=await boot(baseSettings());
  const d=dom.window.document,w=dom.window;
  ck('markdown renderer intact', w.eval('renderMarkdown("**b** `c`")')==='<p><strong>b</strong> <code>c</code></p>');
  ck('xss still escaped', !w.eval('renderMarkdown("<img src=x onerror=1>")').includes('<img'));
  ck('ember meter present', !!d.querySelector('#emberFill'));
  d.querySelector('#settingsBtn').dispatchEvent(new w.Event('click',{bubbles:true}));
  ck('five settings tabs', d.querySelectorAll('.tab').length===5, '→ '+d.querySelectorAll('.tab').length);
  ck('instructions panel exists', !!d.querySelector('[data-panel="inst"]'));
  d.querySelector('#addInjBtn').dispatchEvent(new w.Event('click',{bubbles:true}));
  ck('can add an instruction', d.querySelectorAll('.inj').length===1);
  ck('depth explainer rendered', d.querySelector('.depth-viz').textContent.includes('Depth'));
  // window left open; closing mid-async trips jsdom
}

console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+pass+' checks)');
process.exit(fail?1:0);
})();
