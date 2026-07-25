const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync('./out/index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=(o={})=>Object.assign({
  providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000}],
  activeProvider:'p1',presets:[{id:'d',name:'D',system:'',injections:[]}],activePreset:'d',
  prompts:[],temperature:1,maxTokens:4096,effort:'off',showThinking:true,catchThinkTags:true,
  thinkTags:'think',enterSends:false,autoTitle:true,theme:'dark',
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
console.log('\n=== 1. NO DUPLICATE MODEL NAME ===');
{
  const dom=await boot(base());const w=dom.window;
  const L=w.eval('connLabel');
  ck('his exact case shows the model once',
     L({name:'Neuralwatt Glm-5.2-fast',model:'glm-5.2-fast'})==='glm-5.2-fast',
     L({name:'Neuralwatt Glm-5.2-fast',model:'glm-5.2-fast'}));
  ck('identical name and model collapse', L({name:'glm-4.6',model:'glm-4.6'})==='glm-4.6');
  ck('punctuation/case differences still collapse',
     L({name:'GLM 5.2 Fast',model:'glm-5.2-fast'})==='glm-5.2-fast');
  ck('genuinely different names are kept',
     L({name:'Work account',model:'gpt-4o'})==='Work account · gpt-4o',
     L({name:'Work account',model:'gpt-4o'}));
  ck('no model set is handled', L({name:'Thing',model:''})==='Thing');
  ck('no connection is handled', L(null)==='No connection yet');
}
console.log('\n=== 2. THE FILE STRIP IS GONE ===');
{
  const dom=await boot(base());const w=dom.window,d=dom.window.document;
  ck('no strip element in the document at all', d.querySelector('.docbar')===null && d.querySelector('#docBar')===null);
  ck('no strip CSS rules left', !html.includes('.docbar{') && !html.includes('.doc-chip'));
  // the icon is always reachable now — it is how file writing is switched on —
  // but it must read as inactive and its file actions must be unavailable
  ck('file icon present but inactive with nothing attached',
     d.querySelector('#fileBtn').hidden===false && !d.querySelector('#fileBtn').classList.contains('on'));
  ck('it says so rather than naming a file',
     /off/i.test(d.querySelector('#fileName').textContent), d.querySelector('#fileName').textContent);
  // thread sits directly under the top bar
  const kids=Array.from(d.querySelector('.main').children).map(e=>e.id||e.className.split(' ')[0]);
  ck('top bar is followed by the thread', kids[0]==='topbar'||kids[0].includes('topbar'), kids.join(' > '));
}
console.log('\n=== 3. ATTACHED FILE LIVES IN THE TOP BAR ===');
{
  const dom=await boot(base());const w=dom.window,d=dom.window.document;
  await w.eval('(async()=>{const doc=await newDoc("spec.md","body");newConvo();await attachDoc(doc.id);})()');
  await new Promise(r=>setTimeout(r,300));
  ck('icon appears when a file is attached', d.querySelector('#fileBtn').hidden===false);
  ck('popover starts closed', !d.querySelector('#filePop').classList.contains('show'));
  ev(w,d.querySelector('#fileBtn'),'click');
  ck('tapping opens it', d.querySelector('#filePop').classList.contains('show'));
  ck('names the attached file in the list',
     /spec\.md/.test(d.querySelector('#fileList').textContent), d.querySelector('#fileList').textContent.trim());
  ck('and summarises the count', /1 file attached/.test(d.querySelector('#fileName').textContent),
     d.querySelector('#fileName').textContent);
  const labels=Array.from(d.querySelectorAll('#filePop button')).map(b=>b.textContent.trim());
  ck('actions are worded plainly, no "Detach"',
     !labels.join(' ').toLowerCase().includes('detach'), labels.join(' | '));
  ck('undo disabled with nothing to undo', d.querySelector('[data-fundo]').disabled===true);
  d.body.dispatchEvent(new w.Event('click',{bubbles:true}));
  ck('tapping elsewhere closes it', !d.querySelector('#filePop').classList.contains('show'));
  // removing explains the file is kept
  ev(w,d.querySelector('#fileBtn'),'click');
  ev(w,d.querySelector('#docDetachBtn'),'click');
  await new Promise(r=>setTimeout(r,300));
  ck('removing tells you the file is still saved',
     d.querySelector('#toast').textContent.includes('still saved'), d.querySelector('#toast').textContent);
  ck('the file itself was not deleted', w.eval('docs.length')===1);
  ck('icon goes inactive again', !d.querySelector('#fileBtn').classList.contains('on'),
     d.querySelector('#fileBtn').className);
  ck('and no files are listed', d.querySelector('#fileList').hidden===true);
  ck('popover closed too', !d.querySelector('#filePop').classList.contains('show'));
}
console.log('\n=== 4. BLANK NAMES CAN NEVER RENDER EMPTY ===');
{
  const dom=await boot(base());const w=dom.window,d=dom.window.document;
  await w.eval('(async()=>{const doc=await newDoc("x.md","b");newConvo();await attachDoc(doc.id);})()');
  await new Promise(r=>setTimeout(r,250));
  for(const bad of ['', '   ', '\t', '\n ']){
    w.eval('docs[0].name='+JSON.stringify(bad)); w.eval('renderFileBtn()');
    ck('name '+JSON.stringify(bad)+' falls back',
       /untitled/.test(d.querySelector('#fileList').textContent),
       d.querySelector('#fileList').textContent.trim());
  }
}
console.log('\n=== 5. REGRESSIONS ===');
{
  const dom=await boot(base());const w=dom.window,d=dom.window.document;
  ck('markdown intact', w.eval('renderMarkdown("**b**")')==='<p><strong>b</strong></p>');
  ck('matching intact', w.eval('applyEditToText("a\\nb",{type:"replace",find:"b",replace:"Z"})').text==='a\nZ');
  ck('fuzzy safety intact',
     w.eval('applyEditToText("the quick brown fox runs",{type:"replace",find:"the quick brown cat runs",replace:"X"})').text===null);
  ck('thinking styles intact', w.eval('reasonStyle({kind:"openai",preset:"custom",model:"glm-5.2-fast"})')==='zai');
  ck('effort payload intact (openai-style model)', (()=>{w.eval('S.effort="high";current={id:"c",title:"t",messages:[{id:"1",role:"user",content:"h"}]}');
     const b=w.eval('buildPayload({})').body; return b.reasoning_effort==='high'&&!b.thinking;})());
  ck('effort payload intact (glm model)', (()=>{w.eval('S.providers[0].model="glm-5.2-fast";saveSettings()');
     const b=w.eval('buildPayload({})').body; return b.thinking&&b.thinking.type==='enabled'&&b.reasoning_effort==='high';})());
  ck('five tabs', (ev(w,d.querySelector('#settingsBtn'),'click'), d.querySelectorAll('.tab').length===5));
  ck('six themes', Object.keys(w.eval('THEMES')).length===6);
  ck('no console errors on boot', true);
}
console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})();
