// TEST FILE — run with: node tests/v517test.js
// Guards v5.17.0: the "Test prefill" button.
//
// The button answers one question — does prefill work on THIS connection and
// THIS model — and the only way it can answer honestly is by sending the real
// thing. So the probe goes through the same buildPayload() every message uses;
// only the conversation is swapped, for a sequence whose continuation has a
// deterministic answer (A B C already said → D means it carried on, A means it
// started over).
//
// Three ways a status code lies, each checked here:
//  1. A service can accept a trailing assistant turn and quietly drop it. HTTP
//     200 and a reply that starts over are the same 200.
//  2. The turn and the flag field go out together, so one 400 covers two very
//     different repairs. A second probe without the flag separates them.
//  3. A thinking field can be rejected on its own, by a service that took the
//     turn happily. That is a third question and gets its own probe.
//
// And the failure this exists to prevent: a green light that describes
// settings the user has since changed.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=()=>({
  providers:[
    {id:'p1',preset:'custom',kind:'openai',name:'Testly',url:'https://a/v1',apiKey:'k',model:'mod-9',ctx:100000},
    {id:'pA',preset:'anthropic',kind:'anthropic',name:'Claudely',url:'https://c/v1',apiKey:'k',model:'claude',ctx:100000},
    {id:'pH',preset:'hermes',kind:'openai',name:'Hermes',url:'https://h/v1',apiKey:'k',model:'hermes-agent',ctx:100000,hermesRuns:true}],
  activeProvider:'p1',presets:[{id:'d',name:'D',system:'be helpful',injections:[],order:['__main__','__chat__']}],
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
const oaReply=t=>({choices:[{message:{content:t}}]});
const anReply=t=>({content:[{type:'text',text:t}]});
// a scripted sequence of responses, with every request body recorded
function script(steps){
  const rec={bodies:[],urls:[],n:0};
  rec.attach=()=>(url,opt)=>{
    rec.urls.push(url); rec.bodies.push(JSON.parse(opt.body));
    const step=steps[Math.min(rec.n,steps.length-1)]; rec.n++;
    if(step.fail) return Promise.resolve({ok:false,status:step.status||400,
      json:()=>Promise.resolve({error:{message:step.detail||'nope'}})});
    return Promise.resolve({ok:true,json:()=>Promise.resolve(step.body)});
  };
  // never index a request that may not have been made
  rec.tail=i=>{const b=rec.bodies[i];if(!b||!b.messages||!b.messages.length)return {role:'(no such request)'};
    return b.messages[b.messages.length-1];};
  return rec;
}
const statTxt=d=>d.getElementById('pfTestStat').textContent;
const statCls=d=>d.getElementById('pfTestStat').className;
async function press(w,d,ms){ d.getElementById('pfTestBtn').dispatchEvent(new w.Event('click',{bubbles:true})); await sleep(ms||400); }
// a chat with the prefill on, ready to test
async function rig(w,provId,patch){
  await w.eval(`(()=>{
    newConvo();
    current.messages.push({id:'u1',role:'user',content:'hello',ts:Date.now()});
    ${provId?`cfgSet('providerId','${provId}');`:''}
    pfSet(Object.assign({on:true},${JSON.stringify(patch||{})}));
    openSettings();
  })()`);
  await sleep(60);
}

