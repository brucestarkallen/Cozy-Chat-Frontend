// TEST FILE — run with: node tests/v523test.js
// Guards v5.2.3: a fling survives its release. Where a fling ends up is in
// the momentum, not in where the finger let go — so lifting decides nothing,
// the coast runs untouched by paints and following, and only the settle
// reads the final position and decides the pin.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=()=>({
  providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000}],
  activeProvider:'p1',presets:[{id:'d',name:'D',system:'',injections:[],order:['__main__','__chat__']}],
  activePreset:'d',prompts:[],temperature:1,maxTokens:4096,effort:'off',squashSystem:true,
  showThinking:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}});
function boot(st,f){return new Promise(res=>{
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
    beforeParse(w){
      w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
      w.navigator.storage={estimate:async()=>({usage:0})};
      w.requestAnimationFrame=cb=>setTimeout(cb,0);
      w.confirm=()=>true;w.navigator.vibrate=()=>true;
      w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
      if(f)w.fetch=f(w);
    }});
  setTimeout(async()=>{try{
    await dom.window.eval('Promise.all([DB.clear(),DB.docClear()])');
    dom.window.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();');
  }catch(_){}res(dom);},750);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ev=(w,el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true}));
function rig(w,sh){
  const t=w.document.querySelector('#thread');
  let st=0, H={v:sh||1000};
  Object.defineProperty(t,'scrollHeight',{configurable:true,get:()=>H.v});
  Object.defineProperty(t,'clientHeight',{configurable:true,get:()=>500});
  Object.defineProperty(t,'scrollTop',{configurable:true,
    get:()=>st,
    set:v=>{const nv=Math.max(0,Math.min(H.v-500,v)); if(nv!==st){st=nv; t.dispatchEvent(new w.Event('scroll'));}}});
  return {t, at:()=>st, grow:v=>{H.v=v;}, user:v=>{t.scrollTop=v;}};
}
function gated(w,chunks){
  const enc=t=>new TextEncoder().encode(t);
  let i=0; w.__step=null;
  const next=()=>new Promise(res=>{w.__step=()=>{w.__step=null;res();};});
  return ()=>Promise.resolve({ok:true,body:{getReader(){return{read(){
    if(i>=chunks.length)return Promise.resolve({done:true});
    return next().then(()=>({done:false,value:enc(chunks[i++])}));
  }};}}});
}
const oa=t=>'data: '+JSON.stringify({choices:[{delta:{content:t}}]})+'\n\n';
const stream6=w=>gated(w,[oa('one '),oa('two '),oa('three '),oa('four '),oa('five '),oa('six')]);

