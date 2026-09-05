// TEST FILE — run with: node tests/v5243test.js
// Guards v5.24.3: chats from before the detachment memory existed get the
// honest reconstruction: a file the assistant provably had — its replies
// edited it, and the cards keep the name — is named as gone if it is no
// longer attached. A file that was only discussed left no trace, and the app
// never invents one: no trace, no note.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=(o={})=>Object.assign({
  providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000}],
  activeProvider:'p1',
  presets:[{id:'d',name:'D',system:'BASE',injections:[],order:['__main__','__chat__']}],
  activePreset:'d',prompts:[],projects:[],temperature:1,maxTokens:4096,effort:'off',squashSystem:true,
  showThinking:true,showTools:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}},o);
function boot(st,f){return new Promise(res=>{
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
    beforeParse(w){
      w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
      w.navigator.storage={estimate:async()=>({usage:0})};
      w.requestAnimationFrame=cb=>setTimeout(cb,0);
      w.confirm=()=>true;w.prompt=(q,d)=>d||'X';w.navigator.clipboard={writeText:async()=>{}};
      w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
      if(f)w.fetch=f(w);
    }});
  setTimeout(async()=>{try{
    await dom.window.eval('Promise.all([DB.clear(),DB.docClear()])');
    dom.window.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();');
  }catch(_){}res(dom);},750);});}
const ev=(w,el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true}));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const oa=t=>'data: '+JSON.stringify({choices:[{delta:{content:t}}]})+'\n\n';
function fq(w,responses){
  w.__reqs=[];
  const enc=t=>new TextEncoder().encode(t);
  let i=0;
  return (url,opts)=>{
    const r=responses[Math.min(i++,responses.length-1)];
    w.__reqs.push({body:opts&&opts.body?JSON.parse(opts.body):null});
    let k=0; w.__step=null;
    const next=()=>new Promise(res=>{w.__step=()=>{w.__step=null;res();};});
    return Promise.resolve({ok:true,body:{getReader(){return{read(){
      return new Promise((res2,rej)=>{
        const sig=opts&&opts.signal;
        const bail=()=>rej(Object.assign(new Error('aborted'),{name:'AbortError'}));
        if(sig&&sig.aborted)return bail();
        if(sig)sig.addEventListener('abort',bail,{once:true});
        if(k>=r.sse.length)return res2({done:true});
        next().then(()=>{ if(sig&&sig.aborted)return; res2({done:false,value:enc(r.sse[k++])}); });
      });}};}}});
  };
}
async function drain(w,n){for(let k=0;k<n;k++){await sleep(60);w.__step&&w.__step();}await sleep(300);}
async function sendMsg(w,text){
  const d=w.document;
  d.querySelector('#input').value=text; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await drain(w,3);
}
const sysOf=(w,n)=>JSON.stringify(w.__reqs[n].body);
const oldChatWith=(w,edits)=>w.eval(`(function(){
  newConvo();
  current.messages.push({id:"u1",role:"user",content:"fix the file",ts:1});
  current.messages.push({id:"a1",role:"assistant",content:"done",ts:2,edits:${JSON.stringify(edits)}});
})()`);

(async()=>{

console.log('=== 1. AN OLD CHAT THAT PROVABLY HAD THE FILE GETS THE NOTE ===');
{
  const dom=await boot(base(),w=>fq(w,[{sse:[oa('ok.')]},{sse:[oa('ok2.')]}]));
  const w=dom.window;
  oldChatWith(w,[{id:'e1',type:'replace',find:'a',file:'canon.md',replace:'b',reason:'',status:'applied'}]);
  await sendMsg(w,'and now?');
  ck('the edit card\'s name is remembered as gone', sysOf(w,0).indexOf('no longer attached to this chat: canon.md')>=0, sysOf(w,0).slice(0,120));
  ck('the memory then becomes the current set — one note, once', w.eval('JSON.stringify(current.sentDocNames)')==='[]');
  await sendMsg(w,'and after?');
  ck('the next turn is clean', sysOf(w,1).indexOf('no longer attached')<0);
}

console.log('=== 2. A FILE STILL ATTACHED IS NOT CALLED GONE ===');
{
  const dom=await boot(base(),w=>fq(w,[{sse:[oa('ok.')]}]));
  const w=dom.window;
  await w.eval('(async()=>{const doc=await newDoc("canon.md","BODY");newConvo();await attachDoc(doc.id);})()');
  w.eval(`(function(){current.messages.push({id:"u1",role:"user",content:"q",ts:1});
    current.messages.push({id:"a1",role:"assistant",content:"done",ts:2,
      edits:[{id:'e1',type:'replace',find:'a',file:'canon.md',replace:'b',reason:'',status:'applied'}]});})()`);
  await sendMsg(w,'go');
  ck('still attached, still no note', sysOf(w,0).indexOf('no longer attached')<0);
}

console.log('=== 3. NO TRACE, NO NOTE — THE APP NEVER INVENTS A FILE ===');
{
  const dom=await boot(base(),w=>fq(w,[{sse:[oa('ok.')]}]));
  const w=dom.window;
  w.eval(`(function(){newConvo();
    current.messages.push({id:"u1",role:"user",content:"we talked about a file, remember?",ts:1});
    current.messages.push({id:"a1",role:"assistant",content:"sure, I discussed it at length",ts:2});})()`);
  await sendMsg(w,'what was in it?');
  ck('a file that was only discussed is not fabricated into the note', sysOf(w,0).indexOf('no longer attached')<0);
}

console.log('=== 4. AN UNDONE EDIT STILL PROVES THE FILE WAS THERE ===');
{
  const dom=await boot(base(),w=>fq(w,[{sse:[oa('ok.')]}]));
  const w=dom.window;
  oldChatWith(w,[{id:'e1',type:'replace',find:'a',file:'canon.md',replace:'b',reason:'',status:'undone'}]);
  await sendMsg(w,'go');
  ck('undone or not, the file was context — the note names it', sysOf(w,0).indexOf('canon.md')>=0);
}

console.log('=== 5. A FRESH CHAT BEHAVES EXACTLY AS BEFORE ===');
{
  const dom=await boot(base(),w=>fq(w,[{sse:[oa('ok.')]},{sse:[oa('ok2.')]}]));
  const w=dom.window;
  await w.eval('(async()=>{const doc=await newDoc("canon.md","BODY");newConvo();await attachDoc(doc.id);})()');
  await sendMsg(w,'one');
  ck('attached: file rides, no note', sysOf(w,0).indexOf('BODY')>=0 && sysOf(w,0).indexOf('no longer attached')<0);
  await w.eval('(function(){current.docIds=[];current.filesOn=false;return persist();})()');
  await sendMsg(w,'two');
  ck('detached after a remembered send: note, as always', sysOf(w,1).indexOf('no longer attached to this chat: canon.md')>=0);
}

console.log('');
console.log(fail?('FAILED '+fail):'ALL PASS','('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
