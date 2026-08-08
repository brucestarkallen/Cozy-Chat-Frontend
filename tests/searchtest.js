// TEST FILE — run with: node tests/searchtest.js
// Guards v5.21.0: the model decides whether it needs the internet.
//
// Every trigger Cozy had answered "does this need a search?" before the model
// had read the message — a magnifier tap, "every message", or a regex on the
// wording. The one participant that knows whether it knows was never asked,
// and on a Claude connection the tool that WOULD have asked it was gated
// behind opts.search: the user had to decide first, which is the opposite of
// automatic.
//
// Two mechanisms, one rule. On Claude, its own search tool now rides every
// turn and Claude spends a search only when it wants one. Everywhere else
// there is no tool at all, so the request travels as text: the model answers
// with a lookup block, Cozy runs it and asks the same turn again with the
// results in front of it.
//
// The failure modes that shape the code below:
//   1. a reply that merely NAMES the tag is an answer, not a request — the
//      recognizer that decides whether to search is the same one that decides
//      whether to strip, so prose about the protocol can never be gutted;
//   2. a request must not survive as a visible reply on ANY path out of the
//      round — a failed search, an abort, a spent round;
//   3. a search that came back empty still has to appear on the wire, or the
//      model reads silence as "the lookup never happened" and asks again;
//   4. a forced search's block is byte-for-byte what it always was.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const NL='\n';
const OPEN='<'+'websearch>', CLOSE='</'+'websearch>';
const q=s=>OPEN+s+CLOSE;

const base=(search,kind)=>({
  providers:[{id:'p1',preset:'custom',kind:kind||'openai',name:'T',
    url:kind==='anthropic'?'https://api.anthropic.com/v1':'https://a/v1',apiKey:'k',model:'m',ctx:100000}],
  activeProvider:'p1',presets:[{id:'d',name:'D',system:'be helpful',injections:[],order:['__main__','__chat__']}],
  activePreset:'d',prompts:[],temperature:1,maxTokens:4096,effort:'off',squashSystem:true,
  showThinking:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:Object.assign({on:false,provider:'native',key:'',count:5,relay:'',always:false,images:false,auto:true,model:true},search||{})});

