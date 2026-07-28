// TEST FILE — run with: node tests/v54test.js
// Guards v5.4.0: a project carries instructions, an instruction set, and
// files into every chat inside it; smart context sends the parts of a long
// file that matter for the message, in document order, and refuses a full
// rewrite of a file the model only saw in part; the assistant can edit
// project files; deleting a project frees its chats and deleting a file
// leaves no project pointing at it; tool activity can be hidden.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=(o={})=>Object.assign({
  providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000}],
  activeProvider:'p1',
  presets:[{id:'d',name:'D',system:'BASE',injections:[],order:['__main__','__chat__']},
           {id:'w',name:'Writer',system:'WRITER SET',injections:[],order:['__main__','__chat__']}],
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
function gated(w,chunks){
  const enc=t=>new TextEncoder().encode(t);
  let i=0; w.__step=null;
  const next=()=>new Promise(res=>{w.__step=()=>{w.__step=null;res();};});
  return (url,opts)=>{
    w.__req={url:url,headers:(opts&&opts.headers)||{},body:opts&&opts.body?JSON.parse(opts.body):null};
    const sig=opts&&opts.signal;
    return Promise.resolve({ok:true,body:{getReader(){return{read(){
      return new Promise((res,rej)=>{
        const bail=()=>rej(Object.assign(new Error('aborted'),{name:'AbortError'}));
        if(sig&&sig.aborted)return bail();
        if(sig)sig.addEventListener('abort',bail,{once:true});
        if(i>=chunks.length)return res({done:true});
        next().then(()=>{ if(sig&&sig.aborted)return; res({done:false,value:enc(chunks[i++])}); });
      });}};}}});
  };
}
const oa=t=>'data: '+JSON.stringify({choices:[{delta:{content:t}}]})+'\n\n';
const tp=o=>'event: hermes.tool.progress\ndata: '+JSON.stringify(o)+'\n\n';
async function drain(w,n){for(let k=0;k<n;k++){await sleep(60);w.__step&&w.__step();}await sleep(300);}

