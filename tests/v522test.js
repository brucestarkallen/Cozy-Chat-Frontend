// TEST FILE — run with: node tests/v522test.js
// Guards v5.2.2: the reader owns the scroll. Once you scroll up, nothing —
// not a token paint, not a completed reply, not a re-render — drags you back
// down; your own return to the tail (or Jump, or a new send) is what resumes
// following. While a finger is on the thread the growing message underneath
// it is not repainted, and a code block swiped sideways keeps its place.
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
// give #thread real scroll geometry; setting scrollTop through the property
// fires a scroll event, exactly like a browser
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

(async()=>{

console.log('=== 1. A FORCED SCROLL CANNOT RE-PIN A READER ===');
{
  const dom=await boot(base());const w=dom.window;
  w.eval('newConvo(); current.messages.push({id:"1",role:"user",content:"q"},{id:"2",role:"assistant",content:"a"}); renderThread();');
  const r=rig(w);
  r.user(500);                                   // at the tail
  ck('setup: following at the tail', w.eval('pinned')===true);
  r.user(200);                                   // the user scrolls up to read
  ck('scrolling up unpins', w.eval('pinned')===false);
  w.eval('renderThread()');                      // any re-render
  ck('a re-render no longer yanks', r.at()===200, r.at());
  w.eval('scrollDown(true)');                    // an explicit program scroll
  ck('its echo does not re-pin', w.eval('pinned')===false);
  ck('the jump button is still offered', w.document.querySelector('#jumpBtn').classList.contains('show'));
}

console.log('\n=== 2. READING ABOVE, A WHOLE REPLY STREAMS AND FINISHES ===');
{
  const dom=await boot(base(),w=>gated(w,[oa('first part. '),oa('second part.')]));
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  const r=rig(w);
  d.querySelector('#input').value='go'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await sleep(60); w.__step(); await sleep(60);  // first chunk lands, following
  ck('while pinned the stream is followed', r.at()===500-0+ (0) || r.at()>380, r.at());
  r.user(100);                                   // the user scrolls up mid-stream
  w.__step(); await sleep(60);                   // second chunk while reading
  await sleep(250);                              // stream ends, finally renders
  ck('token paints never dragged the view down', r.at()===100, r.at());
  ck('the finished reply did not either', w.eval('pinned')===false && r.at()===100);
  ck('the reply itself is complete', w.eval('current.messages[1].content')==='first part. second part.');
}

console.log('\n=== 3. COMING BACK TO THE TAIL RESUMES FOLLOWING ===');
{
  const dom=await boot(base(),w=>gated(w,[oa('one '),oa('two '),oa('three')]));
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  const r=rig(w);
  d.querySelector('#input').value='go'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await sleep(60); w.__step(); await sleep(60);
  r.user(100);                                   // away
  w.__step(); await sleep(60);
  ck('unpinned while away', w.eval('pinned')===false && r.at()===100);
  r.user(460);                                   // the user returns near the tail
  ck('being back at the tail re-pins', w.eval('pinned')===true);
  r.grow(1200);
  w.__step(); await sleep(60);
  ck('the next token follows again', r.at()===700, r.at());
}

console.log('\n=== 4. A FINGER ON THE THREAD FREEZES THE WORLD ===');
{
  const dom=await boot(base(),w=>gated(w,[oa('alpha '),oa('beta '),oa('gamma')]));
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  const r=rig(w);
  d.querySelector('#input').value='go'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await sleep(60); w.__step(); await sleep(60);
  const body=()=>d.querySelector('.msg.assistant .msg-body');
  const before=body().innerHTML;
  ev(w,r.t,'touchstart');                        // finger down
  w.__step(); await sleep(60);                   // a chunk arrives under it
  ck('the message is not repainted under the finger', body().innerHTML===before);
  ck('but the data kept flowing', /beta/.test(w.eval('current.messages[1].content')));
  r.user(120);                                   // dragging up, events firing
  ck('mid-drag the pin is not resampled', w.eval('pinned')===true);
  r.grow(1200); w.eval('scrollDown()');
  ck('and following is suspended outright', r.at()===120, r.at());
  ev(w,r.t,'touchend');                          // finger lifts; momentum may follow
  ck('lift-off decides nothing', w.eval('pinned')===true && body().innerHTML===before);
  await sleep(220);                              // no momentum: the coast settles
  ck('the settle decides: unpinned', w.eval('pinned')===false);
  ck('the frozen paint catches up at the settle', /beta/.test(body().innerHTML));
  ck('without moving the view', r.at()===120, r.at());
}

console.log('\n=== 5. A GESTURE ENDING AT THE TAIL RE-PINS ===');
{
  const dom=await boot(base());const w=dom.window;
  w.eval('newConvo(); current.messages.push({id:"1",role:"user",content:"q"}); renderThread();');
  const r=rig(w);
  r.user(100);
  ck('setup: unpinned above', w.eval('pinned')===false);
  ev(w,r.t,'touchstart');
  r.user(650);                                   // dragged back down
  ev(w,r.t,'touchend');
  await sleep(220);                              // settle at the tail
  ck('settling at the tail resumes following', w.eval('pinned')===true);
}

console.log('\n=== 6. A SWIPED CODE BLOCK KEEPS ITS PLACE ===');
{
  const chunks=[oa('```\nconst x = 1;\n```\n'),oa('and then some prose '),oa('and more.')];
  const dom=await boot(base(),w=>gated(w,chunks));
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  rig(w);
  d.querySelector('#input').value='code'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await sleep(60); w.__step(); await sleep(60);
  const pre=d.querySelector('.msg.assistant .msg-body pre');
  ck('setup: the code block is on screen', !!pre);
  pre.scrollLeft=120;                            // the user swipes it sideways
  w.__step(); await sleep(60);                   // next token repaints the message
  const pre2=d.querySelector('.msg.assistant .msg-body pre');
  ck('the repaint rebuilt the block', pre2!==pre);
  ck('at the same horizontal place', pre2.scrollLeft===120, pre2.scrollLeft);
  w.__step(); await sleep(250);
  ck('still there when the reply finishes', d.querySelector('.msg.assistant .msg-body pre').scrollLeft===120);
}

console.log('\n=== 7. OPENING A CHAT STARTS AT ITS TAIL ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document;
  w.eval('newConvo(); current.title="A"; current.messages.push({id:"1",role:"user",content:"x"});');
  w.eval('newConvo(); current.title="B";');
  w.eval('persist()'); await sleep(80);
  const r=rig(w);
  r.user(150);
  ck('setup: unpinned in chat B', w.eval('pinned')===false);
  const rowA=[...d.querySelectorAll('#convoList [data-id]')].find(x=>x.textContent.includes('A'));
  rowA.dispatchEvent(new w.Event('click',{bubbles:true}));
  ck('opening another chat pins fresh', w.eval('pinned')===true);
  w.eval('newConvo()');
  ck('a new chat pins fresh too', w.eval('pinned')===true);
}

console.log('\nRESULT:',fail?('FAILURES: '+fail):'ALL PASS','('+pass+' checks)');
process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