function boot(st){return new Promise(res=>{
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
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const J=(w,e)=>JSON.parse(w.eval('JSON.stringify('+e+')'));
const sse=t=>'data: '+JSON.stringify({choices:[{delta:{content:t}}]})+NL+NL;

/* Routes by URL: the model stream and the search endpoint are two different
   services and the loop has to call them in the right order. */
function wire(w, modelRounds, searchAnswers){
  const rec={model:[],search:[]};
  const mq=modelRounds.slice(), sq=(searchAnswers||[]).slice();
  w.fetch=(url,opt)=>{
    const u=String(url);
    if (u.indexOf('tavily')>=0 || u.indexOf('exa.ai')>=0){
      rec.search.push(JSON.parse(String(opt.body)));
      return Promise.resolve({ok:true,json:()=>Promise.resolve(sq.shift()||{results:[]})});
    }
    rec.model.push(JSON.parse(String(opt.body)));
    const text=mq.shift(); const chunks=text==null?[]:[sse(text),'data: [DONE]'+NL+NL];
    let i=0;
    return Promise.resolve({ok:true,body:{getReader(){return{read(){
      if(i>=chunks.length)return Promise.resolve({done:true});
      return Promise.resolve({done:false,value:new TextEncoder().encode(chunks[i++])});
    }};}}});
  };
  return rec;
}
const TAVILY=r=>({results:r.map((x,i)=>({title:x[0],url:x[1],content:x[2]||'body '+i}))});

(async()=>{

console.log('=== 1. WHAT COUNTS AS A REQUEST TO LOOK SOMETHING UP ===');
{
  const dom=await boot(base({on:true,provider:'tavily',key:'K'}));const w=dom.window;
  const call=s=>J(w,'parseSearchCall('+JSON.stringify(s)+')');

  ck('a reply that is only a lookup block is a request',
     (call(q('rust 1.90 release date'))||{}).queries.join()==='rust 1.90 release date');
  ck('a short preamble in front of it is still a request',
     (call('Let me check.'+NL+q('rust 1.90 release date'))||{}).queries.length===1);
  ck('several blocks become several queries',
     (call(q('a')+NL+q('b')+NL+q('c'))||{}).queries.join()==='a,b,c');
  ck('never more than three',
     (call(q('a')+q('b')+q('c')+q('d'))||{}).queries.length===3);
  ck('the same query twice is one query',
     (call(q('a')+NL+q('a'))||{}).queries.length===1);
  ck('an empty block is not a query', call(q('   '))===null);
  ck('an unclosed opener is not a request', call('thinking about '+OPEN+'half')===null);

  /* The reply that must survive: it names the tag while answering. */
  const explain='Cozy lets a model ask for a search by replying with '+q('your query')+
    ', which is why a reply like that never reaches you. '+
    'The app runs the query and asks the model again with the results, so what you read is the second answer. '+
    'It only works when a search key is set in Settings, and it is capped at two rounds per message.';
  ck('prose that merely names the tag is an answer, not a request', call(explain)===null,
     'len(rest)='+explain.replace(new RegExp(OPEN+'[\\s\\S]*?'+CLOSE,'g'),'').trim().length);
  ck('a tag inside a code fence is not a request',
     call('Here is the protocol:'+NL+'```'+NL+q('example')+NL+'```')===null);

  ck('a request the model put in its thinking counts when it said nothing else',
     (J(w,'parseSearchCall({text:"   ",think:'+JSON.stringify(q('x'))+'})')||{}).queries.join()==='x');
  ck('but a real answer outranks a query in the reasoning behind it',
     J(w,'parseSearchCall({text:"The answer is 42.",think:'+JSON.stringify(q('x'))+'})')===null);
  dom.window.close();
}

console.log(NL+'=== 2. WHEN THE PROTOCOL IS ON THE WIRE AT ALL ===');
{
  const off=await boot(base({on:false,provider:'tavily',key:'K'}));
  ck('search switched off: no protocol', off.window.eval('autoSearchTextOn()')===false);
  ck('and nothing about it in the system prompt',
     off.window.eval('newConvo(), assembleMessages("openai",current).system').indexOf(OPEN)<0);
  off.window.close();

  const nokey=await boot(base({on:true,provider:'tavily',key:''}));
  ck('no search key: no protocol', nokey.window.eval('autoSearchTextOn()')===false);
  nokey.window.close();

  const nat=await boot(base({on:true,provider:'native',key:''},'anthropic'));
  ck('Claude\u2019s own tool does the asking, so no text protocol beside it',
     nat.window.eval('autoSearchTextOn()')===false);
  nat.window.close();

  /* Switching service does not clear the key, so a Claude user who tried
     Tavily first still has one on file. Two ways to search in one prompt is
     one contradiction and one wasted round: the text request would reach
     runSearch(), which has no native branch and returns nothing. */
  const natKey=await boot(base({on:true,provider:'native',key:'LEFTOVER'},'anthropic'));
  ck('a key left over from another service does not put the protocol beside Claude\u2019s tool',
     natKey.window.eval('autoSearchTextOn()')===false);
  ck('and the system prompt stays clean of it',
     natKey.window.eval('newConvo(), assembleMessages("anthropic",current).system').indexOf(OPEN)<0);
  natKey.window.close();

  const optout=await boot(base({on:true,provider:'tavily',key:'K',model:false}));
  ck('switched off by the user: no protocol', optout.window.eval('autoSearchTextOn()')===false);
  optout.window.close();

  const on=await boot(base({on:true,provider:'tavily',key:'K'}));
  ck('key plus the toggle: the protocol is live', on.window.eval('autoSearchTextOn()')===true);
  const sys=on.window.eval('newConvo(), assembleMessages("openai",current).system');
  ck('and the system prompt teaches the tag', sys.indexOf(OPEN)>=0);
  ck('and says the request reply is never shown', /never sees it/.test(sys));
  ck('an old settings blob with no model field still gets the protocol',
     on.window.eval('S.search.model!==false')===true);
  on.window.close();
}

console.log(NL+'=== 3. CLAUDE\u2019S OWN TOOL NO LONGER WAITS TO BE ASKED ===');
{
  const dom=await boot(base({on:true,provider:'native',key:''},'anthropic'));const w=dom.window;
  w.eval('newConvo(); current.messages.push({id:"u",role:"user",content:"hi",ts:1});');
  const noOpt=J(w,'buildPayload({},current).body');
  ck('the tool rides a turn nobody marked', !!(noOpt.tools&&noOpt.tools.length),
     JSON.stringify(noOpt.tools||null));
  ck('and it is the web search tool', (noOpt.tools||[{}])[0].name==='web_search');
  const forced=J(w,'buildPayload({search:true},current).body');
  ck('the magnifier still works', !!(forced.tools&&forced.tools.length));
  w.eval('S.search.model=false');
  ck('opting out puts it back to the old behaviour',
     !J(w,'buildPayload({},current).body').tools);
  ck('and the magnifier still overrides that',
     !!J(w,'buildPayload({search:true},current).body').tools);
  w.eval('S.search.model=true; S.search.on=false');
  ck('search off means no tool either way', !J(w,'buildPayload({search:true},current).body').tools);
  w.eval('S.search.on=true');
  ck('a probe never carries tools \u2014 it is testing the prefill, not the search',
     !J(w,'buildPayload({probe:"continuation"},current).body').tools);
  dom.window.close();
}

console.log(NL+'=== 4. THE BLOCK THE RESULTS ARRIVE IN ===');
{
  const dom=await boot(base({on:true,provider:'tavily',key:'K'}));const w=dom.window;
  const wireOf=seed=>{ w.eval('newConvo(); current.messages=['+seed+']');
    return w.eval('assembleMessages("openai",current).messages.map(m=>m.content).join("\\n")'); };

  /* A chat saved before v5.21.0 has sources and neither of the new fields.
     Its block has to be byte-for-byte what it was, or reopening an old
     conversation changes every request it makes. A forced search performed
     NOW records its query like any other \u2014 v2test pins that end. */
  const old=wireOf('{id:"u",role:"user",content:"hi",ts:1,sources:[{title:"T",url:"https://u/1",snippet:"S"}]}');
  ck('a search stored before this release is on the wire unchanged',
     old.indexOf('<web_results>'+NL+'[1] T'+NL+'https://u/1'+NL+'S'+NL+'</web_results>')>=0,
     JSON.stringify(old.slice(-90)));

  const named=wireOf('{id:"u",role:"user",content:"hi",ts:1,searchedFor:["who won"],sources:[{title:"T",url:"https://u/1",snippet:"S"}]}');
  ck('a search the model asked for names the query it asked',
     named.indexOf('<web_results for="who won">')>=0, JSON.stringify(named.slice(-120)));

  const empty=wireOf('{id:"u",role:"user",content:"hi",ts:1,searchedFor:["nothing there"]}');
  ck('a search that came back empty still appears',
     empty.indexOf('<web_results for="nothing there">')>=0);
  ck('and says so, so the model does not ask for it again',
     empty.indexOf('(nothing came back)')>=0);

  const spent=wireOf('{id:"u",role:"user",content:"hi",ts:1,searchedFor:["a"],searchDone:true,sources:[{title:"T",url:"https://u/1",snippet:"S"}]}');
  ck('the last round says it is the last', /No further lookups are available/.test(spent));
  ck('and an earlier round does not', !/No further lookups are available/.test(named));

  const quoted=wireOf('{id:"u",role:"user",content:"hi",ts:1,searchedFor:[\'say "hi"\']}');
  ck('a quote in the query cannot break the attribute', quoted.indexOf('for="say \'hi\'"')>=0,
     JSON.stringify(quoted.slice(-80)));

  const none=wireOf('{id:"u",role:"user",content:"hi",ts:1}');
  ck('a turn with no search carries no block at all', none.indexOf('<web_results')<0);
  dom.window.close();
}

console.log(NL+'=== 5. THE WHOLE ROUND TRIP: ASK, SEARCH, ANSWER ===');
{
  const dom=await boot(base({on:true,provider:'tavily',key:'K'}));const w=dom.window;
  w.eval('newConvo()');
  const rec=wire(w,[q('who won the 2026 final'),'Vega won it 3\u20131.'],
                   [TAVILY([['Final report','https://n/1','Vega beat Corvus 3-1']])]);
  await w.eval('send("who won the 2026 final?")'); await sleep(700);

  const msgs=J(w,'current.messages');
  const last=msgs[msgs.length-1];
  ck('the model was asked twice and the searcher once',
     rec.model.length===2 && rec.search.length===1,
     'model='+rec.model.length+' search='+rec.search.length);
  ck('the searcher got the model\u2019s query, not the user\u2019s words',
     rec.search[0].query==='who won the 2026 final', JSON.stringify(rec.search[0].query));
  ck('the reply the user reads is the answer', last.content==='Vega won it 3\u20131.',
     JSON.stringify(last.content));
  ck('and the request is nowhere in the conversation',
     JSON.stringify(msgs).indexOf('websearch')<0);
  const um=msgs.filter(m=>m.role==='user').pop();
  ck('the results are on the turn they belong to', (um.sources||[]).length===1,
     'n='+(um.sources||[]).length);
  ck('and the query is recorded with them', (um.searchedFor||[]).join()==='who won the 2026 final');
  /* The protocol names <web_results> when it teaches it, so the system turn
     always mentions it. What is being asked here is whether a RESULTS block
     reached the conversation, which is the only place one ever goes. */
  const convoOf=r=>JSON.stringify(r.messages.filter(m=>m.role!=='system'));
  ck('the second request carried the results',
     convoOf(rec.model[1]).indexOf('web_results for=\\"who won the 2026 final\\"')>=0
     && convoOf(rec.model[1]).indexOf('Vega beat Corvus')>=0);
  ck('the first request did not', convoOf(rec.model[0]).indexOf('web_results')<0,
     convoOf(rec.model[0]));
  ck('only one assistant turn came out of it',
     msgs.filter(m=>m.role==='assistant').length===1);
  dom.window.close();
}

console.log(NL+'=== 6. A REPLY THAT NEEDED NOTHING IS LEFT ALONE ===');
{
  const dom=await boot(base({on:true,provider:'tavily',key:'K'}));const w=dom.window;
  w.eval('newConvo()');
  const rec=wire(w,['Paris.'],[]);
  await w.eval('send("capital of France?")'); await sleep(500);
  ck('one request, no search', rec.model.length===1 && rec.search.length===0,
     'model='+rec.model.length+' search='+rec.search.length);
  ck('and the answer stands', J(w,'current.messages').pop().content==='Paris.');
  dom.window.close();
}

console.log(NL+'=== 7. THE ROUNDS RUN OUT, AND A REQUEST STILL IS NOT A REPLY ===');
{
  const dom=await boot(base({on:true,provider:'tavily',key:'K'}));const w=dom.window;
  w.eval('newConvo()');
  const rec=wire(w,[q('a'),q('b'),q('c'),'never reached'],
                   [TAVILY([['A','https://n/a']]),TAVILY([['B','https://n/b']])]);
  await w.eval('send("go")'); await sleep(900);
  const msgs=J(w,'current.messages'); const last=msgs[msgs.length-1];
  ck('it stops after two lookups', rec.search.length===2 && rec.model.length===3,
     'model='+rec.model.length+' search='+rec.search.length);
  ck('a request that outlived its rounds is not shown',
     last.content.indexOf('websearch')<0, JSON.stringify(last.content));
  ck('and the reply says what happened instead of going blank',
     /no lookups left/.test(last.content), JSON.stringify(last.content));
  ck('the last round told the model it was the last',
     /No further lookups are available/.test(JSON.stringify(rec.model[2].messages)));
  dom.window.close();
}

console.log(NL+'=== 8. A SEARCH THAT FAILS STILL ENDS THE ROUND ===');
{
  const dom=await boot(base({on:true,provider:'tavily',key:'K'}));const w=dom.window;
  w.eval('newConvo()');
  const mq=[q('anything'),'Answering from what I know.'];
  const rec={model:[],search:0};
  w.fetch=(url,opt)=>{
    const u=String(url);
    if(u.indexOf('tavily')>=0){rec.search++;return Promise.resolve({ok:false,status:401,text:()=>Promise.resolve('bad key')});}
    rec.model.push(JSON.parse(String(opt.body)));
    const chunks=[sse(mq.shift()||''),'data: [DONE]'+NL+NL];let i=0;
    return Promise.resolve({ok:true,body:{getReader(){return{read(){
      if(i>=chunks.length)return Promise.resolve({done:true});
      return Promise.resolve({done:false,value:new TextEncoder().encode(chunks[i++])});
    }};}}});
  };
  await w.eval('send("go")'); await sleep(700);
  const msgs=J(w,'current.messages'); const um=msgs.filter(m=>m.role==='user').pop();
  ck('the failed lookup is still recorded', (um.searchedFor||[]).join()==='anything');
  ck('so the second request tells the model nothing came back',
     JSON.stringify(rec.model[1].messages).indexOf('(nothing came back)')>=0);
  ck('and the model answers instead of asking again',
     msgs[msgs.length-1].content==='Answering from what I know.',
     JSON.stringify(msgs[msgs.length-1].content));
  ck('the request never became the reply', JSON.stringify(msgs).indexOf('websearch')<0);
  dom.window.close();
}

console.log(NL+'=== 9. A ROUND THAT CANNOT RUN DISCARDS THE REQUEST ANYWAY ===');
{
  /* A round can end between recognizing the request and running it — nothing
     to attach results to, a stop, a newer send. The request is cleared before
     any of that can happen, so no path out leaves it standing as the reply. */
  const dom=await boot(base({on:true,provider:'tavily',key:'K'}));const w=dom.window;
  w.eval('newConvo()');   // a regenerate with nothing to search on behalf of
  const rec=wire(w,[q('anything at all')],[TAVILY([['A','https://n/a']])]);
  await w.eval('send()'); await sleep(600);
  const last=J(w,'current.messages').pop();
  ck('no lookup was attempted', rec.search.length===0, 'search='+rec.search.length);
  ck('and the request is not the reply', last.content.indexOf('websearch')<0,
     JSON.stringify(last.content));
  ck('the turn says why instead of reading as an empty reply',
     /no message to look it up for/.test(last.content), JSON.stringify(last.content));
  dom.window.close();
}

console.log(NL+'=== 10. THE SWITCH IS WHERE THE USER CAN REACH IT ===');
{
  const dom=await boot(base({on:true,provider:'tavily',key:'K'}));const w=dom.window,d=w.document;
  const btn=d.querySelector('#tgSearchModel');
  ck('the toggle exists in the search panel', !!btn);
  ck('and its panel is the search one', !!btn.closest('[data-panel="search"]'));
  ck('shipped on', btn.classList.contains('on'));
  btn.dispatchEvent(new w.Event('click',{bubbles:true}));
  ck('tapping it turns the protocol off', w.eval('S.search.model')===false);
  ck('and the wire agrees at once', w.eval('autoSearchTextOn()')===false);
  btn.dispatchEvent(new w.Event('click',{bubbles:true}));
  ck('tapping again turns it back on', w.eval('S.search.model')===true);
  ck('and it survives a reload of settings',
     JSON.parse(w.localStorage.getItem('cozychat:settings')).search.model===true);
  dom.window.close();
}

console.log(NL+'RESULT:',fail?('FAILURES: '+fail):'ALL PASS','('+pass+' checks)');
process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
