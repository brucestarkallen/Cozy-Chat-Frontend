// TEST FILE — run with: node tests/v5270test.js
// Guards v5.27.0 in the browser's own storage (no phone server): what the
// model saw is kept per reply version and shown part by part and raw; a swipe
// streams into the reply and never takes its versions out of the chat; the
// bottom Retry means the same as Swipe; Retry on an older reply asks first; a
// branch keeps the chat's setup; an emptied temperature box sends nothing; an
// imported block with no text cannot break sends; CRLF streams are read; a
// reply stuck mid-stream is settled at open; and this host never calls a store.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=(o={})=>Object.assign({
  providers:[
    {id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000},
    {id:'p2',preset:'custom',kind:'openai',name:'U',url:'https://b/v1',apiKey:'k',model:'m2',ctx:100000},
    {id:'pA',preset:'anthropic',kind:'anthropic',name:'C',url:'https://c/v1',apiKey:'k',model:'claude-x',ctx:100000}],
  activeProvider:'p1',
  presets:[{id:'d',name:'D',system:'BASE PROMPT',injections:[
      {id:'b1',name:'Style guide',text:'Write warmly.',role:'system',pos:'relative',depth:0,enabled:true},
      {id:'b2',name:'Nudge',text:'Stay on topic.',role:'system',pos:'chat',depth:1,enabled:true}],
    order:['__main__','b1','__chat__','b2']},
    {id:'s2',name:'Second',system:'SECOND',injections:[],order:['__main__','__chat__']}],
  activePreset:'d',prompts:[],projects:[{id:'pj',name:'Proj',system:'',injections:[],order:['__main__','__chat__'],docIds:[]}],
  temperature:1,maxTokens:4096,effort:'off',squashSystem:true,
  showThinking:true,showTools:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}},o);
function boot(st,f){return new Promise(res=>{
  let clip=null;
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
    beforeParse(w){
      w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
      w.navigator.storage={estimate:async()=>({usage:0})};
      w.requestAnimationFrame=cb=>setTimeout(cb,0);
      w.__confirm=true; w.confirm=()=>w.__confirm; w.prompt=(q,d)=>d||'X';
      w.navigator.clipboard={writeText:async t=>{clip=t;}}; w.__clip=()=>clip;
      if (st) w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
      if (f) w.fetch=f(w);
    }});
  setTimeout(async()=>{try{
    await dom.window.eval('Promise.all([DB.clear(),DB.docClear()])');
    dom.window.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();');
  }catch(_){}res(dom);},750);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ev=(w,el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true}));
const oa=t=>'data: '+JSON.stringify({choices:[{delta:{content:t}}]})+'\n\n';
/* a fetch that answers each request from a list: {status,msg} refuses; {sse:[chunks], hold:k} streams,
   pausing before chunk k until w.__release() is called */
function fq(w,responses){
  w.__reqs=[];
  const enc=t=>new TextEncoder().encode(t);
  let i=0;
  return (url,opts)=>{
    const u=String(url);
    if (u.indexOf('api/')===0 || u.indexOf('/api/')>=0){ (w.__api=w.__api||[]).push(u); return Promise.reject(new Error('no store here')); }
    const r=responses[Math.min(i++,responses.length-1)];
    w.__reqs.push({url:u,body:opts&&opts.body?JSON.parse(opts.body):null});
    if (r.status){
      return Promise.resolve({ok:false,status:r.status,json:()=>Promise.resolve({error:{message:r.msg||'nope'}}),text:()=>Promise.resolve(r.msg||'nope')});
    }
    let k=0, held=null;
    w.__release=()=>{ const h=held; held=null; if(h) h(); };
    return Promise.resolve({ok:true,status:200,body:{getReader(){return{read(){
      return new Promise((res2,rej)=>{
        const sig=opts&&opts.signal;
        if(sig&&sig.aborted) return rej(Object.assign(new Error('aborted'),{name:'AbortError'}));
        if(k>=r.sse.length) return res2({done:true});
        const go=()=>res2({done:false,value:enc(r.sse[k++])});
        if (r.hold!=null && k===r.hold && !r.__held){ r.__held=true; held=go; return; }
        setTimeout(go,0);
      });
    }};}}});
  };
}