(async()=>{

console.log('=== 1. RETRIEVAL PICKS WHAT THE MESSAGE NEEDS ===');
{
  const dom=await boot(base());
  const w=dom.window;
  const doc=w.eval(`(function(){
    const secs=[];
    for (let i=0;i<40;i++) secs.push("Section "+i+". "+("Filler sentence about ordinary things. ".repeat(6)));
    // the LATER section scores higher, so score order and document order
    // disagree — only the re-sort by position can make this pass
    secs[7]="Section 7. A first note on the zanpakuto release. "+("Filler around it. ".repeat(5));
    secs[31]="Section 31. The zanpakuto release phrase belongs to the captain alone. "+("More detail on the release phrase ritual. ".repeat(5));
    return secs.join("\\n\\n");
  })()`);
  w.eval(`__doc=${JSON.stringify(doc)}`);
  const out=w.eval(`relevantChunks(__doc,"what is the zanpakuto release phrase",7000)`);
  ck('the relevant section is in', out.indexOf('release phrase belongs to the captain')>=0);
  ck('an unrelated distant section is out', out.indexOf('Section 25.')<0);
  ck('both hits arrive in document order', out.indexOf('Section 7.')>=0 && out.indexOf('Section 31.')>out.indexOf('Section 7.'),
     out.indexOf('Section 7.')+' < '+out.indexOf('Section 31.'));
  ck('gaps are marked', out.indexOf('[\u2026]')>=0);
  ck('a small file passes through whole', w.eval(`relevantChunks("tiny file","anything",7000)`)==='tiny file');
  const fb=w.eval(`relevantChunks(__doc,"",7000)`);
  ck('no usable query falls back to the head, not nothing', fb.indexOf('Section 0.')===0 && fb.length<=7010, String(fb.length));
}

console.log('=== 2. A PROJECT TRAVELS WITH ITS CHATS ===');
{
  const dom=await boot(base());
  const w=dom.window,d=w.document;
  await w.eval(`(async function(){
    const doc=await newDoc("canon.md","The hero is Jovan Oda.\\nHe fights in Karakura.");
    S.projects=[{id:"pr1",name:"Bleach RP",instructions:"PROJECT LAW: stay in canon.",presetId:"w",docIds:[doc.id]}];
    saveSettings(); renderSidebar();
  })()`);
  await sleep(80);
  const head=d.querySelector('.proj-head');
  ck('the project appears in the sidebar', !!head && head.textContent.indexOf('Bleach RP')>=0);
  head.querySelector('[data-projnew]').dispatchEvent(new w.Event('click',{bubbles:true}));
  await sleep(80);
  ck('a chat born there belongs to it', w.eval('current.projectId')==='pr1');
  ck('and is pinned to the project\'s instruction set', w.eval('current.cfg.presetId')==='w');
  w.eval('current.messages.push({id:uid(),role:"user",content:"who is the hero?",ts:Date.now()})');
  const asm=w.eval('JSON.stringify(assembleMessages("openai"))');
  ck('project instructions reach the system prompt', asm.indexOf('PROJECT LAW: stay in canon.')>=0);
  ck('after the set\'s own prompt', asm.indexOf('WRITER SET')>=0 && asm.indexOf('WRITER SET')<asm.indexOf('PROJECT LAW'));
  ck('the project file rides along', asm.indexOf('The hero is Jovan Oda.')>=0);
  ck('the sidebar counts it', d.querySelector('.proj-head .ph-n').textContent==='1');
  // a chat outside the project sees none of it
  w.eval('newConvo()');
  w.eval('current.messages.push({id:uid(),role:"user",content:"hi",ts:Date.now()})');
  const asm2=w.eval('JSON.stringify(assembleMessages("openai"))');
  ck('an outside chat gets neither instructions nor files', asm2.indexOf('PROJECT LAW')<0 && asm2.indexOf('Jovan Oda')<0);
}

console.log('=== 3. THE ASSISTANT CAN EDIT A PROJECT FILE ===');
{
  const dom=await boot(base());
  const w=dom.window;
  await w.eval(`(async function(){
    const doc=await newDoc("notes.md","alpha line\\nbeta line");
    S.projects=[{id:"pr1",name:"P",instructions:"",presetId:null,docIds:[doc.id]}];
    saveSettings(); newConvo(null,"pr1");
    current.messages.push({id:"m1",role:"assistant",content:"done",
      edits:[{id:"e1",type:"replace",find:"beta line",file:"notes.md",replace:"gamma line",reason:"",status:"pending"}]});
  })()`);
  await w.eval('applyEdit("m1","e1")');
  await sleep(80);
  ck('the edit landed in the project file', w.eval('docs[0].text')==='alpha line\ngamma line', w.eval('docs[0].text'));
  ck('and the card says applied', w.eval('current.messages[0].edits[0].status')==='applied');
}

console.log('=== 4. EXCERPTS ARE HONEST — AND REFUSE FULL REWRITES ===');
{
  const dom=await boot(base());
  const w=dom.window;
  await w.eval(`(async function(){
    const secs=[];
    for (let i=0;i<40;i++) secs.push("Part "+i+". "+("Plain filler text sentence here. ".repeat(6)));
    secs[5]="Part 5. The arbiter engine resolves combat by initiative. "+("Extra arbiter engine detail. ".repeat(4));
    const doc=await newDoc("big.md",secs.join("\\n\\n"));
    doc.mode="smart"; await saveDoc(doc);
    newConvo(); current.docIds=[doc.id]; current.filesOn=true;
    current.messages.push({id:uid(),role:"user",content:"explain the arbiter engine",ts:Date.now()});
  })()`);
  const asm=w.eval('JSON.stringify(assembleMessages("openai"))');
  ck('the file goes out marked as excerpts', asm.indexOf('relevant excerpts, not the whole file')>=0);
  ck('with the part the message asked about', asm.indexOf('resolves combat by initiative')>=0);
  ck('and not the whole thing', asm.indexOf('Part 25.')<0);
  ck('the model is told not to rewrite what it cannot see', asm.indexOf('Never use replace_all on an excerpted file')>=0);
  await w.eval(`(function(){
    current.messages.push({id:"m1",role:"assistant",content:"x",
      edits:[{id:"e1",type:"replace_all",find:null,file:"big.md",replace:"gone",reason:"",status:"pending"}]});
    return applyEdit("m1","e1");
  })()`);
  await sleep(80);
  ck('a full rewrite of an excerpted file is refused', w.eval('current.messages[current.messages.length-1].edits[0].status')==='failed',
     w.eval('current.messages[current.messages.length-1].edits[0].status'));
  ck('with a reason that names the cure', /excerpts/.test(w.eval('current.messages[current.messages.length-1].edits[0].note')));
  ck('the file is untouched', w.eval('docs[0].text.indexOf("Part 39.")')>=0);
  await w.eval(`(function(){
    docs[0].mode="full";
    current.messages[current.messages.length-1].edits[0].status="pending";
    return applyEdit("m1","e1");
  })()`);
  await sleep(80);
  ck('on Full the same rewrite goes through', w.eval('docs[0].text')==='gone');
}

console.log('=== 5. TOOL ACTIVITY CAN BE HIDDEN ===');
{
  const st=base({providers:[{id:'h1',preset:'hermes',kind:'openai',name:'Hermes Agent',url:'http://127.0.0.1:8642/v1',apiKey:'k',model:'hermes-agent',ctx:200000}],activeProvider:'h1',showTools:false});
  const dom=await boot(st,w=>gated(w,[
    tp({tool:'web_search',emoji:'\u{1F50D}',label:'web_search: q',toolCallId:'c1',status:'running'}),
    oa('Reply.')
  ]));
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  d.querySelector('#input').value='go'; ev(w,d.querySelector('#input'),'input');
  ev(w,d.querySelector('#sendBtn'),'click');
  await drain(w,3);
  ck('with the toggle off no activity log renders', !d.querySelector('.tool-log'));
  ck('but the events are still kept on the message', w.eval('current.messages[1].tools.length')===1);
  w.eval('S.showTools=true;saveSettings();renderThread()');
  await sleep(60);
  ck('turning it on reveals what was recorded', !!d.querySelector('.tool-log .tool-row'));
}

console.log('=== 6. LIFECYCLES — MOVE, DELETE, PURGE ===');
{
  const dom=await boot(base());
  const w=dom.window,d=w.document;
  await w.eval(`(async function(){
    const doc=await newDoc("shared.md","content");
    S.projects=[{id:"pr1",name:"P1",instructions:"",presetId:null,docIds:[doc.id]}];
    saveSettings(); newConvo(); openSettings(); syncSettingsUI();
  })()`);
  await sleep(60);
  const sel=d.querySelector('#chatProj');
  ck('the chat panel offers the project', sel && sel.querySelectorAll('option').length===2);
  sel.value='pr1'; ev(w,sel,'change'); await sleep(60);
  ck('picking it moves the chat in', w.eval('current.projectId')==='pr1');
  ck('and the project file appears in the chat\'s file list', w.eval('allChatDocs().length')===1);
  // deleting the file leaves no project pointing at it
  await w.eval('(function(){openDocId=docs[0].id;return null;})()');
  d.querySelector('#docDelBtn').dispatchEvent(new w.Event('click',{bubbles:true}));
  await sleep(120);
  ck('deleting the file purges it from the project', w.eval('S.projects[0].docIds.length')===0);
  // deleting the project frees the chat
  w.eval('openProjEditor("pr1")');
  d.querySelector('#projDelBtn').dispatchEvent(new w.Event('click',{bubbles:true}));
  await sleep(120);
  ck('deleting the project keeps the chat', w.eval('convos.length')>=1);
  ck('outside any project', w.eval('current.projectId')===undefined);
  ck('and the sidebar has no orphan header', !d.querySelector('.proj-head'));
}

console.log('');
console.log(fail?('FAILED '+fail):'ALL PASS','('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})();
