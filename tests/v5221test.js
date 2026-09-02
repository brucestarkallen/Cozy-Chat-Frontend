// TEST FILE — run with: node tests/v5221test.js
// Guards v5.22.1: a thinking level the wire refuses can never eat a message.
// The level steps down one rung, the turn goes out again, and the connection
// remembers the cap until it is re-saved — the same bargain the prefill and
// the Runs API already had. The picker offers nothing above the cap, the
// stored choice is kept, and re-saving the connection clears the mark.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=(o={})=>Object.assign({
  providers:[
    {id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000},
    {id:'pA',preset:'anthropic',kind:'anthropic',name:'C',url:'https://c/v1',apiKey:'k',model:'claude',ctx:100000},
    {id:'pZ',preset:'zai',kind:'openai',name:'Z',url:'https://z/v1',apiKey:'k',model:'glm-5.3',ctx:100000}],
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
/* a fetch that answers from a queue: {status:400,msg} refuses, {sse:[chunks]} streams */
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
}

(async()=>{

console.log('=== 1. THE CAP CLAMPS INSIDE THE STYLE\'S LADDER ===');
{
  const dom=await boot(base());const w=dom.window;
  ck('max under a high cap sends as high', w.eval('effortFor("anthropic","max","high")')==='high');
  ck('max under an xhigh cap sends as xhigh', w.eval('effortFor("anthropic","max","xhigh")')==='xhigh');
  ck('a level under the cap is untouched', w.eval('effortFor("anthropic","medium","high")')==='medium');
  ck('the cap resolves through GLM\'s ladder', w.eval('effortFor("zai","max","high")')==='high');
  ck('and a stored xhigh under a GLM high cap', w.eval('effortFor("zai","xhigh","high")')==='high');
  ck('no cap keeps yesterday\'s behavior', w.eval('effortFor("zai","xhigh")')==='max' && w.eval('effortFor("openai","max")')==='max');
  ck('qwen still tops out at its own ceiling', w.eval('effortFor("qwen","max","high")')==='high');
}

console.log('=== 2. ONE RUNG DOWN, NEVER PAST LOW ===');
{
  const dom=await boot(base());const w=dom.window;
  ck('anthropic ladder steps down rung by rung',
     w.eval('effortStepDown("anthropic","max")')==='xhigh' && w.eval('effortStepDown("anthropic","xhigh")')==='high'
     && w.eval('effortStepDown("anthropic","high")')==='medium' && w.eval('effortStepDown("anthropic","medium")')==='low');
  ck('GLM skips the rung it does not have', w.eval('effortStepDown("zai","max")')==='high' && w.eval('effortStepDown("zai","high")')==='low');
  ck('low is the floor — off would switch thinking off', w.eval('effortStepDown("anthropic","low")')===null && w.eval('effortStepDown("zai","low")')===null);
}

console.log('=== 3. THE MARK LANDS ON THE STORED CONNECTION ===');
{
  const dom=await boot(base());const w=dom.window;
  w.eval('markEffortCap(Object.assign({}, S.providers[0]), "high")');
  ck('a per-chat copy still marks the real connection', w.eval('S.providers[0].effortCap')==='high');
  ck('and it persists', JSON.parse(w.localStorage.getItem('cozychat:settings')).providers[0].effortCap==='high');
  ck('the first mark reports itself, a repeat does not',
     w.eval('markEffortCap(S.providers[1],"high")')===true && w.eval('markEffortCap(S.providers[1],"high")')===false);
}

console.log('=== 4. A REFUSED LEVEL STEPS DOWN AND THE MESSAGE GOES OUT ===');
{
  const dom=await boot(base(),w=>fq(w,[
    {status:400,msg:"Unsupported value: 'reasoning_effort' is not supported with this model."},
    {sse:[oa('Healed.')]}
  ]));
  const w=dom.window,d=w.document;
  w.eval('newConvo(); cfgSet("effort","max");');
  await sendMsg(w,'think hard'); await drain(w,3);
  ck('two requests went out', w.__reqs.length===2, String(w.__reqs.length));
  ck('the first asked for max', w.__reqs[0].body.reasoning_effort==='max');
  ck('the retry stepped down one rung', w.__reqs[1].body.reasoning_effort==='xhigh', JSON.stringify(w.__reqs[1].body.reasoning_effort));
  ck('the reply arrived — the message was not spent finding out', d.querySelector('#threadInner').textContent.indexOf('Healed.')>=0);
  ck('the connection remembers the cap', w.eval('S.providers.find(x=>x.id==="p1").effortCap')==='xhigh');
  ck('and said so out loud', d.querySelector('#toast').textContent.indexOf('XHigh')>=0 && d.querySelector('#toast').textContent.indexOf('re-saved')>=0,
     d.querySelector('#toast').textContent);
}

console.log('=== 5. A SECOND REFUSAL STEPS DOWN AGAIN ===');
{
  const dom=await boot(base(),w=>fq(w,[
    {status:400,msg:"reasoning_effort 'max' is not supported"},
    {status:400,msg:"reasoning_effort 'xhigh' is not supported"},
    {sse:[oa('Third time.')]}
  ]));
  const w=dom.window,d=w.document;
  w.eval('newConvo(); cfgSet("effort","max");');
  await sendMsg(w,'go'); await drain(w,3);
  ck('three requests, one per rung', w.__reqs.length===3, String(w.__reqs.length));
  ck('max, then xhigh, then high',
     w.__reqs[0].body.reasoning_effort==='max' && w.__reqs[1].body.reasoning_effort==='xhigh' && w.__reqs[2].body.reasoning_effort==='high');
  ck('the cap landed where the wire stopped complaining', w.eval('S.providers.find(x=>x.id==="p1").effortCap')==='high');
  ck('the reply still arrived', d.querySelector('#threadInner').textContent.indexOf('Third time.')>=0);
}

console.log('=== 6. A KNOWN CAP IS RESPECTED FROM THE START ===');
{
  const prov=base().providers; prov[0].effortCap='high';
  const dom=await boot(base({providers:prov}),w=>fq(w,[{sse:[oa('Straight.')]}]));
  const w=dom.window,d=w.document;
  w.eval('newConvo(); cfgSet("effort","max");');
  await sendMsg(w,'go'); await drain(w,2);
  ck('one request — no re-learning a lesson already learned', w.__reqs.length===1, String(w.__reqs.length));
  ck('at the capped level', w.__reqs[0].body.reasoning_effort==='high', JSON.stringify(w.__reqs[0].body.reasoning_effort));
  ck('the saved choice was never rewritten', w.eval('chatEffort()')==='max');
}

console.log('=== 7. A REFUSAL AT LOW IS NOT A LEVEL PROBLEM ===');
{
  const dom=await boot(base(),w=>fq(w,[
    {status:400,msg:"reasoning_effort is not supported at all here"},
    {sse:[oa('never')]}
  ]));
  const w=dom.window,d=w.document;
  w.eval('newConvo(); cfgSet("effort","low");');
  await sendMsg(w,'go'); await drain(w,3);
  ck('no retry — there is no rung below low', w.__reqs.length===1, String(w.__reqs.length));
  ck('the error explains itself instead', d.querySelector('#threadInner').textContent.indexOf('said no (400)')>=0,
     d.querySelector('#threadInner').textContent.slice(-120));
  ck('nothing was marked', !w.eval('S.providers.find(x=>x.id==="p1").effortCap'));
}

console.log('=== 8. AN ORDINARY 400 IS NOT MISTAKEN FOR A LEVEL ===');
{
  const dom=await boot(base(),w=>fq(w,[
    {status:400,msg:"This model's maximum context length is 8192 tokens."},
    {sse:[oa('never')]}
  ]));
  const w=dom.window,d=w.document;
  w.eval('newConvo(); cfgSet("effort","max");');
  await sendMsg(w,'go'); await drain(w,3);
  ck('no retry for a context complaint', w.__reqs.length===1, String(w.__reqs.length));
  ck('the error surfaces as itself', d.querySelector('#threadInner').textContent.indexOf('maximum context length')>=0);
  ck('no cap invented', !w.eval('S.providers.find(x=>x.id==="p1").effortCap'));
}

console.log('=== 9. THE PICKER OFFERS NOTHING ABOVE THE CAP ===');
{
  const prov=base().providers; prov[1].effortCap='high';
  const dom=await boot(base({providers:prov}));const w=dom.window,d=w.document;
  w.eval('newConvo(); cfgSet("providerId","pA"); cfgSet("effort","max"); renderEffort();');
  ck('the rungs above the cap are gone', Array.from(d.querySelectorAll('#effortSeg button')).map(b=>b.dataset.effort).join(',')==='off,low,medium,high',
     Array.from(d.querySelectorAll('#effortSeg button')).map(b=>b.dataset.effort).join(','));
  ck('what it would send lights instead', (d.querySelector('#effortSeg button.on')||{}).dataset.effort==='high');
  ck('the stored choice is still there', w.eval('chatEffort()')==='max');
  ck('the hint explains, and names the cure', d.querySelector('#effortHint').textContent.indexOf('re-save')>=0,
     d.querySelector('#effortHint').textContent.slice(-90));
  ev(w,d.querySelector('#settingsBtn'),'click'); await sleep(120);
  d.querySelector('[data-editprov="pA"]').dispatchEvent(new w.Event('click',{bubbles:true})); await sleep(120);
  ck('the connection editor says it too', !d.querySelector('#pEffortStat').hidden && d.querySelector('#pEffortStat').textContent.indexOf('High')>=0,
     d.querySelector('#pEffortStat').textContent);
}

console.log('=== 10. RE-SAVING THE CONNECTION TRIES IT AGAIN ===');
{
  const prov=base().providers; prov[0].effortCap='high';
  const dom=await boot(base({providers:prov}));const w=dom.window,d=w.document;
  w.eval('newConvo()'); await sleep(120);
  ev(w,d.querySelector('#settingsBtn'),'click'); await sleep(120);
  d.querySelector('[data-editprov]').dispatchEvent(new w.Event('click',{bubbles:true})); await sleep(120);
  d.querySelector('#saveProvBtn').dispatchEvent(new w.Event('click',{bubbles:true})); await sleep(120);
  ck('the mark is gone with the rebuilt record', !w.eval('S.providers.find(x=>x.id==="p1").effortCap'));
  ck('and the full ladder is back on offer', Array.from(d.querySelectorAll('#effortSeg button')).map(b=>b.dataset.effort).join(',')==='off,low,medium,high,xhigh,max',
     Array.from(d.querySelectorAll('#effortSeg button')).map(b=>b.dataset.effort).join(','));
}

console.log('');
console.log(fail?('FAILED '+fail):'ALL PASS','('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