(async()=>{

console.log('=== 1. AN EMPTIED TEMPERATURE BOX SENDS NOTHING; A SET ONE IS SENT ===');
{
  const dom=await boot(base(),w=>fq(w,[{sse:[oa('hi')]}]));const w=dom.window,d=w.document;
  w.eval('newConvo(); current.messages.push({id:"u1",role:"user",content:"hello"});');
  ck('a set temperature is sent', w.eval('buildPayload({},current).body.temperature')===1);
  const t=d.querySelector('#temp'); t.value=''; ev(w,t,'change');
  ck('emptied: the request carries no temperature at all', w.eval('!("temperature" in buildPayload({},current).body)'), w.eval('JSON.stringify(buildPayload({},current).body.temperature)'));
  ck('… and not 0 (Number("") used to send the coldest setting)', w.eval('chatTemp()')===null);
  ck('the choice belongs to this chat', w.eval('current.cfg.temperature')==='none');
  ck('the box shows it empty, not 0', (w.eval('syncSettingsUI()'), d.querySelector('#temp').value)==='');
  w.eval('current.cfg.providerId="pA"');
  ck('Claude: no temperature either', w.eval('!("temperature" in buildPayload({},current).body)'));
  t.value='0.7'; ev(w,t,'change');
  ck('a typed value is sent again', w.eval('buildPayload({},current).body.temperature')===0.7);
  const dom2=await boot(null,w=>fq(w,[{sse:[oa('x')]}]));const w2=dom2.window;
  w2.eval('S.providers=[{id:"p1",preset:"custom",kind:"openai",name:"T",url:"https://a/v1",apiKey:"k",model:"m"}];S.activeProvider="p1";newConvo();current.messages.push({id:"u",role:"user",content:"q"});');
  ck('a fresh install sends none until one is set', w2.eval('!("temperature" in buildPayload({},current).body)'));
}

console.log('=== 2. A BRANCH KEEPS THE CHAT\'S SETUP ===');
{
  const dom=await boot(base(),w=>fq(w,[{sse:[oa('x')]}]));const w=dom.window,d=w.document;
  await w.eval(`(async()=>{ const dd = await newDoc("notes.md","N"); newConvo(null,"pj");
    current.cfg = {providerId:"p2",model:"m2-special",presetId:"s2",temperature:0.3,maxTokens:999,effort:"high",squashSystem:false};
    current.sysExtra="ONLY HERE"; current.docIds=[dd.id]; current.filesOn=true; current.title="Origin";
    current.messages=[{id:"a1",role:"user",content:"one"},{id:"a2",role:"assistant",content:"two"},{id:"a3",role:"user",content:"three"}];
    await persist(); renderThread(); })()`);
  const src=w.eval('current');
  d.querySelector('[data-branch="a2"]').click(); await sleep(150);
  const c=w.eval('current');
  ck('a new chat opened', c.id!==src.id);
  ck('… with messages up to the branch point', c.messages.length===2 && c.messages[1].content==='two' && c.messages[0].id!=='a1');
  ck('the connection, model, set and sampling came along', JSON.stringify(c.cfg)===JSON.stringify(src.cfg), JSON.stringify(c.cfg));
  ck('the project came along', c.projectId==='pj');
  ck('"this chat only" text and files came along', c.sysExtra==='ONLY HERE' && c.docIds.length===1 && c.docIds[0]===src.docIds[0] && c.filesOn===true);
  ck('the request is built the way the original\'s was', w.eval('buildPayload({},current).body.model')==='m2-special');
}

console.log('=== 3. A SWIPE STREAMS INTO THE REPLY; ITS VERSIONS NEVER LEAVE THE CHAT ===');
{
  const dom=await boot(base(),w=>fq(w,[{sse:[oa('NEW '),oa('VERSION')],hold:1}, {status:500,msg:'down'}, {sse:[oa('THIRD')]}]));
  const w=dom.window,d=w.document;
  await w.eval(`(async()=>{ newConvo(); current.messages=[{id:"u1",role:"user",content:"q"},
     {id:"r1",role:"assistant",content:"OLD REPLY",thinking:"",variants:[{content:"OLD REPLY",thinking:""}],vi:0}];
     await persist(); renderThread(); })()`);
  d.querySelector('[data-regen="r1"]').click(); await sleep(120);
  const mid=w.eval('current.messages[1]');
  ck('mid-stream the reply is the same message', mid.id==='r1' && mid.pending===true);
  ck('… and its old version is still on it', mid.variants.length===1 && mid.variants[0].content==='OLD REPLY');
  const saved=await w.eval('DB.all()');
  ck('what is saved mid-stream still holds the old reply', saved[0].messages.some(m=>m.id==='r1' && /OLD REPLY/.test(JSON.stringify(m))));
  ck('the request did not carry the reply being replaced', JSON.stringify(w.__reqs[0].body.messages).indexOf('OLD REPLY')<0);
  ck('no swipe arrows while it streams', !d.querySelector('[data-swipe]'));
  w.__release(); await sleep(250);
  const done=w.eval('current.messages[1]');
  ck('the new version landed beside the old', done.variants.length===2 && done.vi===1 && done.content==='NEW VERSION', JSON.stringify(done.variants.map(v=>v.content)));
  d.querySelector('[data-regen="r1"]').click(); await sleep(250);
  const after=w.eval('current.messages');
  ck('a failed swipe puts the reply back as it was', after[1].id==='r1' && after[1].content==='NEW VERSION' && after[1].vi===1 && after[1].variants.length===2, JSON.stringify(after.map(m=>m.role+':'+m.content)));
  ck('… with the error after it', after.length===3 && after[2].role==='error');
  ck('… and nothing left arriving', !after[1].pending);
  d.querySelector('#regenBtn').click(); await sleep(300);
  const fin=w.eval('current.messages');
  ck('bottom Retry = Swipe: the error goes, a third version joins', fin.length===2 && fin[1].variants.length===3 && fin[1].content==='THIRD', JSON.stringify(fin.map(m=>m.role)));
}

console.log('=== 4. RETRY ON AN OLDER REPLY ASKS BEFORE REMOVING WHAT FOLLOWS ===');
{
  const dom=await boot(base(),w=>fq(w,[{sse:[oa('again')]}]));const w=dom.window,d=w.document;
  await w.eval(`(async()=>{ newConvo(); current.messages=[{id:"u1",role:"user",content:"q1"},{id:"r1",role:"assistant",content:"A1"},
     {id:"u2",role:"user",content:"q2"},{id:"r2",role:"assistant",content:"A2"}]; await persist(); renderThread(); })()`);
  w.__confirm=false;
  d.querySelector('[data-regen="r1"]').click(); await sleep(150);
  ck('declined: every message stays', w.eval('current.messages.length')===4 && w.__reqs.length===0);
  w.__confirm=true;
  d.querySelector('[data-regen="r1"]').click(); await sleep(250);
  ck('accepted: retried from there', w.eval('current.messages.map(m=>m.content).join("|")')==='q1|again');
}

console.log('=== 5. AN IMPORTED BLOCK WITH NO TEXT CANNOT BREAK SENDING ===');
{
  const st=base(); st.presets[0].injections.push({id:'b9',name:'Broken',enabled:true});
  st.presets[0].order.splice(2,0,'b9');
  const dom=await boot(st,w=>fq(w,[{sse:[oa('fine')]}]));const w=dom.window;
  w.eval('newConvo(); current.messages.push({id:"u",role:"user",content:"q"});');
  let ok=true; try { w.eval('buildPayload({},current)'); } catch(e){ ok=false; }
  ck('the request builds', ok);
  ck('the block was given empty text and a role', w.eval('PS().injections.find(i=>i.id==="b9").text')==='' && w.eval('PS().injections.find(i=>i.id==="b9").role')==='system');
}

console.log('=== 6. A SEARCH LINK THAT IS NOT A WEB ADDRESS IS NOT A LINK ===');
{
  const dom=await boot(base());const w=dom.window;
  ck('javascript: in a source becomes #', w.eval('sourcesHtml([{url:"javascript:alert(1)",title:"x"}])').indexOf('href="#"')>=0);
  ck('javascript: in an image becomes #', w.eval('imagesHtml([{url:"javascript:x",link:"javascript:y"}])').indexOf('javascript')<0);
  ck('a real address stays', w.eval('sourcesHtml([{url:"https://ok.example/a?b=1",title:"x"}])').indexOf('href="https://ok.example/a?b=1"')>=0);
}

console.log('=== 7. A STREAM FRAMED WITH CRLF IS READ ===');
{
  const crlf=t=>'data: '+JSON.stringify({choices:[{delta:{content:t}}]})+'\r\n\r\n';
  const a=crlf('Hello, '), b=crlf('world');
  const chunks=[a.slice(0,-1), a.slice(-1)+b.slice(0,10), b.slice(10), 'data: '+JSON.stringify({choices:[{delta:{content:'!'}}]})];
  const dom=await boot(base(),w=>fq(w,[{sse:chunks}]));const w=dom.window;
  w.eval('newConvo();'); await w.eval('send("hi")');
  ck('every frame arrived, split CR|LF included', w.eval('current.messages[1].content')==='Hello, world!', w.eval('current.messages[1].content'));
  ck('sseFrames: a lone CR is a line end too', JSON.stringify(w.eval('(function(){const st={buf:""};return sseFrames(st,"data: 1\\r\\rdata: 2\\r\\r",true);})()'))==='["data: 1","data: 2"]');
}

console.log('=== 8. WHAT THE MODEL SAW ===');
{
  const usage={choices:[],usage:{prompt_tokens:4321,completion_tokens:12,prompt_tokens_details:{cached_tokens:4000}}};
  const dom=await boot(base(),w=>fq(w,[{sse:[oa('First '),oa('answer'),'data: '+JSON.stringify(usage)+'\n\n','data: [DONE]\n\n']},
                                      {sse:[oa('Second answer')]},{sse:[oa('Swiped')]}]));
  const w=dom.window,d=w.document;
  w.eval('newConvo(); current.sysExtra="JUST THIS CHAT";');
  const para=k=>'Paragraph '+k+' says '+('something particular about number '+k+' ').repeat(9);
  w.__long='What is up?\n\n'+Array.from({length:24},(_,k)=>para(k)).join('\n\n');
  await w.eval('send(window.__long)');
  await sleep(300);
  const m=w.eval('current.messages[1]');
  ck('the reply knows where its request is kept', !!(m.sent && m.sent.id && m.sent.chat===w.eval('current.id')));
  ck('the count is the service\'s own', m.sent.tokens===4321 && m.sent.exact===true, JSON.stringify(m.sent));
  const rec=await w.eval('Sent.load(current.id, current.messages[1].sent.id)');
  ck('the kept request is the request that went out, word for word', JSON.stringify(rec.requests[0].body)===JSON.stringify(w.__reqs[0].body));
  const names=rec.parts.map(x=>x.name);
  ck('its parts are named', ['Main system prompt','Style guide','This chat only','The conversation','Nudge'].every(n=>names.indexOf(n)>=0), names.join(' | '));
  const wire=JSON.stringify(w.__reqs[0].body);
  ck('every part\'s words are in the request', rec.parts.filter(x=>x.name!=='The conversation').every(x=>wire.indexOf(JSON.stringify(x.text).slice(1,-1))>=0));
  /* v5.29.1: the chat is one message long, so the block at depth 1 opens the
     list - and with squash on it joins the system prompt in front of it
     (v5291wiretest.js, section 8), which is where its part says it sat. It
     used to go out as a second system message. */
  ck('the in-chat block says where it sat', rec.parts.find(x=>x.name==='Nudge').where==='the system prompt', rec.parts.find(x=>x.name==='Nudge').where);
  ck('the service\'s counts and the timing are kept', rec.usage.in===4321 && rec.usage.out===12 && rec.usage.cached===4000 && typeof rec.durationMs==='number');
  ck('no key in what was kept', JSON.stringify(rec).indexOf('"k"')<0 && JSON.stringify(rec).indexOf('Bearer')<0);
  const btn=d.querySelector('[data-sent="'+m.id+'"]');
  ck('the line under the reply says it, with the count', !!btn && /What the model saw · 4,321 tokens/.test(btn.textContent), btn && btn.textContent);
  btn.click(); await sleep(200);
  ck('the sheet opens on Normal', d.querySelector('#sentModal').classList.contains('show') && !d.querySelector('#sentNormal').hidden);
  const rows=[...d.querySelectorAll('#sentNormal .sent-name')].map(b=>b.textContent);
  ck('one row per part, in order', rows[0]==='Main system prompt' && rows.indexOf('The conversation')>0, rows.join(' | '));
  const conv=[...d.querySelectorAll('#sentNormal .sent-part')].find(p=>p.querySelector('.sent-name').textContent==='The conversation');
  conv.querySelector('.sent-name').click();
  ck('a tap opens its words', /\[You\]\nWhat is up\?/.test(conv.querySelector('.sent-text').textContent));
  conv.querySelector('.sent-copy').click(); await sleep(30);
  ck('Copy takes exactly those words', w.__clip()===conv.querySelector('.sent-text').textContent);
  ck('the foot names the service\'s count', /4,321 tokens in, 12 out \(4,000 read from cache\) — counted by the service/.test(d.querySelector('#sentFoot').textContent), d.querySelector('#sentFoot').textContent);
  d.querySelector('[data-sentview="raw"]').click(); await sleep(50);
  const raw=d.querySelector('#sentRaw');
  // one system string (main prompt + the leading block + this chat's text + the in-chat block that opens the chat, squashed), then the user turn
  ck('Raw shows the settings and every message by role', /"model": "m"/.test(raw.textContent) && [...raw.querySelectorAll('.sent-role')].map(r=>r.textContent).join(',')==='settings,system,user', [...raw.querySelectorAll('.sent-role')].map(r=>r.textContent).join(','));
  raw.querySelector('.sent-req-head .sent-copy').click(); await sleep(30);
  ck('Copy all is the request body exactly', w.__clip()===JSON.stringify(w.__reqs[0].body,null,2));
  d.querySelector('#closeSent').click();
  await w.eval('send("and again")'); await sleep(300);
  const box=await w.eval('(async()=>{ const db=await new Promise(r=>{const q=indexedDB.open("cozychat-sent",1);q.onsuccess=()=>r(q.result);}); return await new Promise(r=>{const g=db.transaction("boxes").objectStore("boxes").get(current.id);g.onsuccess=()=>r(g.result);}); })()');
  const sizes=Object.values(box.pieces).reduce((n,t)=>n+t.length,0);
  const longOnes=v=>typeof v==='string'?(v.length>=512?v.length:0):Array.isArray(v)?v.reduce((n,x)=>n+longOnes(x),0):(v&&typeof v==='object')?Object.values(v).reduce((n,x)=>n+longOnes(x),0):0;
  const ids=Object.keys(box.records);
  let whole=0; for (const id of ids) whole+=longOnes(await w.eval('Sent.load(current.id,'+JSON.stringify(id)+')'));
  ck('two replies kept, the words they share stored once', ids.length===2 && sizes < 0.5*whole, sizes+' chars kept for '+whole+' chars of long words');
  ck('a reply without a count says it is an estimate', w.eval('current.messages[3].sent.exact')===false && w.eval('current.messages[3].sent.tokens')>0);
  const firstSent=w.eval('current.messages[3].sent.id');
  await w.eval('send(null,"swipe",current)'); await sleep(300);
  const r3=w.eval('current.messages[3]');
  ck('a new version has its own record', r3.sent.id!==firstSent && r3.variants[0].sent.id===firstSent && r3.variants[1].sent.id===r3.sent.id);
  d.querySelector('[data-swipe="'+r3.id+'"][data-dir="-1"]').click(); await sleep(60);
  ck('swiping back shows that version\'s record', w.eval('current.messages[3].sent.id')===firstSent);
  w.eval('Sent.drop(current.id)'); await sleep(80);
  d.querySelector('[data-sent="'+r3.id+'"]').click(); await sleep(150);
  ck('a record no longer kept says so plainly', /isn't kept any more/.test(d.querySelector('#sentNormal').textContent));
}

console.log('=== 9. CLAUDE\'S OWN COUNT IS READ TOO ===');
{
  const an=[{type:'message_start',message:{usage:{input_tokens:100,cache_read_input_tokens:900,cache_creation_input_tokens:5,output_tokens:1}}},
    {type:'content_block_delta',delta:{type:'text_delta',text:'Hi'}},{type:'message_delta',usage:{output_tokens:7}}].map(x=>'data: '+JSON.stringify(x)+'\n\n');
  const st=base({activeProvider:'pA'});
  const dom=await boot(st,w=>fq(w,[{sse:an}]));const w=dom.window;
  w.eval('newConvo();'); await w.eval('send("hey")'); await sleep(200);
  const rec=await w.eval('Sent.load(current.id, current.messages[1].sent.id)');
  ck('input counts every token the model read, cache included', rec.usage.in===1005 && rec.usage.out===7 && rec.usage.cached===900, JSON.stringify(rec.usage));
  ck('Claude\'s system text is the system part', rec.parts[0].name==='Main system prompt' && rec.requests[0].body.system.indexOf('BASE PROMPT')===0);
}

console.log('=== 10. A REPLY STUCK MID-STREAM IS SETTLED WHEN THE APP OPENS ===');
{
  const old=Date.now()-2*3600*1000;
  const dom0=await boot(base());
  await dom0.window.eval(`DB.put(${JSON.stringify({id:'st1',title:'Stuck',createdAt:old,updatedAt:old,cfg:{},messages:[
    {id:'u',role:'user',content:'q'},{id:'r',role:'assistant',content:'half a rep',thinking:'',variants:[],vi:0,pending:true},
    {id:'u2',role:'user',content:'q2'},{id:'r2',role:'assistant',content:'',thinking:'',variants:[{content:'kept version',thinking:''}],vi:0,pending:true},
    {id:'u3',role:'user',content:'q3'},{id:'r3',role:'assistant',content:'',thinking:'',variants:[],vi:0,pending:true}]})})`);
  const fresh=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',beforeParse(w){
    w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;w.navigator.storage={estimate:async()=>({usage:0})};
    w.requestAnimationFrame=cb=>setTimeout(cb,0);w.localStorage.setItem('cozychat:settings',JSON.stringify(base()));}});
  await sleep(900);
  const c=fresh.window.eval('convos.find(c=>c.id==="st1")');
  const byId=id=>c.messages.find(m=>m.id===id);
  ck('nothing is left arriving', !c.messages.some(m=>m.pending));
  ck('what came is kept as a version', byId('r').content==='half a rep' && byId('r').variants.length===1);
  ck('an empty new version gives way to the one before', byId('r2').content==='kept version');
  ck('an empty reply with no version goes', !byId('r3'));
  const saved=(await fresh.window.eval('DB.all()')).find(c=>c.id==='st1');
  ck('and the settled chat is saved', !saved.messages.some(m=>m.pending));
}

console.log('=== 11. THIS HOST NEVER CALLS A STORE ===');
{
  const dom=await boot(base(),w=>fq(w,[{sse:[oa('x')]}]));const w=dom.window,d=w.document;
  w.eval('newConvo();'); await w.eval('send("hi")'); await sleep(300);
  ck('no request to api/ of any kind', !(w.__api||[]).length, (w.__api||[]).join(','));
  ck('the data panel says where the data is', /in this browser only/.test((w.eval('renderDataHint()'),d.querySelector('#dataHint').textContent)));
  ck('no banner', d.querySelector('#storeBanner').hidden);
}

console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})();
