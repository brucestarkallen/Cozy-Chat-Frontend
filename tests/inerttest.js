// TEST FILE — run with: OLD=/path/to/a/checkout node tests/inerttest.js
//
// With the prefill switched off, does this build the exact same request the
// version before it did?
//
// Every gate so far proves the prefill behaves. None of them prove the other
// 99% of Cozy is untouched by it — and "the tests still pass" is weaker than
// it sounds, because a test only fails where somebody thought to look. The
// outgoing body is the whole contract with the service, so comparing it byte
// for byte across a range of shapes is the strong form of the claim.
//
// It needs a second checkout, so it is not something a plain `node` run can
// do. Without OLD it prints SKIP and exits 0 — loudly, so it never reads as a
// pass on a machine that could not run it:
//
//     git worktree add /tmp/cozy-prev <tag-or-sha>
//     OLD=/tmp/cozy-prev node tests/inerttest.js
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};

const settings=()=>({
  providers:[
    {id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000},
    {id:'pA',preset:'anthropic',kind:'anthropic',name:'C',url:'https://c/v1',apiKey:'k',model:'claude',ctx:100000},
    {id:'pZ',preset:'zai',kind:'openai',name:'Z',url:'https://z/v1',apiKey:'k',model:'glm-5',ctx:100000},
    {id:'pO',preset:'openrouter',kind:'openai',name:'O',url:'https://o/v1',apiKey:'k',model:'x/y',ctx:100000},
    {id:'pQ',preset:'custom',kind:'openai',name:'Q',url:'https://q/v1',apiKey:'k',model:'qwen-3',ctx:100000}],
  activeProvider:'p1',
  presets:[{id:'d',name:'D',system:'You are a careful assistant.',
    injections:[
      {id:'i1',name:'lead',pos:'relative',role:'system',text:'A leading block.',enabled:true},
      {id:'i2',name:'deep',pos:'chat',role:'system',depth:1,text:'An in-chat block.',enabled:true},
      {id:'i3',name:'tail',pos:'relative',role:'user',text:'A trailing block.',enabled:true}],
    order:['__main__','i1','__chat__','i3','i2']}],
  activePreset:'d',prompts:[],temperature:0.8,maxTokens:2048,effort:'off',squashSystem:true,
  showThinking:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  projects:[],
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false,images:true,auto:true}});

function boot(file,st){return new Promise(res=>{
  const html=fs.readFileSync(file,'utf8');
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
    beforeParse(w){
      w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
      w.navigator.storage={estimate:async()=>({usage:0})};
      w.requestAnimationFrame=cb=>setTimeout(cb,0);
      w.confirm=()=>true;w.navigator.vibrate=()=>true;
      w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
    }});
  setTimeout(async()=>{try{
    await dom.window.eval('Promise.all([DB.clear(),DB.docClear()])');
    dom.window.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();');
  }catch(_){}res(dom);},800);});}

