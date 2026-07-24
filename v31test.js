const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync('./out/index.html','utf8');
function sse(cs){let i=0;return{getReader(){return{read(){
  if(i>=cs.length)return Promise.resolve({done:true});
  return Promise.resolve({done:false,value:new TextEncoder().encode(cs[i++])});}};}};}
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=(o={})=>Object.assign({
  providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://api.t/v1',apiKey:'k',model:'m',ctx:100000}],
  activeProvider:'p1',presets:[{id:'d',name:'D',system:'',injections:[]}],activePreset:'d',
  prompts:[],temperature:1,maxTokens:4096,effort:'off',showThinking:true,catchThinkTags:true,
  thinkTags:'think, thinking',enterSends:false,autoTitle:true,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}},o);
function boot(st,f){return new Promise(res=>{
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
    beforeParse(w){
      w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
      w.navigator.storage={estimate:async()=>({usage:0})};
      w.requestAnimationFrame=cb=>setTimeout(cb,0);
      w.confirm=()=>true;w.prompt=(q,d)=>d||'X';
      w.navigator.clipboard={writeText:async()=>{}};
      w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
      if(f)w.fetch=f;
    }});
  setTimeout(()=>{try{dom.window.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();');}catch(_){}res(dom);},750);});}
const ev=(w,el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true}));

(async()=>{
console.log('\n=== 1. THINKING STYLE AUTO-DETECTION ===');
{
  const dom=await boot(base()); const w=dom.window;
  const rs=w.eval('reasonStyle');
  ck('Claude connection → anthropic', rs({kind:'anthropic',preset:'anthropic',model:'claude-sonnet-4-6'})==='anthropic');
  ck('Z.ai preset → zai', rs({kind:'openai',preset:'zai',model:'glm-4.6'})==='zai');
  ck('custom endpoint + glm model → zai', rs({kind:'openai',preset:'custom',model:'glm-5.2-fast'})==='zai',
     rs({kind:'openai',preset:'custom',model:'glm-5.2-fast'}));
  ck('qwen model → qwen', rs({kind:'openai',preset:'custom',model:'qwen3-max'})==='qwen');
  ck('openrouter → openrouter', rs({kind:'openai',preset:'openrouter',model:'z-ai/glm-4.7'})==='openrouter');
  ck('deepseek → none', rs({kind:'openai',preset:'deepseek',model:'deepseek-reasoner'})==='none');
  ck('plain openai → openai', rs({kind:'openai',preset:'openai',model:'gpt-4o'})==='openai');
  ck('explicit override wins', rs({kind:'openai',preset:'custom',model:'glm-5.2',reason:'openai'})==='openai');
}

console.log('\n=== 2. EFFORT → CORRECT PAYLOAD PER SERVICE ===');
{
  const cases=[
    ['GLM via custom endpoint (his setup)', {preset:'custom',kind:'openai',model:'glm-5.2-fast'},'high',
      b=>b.thinking&&b.thinking.type==='enabled'&&b.reasoning_effort==='high'],
    ['GLM with effort off sends disabled', {preset:'custom',kind:'openai',model:'glm-5.2-fast'},'off',
      b=>b.thinking&&b.thinking.type==='disabled'&&b.reasoning_effort===undefined],
    ['GLM low omits reasoning_effort', {preset:'custom',kind:'openai',model:'glm-5.2-fast'},'low',
      b=>b.thinking.type==='enabled'&&b.reasoning_effort===undefined],
    ['OpenAI uses reasoning_effort', {preset:'openai',kind:'openai',model:'gpt-4o'},'medium',
      b=>b.reasoning_effort==='medium'&&!b.thinking],
    ['OpenAI off sends nothing', {preset:'openai',kind:'openai',model:'gpt-4o'},'off',
      b=>b.reasoning_effort===undefined&&!b.thinking],
    ['Claude uses adaptive + output_config', {preset:'anthropic',kind:'anthropic',model:'claude-opus-4-7'},'high',
      b=>b.thinking.type==='adaptive'&&b.output_config.effort==='high'],
    ['Claude off omits thinking entirely', {preset:'anthropic',kind:'anthropic',model:'claude-opus-4-7'},'off',
      b=>!b.thinking&&!b.output_config],
    ['Qwen uses enable_thinking', {preset:'custom',kind:'openai',model:'qwen3-max'},'medium',
      b=>b.enable_thinking===true],
    ['OpenRouter uses a reasoning object', {preset:'openrouter',kind:'openai',model:'x'},'low',
      b=>b.reasoning&&b.reasoning.effort==='low'],
    ['DeepSeek sends nothing extra', {preset:'deepseek',kind:'openai',model:'deepseek-reasoner'},'high',
      b=>!b.thinking&&b.reasoning_effort===undefined&&b.enable_thinking===undefined],
  ];
  for(const [name,prov,eff,test] of cases){
    const dom=await boot(base({effort:eff,
      providers:[Object.assign({id:'p1',name:'N',url:'https://a/v1',apiKey:'k',ctx:9000},prov)],activeProvider:'p1'}));
    const w=dom.window;
    w.eval('current={id:"c",title:"t",messages:[{id:"1",role:"user",content:"hi"}]}');
    const b=w.eval('buildPayload({})').body;
    ck(name, test(b), JSON.stringify({thinking:b.thinking,output_config:b.output_config,
      reasoning_effort:b.reasoning_effort,enable_thinking:b.enable_thinking,reasoning:b.reasoning}));
  }
}
console.log('\n=== 3. LEGACY CLAUDE BUDGET MODE ===');
{
  const dom=await boot(base({effort:'high',maxTokens:4096,
    providers:[{id:'p1',preset:'anthropic',kind:'anthropic',name:'C',url:'https://a/v1',apiKey:'k',
      model:'claude-3-7-sonnet',ctx:200000,reason:'anthropic-budget'}],activeProvider:'p1'}));
  const w=dom.window;
  w.eval('current={id:"c",title:"t",messages:[{id:"1",role:"user",content:"hi"}]}');
  const b=w.eval('buildPayload({})').body;
  ck('budget mode sends budget_tokens', b.thinking.type==='enabled'&&typeof b.thinking.budget_tokens==='number',
     JSON.stringify(b.thinking));
  ck('budget stays under max_tokens', b.thinking.budget_tokens < b.max_tokens,
     b.thinking.budget_tokens+' < '+b.max_tokens);
}

console.log('\n=== 4. MODEL LIST LOADING ===');
{
  let called=null;
  const f=(u,o)=>{called={u,o};
    if(String(u).endsWith('/models')) return Promise.resolve({ok:true,json:async()=>({data:[
      {id:'glm-5.2-fast'},{id:'glm-4.6'},{id:'anthropic/claude-sonnet-4-6'}]})});
    return Promise.resolve({ok:true,body:sse([])});};
  const dom=await boot(base(),f);
  const w=dom.window,d=dom.window.document;
  ev(w,d.querySelector('#settingsBtn'),'click');
  ev(w,d.querySelector('[data-editprov]'),'click');
  await new Promise(r=>setTimeout(r,150));
  ck('dropdown hidden before loading', d.querySelector('#pModelSel').hidden===true);
  ev(w,d.querySelector('#loadModelsBtn'),'click');
  await new Promise(r=>setTimeout(r,400));
  ck('hit the /models endpoint', called && called.u==='https://api.t/v1/models', called&&called.u);
  ck('sent the key', !!(called.o.headers.authorization));
  ck('dropdown now visible', d.querySelector('#pModelSel').hidden===false);
  ck('models listed and sorted', d.querySelectorAll('#pModelSel option').length===4,
     Array.from(d.querySelectorAll('#pModelSel option')).map(o=>o.value).join(','));
  ck('datalist populated too (typing still works)', d.querySelectorAll('#modelList option').length===3);
  const sel=d.querySelector('#pModelSel'); sel.value='glm-4.6'; ev(w,sel,'change');
  ck('picking one fills the model field', d.querySelector('#pModel').value==='glm-4.6');
  ck('list saved on the connection', w.eval('S.providers[0].models||[]').length===3);
}
console.log('\n=== 5. MODEL LIST FAILURE IS SOFT ===');
{
  const dom=await boot(base(),()=>Promise.resolve({ok:false,status:404,json:async()=>({})}));
  const w=dom.window,d=dom.window.document;
  ev(w,d.querySelector('#settingsBtn'),'click');
  ev(w,d.querySelector('[data-editprov]'),'click');
  await new Promise(r=>setTimeout(r,150));
  ev(w,d.querySelector('#loadModelsBtn'),'click');
  await new Promise(r=>setTimeout(r,400));
  ck('shows a plain-language message', d.querySelector('#toast').textContent.includes('Type the name instead'),
     d.querySelector('#toast').textContent);
  ck('manual entry still available', d.querySelector('#pModel').disabled!==true);
  ck('no crash', true);
}

console.log('\n=== 6. FILE CHIP IS COLLAPSED ===');
{
  const dom=await boot(base());
  const w=dom.window,d=dom.window.document;
  await w.eval('(async()=>{const doc=await newDoc("spec.md","body");newConvo();await attachDoc(doc.id);})()');
  await new Promise(r=>setTimeout(r,300));
  ck('strip visible when a file is attached', d.querySelector('#docBar').hidden===false);
  ck('starts collapsed', !d.querySelector('#docBar').classList.contains('open'));
  ck('file name shown', d.querySelector('#docBarName').textContent==='spec.md');
  ck('actions hidden until tapped', d.querySelector('#docChip').getAttribute('aria-expanded')==='false');
  ev(w,d.querySelector('#docChip'),'click');
  ck('tapping reveals the actions', d.querySelector('#docBar').classList.contains('open'));
  ck('aria updated', d.querySelector('#docChip').getAttribute('aria-expanded')==='true');
  ev(w,d.querySelector('#docChip'),'click');
  ck('tapping again collapses', !d.querySelector('#docBar').classList.contains('open'));
  // empty name can't happen
  w.eval('docs[0].name=""');w.eval('renderDocBar()');
  ck('empty name falls back to a label', d.querySelector('#docBarName').textContent==='untitled',
     JSON.stringify(d.querySelector('#docBarName').textContent));
  await w.eval('(async()=>{delete current.docId;await persist();renderThread();})()');
  await new Promise(r=>setTimeout(r,200));
  ck('strip gone when nothing attached', d.querySelector('#docBar').hidden===true);
}

console.log('\n=== 7. EFFORT PICKER UI ===');
{
  const dom=await boot(base({effort:'medium'}));
  const w=dom.window,d=dom.window.document;
  ev(w,d.querySelector('#settingsBtn'),'click');
  d.querySelectorAll('.tab')[1].dispatchEvent(new w.Event('click',{bubbles:true}));
  ck('saved level highlighted', d.querySelector('#effortSeg button.on').dataset.effort==='medium');
  ck('four levels offered', d.querySelectorAll('#effortSeg button').length===4);
  d.querySelector('[data-effort="high"]').dispatchEvent(new w.Event('click',{bubbles:true}));
  ck('tapping changes it', w.eval('S.effort')==='high');
  ck('highlight follows', d.querySelector('#effortSeg button.on').dataset.effort==='high');
  ck('hint explains what gets sent', d.querySelector('#effortHint').textContent.length>10,
     d.querySelector('#effortHint').textContent.slice(0,50));
}

console.log('\n=== 8. REGRESSIONS ===');
{
  const dom=await boot(base());const w=dom.window,d=dom.window.document;
  ck('markdown intact', w.eval('renderMarkdown("**b**")')==='<p><strong>b</strong></p>');
  ck('think tags intact', w.eval('splitReasoning("x</think>y")').text==='y');
  ck('matching engine intact', w.eval('applyEditToText("a\\nb\\nc",{type:"replace",find:"b",replace:"Z"})').text==='a\nZ\nc');
  ck('fuzzy safety intact',
     w.eval('applyEditToText("the quick brown fox runs",{type:"replace",find:"the quick brown cat runs",replace:"X"})').text===null);
  ck('insert still on its own line',
     w.eval('applyEditToText("a\\nb",{type:"insert",find:"a",replace:"N"})').text==='a\nN\nb');
  ck('six themes', Object.keys(w.eval('THEMES')).length===6);
  ck('five tabs', (ev(w,d.querySelector('#settingsBtn'),'click'), d.querySelectorAll('.tab').length===5));
  ck('effort defaults to off for new users', w.eval('DEFAULTS.effort')==='off');
}
console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})();
