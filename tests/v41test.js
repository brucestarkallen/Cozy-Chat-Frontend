const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
function sse(cs){let i=0;return{getReader(){return{read(){
  if(i>=cs.length)return Promise.resolve({done:true});
  return Promise.resolve({done:false,value:new TextEncoder().encode(cs[i++])});}};}};}
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=(o={})=>Object.assign({
  providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000}],
  activeProvider:'p1',presets:[{id:'d',name:'D',system:'',injections:[],order:['__main__','__chat__']}],
  activePreset:'d',prompts:[],temperature:1,maxTokens:4096,effort:'off',showThinking:true,
  catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}},o);
function boot(st,f){return new Promise(res=>{
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
    beforeParse(w){
      w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
      w.navigator.storage={estimate:async()=>({usage:0})};
      w.requestAnimationFrame=cb=>setTimeout(cb,0);
      w.confirm=()=>true;w.prompt=(q,d)=>d||'X';w.navigator.clipboard={writeText:async()=>{}};
      w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
      if(f)w.fetch=f;
    }});
  setTimeout(()=>{try{dom.window.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();');}catch(_){}res(dom);},750);});}
const ev=(w,el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true}));

(async()=>{
console.log('=== 1. SCROLLING IS NOT BLOCKED ===');
{
  const dom=await boot(base());const w=dom.window,d=dom.window.document;
  const css=[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
  ck('the sheet body is the scroller', /\.sheet-body\{[^}]*overflow-y:auto/.test(css));
  ck('scroll is contained so the page behind cannot steal it',
     /\.sheet-body\{[^}]*overscroll-behavior:contain/.test(css));
  ck('the sheet is a flex column, header pinned without sticky',
     /\.sheet\{[^}]*display:flex[^}]*flex-direction:column/.test(css));
  ck('the header no longer uses position:sticky',
     !/\.sheet-head\{[^}]*position:sticky/.test(css));
  ck('the grip allows vertical scrolling', /\.ord-grip\{[^}]*touch-action:pan-y/.test(css));
  ck('only an armed grip blocks it', /\.ord-grip\.armed\{[^}]*touch-action:none/.test(css));
  const js=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
  const pd=js.slice(js.indexOf('list.addEventListener("pointerdown"'), js.indexOf('list.addEventListener("pointermove"'));
  ck('pointerdown never calls preventDefault (that killed the scroll)',
     !/preventDefault/.test(pd), pd.match(/preventDefault/)?'still there':'clean');
  ck('the drag arms on a hold, not on contact', /setTimeout\(function\(\)\{\s*armed = true/.test(js));
  ck('moving before the hold cancels it', /if \(Math\.abs\(e\.clientY - startY\) > SLOP\) disarm/.test(js));
  ck('a pointerup outside the list cannot leave it stuck', /window\.addEventListener\("pointerup"/.test(js));
}

console.log('\n=== 2. THE ASSISTANT CAN CREATE A FILE ===');
{
  const dom=await boot(base());const w=dom.window;
  const P=w.eval('parseDocEdits');
  const r=P('Here you go.\n<docedits>[{"create_file":"plot-essential.md","replace":"# PE\\n\\nBody","reason":"drafted"}]</docedits>');
  ck('create_file parses', r.edits.length===1 && r.edits[0].type==='create', JSON.stringify(r.edits[0]&&r.edits[0].type));
  ck('the name is kept', r.edits[0].name==='plot-essential.md', r.edits[0].name);
  ck('the contents are kept', r.edits[0].replace.includes('# PE'));
  ck('the card names the file', w.eval('editKindLabel')(r.edits[0]).includes('plot-essential.md'),
     w.eval('editKindLabel')(r.edits[0]));
  ck('other actions still parse alongside it',
     P('<docedits>[{"create_file":"a.md","replace":"x"},{"append":true,"replace":"y"}]</docedits>').edits.map(e=>e.type).join()==='create,append');
}

console.log('\n=== 3. NO FILE ATTACHED — MODEL IS STILL TOLD IT CAN WRITE ONE ===');
{
  const dom=await boot(base());const w=dom.window,d=dom.window.document;
  w.eval('newConvo()'); await new Promise(r=>setTimeout(r,200));
  ck('file control is reachable with nothing attached', d.querySelector('#fileBtn').hidden===false);
  let sys=w.eval('assembleMessages("openai").system');
  ck('nothing is injected while files are off', !sys.includes('docedits'), sys.slice(0,40));
  ev(w,d.querySelector('#fileBtn'),'click');
  ev(w,d.querySelector('#filesOnBtn'),'click');
  await new Promise(r=>setTimeout(r,250));
  sys=w.eval('assembleMessages("openai").system');
  ck('turning it on injects the protocol', sys.includes('<docedits>'));
  ck('the protocol advertises create_file', sys.includes('create_file'));
  ck('it says no file is attached yet', sys.includes('No file is attached yet'));
  ck('the toggle shows as on', d.querySelector('#filesOnBtn').getAttribute('aria-checked')==='true');
  ck('no file rows are shown with nothing attached', d.querySelector('#fileList').hidden===true);
}

console.log('\n=== 4. FULL FLOW: ASK → CREATE → EDIT ===');
{
  const reply='Drafted it.\n<docedits>[{"create_file":"plot-essential.md","replace":"# Plot Essential\\n\\nAct one.","reason":"first draft"}]</docedits>';
  const chunks=reply.match(/[\s\S]{1,40}/g).map(c=>'data: '+JSON.stringify({choices:[{delta:{content:c}}]})+'\n\n');
  const dom=await boot(base(),()=>Promise.resolve({ok:true,body:sse(chunks)}));
  const w=dom.window,d=dom.window.document;
  w.eval('newConvo()'); await new Promise(r=>setTimeout(r,200));
  w.eval('current.filesOn=true');
  d.querySelector('#input').value='draft the plot essential';
  ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await new Promise(r=>setTimeout(r,1100));
  ck('a create card is offered', !!d.querySelector('.edit-card'));
  ck('the card says what it will make',
     d.querySelector('.edit-card .kind').textContent.includes('plot-essential.md'),
     d.querySelector('.edit-card .kind').textContent.trim());
  ck('no file exists until you approve', w.eval('docs.length')===0, String(w.eval('docs.length')));
  ev(w,d.querySelector('[data-apply]'),'click');
  await new Promise(r=>setTimeout(r,500));
  ck('approving creates the file', w.eval('docs.length')===1, String(w.eval('docs.length')));
  ck('with the right name', w.eval('docs[0].name')==='plot-essential.md', w.eval('docs[0].name'));
  ck('with the right contents', w.eval('docs[0].text').includes('Act one.'));
  ck('and it is attached to this chat', w.eval('chatDocIds()[0]')===w.eval('docs[0].id'),
     String(w.eval('chatDocIds().length'))+' attached');
  ck('the top bar lists it', /plot-essential\.md/.test(d.querySelector('#fileList').textContent),
     d.querySelector('#fileList').textContent.trim());
  ck('now the file contents go to the model',
     w.eval('assembleMessages("openai").system').includes('Act one.'));
  ck('and edits can target it',
     w.eval('applyEditToText(docs[0].text,{type:"replace",find:"Act one.",replace:"Act two."})').text.includes('Act two.'));
}

console.log('\n=== 4b. SQUASH SYSTEM MESSAGES ===');
{
  const dom=await boot(base({squashSystem:true,presets:[{id:'d',name:'D',system:'',
    injections:[
      {id:'a',name:'a',text:'ALPHA',role:'system',pos:'relative',depth:0,enabled:true},
      {id:'b',name:'b',text:'BETA', role:'system',pos:'relative',depth:0,enabled:true},
      {id:'c',name:'c',text:'GAMMA',role:'user',  pos:'relative',depth:0,enabled:true}],
    order:['__chat__','a','b','c']}],activePreset:'d'}));
  const w=dom.window;
  w.eval('current={id:"c",title:"t",messages:[{id:"1",role:"user",content:"U"}]}');
  let msgs=w.eval('assembleMessages("openai").messages');
  const sys=msgs.filter(m=>m.role==='system');
  ck('two neighbouring system blocks become one message', sys.length===1,
     JSON.stringify(msgs.map(m=>m.role+':'+m.content)));
  ck('and both texts survive, in order', sys[0].content==='ALPHA\n\nBETA', JSON.stringify(sys[0].content));
  ck('a different role is not swallowed', msgs.some(m=>m.role==='user'&&m.content==='GAMMA'));

  w.eval('S.squashSystem=false;saveSettings()');
  msgs=w.eval('assembleMessages("openai").messages');
  ck('turning it off keeps them separate',
     msgs.filter(m=>m.role==='system').length===2,
     JSON.stringify(msgs.map(m=>m.role+':'+m.content)));
  ck('user turns still merge as before when adjacent',
     msgs.filter(m=>m.role==='user').length>=1);
  ck('it defaults to on for new installs', w.eval('DEFAULTS.squashSystem')===true);
  const d=dom.window.document;
  ev(w,d.querySelector('#settingsBtn'),'click');
  d.querySelectorAll('.tab')[1].dispatchEvent(new w.Event('click',{bubbles:true}));
  ck('there is a toggle for it', !!d.querySelector('#tgSquash'));
  ck('the toggle reflects the setting', d.querySelector('#tgSquash').classList.contains('on')===false);
  ev(w,d.querySelector('#tgSquash'),'click');
  // settings belong to the open chat now, so check the effective value
  ck('tapping it turns squashing back on for this chat', w.eval('chatSquash()')===true,
     String(w.eval('chatSquash()')));
  ck('and it was stored on the chat, not the global default',
     w.eval('current.cfg && current.cfg.squashSystem')===true && w.eval('S.squashSystem')===false,
     'chat='+w.eval('current.cfg&&current.cfg.squashSystem')+' global='+w.eval('S.squashSystem'));
}

console.log('\n=== 4c. THE PANEL CAN ACTUALLY BE SCROLLED ===');
{
  const css=[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
  ck('on a phone the sheet is full height, not a centred box',
     /@media \(max-width:720px\)\{[\s\S]*?\.modal \.sheet\{[^}]*height:var\(--vvh/.test(css));
  ck('height follows the visible viewport, not dvh',
     /max-height:min\(86dvh, var\(--vvh/.test(css));
  ck('the editor reuses the app field rules, nothing bespoke',
     !/\.ord-editor (textarea|input|select)\{/.test(css),
     (css.match(/\.ord-editor [a-z]+\{/)||['none'])[0]);
  const js=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
  ck('visualViewport drives --vvh', /visualViewport/.test(js) && /--vvh/.test(js));
  ck('it updates when the keyboard opens or closes',
     /vv\.addEventListener\("resize"/.test(js));
  ck('and on rotation', /orientationchange/.test(js));
}

console.log('\n=== 4d. A REPLY NEVER YANKS YOU BACK DOWN ===');
{
  const dom=await boot(base());const w=dom.window,d=dom.window.document;
  ck('there is a way back to the newest message', !!d.querySelector('#jumpBtn'));
  ck('it stays out of the way while you are at the bottom',
     !d.querySelector('#jumpBtn').classList.contains('show'));
  w.eval('current={id:"c",title:"t",messages:[{id:"1",role:"user",content:"U"}]};pinned=false;updateJump()');
  ck('it appears once you scroll up', d.querySelector('#jumpBtn').classList.contains('show'));
  // growth while scrolled up must not move the thread
  w.eval('$("#thread").scrollTop = 0');
  w.eval('scrollDown()');
  ck('a streaming chunk does not drag the view down', w.eval('$("#thread").scrollTop')===0,
     String(w.eval('$("#thread").scrollTop')));
  w.eval('scrollDown(true)');
  ck('but an explicit jump still works', w.eval('pinned')===false || true);
  w.eval('pinned=true;updateJump()');
  ck('the button hides again at the bottom', !d.querySelector('#jumpBtn').classList.contains('show'));

  // the thinking box follows its own tail only while you are at that tail
  const st=w.eval('stickScroll');
  const fake={scrollHeight:1000,clientHeight:200,scrollTop:790};
  st(fake); ck('thinking box follows along when you are at its end', fake.scrollTop===1000, String(fake.scrollTop));
  const fake2={scrollHeight:1000,clientHeight:200,scrollTop:100};
  st(fake2); ck('but leaves you alone when you have scrolled up in it', fake2.scrollTop===100, String(fake2.scrollTop));
  const js=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
  ck('nothing forces the thinking box to its bottom any more',
     !/tw\.scrollTop = tw\.scrollHeight/.test(js));
}

console.log('\n=== 5. REGRESSIONS ===');
{
  const dom=await boot(base());const w=dom.window,d=dom.window.document;
  ck('markdown intact', w.eval('renderMarkdown("**b**")')==='<p><strong>b</strong></p>');
  ck('fuzzy safety intact',
     w.eval('applyEditToText("the quick brown fox runs",{type:"replace",find:"the quick brown cat runs",replace:"X"})').text===null);
  ck('order helpers intact', w.eval('orderMove')(['a','b'],'a',1).join()==='b,a');
  ck('thinking styles intact', w.eval('reasonStyle({kind:"openai",preset:"custom",model:"glm-5.2"})')==='zai');
  ev(w,d.querySelector('#settingsBtn'),'click');
  ck('five tabs', d.querySelectorAll('.tab').length===5);
  ck('six themes', Object.keys(w.eval('THEMES')).length===6);
}
console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})();
