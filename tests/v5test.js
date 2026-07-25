const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync('./out/index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=(o={})=>Object.assign({
  providers:[
    {id:'pa',preset:'custom',kind:'openai',name:'Alpha',url:'https://a/v1',apiKey:'k',model:'glm-5.2',ctx:100000},
    {id:'pb',preset:'anthropic',kind:'anthropic',name:'Beta',url:'https://b/v1',apiKey:'k',model:'claude-sonnet-4-6',ctx:200000}],
  activeProvider:'pa',
  presets:[{id:'p1',name:'Story',system:'STORY',injections:[],order:['__main__','__chat__']},
           {id:'p2',name:'Code', system:'CODE', injections:[],order:['__main__','__chat__']}],
  activePreset:'p1',prompts:[],temperature:1,maxTokens:4096,effort:'off',squashSystem:true,
  showThinking:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}},o);
function boot(st){return new Promise(res=>{
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
    beforeParse(w){
      w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
      w.navigator.storage={estimate:async()=>({usage:0})};
      w.requestAnimationFrame=cb=>setTimeout(cb,0);
      w.confirm=()=>true;w.prompt=(q,d)=>d||'X';w.navigator.clipboard={writeText:async()=>{}};
      w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
    }});
  setTimeout(()=>{try{dom.window.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();');}catch(_){}res(dom);},750);});}
const ev=(w,el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true}));

(async()=>{
console.log('=== 1. A NEW CHAT CAPTURES THE CURRENT SETUP ===');
{
  const dom=await boot(base());const w=dom.window;
  w.eval('newConvo()'); await new Promise(r=>setTimeout(r,150));
  const c=w.eval('JSON.parse(JSON.stringify(current.cfg))');
  ck('it stores a connection', c.providerId==='pa', c.providerId);
  ck('it stores an instruction set', c.presetId==='p1', c.presetId);
  ck('it stores sampling', c.temperature===1 && c.maxTokens===4096);
  ck('it stores thinking effort', c.effort==='off');
  ck('it stores squash', c.squashSystem===true);
}

console.log('\n=== 2. TWO CHATS KEEP DIFFERENT SETUPS ===');
{
  const dom=await boot(base());const w=dom.window,d=dom.window.document;
  w.eval('newConvo(); current.title="Story chat";'); await new Promise(r=>setTimeout(r,120));
  const a=w.eval('current.id');
  w.eval('cfgSet("presetId","p1"); cfgSet("providerId","pa"); cfgSet("temperature",0.7); cfgSet("effort","off")');
  await new Promise(r=>setTimeout(r,120));

  w.eval('newConvo(); current.title="Code chat";'); await new Promise(r=>setTimeout(r,120));
  const b=w.eval('current.id');
  w.eval('cfgSet("presetId","p2"); cfgSet("providerId","pb"); cfgSet("temperature",0.2); cfgSet("effort","high")');
  await new Promise(r=>setTimeout(r,120));

  ck('the second chat uses its own set', w.eval('PS().name')==='Code', w.eval('PS().name'));
  ck('and its own connection', w.eval('activeProv().name')==='Beta', w.eval('activeProv().name'));
  ck('and its own temperature', w.eval('chatTemp()')===0.2, String(w.eval('chatTemp()')));
  ck('and its own effort', w.eval('chatEffort()')==='high');

  w.eval('current = convos.find(c=>c.id==="'+a+'")');
  ck('switching back restores the first set', w.eval('PS().name')==='Story', w.eval('PS().name'));
  ck('and its connection', w.eval('activeProv().name')==='Alpha', w.eval('activeProv().name'));
  ck('and its temperature', w.eval('chatTemp()')===0.7, String(w.eval('chatTemp()')));
  ck('and its effort', w.eval('chatEffort()')==='off');
  ck('globals were not trampled', w.eval('S.activePreset')==='p1' && w.eval('S.activeProvider')==='pa',
     w.eval('S.activePreset')+'/'+w.eval('S.activeProvider'));
}

console.log('\n=== 3. IT REACHES THE ACTUAL REQUEST ===');
{
  const dom=await boot(base());const w=dom.window;
  w.eval('newConvo(); current.messages=[{id:"1",role:"user",content:"U"}];');
  w.eval('cfgSet("presetId","p2"); cfgSet("providerId","pb"); cfgSet("temperature",0.15); cfgSet("maxTokens",1234); cfgSet("effort","high")');
  await new Promise(r=>setTimeout(r,150));
  const req=w.eval('buildPayload({})');
  ck('the chat\'s connection is called', req.url.indexOf('https://b/v1')===0, req.url);
  ck('with the chat\'s model', req.body.model==='claude-sonnet-4-6', req.body.model);
  ck('the chat\'s instruction set is sent', req.body.system==='CODE', JSON.stringify(req.body.system));
  ck('the chat\'s temperature', req.body.temperature===0.15, String(req.body.temperature));
  ck('the chat\'s token cap', req.body.max_tokens===1234, String(req.body.max_tokens));
  ck('the chat\'s thinking effort', req.body.thinking && req.body.output_config.effort==='high',
     JSON.stringify(req.body.thinking));
}

console.log('\n=== 4. A PER-CHAT MODEL OVERRIDE ===');
{
  const dom=await boot(base());const w=dom.window;
  w.eval('newConvo(); cfgSet("model","glm-5.2-fast")'); await new Promise(r=>setTimeout(r,120));
  ck('the override is used', w.eval('activeProv().model')==='glm-5.2-fast', w.eval('activeProv().model'));
  ck('the saved connection is untouched', w.eval('S.providers.find(p=>p.id==="pa").model')==='glm-5.2',
     w.eval('S.providers.find(p=>p.id==="pa").model'));
  w.eval('cfgSet("model",null)');
  ck('clearing it falls back to the connection', w.eval('activeProv().model')==='glm-5.2');
}

console.log('\n=== 5. OLDER CHATS ARE PINNED, NOT LEFT DRIFTING ===');
{
  const dom=await boot(base());const w=dom.window;
  await w.eval(`(async()=>{
    await DB.put({id:'old',title:'From before',createdAt:1,updatedAt:1,
      messages:[{id:'m',role:'user',content:'hi'}]});
    await loadConvos();
  })()`);
  await new Promise(r=>setTimeout(r,250));
  const c=w.eval('JSON.parse(JSON.stringify((convos.find(x=>x.id==="old")||{}).cfg||null))');
  ck('an old chat gets a snapshot on load', !!c, JSON.stringify(c));
  ck('pinned to the settings in force at that moment', c && c.presetId==='p1' && c.providerId==='pa');
  ck('and it was written back to storage', await w.eval(`(async()=>{
     const all = await DB.all(); const o = all.find(x=>x.id==='old'); return !!(o && o.cfg); })()`));
  w.eval('S.activePreset="p2";saveSettings()');
  w.eval('current = convos.find(x=>x.id==="old")');
  ck('changing the global default does not move it', w.eval('PS().name')==='Story', w.eval('PS().name'));
}

console.log('\n=== 6. THE PANEL SAYS WHOSE SETTINGS THESE ARE ===');
{
  const dom=await boot(base());const w=dom.window,d=dom.window.document;
  w.eval('newConvo(); current.title="Bleach";'); await new Promise(r=>setTimeout(r,120));
  ev(w,d.querySelector('#settingsBtn'),'click');
  ck('the banner names the chat', d.querySelector('#scopeChat').textContent==='Bleach',
     d.querySelector('#scopeChat').textContent);
  ck('there is a way to make it the default', !!d.querySelector('#useEverywhereBtn'));
  w.eval('cfgSet("presetId","p2"); cfgSet("temperature",0.33)');
  ev(w,d.querySelector('#useEverywhereBtn'),'click');
  ck('it promotes the set', w.eval('S.activePreset')==='p2', w.eval('S.activePreset'));
  ck('and the sampling', w.eval('S.temperature')===0.33, String(w.eval('S.temperature')));
  w.eval('newConvo()'); await new Promise(r=>setTimeout(r,120));
  ck('a new chat then starts from those', w.eval('current.cfg.presetId')==='p2' && w.eval('current.cfg.temperature')===0.33);
}

console.log('\n=== 7. CONTROLS WRITE TO THE CHAT, NOT THE GLOBALS ===');
{
  const dom=await boot(base());const w=dom.window,d=dom.window.document;
  w.eval('newConvo()'); await new Promise(r=>setTimeout(r,120));
  ev(w,d.querySelector('#settingsBtn'),'click');
  d.querySelectorAll('.tab')[1].dispatchEvent(new w.Event('click',{bubbles:true}));
  const t=d.querySelector('#temp'); t.value='0.42'; ev(w,t,'change');
  await new Promise(r=>setTimeout(r,120));
  ck('temperature lands on the chat', w.eval('current.cfg.temperature')===0.42, String(w.eval('current.cfg.temperature')));
  ck('the global default is unchanged', w.eval('S.temperature')===1, String(w.eval('S.temperature')));
  d.querySelector('[data-effort="medium"]').dispatchEvent(new w.Event('click',{bubbles:true}));
  ck('effort lands on the chat', w.eval('current.cfg.effort')==='medium');
  ck('global effort unchanged', w.eval('S.effort')==='off');
  ev(w,d.querySelector('#tgSquash'),'click');
  ck('squash lands on the chat', w.eval('current.cfg.squashSystem')===false, String(w.eval('current.cfg.squashSystem')));
  ck('global squash unchanged', w.eval('S.squashSystem')===true);
}

console.log('\n=== 8. REGRESSIONS ===');
{
  const dom=await boot(base());const w=dom.window;
  ck('markdown intact', w.eval('renderMarkdown("**b**")')==='<p><strong>b</strong></p>');
  ck('fuzzy safety intact',
     w.eval('applyEditToText("the quick brown fox runs",{type:"replace",find:"the quick brown cat runs",replace:"X"})').text===null);
  ck('order helpers intact', w.eval('orderMove')(['a','b'],'a',1).join()==='b,a');
  ck('with no chat open it still resolves a provider', w.eval('current=null; activeProv().id')==='pa');
  ck('and a preset', w.eval('PS().name')==='Story');
}
console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})();