(async()=>{

console.log('=== Q. THE PROBE IS THE REAL REQUEST, MINUS THE CONVERSATION ===');
{
  const dom=await boot(base());const w=dom.window;
  await rig(w,null,{});
  const t=JSON.parse(w.eval("JSON.stringify(buildPayload({probe:'text'},current))"));
  const m=t.body.messages;
  ck('the probe asks its own question',m[0].role==='user'&&/Continue the sequence/.test(m[0].content),m[0].role);
  ck('the chat is not in it',!m.some(x=>x.content==='hello'));
  ck('and neither is the system prompt',!m.some(x=>x.role==='system'),JSON.stringify(m.map(x=>x.role)));
  const tail=m[m.length-1];
  ck('the prefilled turn is there',tail.role==='assistant'&&tail.content==='A B C',tail.content);
  ck('carrying the flag the user configured',tail.partial===true);
  ck('the thinking split is off for this probe',tail.reasoning_content===undefined);
  ck('and it is reported as applied',t.prefill.applied===true,t.prefill.reason);

  const b=JSON.parse(w.eval("JSON.stringify(buildPayload({probe:'bare'},current).body.messages)"));
  ck('the bare probe drops the flag',b[b.length-1].partial===undefined);
  ck('but keeps the turn',b[b.length-1].content==='A B C');

  const sd=JSON.parse(w.eval("JSON.stringify(buildPayload({probe:'seed'},current).body.messages)"));
  ck('the seed probe fills the thinking field',sd[sd.length-1].reasoning_content==='checking',sd[sd.length-1].reasoning_content);
  ck('and still leaves something to carry on from',sd[sd.length-1].content==='A B C');

  // a probe is not a message, and "applied" is not a distinguishing answer:
  // the probe applies too, so the report has to be compared on what it sent
  w.eval("pfSet({text:'the real prefill words'})");
  w.eval("buildPayload({},current)");
  const realText=w.eval('lastPrefill.detail.text');
  ck('a real send is what gets recorded',realText==='the real prefill words',realText);
  w.eval("buildPayload({probe:'bare'},current)");
  ck('a probe never overwrites it',w.eval('lastPrefill.detail.text')==='the real prefill words',
    w.eval('lastPrefill.detail.text'));
  w.eval("buildPayload({probe:'text'},current)");
  ck('nor does the probe that carries the flag',w.eval('lastPrefill.detail.text')==='the real prefill words',
    w.eval('lastPrefill.detail.text'));
  w.eval("pfSet({text:PF_DEFAULT.text})");

  // an old refusal must not gag the test that would clear it
  w.eval("markPrefillDown({id:'p1'})");
  ck('a refused connection still skips a real send',
    JSON.parse(w.eval('JSON.stringify(buildPayload({},current))')).prefill.reason==='wire-refused');
  ck('but the probe is sent anyway',
    JSON.parse(w.eval("JSON.stringify(buildPayload({probe:'text'},current))")).prefill.applied===true);
  await sleep(60);
  dom.window.close();
}

console.log(NL+'=== R. READING THE ANSWER ===');
{
  const dom=await boot(base());const w=dom.window;
  const v=t=>w.eval('pfProbeVerdict('+JSON.stringify(t)+')');
  ck('D means it carried on',v('D E F')==='continued');
  ck('leading space and case do not matter',v('  d e f ')==='continued');
  ck('A means it started over',v('A B C D E F')==='restarted');
  ck('nothing back is not a pass',v('')==='empty');
  ck('whitespace only is not a pass',v('   ')==='empty');
  ck('an off-script answer is not a pass',v('Sure! Here you go.')==='unclear');
  ck('"D" inside a word is not a continuation',v('Done')==='unclear',v('Done'));
  const rd=(k,j)=>w.eval('pfReplyText('+JSON.stringify(k)+','+JSON.stringify(j)+')');
  ck('an OpenAI reply is read',rd('openai',oaReply('D E F'))==='D E F');
  ck('an Anthropic reply is read',rd('anthropic',anReply('D E F'))==='D E F');
  ck('Anthropic thinking blocks are not mistaken for the reply',
    rd('anthropic',{content:[{type:'thinking',thinking:'A B C'},{type:'text',text:'D E F'}]})==='D E F');
  ck('a body with nothing in it reads as empty',rd('openai',{})==='');
  await sleep(60);
  dom.window.close();
}

console.log(NL+'=== S. WHAT THE BUTTON SAYS ===');
{
  const rec=script([{body:oaReply('D E F')},{body:oaReply('D E F')}]);
  const dom=await boot(base(),rec.attach);const w=dom.window,d=w.document;
  await rig(w,null,{});
  await press(w,d,500);
  ck('a working prefill goes green',/pf-ok/.test(statCls(d)),statCls(d));
  ck('and names the connection and model',/Testly/.test(statTxt(d))&&/mod-9/.test(statTxt(d)),statTxt(d).slice(0,70));
  ck('and says it carried on',/carried on/.test(statTxt(d)));
  ck('the flag is reported accepted',/Flag "partial" accepted/.test(statTxt(d)));
  ck('the thinking field is checked separately',rec.n===2,String(rec.n));
  ck('and reported accepted',/thinking field "reasoning_content" was accepted/.test(statTxt(d)),statTxt(d).slice(-90));
  ck('the button is usable again',d.getElementById('pfTestBtn').disabled===false
    &&d.getElementById('pfTestBtn').textContent==='Test prefill',d.getElementById('pfTestBtn').textContent);
  ck('nothing was written into the chat',w.eval('current.messages.length')===1,String(w.eval('current.messages.length')));
  await sleep(60);
  dom.window.close();
}

console.log(NL+'=== T. A 200 THAT ISN\'T A PASS ===');
{
  const rec=script([{body:oaReply('A B C D E F')}]);
  const dom=await boot(base(),rec.attach);const w=dom.window,d=w.document;
  await rig(w,null,{});
  await press(w,d,500);
  ck('a service that drops the turn is not green',!/pf-ok/.test(statCls(d)),statCls(d));
  ck('it is flagged amber',/pf-warn/.test(statCls(d)));
  ck('and says the model started over',/started the answer over/.test(statTxt(d)),statTxt(d).slice(0,80));
  ck('the thinking field is not probed after that',rec.n===1,String(rec.n));
  await sleep(60);
  dom.window.close();
}
{
  const rec=script([{body:oaReply('')}]);
  const dom=await boot(base(),rec.attach);const w=dom.window,d=w.document;
  await rig(w,null,{});
  await press(w,d,500);
  ck('an empty reply is not a pass either',/pf-warn/.test(statCls(d)),statCls(d));
  ck('and points at thinking as the likely cause',/spent the whole reply on thinking/.test(statTxt(d)));
  await sleep(60);
  dom.window.close();
}

console.log(NL+'=== U. A REFUSAL IS DIAGNOSED, NOT JUST REPORTED ===');
{
  const rec=script([{fail:true,status:400,detail:'This model does not support assistant message prefill. The conversation must end with a user message.'}]);
  const dom=await boot(base(),rec.attach);const w=dom.window,d=w.document;
  await rig(w,null,{});
  await press(w,d,500);
  ck('a hard refusal goes red',/pf-bad/.test(statCls(d)),statCls(d));
  ck('and names the model that refused',/mod-9/.test(statTxt(d)),statTxt(d).slice(0,60));
  ck('the connection is marked so messages are not spent on it',w.eval("prefillIsDown({id:'p1'})")===true);
  ck('and it does not go on to probe the flag',rec.n===1,String(rec.n));
  await sleep(60);
  dom.window.close();
}
{
  // the turn is fine; the field riding on it is not
  const rec=script([{fail:true,status:400,detail:'Unrecognized request argument supplied: partial'},{body:oaReply('D E F')}]);
  const dom=await boot(base(),rec.attach);const w=dom.window,d=w.document;
  await rig(w,null,{});
  await press(w,d,600);
  ck('a rejected field is separated from a rejected turn',rec.n===2,String(rec.n));
  ck('the second probe carried no flag',rec.tail(1).partial===undefined,rec.tail(1).role);
  ck('and the field is named in the verdict',/"partial" was rejected/.test(statTxt(d)),statTxt(d).slice(0,80));
  ck('the turn is reported as fine',/The turn is fine/.test(statTxt(d)));
  ck('the connection is NOT marked down for a field problem',w.eval("prefillIsDown({id:'p1'})")===false);
  await sleep(60);
  dom.window.close();
}
{
  // turn and flag both fine, thinking field rejected on its own
  const rec=script([{body:oaReply('D E F')},{fail:true,status:400,detail:'unknown field reasoning_content'}]);
  const dom=await boot(base(),rec.attach);const w=dom.window,d=w.document;
  await rig(w,null,{});
  await press(w,d,600);
  ck('a rejected thinking field is amber, not green',/pf-warn/.test(statCls(d)),statCls(d));
  ck('the prefill is still reported as working',/The prefill works/.test(statTxt(d)),statTxt(d).slice(0,60));
  ck('and the field is named',/"reasoning_content" was rejected/.test(statTxt(d)));
  await sleep(60);
  dom.window.close();
}

console.log(NL+'=== V. A SUCCESS OUTRANKS AN OLD REFUSAL ===');
{
  const rec=script([{body:oaReply('D E F')},{body:oaReply('D E F')}]);
  const dom=await boot(base(),rec.attach);const w=dom.window,d=w.document;
  await rig(w,null,{});
  w.eval("markPrefillDown({id:'p1'})");
  ck('the connection starts marked down',w.eval("prefillIsDown({id:'p1'})")===true);
  await press(w,d,600);
  ck('a passing test clears the mark',w.eval("prefillIsDown({id:'p1'})")===false);
  ck('so real messages get the prefill again',
    JSON.parse(w.eval('JSON.stringify(buildPayload({},current))')).prefill.applied===true);
  ck('and the mark is gone from storage too',
    !JSON.parse(w.localStorage.getItem('cozychat:settings')).providers.some(p=>p.id==='p1'&&p.prefillDownAt));
  await sleep(60);
  dom.window.close();
}

console.log(NL+'=== W. QUESTIONS ANSWERED WITHOUT SPENDING A REQUEST ===');
{
  const rec=script([{body:oaReply('D E F')}]);
  const dom=await boot(base(),rec.attach);const w=dom.window,d=w.document;
  await rig(w,'pA',{});
  w.eval("cfgSet('effort','high')");
  await press(w,d,400);
  ck('Claude with thinking on is refused before sending',rec.n===0,String(rec.n));
  ck('and it is red',/pf-bad/.test(statCls(d)),statCls(d));
  ck('with the fix in the message',/Thinking effort to Off/.test(statTxt(d)),statTxt(d).slice(0,70));
  await sleep(60);
  dom.window.close();
}
{
  const rec=script([{body:oaReply('D E F')}]);
  const dom=await boot(base(),rec.attach);const w=dom.window,d=w.document;
  await rig(w,null,{});
  w.eval("pfSet({on:false})");
  await press(w,d,400);
  ck('a prefill that is off is explained, not blamed on the service',
    /Nothing was prefilled/.test(statTxt(d)),statTxt(d).slice(0,60));
  ck('and it is not green',!/pf-ok/.test(statCls(d)),statCls(d));
  await sleep(60);
  dom.window.close();
}
{
  const dom=await boot(base(),()=>()=>Promise.reject(new TypeError('Failed to fetch')));
  const w=dom.window,d=w.document;
  await w.eval("(()=>{S.providers=[];S.activeProvider=null;newConvo();pfSet({on:true});openSettings();})()");
  await sleep(60);
  await press(w,d,400);
  ck('no connection is said plainly',/Add a connection/.test(statTxt(d)),statTxt(d).slice(0,50));
  await sleep(60);
  dom.window.close();
}

console.log(NL+'=== X. A GREEN LIGHT THAT WOULD BE A LIE ===');
{
  const rec=script([{body:oaReply('D E F')},{body:oaReply('D E F')}]);
  const dom=await boot(base(),rec.attach);const w=dom.window,d=w.document;
  await rig(w,'pH',{});
  await press(w,d,600);
  ck('Runs mode is not reported as a plain pass',!/pf-ok/.test(statCls(d)),statCls(d));
  ck('because a run carries no prefill',/Runs mode/.test(statTxt(d)),statTxt(d).slice(-120));
  await sleep(60);
  dom.window.close();
}
{
  const rec=script([{body:oaReply('D E F')},{body:oaReply('D E F')}]);
  const dom=await boot(base(),rec.attach);const w=dom.window,d=w.document;
  await rig(w,null,{});
  await press(w,d,600);
  ck('the verdict is there to begin with',/pf-ok/.test(statCls(d)));
  d.getElementById('pfFlag').value='prefix';
  d.getElementById('pfFlag').dispatchEvent(new w.Event('change',{bubbles:true}));
  await sleep(80);
  ck('changing a field name clears it',statTxt(d)==='',JSON.stringify(statTxt(d).slice(0,40)));
  await press(w,d,600);
  ck('and it comes back after another test',/pf-ok/.test(statCls(d)));
  d.getElementById('pfClose').value='</thinking>';
  d.getElementById('pfClose').dispatchEvent(new w.Event('change',{bubbles:true}));
  await sleep(80);
  ck('changing a tag clears it',statTxt(d)==='');
  await press(w,d,600);
  w.eval("cfgSet('effort','high');renderEffort();renderPrefill()");
  await sleep(80);
  ck('changing thinking effort clears it',statTxt(d)==='');
  await press(w,d,600);
  const before=statTxt(d);
  d.getElementById('tgPfEcho').dispatchEvent(new w.Event('click',{bubbles:true}));
  await sleep(80);
  ck('a setting the test does not depend on leaves it alone',statTxt(d)===before,statTxt(d).slice(0,40));
  await sleep(60);
  dom.window.close();
}

console.log(NL+'=== Y. THE BUTTON IS THERE AND EXPLAINED ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document;
  const btn=d.getElementById('pfTestBtn'), st=d.getElementById('pfTestStat');
  ck('the button exists',!!btn);
  ck('inside the prefill block',!!d.querySelector('#prefillCfg #pfTestBtn'));
  ck('it says what it does',/Test prefill/.test(btn.textContent),btn.textContent);
  ck('there is somewhere for the answer to go',!!st);
  const note=btn.closest('.field').querySelectorAll('.hint');
  ck('and the button is explained where it sits',note.length>=2&&note[note.length-1].textContent.trim().length>40,
    String(note.length));
  ck('the explanation says it uses the current connection',
    /connection you're using now/.test(btn.closest('.field').textContent));
  await sleep(60);
  dom.window.close();
}

console.log(NL+'RESULT: '+(fail?('FAILURES: '+fail+' of '+(pass+fail)):('ALL PASS ('+pass+' checks)')));
process.exit(fail?1:0);
})();
