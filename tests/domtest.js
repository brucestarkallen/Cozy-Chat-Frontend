// TEST FILE - not for pasting into SillyTavern. Run with: node tests/domtest.js
const fs=require('fs');
const {JSDOM}=require('jsdom');
require('fake-indexeddb/auto');

const html=fs.readFileSync('/home/claude/build/out/index.html','utf8');
const errors=[];
const dom=new JSDOM(html,{
  runScripts:'dangerously',
  pretendToBeVisual:true,
  url:'https://example.com/',
  beforeParse(w){
    w.indexedDB=global.indexedDB;
    w.IDBKeyRange=global.IDBKeyRange;
    w.navigator.storage={estimate:async()=>({usage:1024})};
    w.requestAnimationFrame=cb=>setTimeout(cb,0);
    w.confirm=()=>true;
    w.onerror=(m)=>errors.push('window.onerror: '+m);
  }
});
dom.virtualConsole.on('jsdomError',e=>errors.push('jsdomError: '+e.message));
dom.virtualConsole.on('error',e=>errors.push('console.error: '+e));

setTimeout(()=>{
  const d=dom.window.document;
  const checks=[
    ['app shell', !!d.querySelector('.app')],
    ['sidebar', !!d.querySelector('#sidebar')],
    ['thread rendered', d.querySelector('#threadInner').innerHTML.length>50],
    ['welcome shown', d.querySelector('#threadInner').innerHTML.includes('Add a connection')],
    ['ember bar', !!d.querySelector('#emberFill')],
    ['ctx label filled', d.querySelector('#ctxLabel').textContent.includes('tokens')],
    ['settings modal', !!d.querySelector('#settingsModal')],
    ['presets in select', d.querySelectorAll('#pPreset option').length===7],
    ['tabs', d.querySelectorAll('.tab').length===3],
    ['model chip', d.querySelector('#modelChip').textContent.length>0],
  ];
  let pass=true;
  for(const [n,ok] of checks){ console.log((ok?'  ok  ':'  FAIL'),n); if(!ok)pass=false; }

  // interaction: open settings
  d.querySelector('#settingsBtn').dispatchEvent(new dom.window.Event('click',{bubbles:true}));
  console.log((d.querySelector('#settingsModal').classList.contains('show')?'  ok  ':'  FAIL'),'settings opens');

  // add a provider through the UI
  d.querySelector('#addProvBtn').dispatchEvent(new dom.window.Event('click',{bubbles:true}));
  d.querySelector('#pKey').value='sk-test';
  d.querySelector('#pModel').value='claude-sonnet-4-6';
  d.querySelector('#saveProvBtn').dispatchEvent(new dom.window.Event('click',{bubbles:true}));
  const saved=JSON.parse(dom.window.localStorage.getItem('cozychat:settings'));
  console.log((saved.providers.length===1?'  ok  ':'  FAIL'),'provider saved to localStorage');
  console.log((saved.providers[0].kind==='anthropic'?'  ok  ':'  FAIL'),'anthropic kind set');
  console.log((d.querySelector('#modelChip').textContent.includes('claude-sonnet-4-6')?'  ok  ':'  FAIL'),'model chip updated');

  // theme toggle
  d.querySelector('#themeBtn').dispatchEvent(new dom.window.Event('click',{bubbles:true}));
  console.log((d.documentElement.getAttribute('data-theme')==='light'?'  ok  ':'  FAIL'),'theme toggles');

  // new chat + input
  d.querySelector('#newChatBtn').dispatchEvent(new dom.window.Event('click',{bubbles:true}));
  const inp=d.querySelector('#input');
  inp.value='hello there';
  inp.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  console.log((!d.querySelector('#sendBtn').disabled?'  ok  ':'  FAIL'),'send enables on typing');
  console.log((parseFloat(d.querySelector('#emberFill').style.width)>0?'  ok  ':'  FAIL'),'ember reacts to input');

  console.log('\nERRORS:',errors.length?errors:'none');
  process.exit(pass&&errors.length===0?0:1);
},900);
