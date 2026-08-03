// TEST FILE — run with: node tests/v516test.js
// Guards v5.16.0: the prefill, ported from the SillyTavern Prefill Control
// extension and rebuilt around what Cozy actually is.
//
// The extension exists to predict a SillyTavern server it cannot see: whether
// post-processing will merge the prefilled turn into the one before it and
// throw the whole thing away. Cozy has no such server. It assembles the
// prompt itself and posts it, so the prefill runs on the finished list after
// the squash and the message that leaves buildPayload() is the message on the
// wire. None of that prediction machinery was carried over — and these checks
// are mostly about the four things that ARE different here and would each
// have been a live bug in a straight copy:
//
//  1. Anthropic's /messages rejects unknown keys on a message, so the flag and
//     the thinking field must not be written on that wire at all.
//  2. "More" ends the prompt with a real reply. The engine's preset mode would
//     have rewritten it — a reply opening with <think> would have lost its
//     first paragraph to the thinking field, silently.
//  3. The Hermes Runs transport assembles its own messages and maps them to
//     {role, content}. An assistant tail there empties `input`.
//  4. include_reasoning means nothing to Cozy. Opening the thinking channel
//     has to go through the connection's own reasoning style.
//
// Plus the one thing no amount of reading could settle: Claude 4.6 and newer
// refuse a prefilled turn outright, and a model name behind a relay cannot
// say which model it really is. So the connection learns it from the refusal.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=()=>({
  providers:[
    {id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000},
    {id:'pA',preset:'anthropic',kind:'anthropic',name:'C',url:'https://c/v1',apiKey:'k',model:'claude',ctx:100000},
    {id:'pZ',preset:'zai',kind:'openai',name:'Z',url:'https://z/v1',apiKey:'k',model:'glm-5',ctx:100000}],
  activeProvider:'p1',presets:[{id:'d',name:'D',system:'',injections:[],order:['__main__','__chat__']}],
  activePreset:'d',prompts:[],temperature:1,maxTokens:4096,effort:'off',squashSystem:true,
  showThinking:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}});
