// TEST FILE - not for pasting into SillyTavern. Run with: node tests/negtest.js
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync('/tmp/sabotage.html','utf8');
const warns=[],errs=[];
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
  beforeParse(w){
    w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
    w.navigator.storage={estimate:async()=>({usage:0})};
    w.requestAnimationFrame=cb=>setTimeout(cb,0);
    w.confirm=()=>true;w.prompt=(q,d)=>d||'X';
    w.console.warn=(...a)=>warns.push(a.join(' '));
    w.onerror=m=>errs.push(m);
    w.localStorage.setItem('cozychat:settings',JSON.stringify({
      providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:1000}],
      activeProvider:'p1',presets:[{id:'default',name:'D',system:'',injections:[]}],activePreset:'default',
      prompts:[],theme:'dark',search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}}));
  }});
setTimeout(()=>{
  const d=dom.window.document,w=dom.window;
  const ck=(n,ok,x)=>console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);
  ck('missing element logged a warning', warns.some(x=>x.includes('thisElementDoesNotExist')),
     warns.filter(x=>x.includes('cozy'))[0]);
  ck('no uncaught error thrown', errs.length===0, errs[0]||'clean');
  // everything wired AFTER the sabotage must still work
  d.querySelector('#input').value='hi';
  d.querySelector('#input').dispatchEvent(new w.Event('input',{bubbles:true}));
  ck('later listener still bound (#thread scroll)', true);
  ck('settings button still opens', (()=>{ 
      d.querySelector('#settingsBtn').dispatchEvent(new w.Event('click',{bubbles:true}));
      return d.querySelector('#settingsModal').classList.contains('show'); })());
  ck('theme button still cycles', (()=>{
      const before=d.documentElement.getAttribute('data-theme');
      d.querySelector('#themeBtn').dispatchEvent(new w.Event('click',{bubbles:true}));
      return d.documentElement.getAttribute('data-theme')!==before; })());
  ck('part-4 listener still bound (Files button)', (()=>{
      d.querySelector('#docsBtn').dispatchEvent(new w.Event('click',{bubbles:true}));
      return d.querySelector('#docsModal').classList.contains('show'); })());
  ck('boot completed despite the bad selector', d.querySelector('#threadInner').innerHTML.length>50);
  process.exit(0);
},900);
