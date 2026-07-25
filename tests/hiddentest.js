// Guards the blue dot: an element with the hidden attribute that an author
// rule keeps on screen by setting display.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync('./out/index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
  beforeParse(w){
    w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
    w.navigator.storage={estimate:async()=>({usage:0})};
    w.requestAnimationFrame=cb=>setTimeout(cb,0);
    w.confirm=()=>true;w.prompt=(q,d)=>d||'X';w.navigator.clipboard={writeText:async()=>{}};
    w.localStorage.setItem('cozychat:settings',JSON.stringify({
      providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:9000}],
      activeProvider:'p1',prompts:[],theme:'dark',
      presets:[{id:'d',name:'D',system:'',injections:[],order:['__main__','__chat__']}],activePreset:'d',
      search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}}));
  }});
setTimeout(async ()=>{
  const w=dom.window,d=w.document,cs=el=>w.getComputedStyle(el);

  console.log('=== 1. hidden ALWAYS means hidden ===');
  // Chrome resolves the hidden attribute from its UA stylesheet, so any author
  // rule that sets display outranks it and the element stays visible — that is
  // the bug this file exists for. jsdom does NOT reproduce that: it keeps the
  // element hidden regardless. So the source-level check below is the real
  // guard, and the computed checks are a weaker backstop. This probe records
  // the difference so nobody mistakes them for proof.
  {
    const probe=new (require('jsdom').JSDOM)(
      '<!DOCTYPE html><html><head><style>.x{display:grid}</style></head>'+
      '<body><i class="x" hidden></i></body></html>');
    const el=probe.window.document.querySelector('.x');
    const differs=probe.window.getComputedStyle(el).display==='none';
    ck('harness note: jsdom hides [hidden] even when CSS sets display', differs,
       probe.window.getComputedStyle(el).display);
  }
  const css=[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
  ck('there is a global rule enforcing it', /\[hidden\]\{display:none !important\}/.test(css));
  // every element the app hides, checked for real
  for (const sel of ['#fileCount','#attachTray','#fileList','#provEditor']){
    const el=d.querySelector(sel);
    if (!el){ ck(sel+' exists', false); continue; }
    el.hidden = true;
    ck(sel+' really disappears when hidden', cs(el).display==='none', cs(el).display);
  }

  console.log('\n=== 2. THE COUNT BADGE ONLY SHOWS A COUNT ===');
  await w.eval(`(async()=>{ newConvo(); })()`);
  w.eval('renderFileBtn()');
  const badge=d.querySelector('#fileCount');
  ck('no files → badge hidden', badge.hidden===true && cs(badge).display==='none', cs(badge).display);
  ck('and it is empty, not a blank dot', badge.textContent==='', JSON.stringify(badge.textContent));

  await w.eval(`(async()=>{ const a=await newDoc("one.md","x"); await attachDoc(a.id); })()`);
  await new Promise(r=>setTimeout(r,250));
  ck('one file → still no badge', d.querySelector('#fileCount').hidden===true);
  ck('the icon is lit though', d.querySelector('#fileBtn').classList.contains('on'));

  await w.eval(`(async()=>{ const b=await newDoc("two.md","y"); await attachDoc(b.id); })()`);
  await new Promise(r=>setTimeout(r,250));
  const b2=d.querySelector('#fileCount');
  ck('two files → badge appears', b2.hidden===false && cs(b2).display!=='none', cs(b2).display);
  ck('showing the number', b2.textContent==='2', b2.textContent);

  console.log('\n=== 3. THE ATTACHMENT TRAY TOO ===');
  w.eval('pendingAtts=[];renderAttachTray()');
  const tray=d.querySelector('#attachTray');
  ck('empty tray takes no space', cs(tray).display==='none', cs(tray).display);
  w.eval('pendingAtts=[{kind:"text",name:"n.txt",text:"t"}];renderAttachTray()');
  ck('tray appears once something is attached', cs(tray).display!=='none', cs(tray).display);

  console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
  process.exit(fail?1:0);
},900);