function boot(st,fetchFn){return new Promise(res=>{
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
    beforeParse(w){
      w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
      w.navigator.storage={estimate:async()=>({usage:0})};
      w.requestAnimationFrame=cb=>setTimeout(cb,0);
      w.confirm=()=>true;w.navigator.vibrate=()=>true;
      w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
      if(fetchFn) w.fetch=fetchFn(w);
    }});
  setTimeout(async()=>{try{
    await dom.window.eval('Promise.all([DB.clear(),DB.docClear()])');
    dom.window.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();');
  }catch(_){}res(dom);},750);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const NL=String.fromCharCode(10);
const oa=t=>'data: '+JSON.stringify({choices:[{delta:{content:t}}]})+NL+NL;
function ev(w,el,type){el.dispatchEvent(new w.Event(type,{bubbles:true}));}
// run one engine case in the page and hand back the report plus the list
function run(w,msgs,cfg,wire,mode){
  return w.eval(`(()=>{
    const msgs=${JSON.stringify(msgs)};
    const before=JSON.stringify(msgs);
    const r=applyPrefill(msgs,Object.assign({},PF_DEFAULT,{on:true},${JSON.stringify(cfg||{})}),
      Object.assign({fields:true,thinking:false,refused:false,tools:false},${JSON.stringify(wire||{})}),
      ${JSON.stringify(mode||null)});
    return JSON.stringify({r:r,msgs:msgs,untouched:before===JSON.stringify(msgs)});
  })()`);
}
const U=[{role:'user',content:'hello'}];

(async()=>{

console.log('=== A. EVERY REASON HAS WORDS FOR IT ===');
{
  const dom=await boot(base());const w=dom.window;
  const codes=w.eval('JSON.stringify(Object.values(PF_REASON))');
  const keys =w.eval('JSON.stringify(Object.keys(PF_STATUS))');
  const c=JSON.parse(codes),k=JSON.parse(keys);
  const missing=c.filter(x=>k.indexOf(x)<0);
  const orphan =k.filter(x=>c.indexOf(x)<0);
  ck('every reason code has display text',missing.length===0,missing.join(','));
  ck('no display text without a reason code',orphan.length===0,orphan.join(','));
  ck('codes are stable strings',c.length>=12,String(c.length));
  const st=w.eval('pfStatusText()');
  ck('status before any send reads as English',/Nothing has been sent/.test(st),st);
  await sleep(60);  dom.window.close();
}

console.log(NL+'=== B. FIELD NAMES ARE CHECKED BEFORE ANYTHING IS WRITTEN ===');
{
  const dom=await boot(base());const w=dom.window;
  const f=n=>JSON.parse(w.eval('JSON.stringify(pfField('+JSON.stringify(n)+'))'));
  ck('a blank name is fine and means "none"',f('').ok===true&&f('').name==='');
  ck('whitespace is trimmed, not sent as a key',f('  partial  ').name==='partial');
  ck('"content" is refused',f('content').ok===false,f('content').why);
  ck('"role" is refused',f('role').ok===false);
  ck('__proto__ is refused',f('__proto__').ok===false);
  ck('a name with a space inside is refused',f('my field').ok===false);
  ck('a name starting with a digit is refused',f('1st').ok===false);
  ck('a plain name passes',f('reasoning_content').ok===true);

  // a skip must leave the request exactly as assembleMessages built it
  const bad=JSON.parse(run(w,U,{flagField:'content'}));
  ck('an unusable name skips',bad.r.reason==='bad-field-name',bad.r.reason);
  ck('and writes nothing',bad.untouched===true);
  ck('and says which name',/content/.test(bad.r.detail.why||''),bad.r.detail.why);
  const clash=JSON.parse(run(w,U,{flagField:'reasoning_content'}));
  ck('two names, one key: skipped',clash.r.reason==='field-collision',clash.r.reason);
  ck('and writes nothing',clash.untouched===true);
  await sleep(60);  dom.window.close();
}

console.log(NL+'=== C. THE TAG PATTERN SURVIVES REGEX CHARACTERS ===');
{
  const dom=await boot(base());const w=dom.window;
  const cap=(open,close,text)=>JSON.parse(w.eval(`(()=>{
    const x=${JSON.stringify(text)}.match(pfPattern(${JSON.stringify(open)},${JSON.stringify(close)}));
    return JSON.stringify(x===null?null:(x[1]===undefined?null:x[1]));})()`));
  ck('a closed tag captures what is between',cap('<think>','</think>','<think>seed here</think>and the reply')==='seed here');
  ck('an unclosed tag runs to the end',cap('<think>','</think>','<think>runs to the end')==='runs to the end');
  const meta=cap('[[a.b]]','','[[a.b]]seed');
  ck('regex characters in a tag are literal',meta==='seed',String(meta));
  ck('and do not match as a wildcard',cap('[[a.b]]','','[[aXb]]seed')===null);
  await sleep(60);  dom.window.close();
}

console.log(NL+'=== D. EVERY SKIP LEAVES THE REQUEST ALONE ===');
{
  const dom=await boot(base());const w=dom.window;
  const cases=[
    ['off',            U,{on:false},{},null,'disabled'],
    ['an empty prompt',[],{},{},null,'no-messages'],
    ['More, by default',[{role:'user',content:'a'},{role:'assistant',content:'b'}],{},{},'continue','continue-excluded'],
    ['tools in play',  U,{},{tools:true},null,'tools-present'],
    ['a refused connection',U,{},{refused:true},null,'wire-refused'],
    ['Claude with thinking on',U,{},{thinking:true},null,'thinking-conflict'],
    ['empty prefill text',U,{text:'   '},{},null,'empty-prefill'],
  ];
  for (const [label,msgs,cfg,wire,mode,want] of cases){
    const o=JSON.parse(run(w,msgs,cfg,wire,mode));
    ck(label+' → '+want,o.r.reason===want,o.r.reason);
    ck('  ...and nothing was written',o.untouched===true&&o.r.applied===false);
  }
  // the tag is all there is, and no field is configured to hold it
  const hollow=JSON.parse(run(w,U,{text:'<think></think>',flagField:''},{}));
  ck('a prefill that reduces to nothing is not sent',hollow.r.reason==='nothing-to-do',hollow.r.reason);
  ck('  ...and no empty turn is left behind',hollow.untouched===true);
  await sleep(60);  dom.window.close();
}

console.log(NL+'=== E. WHAT A PREFILL ACTUALLY DOES ===');
{
  const dom=await boot(base());const w=dom.window;
  const o=JSON.parse(run(w,U,{text:'<think>plan it</think>Once upon  '},{}));
  const tail=o.msgs[o.msgs.length-1];
  ck('applied',o.r.applied===true&&o.r.reason==='applied',o.r.reason);
  ck('a turn was added, the user turn is untouched',o.msgs.length===2&&o.msgs[0].content==='hello');
  ck('the added turn is the assistant',tail.role==='assistant');
  ck('the seed moved into the thinking field',tail.reasoning_content==='plan it',tail.reasoning_content);
  ck('the tag is gone from the reply text',tail.content==='Once upon',JSON.stringify(tail.content));
  ck('trailing whitespace is trimmed',!/\s$/.test(tail.content));
  ck('the flag rides along',tail.partial===true);
  ck('the report names the fields',o.r.detail.flagField==='partial'&&o.r.detail.reasoningField==='reasoning_content');
  ck('the report counts the seed',o.r.detail.reasoningLength===7,String(o.r.detail.reasoningLength));
  ck('the echo is exactly what was sent',o.r.detail.echo===tail.content,JSON.stringify(o.r.detail.echo));

  const noecho=JSON.parse(run(w,U,{text:'Once upon',echo:false},{}));
  ck('echo off means nothing to prepend',noecho.r.detail.echo===undefined);
  ck('  ...but the turn still goes',noecho.msgs.length===2);

  const noseed=JSON.parse(run(w,U,{text:'<think>plan</think>go',reasoningField:''},{}));
  const t2=noseed.msgs[noseed.msgs.length-1];
  ck('with no thinking field the tag stays in the text',t2.content==='<think>plan</think>go',t2.content);
  ck('  ...and nothing is invented to hold it',t2.reasoning_content===undefined);

  const off=JSON.parse(run(w,U,{text:'<think>plan</think>go',thinkOn:false},{}));
  ck('the split can be switched off',off.msgs[1].content==='<think>plan</think>go');

  const noflag=JSON.parse(run(w,U,{text:'Once upon',flagField:''},{}));
  ck('no flag configured, no flag sent',noflag.msgs[1].partial===undefined&&noflag.r.applied===true);
  await sleep(60);  dom.window.close();
}

console.log(NL+'=== F. A REPLY THAT ALREADY EXISTS IS NEVER REWRITTEN ===');
{
  const dom=await boot(base());const w=dom.window;
  // this is the one the extension's preset mode would have got wrong
  const real=[{role:'user',content:'a'},{role:'assistant',content:'<think>my own words</think>the story so far'}];
  const o=JSON.parse(run(w,real,{applyToContinue:true},{},'continue'));
  const tail=o.msgs[1];
  ck('More is allowed to send the flag',o.r.applied===true&&tail.partial===true);
  ck('the reply text is untouched',tail.content===real[1].content,tail.content);
  ck('its first paragraph was not moved to thinking',tail.reasoning_content===undefined);
  ck('no second assistant turn was appended',o.msgs.length===2,String(o.msgs.length));
  ck('the report does not claim an append',!o.r.detail.appended);
  ck('and nothing is echoed into the reply',o.r.detail.echo===undefined);

  const noflag=JSON.parse(run(w,real,{applyToContinue:true,flagField:''},{},'continue'));
  ck('with no flag there is nothing to add',noflag.r.reason==='nothing-to-do',noflag.r.reason);
  ck('  ...so the reply is left exactly as it was',noflag.untouched===true);

  // a plain send whose prompt happens to end with a reply is the same case
  const plain=JSON.parse(run(w,real,{},{},null));
  ck('a prompt already ending in a reply is not appended to',plain.msgs.length===2);
  ck('  ...and keeps its text',plain.msgs[1].content===real[1].content);
  await sleep(60);  dom.window.close();
}

console.log(NL+'=== G. CLAUDE GETS THE TURN AND NOTHING ELSE ===');
{
  const dom=await boot(base());const w=dom.window;
  const o=JSON.parse(run(w,U,{text:'<think>plan</think>Once upon'},{fields:false}));
  const tail=o.msgs[o.msgs.length-1];
  ck('the turn is still sent',o.r.applied===true&&tail.role==='assistant');
  ck('no flag key on the message',Object.keys(tail).indexOf('partial')<0,Object.keys(tail).join(','));
  ck('no thinking key on the message',Object.keys(tail).indexOf('reasoning_content')<0);
  ck('only role and content',JSON.stringify(Object.keys(tail).sort())==='["content","role"]',Object.keys(tail).join(','));
  ck('the text is kept whole, tag and all',tail.content==='<think>plan</think>Once upon',tail.content);
  ck('so the echo restores the whole thing',o.r.detail.echo===tail.content);
  // a name that would be rejected on an OpenAI wire is simply unused here
  const bad=JSON.parse(run(w,U,{flagField:'content',text:'hi'},{fields:false}));
  ck('an unused bad name is not an error on this wire',bad.r.applied===true,bad.r.reason);
  await sleep(60);  dom.window.close();
}

console.log(NL+'=== H. WHAT THE CONNECTION WILL TAKE ===');
{
  const dom=await boot(base());const w=dom.window;
  const wire=id=>JSON.parse(w.eval(`JSON.stringify(pfWire(S.providers.find(p=>p.id==='${id}'),null))`));
  ck('an OpenAI-shaped connection takes fields',wire('p1').fields===true);
  ck('a Claude connection does not',wire('pA').fields===false);
  ck('Claude with thinking off is fine',wire('pA').thinking===false);
  w.eval("S.effort='high'");
  ck('Claude with thinking on refuses a prefilled turn',wire('pA').thinking===true);
  ck('an OpenAI-shaped one is unaffected by effort',wire('p1').thinking===false);
  w.eval("S.effort='off'");
  ck('nothing is refused until it says so',wire('p1').refused===false);
  w.eval("markPrefillDown({id:'p1'})");
  ck('a refusal is remembered on the connection',wire('p1').refused===true);
  ck('and only on that one',wire('pA').refused===false);
  ck('marking twice reports it as old news',w.eval("markPrefillDown({id:'p1'})")===false);
  ck('the mark survives a reload',JSON.parse(w.localStorage.getItem('cozychat:settings')).providers.some(p=>p.id==='p1'&&p.prefillDownAt));
  await sleep(60);  dom.window.close();
}

console.log(NL+'=== I. IT REACHES THE WIRE, AND ONLY THIS WIRE ===');
{
  const dom=await boot(base());const w=dom.window;
  w.eval(`(()=>{
    newConvo();
    current.messages.push({id:'u1',role:'user',content:'hello',ts:Date.now()});
    pfSet({on:true,text:'<think>plan</think>Once upon'});
  })()`);
  const req=JSON.parse(w.eval('JSON.stringify(buildPayload({},current))'));
  const tail=req.body.messages[req.body.messages.length-1];
  ck('the prefilled turn is on the outgoing body',tail.role==='assistant'&&tail.content==='Once upon',tail.content);
  ck('with its thinking seed',tail.reasoning_content==='plan');
  ck('and its flag',tail.partial===true);
  ck('the payload carries the report',req.prefill&&req.prefill.applied===true);
  ck('the panel can see the last verdict',
    w.eval('lastPrefill ? lastPrefill.reason : "(nothing recorded)"')==='applied',
    w.eval('lastPrefill ? lastPrefill.reason : "(nothing recorded)"'));
  ck('the status line reads as English',/Sent with the last message/.test(w.eval('pfStatusText()')),w.eval('pfStatusText()'));

  // the Hermes Runs transport assembles its own list and must not see a prefill
  const runList=JSON.parse(w.eval('JSON.stringify(assembleMessages("openai",current).messages)'));
  ck('assembleMessages alone adds nothing',runList[runList.length-1].role==='user',runList[runList.length-1].role);
  ck('so a run still has something to put in `input`',runList.length===1,String(runList.length));

  // suppression is explicit and reported, never silent
  const off=JSON.parse(w.eval('JSON.stringify(buildPayload({noPrefill:true},current))'));
  const t2=off.body.messages[off.body.messages.length-1];
  ck('a suppressed send has no prefilled turn',t2.role==='user');
  ck('and says so',off.prefill.reason==='suppressed',off.prefill.reason);

  // More goes through the same door with the same setting
  const cont=JSON.parse(w.eval('JSON.stringify(buildPayload({mode:"continue"},current))'));
  ck('More is excluded by default',cont.prefill.reason==='continue-excluded',cont.prefill.reason);
  await sleep(60);  dom.window.close();
}

console.log(NL+'=== J. A SEEDED THINKING CHANNEL IS AN OPEN ONE ===');
{
  const dom=await boot(base());const w=dom.window;
  w.eval(`(()=>{
    newConvo();
    S.activeProvider='pZ'; cfgSet('providerId','pZ'); cfgSet('effort','off');
    current.messages.push({id:'u1',role:'user',content:'hello',ts:Date.now()});
    pfSet({on:true,text:'<think>plan</think>Once upon'});
  })()`);
  let b=JSON.parse(w.eval('JSON.stringify(buildPayload({},current).body)'));
  ck('a seed cancels an explicit "thinking off"',b.thinking&&b.thinking.type==='enabled',JSON.stringify(b.thinking));
  ck('but no effort level is invented',b.reasoning_effort===undefined,String(b.reasoning_effort));
  w.eval("pfSet({ensureThinking:false})");
  b=JSON.parse(w.eval('JSON.stringify(buildPayload({},current).body)'));
  ck('with the setting off, "off" stands',b.thinking&&b.thinking.type==='disabled',JSON.stringify(b.thinking));
  w.eval("pfSet({ensureThinking:true,reasoningField:''})");
  b=JSON.parse(w.eval('JSON.stringify(buildPayload({},current).body)'));
  ck('no seed, no interference',b.thinking&&b.thinking.type==='disabled',JSON.stringify(b.thinking));
  w.eval("pfSet({reasoningField:'reasoning_content'});cfgSet('effort','high')");
  b=JSON.parse(w.eval('JSON.stringify(buildPayload({},current).body)'));
  ck('a chosen effort level is never overwritten',b.reasoning_effort==='high',b.reasoning_effort);
  await sleep(60);  dom.window.close();
}

console.log(NL+'=== K. THE REPLY DOES NOT START MID-SENTENCE ===');
{
  const rec={bodies:[]};
  const dom=await boot(base(),w=>(url,opt)=>{
    rec.bodies.push(JSON.parse(opt.body));let i=0;const chunks=[oa(' there was a wolf.')];
    return Promise.resolve({ok:true,body:{getReader(){return{read(){
      if(i>=chunks.length)return Promise.resolve({done:true});
      return Promise.resolve({done:false,value:new TextEncoder().encode(chunks[i++])});}};}}});});
  const w=dom.window,d=w.document;
  w.eval("newConvo();pfSet({on:true,text:'Once upon a time'})");
  d.querySelector('#input').value='tell me a story';ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await sleep(400);
  const msgs=w.eval('JSON.stringify(current.messages)');
  const last=JSON.parse(msgs).filter(m=>m.role==='assistant').pop();
  ck('the saved reply begins with the prefill',last.content==='Once upon a time there was a wolf.',JSON.stringify(last.content));
  const sent=rec.bodies[0].messages;
  ck('the prefilled turn was what went out',sent[sent.length-1].content==='Once upon a time');
  await sleep(60);  dom.window.close();
}

console.log(NL+'=== L. A REFUSAL COSTS THE MESSAGE NOTHING ===');
{
  const rec={bodies:[],calls:0};
  const refusal={error:{message:'This model does not support assistant message prefill. The conversation must end with a user message.'}};
  const dom=await boot(base(),w=>(url,opt)=>{
    rec.calls++;rec.bodies.push(JSON.parse(opt.body));
    if(rec.calls===1) return Promise.resolve({ok:false,status:400,json:()=>Promise.resolve(refusal)});
    let i=0;const chunks=[oa('a plain answer')];
    return Promise.resolve({ok:true,body:{getReader(){return{read(){
      if(i>=chunks.length)return Promise.resolve({done:true});
      return Promise.resolve({done:false,value:new TextEncoder().encode(chunks[i++])});}};}}});});
  const w=dom.window,d=w.document;
  w.eval("newConvo();pfSet({on:true,text:'Once upon a time'})");
  d.querySelector('#input').value='hi';ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await sleep(500);
  const msgs=JSON.parse(w.eval('JSON.stringify(current.messages)'));
  ck('it was sent again without the prefill',rec.calls===2,String(rec.calls));
  const roleOf=i=>{const b=rec.bodies[i];if(!b||!b.messages||!b.messages.length)return '(no such request)';
    return b.messages[b.messages.length-1].role;};
  ck('the first try carried the turn',roleOf(0)==='assistant',roleOf(0));
  ck('the second did not',roleOf(1)==='user',roleOf(1));
  ck('the reply arrived',msgs.some(m=>m.role==='assistant'&&m.content==='a plain answer'));
  ck('no error was shown to the user',!msgs.some(m=>m.role==='error'));
  ck('the connection remembers',w.eval("prefillIsDown({id:'p1'})")===true);
  // the shape a real next send has: the user has typed again, so the prompt
  // ends with their turn and appending one is exactly what is now refused
  w.eval("current.messages.push({id:'u2',role:'user',content:'again',ts:Date.now()})");
  const after=JSON.parse(w.eval('JSON.stringify(buildPayload({},current))'));
  ck('and is not offered one again',after.prefill.reason==='wire-refused',after.prefill.reason);
  const tail=after.body.messages[after.body.messages.length-1];
  ck('so the prompt still ends with the user',tail.role==='user',tail.role);
  // More is a different thing: the assistant tail is the reply being carried
  // on, not a turn the prefill added, so the mark has no say over it
  const more=JSON.parse(w.eval("(()=>{current.messages.pop();pfSet({applyToContinue:true});return JSON.stringify(buildPayload({mode:'continue'},current));})()"));
  ck('but More is not disabled by the mark',more.prefill.applied===true,more.prefill.reason);
  ck('re-saving the connection clears the mark',
    w.eval("(()=>{const p=S.providers.find(x=>x.id==='p1');const d={id:p.id,preset:p.preset,kind:p.kind,name:p.name,url:p.url,apiKey:p.apiKey,model:p.model,ctx:p.ctx};S.providers[0]=d;return !d.prefillDownAt;})()")===true);
  await sleep(60);  dom.window.close();
}

console.log(NL+'=== M. A REFUSAL ON MORE EXPLAINS ITSELF ===');
{
  const dom=await boot(base());const w=dom.window;
  const a=w.eval(`friendlyError(new Error('T said no (400).'+String.fromCharCode(10)+'This model does not support assistant message prefill.'),{name:'T'})`);
  ck('the prefill refusal is put in plain words',/only accept a conversation that ends with your message/.test(a),a.slice(0,60));
  const b=w.eval(`friendlyError(new Error('C said no (400). Expected thinking or redacted_thinking, but found text. When thinking is enabled, a final assistant message must start with a thinking block.'),{name:'C'})`);
  ck('so is the thinking-block refusal',/Thinking effort to Off/.test(b),b.slice(0,60));
  const c=w.eval(`friendlyError(new TypeError('Failed to fetch'),{name:'T'})`);
  ck('ordinary errors are unchanged',/Couldn't reach T/.test(c),c.slice(0,40));
  await sleep(60);  dom.window.close();
}

console.log(NL+'=== N. THE PANEL EXPLAINS EVERY SETTING IT OFFERS ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document;
  const ids=['tgPrefill','pfText','pfProfile','pfFlag','pfSeed','tgPfThink','pfOpen','pfClose',
             'tgPfEnsure','tgPfEcho','tgPfContinue','tgPfTools','pfStatus'];
  for (const id of ids){
    const el=d.getElementById(id);
    if(!el){ck('control #'+id+' exists',false);continue;}
    const box=el.closest('.switch')||el.closest('.field');
    const note=box&&(box.querySelector('.switch-txt .s')||box.querySelector('.hint'));
    ck('#'+id+' is explained where it sits',!!note&&note.textContent.trim().length>25,
      note?String(note.textContent.trim().length):'no note');
  }
  ck('the config block is inside the chat panel',
    !!d.querySelector('[data-panel="chat"] #prefillCfg'));
  ck('it is hidden while the prefill is off',d.getElementById('prefillCfg').hidden===true);
  ev(w,d.getElementById('tgPrefill'),'click');
  ck('turning it on reveals it',d.getElementById('prefillCfg').hidden===false);
  ck('and the toggle reads as on',d.getElementById('tgPrefill').getAttribute('aria-checked')==='true');
  await sleep(60);  dom.window.close();
}

console.log(NL+'=== O. THE FIELD-NAME SHORTCUT TELLS THE TRUTH ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document;
  w.eval('newConvo();openSettings()');
  const sel=d.getElementById('pfProfile');
  ck('every ready-made set is offered',sel.options.length===w.eval('Object.keys(PF_PROFILES).length')+1,String(sel.options.length));
  sel.value='deepseek';ev(w,sel,'change');
  ck('picking one fills the flag box',d.getElementById('pfFlag').value==='prefix',d.getElementById('pfFlag').value);
  ck('and the thinking box',d.getElementById('pfSeed').value==='reasoning_content');
  ck('and it is what the request will use',w.eval('pfCfg().flagField')==='prefix');
  sel.value='plain';ev(w,sel,'change');
  ck('"plain text only" empties both',w.eval('pfCfg().flagField')===''&&w.eval('pfCfg().reasoningField')==='');
  const box=d.getElementById('pfFlag');
  box.value='partial';ev(w,box,'change');
  ck('typing a name by hand takes effect',w.eval('pfCfg().flagField')==='partial');
  ck('and the shortcut stops claiming credit',d.getElementById('pfProfile').value===''
    &&w.eval('pfCfg().profile')==='','profile='+w.eval('pfCfg().profile'));
  await sleep(60);  dom.window.close();
}

console.log(NL+'=== P. THE SETTING BELONGS TO THE CHAT ===');
{
  const dom=await boot(base());const w=dom.window;
  w.eval("newConvo();pfSet({on:true,text:'chat one text'})");
  const one=w.eval('current.id');
  w.eval('newConvo()');
  ck('a new chat does not inherit an unsaved chat setting',w.eval('pfCfg().on')===false,String(w.eval('pfCfg().on')));
  w.eval(`current=convos.find(c=>c.id==='${one}')`);
  ck('the first chat kept its own',w.eval('pfCfg().on')===true&&w.eval('pfCfg().text')==='chat one text');
  w.eval('pushCfgToGlobals()');
  w.eval('newConvo()');
  ck('"use for new chats" carries it forward',w.eval('pfCfg().on')===true&&w.eval('pfCfg().text')==='chat one text');
  ck('and it survives a reload',
    JSON.parse(w.localStorage.getItem('cozychat:settings')).prefill.text==='chat one text');
  await sleep(60);  dom.window.close();
}

console.log(NL+'RESULT: '+(fail?('FAILURES: '+fail+' of '+(pass+fail)):('ALL PASS ('+pass+' checks)')));
process.exit(fail?1:0);
})();
