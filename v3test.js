const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync('./out/index.html','utf8');
function sse(cs){let i=0;return{getReader(){return{read(){
  if(i>=cs.length)return Promise.resolve({done:true});
  return Promise.resolve({done:false,value:new TextEncoder().encode(cs[i++])});}};}};}
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=(o={})=>Object.assign({
  providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://api.t/v1',apiKey:'k',model:'m',ctx:100000}],
  activeProvider:'p1',presets:[{id:'default',name:'Default',system:'',injections:[]}],activePreset:'default',
  prompts:[],temperature:1,maxTokens:100,showThinking:true,catchThinkTags:true,
  thinkTags:'think, thinking, reasoning, thought',enterSends:false,autoTitle:true,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}},o);
function boot(settings,fetchImpl){
  return new Promise(res=>{
    const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
      beforeParse(w){
        w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
        w.navigator.storage={estimate:async()=>({usage:0})};
        w.requestAnimationFrame=cb=>setTimeout(cb,0);
        w.confirm=()=>true;w.prompt=(q,d)=>d||'X';
        w.navigator.clipboard={writeText:async()=>{}};
        w.localStorage.setItem('cozychat:settings',JSON.stringify(settings));
        if(fetchImpl)w.fetch=fetchImpl;
      }});
    setTimeout(()=>{try{dom.window.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();');}catch(_){}res(dom);},750);
  });
}
const ev=(w,el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true}));