// Every shape is set up by the same script in both versions, so any difference
// in the result is a difference in the code, not in the fixture.
const SHAPES=[
  ['plain chat, OpenAI wire',
   `cfgSet('providerId','p1');
    current.messages.push({id:'a',role:'user',content:'hello there',ts:1});`,
   `buildPayload({},current)`],
  ['plain chat, Anthropic wire',
   `cfgSet('providerId','pA');
    current.messages.push({id:'a',role:'user',content:'hello there',ts:1});`,
   `buildPayload({},current)`],
  ['a conversation with replies in it',
   `cfgSet('providerId','p1');
    current.messages.push({id:'a',role:'user',content:'one',ts:1});
    current.messages.push({id:'b',role:'assistant',content:'two',ts:2});
    current.messages.push({id:'c',role:'user',content:'three',ts:3});`,
   `buildPayload({},current)`],
  ['More: the prompt already ends with a reply',
   `cfgSet('providerId','p1');
    current.messages.push({id:'a',role:'user',content:'one',ts:1});
    current.messages.push({id:'b',role:'assistant',content:'half a repl',ts:2});`,
   `buildPayload({},current)`],
  ['squash off',
   `cfgSet('providerId','p1'); cfgSet('squashSystem',false);
    current.messages.push({id:'a',role:'user',content:'hello',ts:1});`,
   `buildPayload({},current)`],
  ['thinking on, GLM shape',
   `cfgSet('providerId','pZ'); cfgSet('effort','high');
    current.messages.push({id:'a',role:'user',content:'hello',ts:1});`,
   `buildPayload({},current)`],
  ['thinking off, GLM shape',
   `cfgSet('providerId','pZ'); cfgSet('effort','off');
    current.messages.push({id:'a',role:'user',content:'hello',ts:1});`,
   `buildPayload({},current)`],
  ['thinking on, OpenRouter shape',
   `cfgSet('providerId','pO'); cfgSet('effort','medium');
    current.messages.push({id:'a',role:'user',content:'hello',ts:1});`,
   `buildPayload({},current)`],
  ['thinking off, OpenRouter shape',
   `cfgSet('providerId','pO'); cfgSet('effort','off');
    current.messages.push({id:'a',role:'user',content:'hello',ts:1});`,
   `buildPayload({},current)`],
  ['thinking on, Qwen shape',
   `cfgSet('providerId','pQ'); cfgSet('effort','low'); S.providers.find(p=>p.id==='pQ').reason='qwen';
    current.messages.push({id:'a',role:'user',content:'hello',ts:1});`,
   `buildPayload({},current)`],
  ['thinking off, Qwen shape',
   `cfgSet('providerId','pQ'); cfgSet('effort','off'); S.providers.find(p=>p.id==='pQ').reason='qwen';
    current.messages.push({id:'a',role:'user',content:'hello',ts:1});`,
   `buildPayload({},current)`],
  ['Claude with adaptive thinking',
   `cfgSet('providerId','pA'); cfgSet('effort','high');
    current.messages.push({id:'a',role:'user',content:'hello',ts:1});`,
   `buildPayload({},current)`],
  ['Claude native web search',
   `cfgSet('providerId','pA'); S.search.on=true; S.search.provider='native';
    current.messages.push({id:'a',role:'user',content:'hello',ts:1});`,
   `buildPayload({search:true},current)`],
  ['an image attachment, Anthropic wire',
   `cfgSet('providerId','pA');
    current.messages.push({id:'a',role:'user',content:'look',ts:1,
      attachments:[{kind:'image',mime:'image/png',data:'QUJD'}]});`,
   `buildPayload({},current)`],
  ['an image attachment, OpenAI wire',
   `cfgSet('providerId','p1');
    current.messages.push({id:'a',role:'user',content:'look',ts:1,
      attachments:[{kind:'image',mime:'image/png',data:'QUJD'}]});`,
   `buildPayload({},current)`],
  ['a text attachment',
   `cfgSet('providerId','p1');
    current.messages.push({id:'a',role:'user',content:'read it',ts:1,
      attachments:[{kind:'text',name:'n.md',text:'file body'}]});`,
   `buildPayload({},current)`],
  ['search results on a message',
   `cfgSet('providerId','p1');
    current.messages.push({id:'a',role:'user',content:'q',ts:1,
      sources:[{title:'T',url:'https://u',snippet:'s'}]});`,
   `buildPayload({},current)`],
  ['extra system text for this chat only',
   `cfgSet('providerId','p1'); current.sysExtra='Only for this chat.';
    current.messages.push({id:'a',role:'user',content:'hello',ts:1});`,
   `buildPayload({},current)`],
  ['a per-chat model override',
   `cfgSet('providerId','p1'); cfgSet('model','other-model');
    current.messages.push({id:'a',role:'user',content:'hello',ts:1});`,
   `buildPayload({},current)`],
  ['assembleMessages on its own (the Hermes Runs input)',
   `cfgSet('providerId','p1');
    current.messages.push({id:'a',role:'user',content:'hello',ts:1});`,
   `assembleMessages('openai',current)`],
];

/* A shape's result must not depend on the shapes before it. Settings are one
   shared object per window, so a setup that switches something on — search,
   say — was still on for every shape after it, and the comparison reported a
   later shape as changed because of an earlier one. Re-seeding from the same
   fixture makes each shape mean only what it says. */
function runShape(w,setup,call){
  return w.eval(`(()=>{
    localStorage.setItem('cozychat:settings', ${JSON.stringify(JSON.stringify(settings()))});
    S = loadSettings();
    convos=[];current=null;newConvo();
    ${setup}
    const out = ${call};
    return JSON.stringify(out.body !== undefined ? {url:out.url,headers:out.headers,body:out.body} : out);
  })()`);
}

(async()=>{
  const OLD=process.env.OLD||process.argv[2];
  if(!OLD||!fs.existsSync(OLD+'/index.html')){
    console.log('SKIP: needs a previous checkout to compare against.');
    console.log('      git worktree add /tmp/cozy-prev <tag-or-sha>');
    console.log('      OLD=/tmp/cozy-prev node tests/inerttest.js');
    process.exit(0);
  }
  const NEW=process.argv[3]||__dirname+'/..';
  const A=await boot(OLD+'/index.html',settings());
  const B=await boot(NEW+'/index.html',settings());
  console.log('old:',A.window.eval('VERSION'),' new:',B.window.eval('VERSION'));
  console.log('prefill is off by default:',B.window.eval('String(pfCfg().on)'));
  console.log('');

  // A comparison that cannot tell two things apart reports everything as
  // identical, including a regression. Prove it can before trusting it.
  const one=runShape(B.window,SHAPES[0][1],SHAPES[0][2]);
  const two=runShape(B.window,SHAPES[1][1],SHAPES[1][2]);
  ck('control: the comparison can tell two different requests apart',one!==two);

  for (const [label,setup,call] of SHAPES){
    let a,b;
    try { a=runShape(A.window,setup,call); } catch(e){ a='THREW: '+e.message; }
    try { b=runShape(B.window,setup,call); } catch(e){ b='THREW: '+e.message; }
    const same=a===b;
    ck(label,same);
    if(!same){
      console.log('        old:',String(a).slice(0,400));
      console.log('        new:',String(b).slice(0,400));
    }
  }
  console.log('\nRESULT: '+(fail?('DIFFERENCES: '+fail+' of '+(pass+fail)):('ALL PASS ('+pass+' checks)')));
  process.exit(fail?1:0);
})();
