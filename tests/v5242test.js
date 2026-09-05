// TEST FILE — run with: node tests/v5242test.js
// Guards v5.24.2: a file that leaves the chat leaves an explicit absence, not
// a hallucination. The wire says the file is no longer attached and its text
// is gone — once, on the first request after it leaves — no matter which way
// it left (the popover, a project dropping it, deleting the doc). Retries
// keep the note, probes never consume it, and re-attaching silences it.
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
    if (r.status===400){
      return Promise.resolve({ok:false,status:400,
        json:()=>Promise.resolve({error:{message:r.msg}}),
        text:()=>Promise.resolve(r.msg)});
    }
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

(async()=>{

console.log('=== 1. THE FILE LEAVES AN ABSENCE, NOT A HALLUCINATION ===');
{
  const dom=await boot(base(),w=>fq(w,[{sse:[oa('one.')]},{sse:[oa('two.')]}]));
  const w=dom.window;
  await w.eval('(async()=>{const doc=await newDoc("canon.md","The hero is Jovan Oda.");newConvo();await attachDoc(doc.id);})()');
  await sendMsg(w,'who is the hero?');
  ck('attached, the file rides and no note is needed', sysOf(w,0).indexOf('Jovan Oda')>=0 && sysOf(w,0).indexOf('no longer attached')<0);
  await w.eval('(function(){current.docIds=[];current.filesOn=false;return persist();})()');
  await sendMsg(w,'what was his name again?');
  ck('the wire names what left', sysOf(w,1).indexOf('no longer attached to this chat: canon.md')>=0, sysOf(w,1).slice(0,120));
  ck('and says the text is gone — never from memory', sysOf(w,1).indexOf('NOT in this conversation anymore')>=0);
  ck('the file text itself is gone', sysOf(w,1).indexOf('Jovan Oda')<0);
  ck('the reply still arrived', w.eval('current.messages[current.messages.length-1].content').indexOf('two.')>=0);
  await sendMsg(w,'and the message after that?');
  ck('the note fires once — the next turn is clean again', sysOf(w,2).indexOf('no longer attached')<0);
}

console.log('=== 2. RE-ATTACHING SILENCES IT, DETACHING AGAIN SPEAKS AGAIN ===');
{
  const dom=await boot(base(),w=>fq(w,[{sse:[oa('a.')]},{sse:[oa('b.')]},{sse:[oa('c.')]},{sse:[oa('d.')]}]));
  const w=dom.window;
  await w.eval('(async()=>{const doc=await newDoc("canon.md","BODY");newConvo();await attachDoc(doc.id);})()');
  await sendMsg(w,'one');
  await w.eval('(function(){current.docIds=[];current.filesOn=false;return persist();})()');
  await sendMsg(w,'two');
  ck('detached: note', sysOf(w,1).indexOf('no longer attached')>=0);
  await w.eval('(async()=>{await attachDoc(docs[0].id);})()');
  await sendMsg(w,'three');
  ck('re-attached: no note, file back', sysOf(w,2).indexOf('no longer attached')<0 && sysOf(w,2).indexOf('BODY')>=0);
  await w.eval('(function(){current.docIds=[];current.filesOn=false;return persist();})()');
  await sendMsg(w,'four');
  ck('detached again: the note speaks again', sysOf(w,3).indexOf('no longer attached to this chat: canon.md')>=0);
}

console.log('=== 3. EVERY WAY OUT LEAVES THE SAME NOTE ===');
{
  // the project drops the file
  const dom=await boot(base(),w=>fq(w,[{sse:[oa('a.')]},{sse:[oa('b.')]}]));
  const w=dom.window;
  await w.eval(`(async function(){
    const doc=await newDoc("canon.md","CANON BODY");
    S.projects=[{id:"pr1",name:"P",docIds:[doc.id],system:"",injections:[],order:[]}];
    saveSettings(); newConvo(null,"pr1");
  })()`);
  await sendMsg(w,'one');
  ck('project file rides', sysOf(w,0).indexOf('CANON BODY')>=0);
  await w.eval('(function(){S.projects[0].docIds=[];saveSettings();return persist();})()');
  await sendMsg(w,'two');
  ck('a project dropping it names it the same way', sysOf(w,1).indexOf('no longer attached to this chat: canon.md')>=0);
}
{
  // the doc is deleted outright
  const dom=await boot(base(),w=>fq(w,[{sse:[oa('a.')]},{sse:[oa('b.')]}]));
  const w=dom.window;
  await w.eval('(async()=>{const doc=await newDoc("canon.md","CANON BODY");newConvo();await attachDoc(doc.id);})()');
  await sendMsg(w,'one');
  await w.eval('(function(){current.docIds=[];docs.splice(0);return persist();})()');
  await sendMsg(w,'two');
  ck('deleting the doc names it too', sysOf(w,1).indexOf('no longer attached to this chat: canon.md')>=0);
}

console.log('=== 4. A RETRY KEEPS THE NOTE ===');
{
  const dom=await boot(base(),w=>fq(w,[
    {sse:[oa('a.')]},
    {status:400,msg:"reasoning_effort 'max' is not supported"},
    {sse:[oa('b.')]}]));
  const w=dom.window;
  await w.eval('(async()=>{const doc=await newDoc("canon.md","BODY");newConvo();await attachDoc(doc.id);})()');
  await sendMsg(w,'one');
  await w.eval('(function(){current.docIds=[];current.filesOn=false;return persist();})()');
  w.eval('cfgSet("effort","max")');
  await sendMsg(w,'two');
  ck('three requests: the send, the refused retry, the healed one', w.__reqs.length===3, String(w.__reqs.length));
  ck('the refusal still carried the note', sysOf(w,1).indexOf('no longer attached')>=0);
  ck('and the healed retry carried it too', sysOf(w,2).indexOf('no longer attached')>=0);
}

console.log('=== 5. PROBES NEVER CONSUME IT, AND THE UNATTACHED NEVER SEE IT ===');
{
  const dom=await boot(base());const w=dom.window;
  w.eval(`(function(){newConvo();
    current.sentDocNames=["canon.md"];
    current.messages.push({id:uid(),role:"user",content:"go",ts:1});})()`);
  const a=w.eval('assembleMessages("openai").system');
  const b=w.eval('assembleMessages("openai").system');
  ck('assembling alone never spends the note', a.indexOf('no longer attached')>=0 && b.indexOf('no longer attached')>=0);
  w.eval('newConvo(); current.messages.push({id:uid(),role:"user",content:"go",ts:1});');
  ck('a chat that never had a file gets no note', w.eval('assembleMessages("openai").system').indexOf('no longer attached')<0);
}

console.log('');
console.log(fail?('FAILED '+fail):'ALL PASS','('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
