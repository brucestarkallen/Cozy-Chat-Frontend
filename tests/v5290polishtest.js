// TEST FILE — run with: node tests/v5290polishtest.js
// The last three things the v5.29.0 audit left, through the live page:
//   1. Ask again on a failed edit card, refused because another chat's reply
//      is still arriving, does not mark the card as asked
//   2. a connection with no key: the welcome screen names it, and its button
//      opens Settings at that connection's key
//   3. Files -> Copy copies where the browser has no clipboard (Cozy opened
//      over plain http on another address) and says so
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=(o)=>Object.assign({
  providers:[{id:'o',preset:'custom',kind:'openai',name:'O',url:'https://o.test/v1',apiKey:'k',model:'m',ctx:200000}],
  activeProvider:'o',presets:[{id:'d',name:'D',system:'',injections:[],order:['__main__','__chat__']}],activePreset:'d',prompts:[],
  maxTokens:1024,effort:'off',showThinking:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}},o||{});
function boot(st,f,before){return new Promise(res=>{
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',beforeParse(w){
    w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;w.navigator.storage={estimate:async()=>({usage:0})};
    w.requestAnimationFrame=cb=>setTimeout(cb,0);w.confirm=()=>true;w.navigator.clipboard={writeText:async()=>{}};
    w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
    if(f)w.fetch=f(w);
    if(before)before(w);
  }});
  setTimeout(async()=>{try{
    await dom.window.eval('Promise.all([DB.clear(),DB.docClear()])');
    dom.window.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();');
  }catch(_){}res(dom);},800);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ev=(w,el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true}));
const enc=t=>new TextEncoder().encode(t);
const oa=t=>'data: '+JSON.stringify({choices:[{delta:{content:t}}]})+'\n\n';
const toastsOf=(w)=>{const out=[],t=w.document.querySelector('#toast');new w.MutationObserver(()=>out.push(t.textContent)).observe(t,{childList:true,characterData:true,subtree:true});return out;};

(async()=>{

console.log('=== 1. ASK AGAIN REFUSED BY A REPLY ARRIVING ELSEWHERE ===');
{
  let release=null,calls=0;
  const dom=await boot(base(),w=>()=>{ calls++;
    let i=0; return Promise.resolve({ok:true,status:200,body:{getReader(){return{read(){
      if(i===0){ i++; return Promise.resolve({done:false,value:enc(oa('Arriving '))}); }
      if(i===1) return new Promise(r=>{ release=()=>{ i++; r({done:true}); }; });
      return Promise.resolve({done:true});}};}}}); });
  const w=dom.window,d=w.document,toasts=toastsOf(w);
  w.eval('newConvo(); current.title="Busy chat"; renderSidebar();');
  d.querySelector('#input').value='hello'; ev(w,d.querySelector('#input'),'input');
  d.querySelector('#sendBtn').click(); await sleep(300);
  ck('setup: a reply is arriving in another chat', !!release && w.eval('!!(streaming && streaming.asstId)'));
  w.eval(`newConvo(); current.filesOn=true; current.messages.push({id:"u1",role:"user",content:"fix it"},
    {id:"a1",role:"assistant",content:"done",edits:[{id:"e1",type:"replace",find:"x",replace:"y",status:"failed",note:"couldn't find that text in the file"}]});
    renderThread();`);
  const btn=d.querySelector('[data-reask]');
  ck('setup: the failed card offers Ask again', !!btn && /Ask again/.test(btn.textContent));
  btn.click(); await sleep(300);
  ck('the ask is refused, naming the busy chat', toasts.some(t=>/Busy chat/.test(t)), JSON.stringify(toasts));
  ck('nothing was sent', calls===1, calls+' requests');
  const asked=w.eval('current.messages[1].edits[0].asked');
  const again=d.querySelector('[data-reask]');
  ck('and the card does not claim an ask that never went out', !asked && again && !/↻/.test(again.textContent), JSON.stringify({asked, label: again && again.textContent}));
  release(); await sleep(300);
}

console.log('\n=== 2. A CONNECTION WITH NO KEY ===');
{
  const dom=await boot(base({providers:[{id:'nk',preset:'custom',kind:'openai',name:'My Relay',url:'https://r.test/v1',apiKey:'',model:'m',ctx:200000}],activeProvider:'nk'}));
  const w=dom.window,d=w.document;
  const wel=d.querySelector('.welcome');
  ck('the welcome screen names the connection that needs its key', !!wel && /My Relay/.test(wel.textContent) && !/Add a connection to start/.test(wel.textContent), wel && wel.textContent.slice(0,120));
  const b=wel && wel.querySelector('button');
  if(b) b.click(); await sleep(200);
  ck('its button opens Settings at that connection', d.querySelector('#settingsModal').classList.contains('show') && w.eval('editingProv')==='nk', w.eval('editingProv'));
  ck('with the key box ready to paste into', d.activeElement && d.activeElement.id==='pKey', d.activeElement && d.activeElement.id);
}
{
  const dom=await boot(base({providers:[],activeProvider:null}));
  const d=dom.window.document, wel=d.querySelector('.welcome');
  ck('with no connection at all it still says to add one', !!wel && /Add a connection/.test(wel.textContent), wel && wel.textContent.slice(0,80));
}

console.log('\n=== 3. FILES -> COPY WITHOUT A CLIPBOARD ===');
{
  let copied=null;
  const dom=await boot(base(),null,w=>{
    delete w.navigator.clipboard;
    Object.defineProperty(w.navigator,'clipboard',{value:undefined,configurable:true});
    w.document.execCommand=function(c){ if(c!=='copy') return false; const all=w.document.querySelectorAll('textarea'); copied=all[all.length-1].value; return true; };
  });
  const w=dom.window,d=w.document,toasts=toastsOf(w);
  await w.eval('newDoc("notes.md","Kira is an archmage.")');
  w.eval('openDocEditor(docs[0].id)');
  let threw='';
  try { d.querySelector('#docCopyBtn').click(); } catch(e){ threw=String(e); }
  await sleep(200);
  ck('the file text is copied', copied==='Kira is an archmage.', threw || JSON.stringify(copied));
  ck('and it says so', toasts.some(t=>/^Copied/.test(t)), JSON.stringify(toasts));
}

console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})();
