const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync('./out/index.html','utf8');
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
  ck('open/undo/detach are disabled with no file', d.querySelector('#docViewBtn').disabled===true);
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
  ck('and it is attached to this chat', w.eval('current.docId')===w.eval('docs[0].id'));
  ck('the top bar shows it', d.querySelector('#fileName').textContent==='plot-essential.md');
  ck('now the file contents go to the model',
     w.eval('assembleMessages("openai").system').includes('Act one.'));
  ck('and edits can target it',
     w.eval('applyEditToText(docs[0].text,{type:"replace",find:"Act one.",replace:"Act two."})').text.includes('Act two.'));
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