(async()=>{
const dom=await boot(base()); const w=dom.window, d=dom.window.document;
const L=w.eval('locate'), A=w.eval('applyEditToText'), P=w.eval('parseDocEdits');

console.log('\n=== 1. MATCHING: exact + normalised ===');
{
  const doc='Alpha line one.\nBeta line two.\nGamma line three.';
  ck('exact hit', L(doc,'Beta line two.').start===16);
  ck('not fuzzy when exact', L(doc,'Beta line two.').fuzzy===false);
  ck('miss returns null', L(doc,'nowhere at all here')===null);
  const curly='He said \u201Chello\u201D and left \u2014 quickly.';
  const hit=L(curly,'He said "hello" and left - quickly.');
  ck('curly quotes + em dash normalise', !!hit && hit.fuzzy===false);
  ck('normalised indices still map to original', hit && curly.slice(hit.start,hit.end)===curly);
  const dup='repeat me\nfiller\nrepeat me';
  ck('ambiguity counted', L(dup,'repeat me').count===2, 'count='+L(dup,'repeat me').count);
}

console.log('\n=== 2. MATCHING: fuzzy safety (must NOT corrupt files) ===');
{
  const doc='The quick brown fox jumps over the lazy dog today.';
  const ws=L(doc,'The quick  brown   fox jumps over the lazy dog today.');
  ck('whitespace-only difference matches', !!ws, ws?('fuzzy='+ws.fuzzy+' safe='+ws.safe):'null');
  ck('whitespace-only marked SAFE', ws && ws.safe===true);
  const wrong=L(doc,'The quick brown cat jumps over the lazy dog today.');
  ck('one wrong word → refused as unsafe', !wrong || wrong.safe===false,
     wrong?('sim='+Math.round(wrong.sim*100)+'% safe='+wrong.safe):'no match');
  const r=A(doc,{type:'replace',find:'The quick brown cat jumps over the lazy dog today.',replace:'X'});
  ck('unsafe fuzzy is NOT written to the file', r.text===null, r.note);
  const r2=A(doc,{type:'replace',find:'The quick  brown   fox jumps over the lazy dog today.',replace:'REPLACED'});
  ck('whitespace fuzzy IS applied', r2.text==='REPLACED', JSON.stringify(r2.text));
}

console.log('\n=== 3. EDIT APPLICATION ===');
{
  const doc='line A\nline B\nline C';
  ck('replace', A(doc,{type:'replace',find:'line B',replace:'line Z'}).text==='line A\nline Z\nline C');
  ck('insert after anchor', A(doc,{type:'insert',find:'line A',replace:'NEW'}).text==='line A\nNEW\nline B\nline C',
     JSON.stringify(A(doc,{type:'insert',find:'line A',replace:'NEW'}).text));
  ck('append', A(doc,{type:'append',replace:'line D'}).text==='line A\nline B\nline C\nline D');
  ck('replace_all', A(doc,{type:'replace_all',replace:'brand new'}).text==='brand new');
  ck('missing anchor fails cleanly', A(doc,{type:'replace',find:'not present at all',replace:'x'}).text===null);
  ck('first of N used', A('dup\ndup',{type:'replace',find:'dup',replace:'X'}).text==='X\ndup');
}

console.log('\n=== 4. JSON TOLERANCE ===');
{
  ck('clean block', P('hi <docedits>[{"find":"a","replace":"b","reason":"r"}]</docedits>').edits.length===1);
  ck('fenced block', P('<docedits>```json\n[{"find":"a","replace":"b"}]\n```</docedits>').edits.length===1);
  ck('trailing comma repaired', P('<docedits>[{"find":"a","replace":"b"},]</docedits>').edits.length===1);
  const rawNl='<docedits>[{"find":"a\nb","replace":"c\nd"}]</docedits>';
  ck('raw newlines inside strings repaired', P(rawNl).edits.length===1, JSON.stringify(P(rawNl).edits[0]&&P(rawNl).edits[0].find));
  ck('comma inside a string value preserved',
     P('<docedits>[{"find":"Options: [a, b, ]","replace":"z"}]</docedits>').edits[0].find==='Options: [a, b, ]');
  ck('garbage reports an error, never crashes', P('<docedits>{{{not json</docedits>').error!==undefined);
  ck('no block → no edits', P('just prose').edits.length===0);
  ck('all four shapes parse',
     P('<docedits>[{"find":"a","replace":"b"},{"insert_after":"c","replace":"d"},{"append":true,"replace":"e"},{"replace_all":true,"replace":"f"}]</docedits>').edits.map(e=>e.type).join(',')==='replace,insert,append,replace_all');
  ck('block stripped from display text',
     w.eval('stripDocEdits')('Prose here.\n<docedits>[]</docedits>')==='Prose here.');
}

console.log('\n=== 5. LIVE EDIT FLOW (attach → propose → apply → undo) ===');
{
  const reply='I will fix that.\n<docedits>[{"find":"old value","replace":"new value","reason":"you asked"}]</docedits>';
  const chunks=reply.match(/[\s\S]{1,40}/g).map(c=>'data: '+JSON.stringify({choices:[{delta:{content:c}}]})+'\n\n');
  const dom2=await boot(base(),()=>Promise.resolve({ok:true,body:sse(chunks)}));
  const w2=dom2.window,d2=dom2.window.document;
  await w2.eval('(async()=>{const doc=await newDoc("spec.md","header\\nold value\\nfooter");newConvo();await attachDoc(doc.id);})()');
  await new Promise(r=>setTimeout(r,300));
  ck('file icon visible when attached', d2.querySelector('#fileBtn').hidden===false);
  const sys=w2.eval('assembleMessages("openai").system');
  ck('protocol sent to model', sys.includes('<docedits>'));
  ck('file contents sent to model', sys.includes('old value')&&sys.includes('[DOCUMENT: spec.md]'));
  d2.querySelector('#input').value='fix it'; ev(w2,d2.querySelector('#input'),'input');
  ev(w2,d2.querySelector('#sendBtn'),'click');
  await new Promise(r=>setTimeout(r,1000));
  ck('diff card rendered', !!d2.querySelector('.edit-card'));
  ck('edit block hidden from the reply text',
     !d2.querySelector('.msg.assistant .msg-body').textContent.includes('docedits'),
     JSON.stringify(d2.querySelector('.msg.assistant .msg-body').textContent.trim()));
  ck('red side shows the old text', d2.querySelector('.diff .del').textContent==='old value');
  ck('green side shows the new text', d2.querySelector('.diff .add').textContent==='new value');
  ev(w2,d2.querySelector('[data-apply]'),'click');
  await new Promise(r=>setTimeout(r,400));
  ck('file actually changed', w2.eval('docs[0].text')==='header\nnew value\nfooter', JSON.stringify(w2.eval('docs[0].text')));
  ck('card marked applied', d2.querySelector('.edit-card').classList.contains('done'));
  ck('undo stack has the previous version', w2.eval('docs[0].undo.length')===1);
  await w2.eval('undoDoc()');
  await new Promise(r=>setTimeout(r,300));
  ck('undo restores the file', w2.eval('docs[0].text')==='header\nold value\nfooter');
}

console.log('\n=== 6. INSTRUCTION SETS ===');
{
  const dom3=await boot(base());
  const w3=dom3.window,d3=dom3.window.document;
  ev(w3,d3.querySelector('#settingsBtn'),'click');
  d3.querySelectorAll('.tab')[2].dispatchEvent(new w3.Event('click',{bubbles:true}));
  d3.querySelector('#sysPrompt').value='SET ONE'; ev(w3,d3.querySelector('#sysPrompt'),'change');
  ev(w3,d3.querySelector('#presetNewBtn'),'click');
  await new Promise(r=>setTimeout(r,150));
  ck('second set created', w3.eval('S.presets.length')===2);
  ck('new set starts empty', d3.querySelector('#sysPrompt').value==='', JSON.stringify(d3.querySelector('#sysPrompt').value));
  d3.querySelector('#sysPrompt').value='SET TWO'; ev(w3,d3.querySelector('#sysPrompt'),'change');
  w3.eval('switchPreset("default")');
  ck('switching back restores the first prompt', d3.querySelector('#sysPrompt').value==='SET ONE');
  ck('sets are independent', w3.eval('S.presets[1].system')==='SET TWO');
  w3.eval('S.presets[0].injections=[{id:"i1",name:"n",text:"BLOCK ONE",role:"system",pos:"depth",depth:0,enabled:true}];saveSettings()');
  w3.eval('current={id:"c",title:"t",messages:[{id:"1",role:"user",content:"U"}]}');
  ck('active set drives the prompt', w3.eval('assembleMessages("openai")').messages.some(m=>m.content==='BLOCK ONE'));
  w3.eval('switchPreset(S.presets[1].id)');
  ck('other set has no blocks', !w3.eval('assembleMessages("openai")').messages.some(m=>m.content==='BLOCK ONE'));
  ck('system follows the set', w3.eval('assembleMessages("openai").system')==='SET TWO');
}

console.log('\n=== 7. SEARCH / PIN / PER-CHAT SYSTEM ===');
{
  const dom4=await boot(base());
  const w4=dom4.window,d4=dom4.window.document;
  w4.eval(`convos=[
    {id:'a',title:'Bleach powerscaling',updatedAt:3,messages:[{id:'1',role:'user',content:'Quincy schrift ranking'}]},
    {id:'b',title:'Dinner ideas',updatedAt:2,pinned:true,messages:[{id:'2',role:'user',content:'nasi goreng'}]},
    {id:'c',title:'Old stuff',updatedAt:1,archived:true,messages:[{id:'3',role:'user',content:'quincy archived note'}]}
  ];current=convos[0];renderSidebar();`);
  ck('pinned section shown first', d4.querySelector('.sec-head').textContent==='Pinned');
  ck('archived hidden by default', !d4.querySelector('#convoList').textContent.includes('Old stuff'));
  d4.querySelector('#convoSearch').value='quincy'; ev(w4,d4.querySelector('#convoSearch'),'input');
  const txt=d4.querySelector('#convoList').textContent;
  ck('search matches message bodies not just titles', txt.includes('Bleach powerscaling'));
  ck('search reaches archived chats', txt.includes('Old stuff'));
  ck('non-matching chat excluded', !txt.includes('Dinner ideas'));
  ck('hit is highlighted', !!d4.querySelector('.convo-hit mark'), d4.querySelector('.convo-hit mark').textContent);
  ev(w4,d4.querySelector('#clearSearch'),'click');
  ck('clearing search restores the list', d4.querySelector('#convoList').textContent.includes('Dinner ideas'));
  w4.eval('current.sysExtra="ONLY THIS CHAT"');
  ck('per-chat system reaches the prompt', w4.eval('assembleMessages("openai").system').includes('ONLY THIS CHAT'));
  w4.eval('current=convos[1]');
  ck('other chat unaffected', !w4.eval('assembleMessages("openai").system').includes('ONLY THIS CHAT'));
}

console.log('\n=== 8. ATTACHMENTS + PROMPTS ===');
{
  let sentBody=null;
  const dom5=await boot(base(),(u,o)=>{sentBody=JSON.parse(o.body);
    return Promise.resolve({ok:true,body:sse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'])});});
  const w5=dom5.window,d5=dom5.window.document;
  w5.eval(`pendingAtts=[{kind:'image',name:'shot.png',mime:'image/png',data:'AAAA'},
                        {kind:'text',name:'notes.txt',text:'FILE BODY'}];renderAttachTray();`);
  ck('tray shows both attachments', d5.querySelectorAll('#attachTray .chip').length===2);
  d5.querySelector('#input').value='look at these'; ev(w5,d5.querySelector('#input'),'input');
  ev(w5,d5.querySelector('#sendBtn'),'click');
  await new Promise(r=>setTimeout(r,900));
  const um=sentBody.messages[sentBody.messages.length-1];
  ck('image sent as a content block', Array.isArray(um.content)&&um.content[0].type==='image_url');
  ck('text file inlined into the message', JSON.stringify(um.content).includes('FILE BODY'));
  ck('tray cleared after sending', w5.eval('pendingAtts.length')===0);
  ck('image thumbnail shown in the thread', !!d5.querySelector('.msg-atts img'));

  // anthropic image shape
  const shape=w5.eval(`(function(){const saved=current.messages;
    return assembleMessages("anthropic").messages.find(m=>Array.isArray(m.content)).content[0];})()`);
  ck('anthropic image shape differs correctly', shape.type==='image'&&shape.source.type==='base64', JSON.stringify(shape).slice(0,60));

  w5.eval('S.prompts=[{id:"p1",title:"Summarise",text:"Summarise the above."}];saveSettings();renderPromptList()');
  ev(w5,d5.querySelector('#quickPromptBtn'),'click');
  ev(w5,d5.querySelector('[data-use]'),'click');
  ck('prompt inserted into the box', d5.querySelector('#input').value.includes('Summarise the above.'));
}

console.log('\n=== 9. REGRESSIONS ===');
{
  const dom6=await boot(base());
  const w6=dom6.window,d6=dom6.window.document;
  ck('markdown intact', w6.eval('renderMarkdown("**b** `c`")')==='<p><strong>b</strong> <code>c</code></p>');
  ck('xss escaped', !w6.eval('renderMarkdown("<img src=x onerror=1>")').includes('<img'));
  ck('think tags still stripped', w6.eval('splitReasoning("<think>r</think>Ans")').text==='Ans');
  ck('closer-only still handled', w6.eval('splitReasoning("reasoning</think>Ans")').text==='Ans');
  ck('six themes', Object.keys(w6.eval('THEMES')).length===6);
  ck('ember meter present', !!d6.querySelector('#emberFill'));
  ev(w6,d6.querySelector('#settingsBtn'),'click');
  ck('five tabs', d6.querySelectorAll('.tab').length===5);
  ck('pending placeholder still excluded from payload',
     w6.eval(`(function(){current={id:'x',title:'t',messages:[{id:'1',role:'user',content:'U'},{id:'2',role:'assistant',content:'',pending:true}]};
       return assembleMessages("openai").messages.length;})()`)===1);
}

console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})();
