// TEST FILE — run with: node tests/v5261test.js
// Guards v5.26.1: a thinking block has a Copy button. It copies exactly what
// the block shows — streamed or settled — and clicking it never folds the
// block shut mid-read.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=()=>({
  providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000}],
  activeProvider:'p1',
  presets:[{id:'d',name:'D',system:'BASE',injections:[],order:['__main__','__chat__']}],
  activePreset:'d',prompts:[],projects:[],temperature:1,maxTokens:4096,effort:'off',squashSystem:true,
  showThinking:true,showTools:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}});
function boot(st){return new Promise(res=>{
  let clip=null;
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
    beforeParse(w){
      w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
      w.navigator.storage={estimate:async()=>({usage:0})};
      w.requestAnimationFrame=cb=>setTimeout(cb,0);
      w.confirm=()=>true;w.prompt=(q,d)=>d||'X';
      w.navigator.clipboard={writeText:async t=>{ clip=t; }};
      w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
      w.__clip=()=>clip;
    }});
  setTimeout(async()=>{try{
    await dom.window.eval('Promise.all([DB.clear(),DB.docClear()])');
    dom.window.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();');
  }catch(_){}res(dom);},750);});}
const ev=(w,el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true,cancelable:true}));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{

console.log('=== 1. THE BUTTON IS THERE AND COPIES WHAT THE BLOCK SHOWS ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document;
  w.eval(`newConvo();
    current.messages.push({id:"u1",role:"user",content:"q",ts:1});
    current.messages.push({id:"a1",role:"assistant",content:"The answer.",
      thinking:"Let me think step by step.\\nFirst: the user asked a question.",ts:2});
    renderThread();`);
  await sleep(80);
  const btn=d.querySelector('[data-mid="a1"] .think [data-copythink]');
  ck('the thinking block has a copy button', !!btn);
  const det=d.querySelector('[data-mid="a1"] .think');
  det.open=true;
  ev(w,btn,'click'); await sleep(80);
  ck('the clipboard has the thinking, exactly as shown', w.__clip()==='Let me think step by step.\nFirst: the user asked a question.', String(w.__clip()).slice(0,50));
  ck('and the block did NOT fold', det.open===true);
  ck('the button confirms and recovers', btn.textContent==='Copied', btn.textContent);
  await sleep(1500);
  ck('button label resets', btn.textContent==='Copy', btn.textContent);
  ck('the reply text is untouched by it', d.querySelector('[data-mid="a1"] .msg-body').textContent.indexOf('The answer.')>=0);
}

console.log('=== 2. NO THINKING, NO BUTTON — AND THE STREAMING PATH HAS IT TOO ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document;
  w.eval(`newConvo();
    current.messages.push({id:"u1",role:"user",content:"q",ts:1});
    current.messages.push({id:"a1",role:"assistant",content:"plain",ts:2});
    renderThread();`);
  await sleep(80);
  ck('a reply without thinking has no button', !d.querySelector('[data-copythink]'));
  ck('both render paths carry it', (html.match(/data-copythink type="button"/g)||[]).length===2,
     String((html.match(/data-copythink type="button"/g)||[]).length));
}

console.log('');
console.log(fail?('FAILED '+fail):'ALL PASS','('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
