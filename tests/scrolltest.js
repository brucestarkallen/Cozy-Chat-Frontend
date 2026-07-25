// Guards the reported bug: a long instruction sitting in a short box that
// becomes its own scroll container, nested inside the panel's scroll.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync('./out/index.html','utf8');
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

  console.log('=== 1. NO NESTED SCROLL IN SETTINGS ===');
  const css=[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
  ck('text boxes never scroll internally', /textarea\.f\{[^}]*overflow-y:hidden/.test(css));
  ck('and have no resize handle to fight the panel', /textarea\.f\{[^}]*resize:none/.test(css));
  ck('the panel itself scrolls', /\.sheet-body\{[^}]*overflow-y:auto/.test(css));

  console.log('\n=== 2. A LONG BLOCK GROWS TO FIT ===');
  d.querySelector('[data-edit="x"]').dispatchEvent(new w.Event('click',{bubbles:true}));
  const ta=d.querySelector('.ord-editor textarea');
  ck('editor opened', !!ta);
  w.eval('autoSize')(ta);
  const h=parseInt(ta.style.height);
  ck('height was set from the content, not left at the default', h>1000, ta.style.height);
  ck('it is taller than the panel, so the panel scrolls instead', h > 800, h+'px');
  ck('internal scrolling is switched off on the element', ta.style.overflowY==='hidden', ta.style.overflowY);

  console.log('\n=== 3. IT KEEPS UP WHILE TYPING ===');
  ta.value = LONG + '\n' + LONG;
  ta.dispatchEvent(new w.Event('input',{bubbles:true}));
  const h2=parseInt(ta.style.height);
  ck('doubling the text roughly doubles the box', h2 > h * 1.8, h+' -> '+h2);
  ta.value = 'short';
  ta.dispatchEvent(new w.Event('input',{bubbles:true}));
  ck('deleting text shrinks it back', parseInt(ta.style.height) < 200, ta.style.height);

  console.log('\n=== 4. THE MAIN PROMPT BEHAVES IDENTICALLY ===');
  d.querySelectorAll('.tab')[2].dispatchEvent(new w.Event('click',{bubbles:true}));
  const sp=d.querySelector('#sysPrompt');
  w.eval('autoSize')(sp);
  ck('main prompt grows too', parseInt(sp.style.height)>1000, sp.style.height);
  ck('same helper drives both', sp.style.overflowY==='hidden');
  const chatSys=d.querySelector('#chatSys');
  ck('the per-chat box is covered as well', !!chatSys);

  console.log('\n=== 5. SIZED ON OPEN, NOT ONLY ON TYPING ===');
  const js=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
  ck('block editors are sized right after rendering', /el\.innerHTML = rows;\s*autoSizeAll\(el\)/.test(js));
  ck('main fields are sized when settings sync', /autoSize\(\$\("#sysPrompt"\)\); autoSize\(\$\("#chatSys"\)\)/.test(js));
  // behaviour, not source text: change a value behind the panel's back, reopen,
  // and the control must reflect it — and be sized to it
  d.querySelector('#closeSettings').dispatchEvent(new w.Event('click',{bubbles:true}));
  w.eval('PS().system = "one line only"; saveSettings();');
  d.querySelector('#settingsBtn').dispatchEvent(new w.Event('click',{bubbles:true}));
  ck('reopening re-reads the value', d.querySelector('#sysPrompt').value==='one line only',
     d.querySelector('#sysPrompt').value.slice(0,20));
  ck('and re-sizes the box to it', parseInt(d.querySelector('#sysPrompt').style.height) < 200,
     d.querySelector('#sysPrompt').style.height);

  console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
  process.exit(fail?1:0);
},900);
