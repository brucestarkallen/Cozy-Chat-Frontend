// Guards the reported bug: a long instruction sitting in a short box that
// becomes its own scroll container, nested inside the panel's scroll.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const LONG=Array.from({length:220},(_,i)=>'Line '+i+' of a long instruction block that will not fit in a short box.').join('\n');

const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
  beforeParse(w){
    w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
    w.navigator.storage={estimate:async()=>({usage:0})};
    w.requestAnimationFrame=cb=>setTimeout(cb,0);
    w.confirm=()=>true;w.prompt=(q,d)=>d||'X';w.navigator.clipboard={writeText:async()=>{}};
    w.localStorage.setItem('cozychat:settings',JSON.stringify({
      providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:9000}],
      activeProvider:'p1',prompts:[],theme:'dark',
      presets:[{id:'d',name:'D',system:LONG,
        injections:[{id:'x',name:'Plot essential maker',text:LONG,role:'system',pos:'relative',depth:0,enabled:true}],
        order:['__main__','x','__chat__']}],activePreset:'d',
      search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}}));
  }});

setTimeout(()=>{
  const w=dom.window,d=w.document,cs=el=>w.getComputedStyle(el);
  // jsdom has no layout: scrollHeight is 0, so autoSize cannot be measured
  // here. Give it a real measurement to work against.
  Object.defineProperty(w.HTMLTextAreaElement.prototype,'scrollHeight',{
    configurable:true,
    get(){ return 24 * (String(this.value).split('\n').length + 1); }
  });

  d.querySelector('#settingsBtn').dispatchEvent(new w.Event('click',{bubbles:true}));
  d.querySelectorAll('.tab')[2].dispatchEvent(new w.Event('click',{bubbles:true}));

  console.log('=== 1. SETTINGS NEVER GROWS A WALL OF TEXT ===');
  const css=[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
  ck('previews are a fixed height', /textarea\.f\{[^}]*height:112px/.test(css),
     (css.match(/textarea\.f\{[^}]*/)||[''])[0].slice(0,70));
  ck('they never scroll internally', /textarea\.f\{[^}]*overflow:hidden/.test(css));
  ck('nothing resizes them to fit content',
     !/autoSize/.test(html), 'autoSize refs: '+(html.match(/autoSize/g)||[]).length);
  ck('the panel is still the scroller', /\.sheet-body\{[^}]*overflow-y:auto/.test(css));

  console.log('\n=== 2. LONG TEXT OPENS ON ITS OWN SCREEN ===');
  d.querySelector('#settingsBtn').dispatchEvent(new w.Event('click',{bubbles:true}));
  d.querySelectorAll('.tab')[2].dispatchEvent(new w.Event('click',{bubbles:true}));
  d.querySelector('[data-edit="x"]').dispatchEvent(new w.Event('click',{bubbles:true}));
  const ta=d.querySelector('.ord-editor textarea');
  ck('the block shows a preview, not the whole text', !!ta && ta.readOnly, String(ta && ta.readOnly));
  ck('its height is not stretched by the content', !ta.style.height, ta.style.height||'unset');
  ta.dispatchEvent(new w.Event('click',{bubbles:true}));
  ck('tapping it opens the full-screen editor',
     d.querySelector('#bigModal').classList.contains('show'));
  ck('the editor is titled with the block name',
     d.querySelector('#bigTitle').textContent==='Plot essential maker', d.querySelector('#bigTitle').textContent);
  ck('and holds the whole text', d.querySelector('#bigArea').value===LONG);
  ck('with a size readout', /chars/.test(d.querySelector('#bigStat').textContent),
     d.querySelector('#bigStat').textContent);

  console.log('\n=== 3. THE EDITOR IS THE ONLY SCROLLER ===');
  ck('its body does not scroll', /#bigModal \.sheet-body\{[^}]*overflow:hidden/.test(css));
  ck('the textarea does', /#bigArea\{[^}]*overflow-y:auto/.test(css));
  ck('and it fills the space', /#bigArea\{[^}]*flex:1 1 auto/.test(css));

  console.log('\n=== 4. SAVING GOES BACK THROUGH THE NORMAL PATH ===');
  d.querySelector('#bigArea').value = 'rewritten by the big editor';
  d.querySelector('#bigSave').dispatchEvent(new w.Event('click',{bubbles:true}));
  ck('the modal closes', !d.querySelector('#bigModal').classList.contains('show'));
  ck('the block text is updated', w.eval('injById("x").text')==='rewritten by the big editor',
     w.eval('injById("x").text'));
  ck('the preview shows it', d.querySelector('.ord-editor textarea').value==='rewritten by the big editor');
  ck('it reaches the payload', w.eval(`(function(){current={id:'c',title:'t',messages:[{id:'1',role:'user',content:'U'}]};
     return assembleMessages("openai").system;})()`).includes('rewritten by the big editor'));

  console.log('\n=== 5. CANCEL LEAVES IT ALONE ===');
  d.querySelector('.ord-editor textarea').dispatchEvent(new w.Event('click',{bubbles:true}));
  d.querySelector('#bigArea').value='discard me';
  d.querySelector('#bigCancel').dispatchEvent(new w.Event('click',{bubbles:true}));
  ck('cancel closes', !d.querySelector('#bigModal').classList.contains('show'));
  ck('and changes nothing', w.eval('injById("x").text')==='rewritten by the big editor');

  console.log('\n=== 6. THE MAIN PROMPT WORKS THE SAME WAY ===');
  const sp=d.querySelector('#sysPrompt');
  ck('main prompt is a preview', sp.readOnly===true);
  ck('and is not stretched', !sp.style.height, sp.style.height||'unset');
  sp.dispatchEvent(new w.Event('click',{bubbles:true}));
  ck('tapping opens it full screen', d.querySelector('#bigModal').classList.contains('show'));
  ck('titled as the main prompt', d.querySelector('#bigTitle').textContent==='Main system prompt');
  d.querySelector('#bigArea').value='new main prompt';
  d.querySelector('#bigSave').dispatchEvent(new w.Event('click',{bubbles:true}));
  ck('saving updates the preset', w.eval('PS().system')==='new main prompt', w.eval('PS().system'));

  console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
  process.exit(fail?1:0);
},900);