(async()=>{

console.log('=== 1. THE REPORTED BUG: SLIDE UP, QUICK RELEASE, MID-STREAM ===');
{
  const dom=await boot(base(),stream6);
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  const r=rig(w);
  d.querySelector('#input').value='go'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await sleep(60); w.__step(); await sleep(60);
  ck('setup: following at the tail', w.eval('pinned')===true && r.at()===500, r.at());
  ev(w,r.t,'touchstart');
  r.user(460);                                   // a short flick — still inside the pin threshold
  ev(w,r.t,'touchend');                          // released while still near the bottom
  ck('release does not slam back down', r.at()===460, r.at());
  w.__step(); await sleep(60);                   // a token arrives during the coast
  ck('a token during the coast does not either', r.at()===460, r.at());
  r.user(300); r.user(150);                      // the momentum carries the view up
  ck('the momentum is never interrupted', r.at()===150, r.at());
  w.__step(); await sleep(60);                   // another token mid-momentum
  ck('tokens mid-momentum change nothing', r.at()===150, r.at());
  await sleep(220);                              // the scroll goes quiet
  ck('the settle reads where the fling ended: unpinned', w.eval('pinned')===false);
  w.__step(); await sleep(60);
  ck('and reading stays exactly where you are', r.at()===150, r.at());
}

console.log('\n=== 1b. THE REPLY FINISHES WHILE YOU ARE COASTING ===');
{
  const dom=await boot(base(),w=>gated(w,[oa('start '),oa('end.')]));
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  const r=rig(w);
  d.querySelector('#input').value='go'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await sleep(60); w.__step(); await sleep(60);
  ck('setup: following at the tail', r.at()===500, r.at());
  ev(w,r.t,'touchstart'); r.user(460); ev(w,r.t,'touchend');   // flick, released near the bottom
  w.__step(); await sleep(250);                  // the stream COMPLETES during the coast
  ck('the reply landed', w.eval('current.messages[1].content')==='start end.');
  ck('its final render does not slam the coast', r.at()===460, r.at());
  r.user(150);                                   // the momentum was still alive
  await sleep(220);
  ck('and the settle still decides: unpinned', w.eval('pinned')===false && r.at()===150, r.at());
}

console.log('\n=== 2. A FLING BACK DOWN RESUMES FOLLOWING ===');
{
  const dom=await boot(base(),stream6);
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  const r=rig(w);
  d.querySelector('#input').value='go'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await sleep(60); w.__step(); await sleep(60);
  r.user(100);                                   // reading above
  ck('setup: unpinned above', w.eval('pinned')===false);
  ev(w,r.t,'touchstart');
  r.user(250);
  ev(w,r.t,'touchend');
  r.user(380); r.user(470);                      // momentum toward the tail
  await sleep(220);
  ck('settling at the tail re-pins', w.eval('pinned')===true);
  r.grow(1200);
  w.__step(); await sleep(60);
  ck('and the next token follows again', r.at()===700, r.at());
}

console.log('\n=== 3. SCROLLEND SETTLES THE COAST EARLY ===');
{
  const dom=await boot(base());const w=dom.window;
  w.eval('newConvo(); current.messages.push({id:"1",role:"user",content:"q"}); renderThread();');
  const r=rig(w);
  r.user(500);
  ev(w,r.t,'touchstart'); r.user(200); ev(w,r.t,'touchend');
  ck('coasting: the pin is not yet resampled', w.eval('pinned')===true);
  ev(w,r.t,'scrollend');                         // the browser says the scroll is done
  ck('scrollend settles without waiting', w.eval('pinned')===false);
}

console.log('\n=== 4. A FINGER CATCHES THE COAST ===');
{
  const dom=await boot(base(),stream6);
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  const r=rig(w);
  d.querySelector('#input').value='go'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await sleep(60); w.__step(); await sleep(60);
  const body=()=>d.querySelector('.msg.assistant .msg-body');
  ev(w,r.t,'touchstart'); r.user(300); ev(w,r.t,'touchend');   // fling…
  ev(w,r.t,'touchstart');                                      // …caught mid-air
  const held=body().innerHTML;
  await sleep(220);                               // the old coast timer must be dead
  ck('the stale settle never fires under the finger', w.eval('pinned')===true);
  w.__step(); await sleep(60);
  ck('and the message stays frozen under it', body().innerHTML===held);
  ev(w,r.t,'touchend'); await sleep(250);
  ck('release then settles normally', w.eval('pinned')===false);
  ck('with the catch-up applied', body().innerHTML!==held);
}

console.log('\n=== 5. JUMP CUTS THROUGH THE COAST ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document;
  w.eval('newConvo(); current.messages.push({id:"1",role:"user",content:"q"}); renderThread();');
  const r=rig(w);
  r.user(500); r.user(150);
  ck('setup: reading above, jump offered', w.eval('pinned')===false && d.querySelector('#jumpBtn').classList.contains('show'));
  ev(w,r.t,'touchstart'); r.user(140); ev(w,r.t,'touchend');   // coasting
  d.querySelector('#jumpBtn').dispatchEvent(new w.Event('click',{bubbles:true}));
  ck('jump lands at the tail immediately', r.at()===500, r.at());
  ck('and following is back on', w.eval('pinned')===true);
}

console.log('\nRESULT:',fail?('FAILURES: '+fail):'ALL PASS','('+pass+' checks)');
process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
