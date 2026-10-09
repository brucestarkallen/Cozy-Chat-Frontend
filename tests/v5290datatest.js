// TEST FILE — run with: node tests/v5290datatest.js
// Guards the data fixes after v5.28.9 in the browser's own storage (github.io
// keeps everything there). What needs the phone's store and a real browser is
// in tests/v5290data_e2e.py.
//   1. a chat deleted while its reply is arriving stays deleted - the
//      sidebar's Delete, the archive's Delete, "Delete every conversation"
//   4. nothing reloads the app while something is in progress: Check for
//      updates while a reply arrives or a connection is being edited, the
//      automatic look with a picture in the tray or one still being made
//      ready - the line at the top offers the new version instead
//   5. a reply still arriving is kept as it comes: the moment the tab is
//      hidden (its words taken from what arrived - a hidden tab draws no
//      frame), at once when a tool changes, every 10 s while words keep
//      coming, at least once a minute; a half-kept reply carries a heartbeat,
//      and a tab opening meanwhile leaves it arriving until that is stale
//   6. the full-screen editor's Save writes to the block by its id: the list
//      drawn again meanwhile loses nothing, and a block deleted meanwhile
//      keeps the editor open with the text in it (tests/v5290data_e2e.py
//      drives the same with a real change in another browser)
//   8. restoring a backup file checks the whole file before asking anything
//      or clearing anything: a malformed one changes nothing and says why,
//      and one the browser cannot store all of changes nothing either
const fs=require('fs');const {JSDOM,VirtualConsole}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
// the version this page is, and one it is not - so the checks hold whatever the release number
const SAME=(html.match(/const VERSION = "([\d.]+)"/)||[])[1], NEWER='9.99.0';
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
// a rejection nothing handled is a finding, not a reason to stop the run
const unhandled=[]; process.on('unhandledRejection',e=>unhandled.push(String((e&&e.message)||e)));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ev=(w,el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true}));
const enc=t=>new TextEncoder().encode(t);
const oa=t=>'data: '+JSON.stringify({choices:[{delta:{content:t}}]})+'\n\n';
const base=(o)=>Object.assign({
  providers:[{id:'o',preset:'custom',kind:'openai',name:'O',url:'https://o.test/v1',apiKey:'k',model:'m',ctx:200000}],
  activeProvider:'o',presets:[{id:'d',name:'D',system:'',injections:[],order:['__main__','__chat__']}],activePreset:'d',prompts:[],
  maxTokens:1024,effort:'off',showThinking:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  seeded513:true,search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}},o||{});

/* The network this app sees: the model (o.test) and the deployed index.html.
   ctl.mode "answer" replies at once; "arrive" sends ctl.first, then whatever
   ctl.push() adds, until ctl.end() or until the request is called off. */
function net(w,ctl){
  return (url,init)=>{
    url=String(url);
    if(/index\.html\?v=/.test(url)) return Promise.resolve({ok:true,status:200,text:async()=>'const VERSION = "'+ctl.version+'";'});
    if(!/o\.test/.test(url)) return Promise.reject(new Error('no network here: '+url));
    ctl.calls=(ctl.calls||0)+1;
    if(ctl.mode==='answer'){ let i=0; const parts=[oa(ctl.text||'ok')];
      return Promise.resolve({ok:true,status:200,body:{getReader(){return{read(){
        return Promise.resolve(i<parts.length?{done:false,value:enc(parts[i++])}:{done:true});},cancel(){}};}}}); }
    const q=ctl.first===''?[]:[oa(ctl.first||'Partial words')], sig=init&&init.signal; let wake=null;
    const kick=()=>{ if(wake){ const f=wake; wake=null; f(); } };
    ctl.push=t=>{ q.push(oa(t)); kick(); };
    ctl.end=()=>{ q.push(null); kick(); };
    return Promise.resolve({ok:true,status:200,body:{getReader(){return{read(){
      return new Promise((res,rej)=>{
        const give=()=>{ const x=q.shift(); res(x===null?{done:true}:{done:false,value:enc(x)}); };
        if(q.length) return give();
        wake=give;
        if(sig) sig.addEventListener('abort',()=>rej(new w.DOMException('The user aborted a request.','AbortError')));
      });},cancel(){}};}}});
  };
}
/* opts.keep: open over what the browser already holds (a second tab, or the
   same tab opened again) instead of starting from nothing.
   opts.noFrames: a hidden tab - requestAnimationFrame never fires. */
function boot(st,ctl,opts){ opts=opts||{}; return new Promise(res=>{
  const nav={n:0}, confirms={n:0,answer:true}, errors=[];
  const vc=new VirtualConsole();
  vc.on('jsdomError',e=>{ const m=String(e&&e.message); if(/navigation/i.test(m)) nav.n++; else errors.push(m); });
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',virtualConsole:vc,beforeParse(w){
    w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;w.navigator.storage={estimate:async()=>({usage:0})};
    w.requestAnimationFrame=cb=>opts.noFrames?0:setTimeout(cb,0);
    w.confirm=()=>{ confirms.n++; return confirms.answer; };
    w.navigator.clipboard={writeText:async()=>{}};
    if(st) w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
    w.fetch=net(w,ctl||{mode:'answer',version:SAME});
  }});
  setTimeout(async()=>{ const w=dom.window;
    if(!opts.keep){ try{ await w.eval('Promise.all([DB.clear(),DB.docClear()])'); w.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();'); }catch(_){} }
    const toasts=[]; const t=w.document.querySelector('#toast');
    new w.MutationObserver(()=>toasts.push(t.textContent)).observe(t,{childList:true,characterData:true,subtree:true});
    res({dom,w,d:w.document,nav,confirms,errors,toasts});
  },800);
});}
const say=async(w,d,text)=>{ d.querySelector('#input').value=text; ev(w,d.querySelector('#input'),'input'); d.querySelector('#sendBtn').click(); await sleep(300); };
const stored=async(w,id)=>((await w.eval('IDB.all()'))||[]).find(c=>c.id===id);

(async()=>{

console.log('=== 1. A CHAT DELETED WHILE ITS REPLY IS ARRIVING STAYS DELETED ===');
for (const how of ['the sidebar\'s Delete','the archive\'s Delete','Delete every conversation']){
  const ctl={mode:'answer',version:SAME};
  const {w,d}=await boot(base(),ctl);
  w.eval('newConvo(); renderSidebar();');
  await say(w,d,'first');
  const id=w.eval('current.id');
  if(how==='the archive\'s Delete'){ w.eval('current.archived=true; DB.put(JSON.parse(JSON.stringify(current))); renderSidebar();'); await sleep(100); }
  ctl.mode='arrive';
  await say(w,d,'second');
  const arriving=w.eval('!!(streaming && streaming.asstId && streaming.convoId === current.id)');
  if(how==='the sidebar\'s Delete') d.querySelector('#convoList [data-del="'+id+'"]').click();
  else if(how==='the archive\'s Delete'){ w.eval('openArchive()'); d.querySelector('#archList [data-archdel="'+id+'"]').click(); }
  else d.querySelector('#wipeBtn').click();
  await sleep(500);
  ck(how+': the reply was still arriving when the chat was deleted', arriving);
  ck(how+': it is gone from the list', !w.eval('convos.some(c => c.id === "'+id+'")'));
  const s=await stored(w,id);
  ck(how+': and from the browser\'s storage, not saved back by the reply it cut off', !s, s && JSON.stringify(s.messages.map(m=>m.content)));
  const again=await boot(null,null,{keep:true});
  ck(how+': opening the app again does not bring it back', !again.w.eval('convos.some(c => c.id === "'+id+'")'));
  again.dom.window.close(); w.close();
}

{
  // a delete the browser's storage refuses keeps the chat listed, and says so
  const {w,d,toasts}=await boot(base(),{mode:'answer',version:SAME});
  w.eval('newConvo(); renderSidebar();');
  await say(w,d,'keep me');
  const id=w.eval('current.id');
  w.eval('window.__del=IDB.del; IDB.del=()=>Promise.reject(new Error("the browser refused"));');
  d.querySelector('#convoList [data-del="'+id+'"]').click(); await sleep(300);
  ck('a delete the storage refuses: the chat stays in the list', w.eval('convos.some(c => c.id === "'+id+'")'));
  ck('and that is said', toasts.some(x=>/Couldn.t delete this chat — the browser refused/.test(x)), JSON.stringify(toasts)+' unhandled: '+JSON.stringify(unhandled));
  w.eval('IDB.del=window.__del; window.__clear=IDB.clear; IDB.clear=()=>Promise.reject(new Error("the browser refused"));');
  toasts.length=0;
  d.querySelector('#wipeBtn').click(); await sleep(300);
  ck('"Delete every conversation" refused: the chats stay in the list', w.eval('convos.length')===1);
  ck('and that is said, not "All conversations deleted"', toasts.some(x=>/Couldn.t delete the conversations — the browser refused/.test(x)) && !toasts.some(x=>/All conversations deleted/.test(x)), JSON.stringify(toasts));
  w.eval('IDB.clear=window.__clear;'); w.close();
}

console.log('\n=== 4. NOTHING RELOADS THE APP WHILE SOMETHING IS IN PROGRESS ===');
{
  const ctl={mode:'answer',version:SAME};
  const {w,d,nav}=await boot(base(),ctl);
  w.eval('window.__reloads=0; reloadPage=function(){ window.__reloads++; };');
  const reloads=()=>w.eval('window.__reloads')+nav.n;     // the stub, or a real location.reload() (jsdom reports it)
  const line=()=>d.querySelector('#updateBanner');
  w.eval('newConvo(); renderSidebar();');
  ctl.mode='arrive';
  await say(w,d,'tell me a long story');
  ctl.version=NEWER;
  w.eval('openSettings(); checkForUpdate();'); await sleep(1700);
  ck('Check for updates while a reply is arriving does not reload', reloads()===0, reloads()+' reloads');
  ck('the reply is still arriving', w.eval('!!(streaming && streaming.asstId)'));
  ck('Settings says the new version is here and waits', /9\.99\.0/.test(d.querySelector('#updateMsg').textContent) && !/Reloading/.test(d.querySelector('#updateMsg').textContent), d.querySelector('#updateMsg').textContent);
  ck('and the line at the top offers it', !line().hidden && /9\.99\.0/.test(line().textContent), line().hidden+' '+line().textContent);
  d.querySelector('#sendBtn').click(); await sleep(300);           // Stop
  w.eval('editProv("o")');                                          // a connection being edited, not saved
  w.eval('checkForUpdate()'); await sleep(1700);
  ck('nor while a connection is open in its editor, unsaved', reloads()===0, reloads()+' reloads');
  w.eval('$("#provEditor").hidden = true; editingProv = null;');
  w.eval('checkForUpdate()'); await sleep(1700);
  ck('with nothing in progress, Check for updates still switches to it', reloads()===1, reloads()+' reloads');
  w.close();
}
{
  const ctl={mode:'answer',version:NEWER};
  const {w,d,nav}=await boot(base(),ctl);
  w.eval('window.__reloads=0; reloadPage=function(){ window.__reloads++; };');
  const reloads=()=>w.eval('window.__reloads')+nav.n;
  w.eval('newConvo(); renderSidebar(); pendingAtts=[{kind:"image",name:"photo.jpg",mime:"image/jpeg",data:"AAAA",w:10,h:10,thumb:""}]; renderAttachTray();');
  ck('a picture waiting in the tray, nothing typed: not a quiet moment', w.eval('quietNow()')===false);
  await w.eval('lookForUpdate(true)');
  ck('the automatic look (the phone came back, or the tab did) does not reload over it', reloads()===0, reloads()+' reloads');
  ck('it offers the new version on the line at the top instead', !d.querySelector('#updateBanner').hidden);
  w.eval('pendingAtts=[]; renderAttachTray(); window.__ready=null; prepareImage=function(){ return new Promise(function(r){ window.__ready=r; }); };');
  const f=new w.File(['not really a picture'],'big.jpg',{type:'image/jpeg'});
  w.eval('(f)=>{ addAttachments([f]); }')(f); await sleep(50);
  ck('a picture still being made ready for the tray: not a quiet moment', w.eval('quietNow()')===false);
  await w.eval('lookForUpdate(true)');
  ck('the automatic look does not reload over it either', reloads()===0, reloads()+' reloads');
  w.eval('window.__ready({mime:"image/jpeg",data:"AAAA",w:10,h:10,thumb:""})'); await sleep(50);
  ck('the picture lands in the tray', w.eval('pendingAtts.length')===1);
  w.eval('pendingAtts=[]; renderAttachTray();');
  ck('with the tray empty and nothing being made ready, it is a quiet moment again', w.eval('quietNow()')===true);
  await w.eval('lookForUpdate(true)');
  ck('and the automatic look switches to the new version', reloads()===1, reloads()+' reloads');
  w.close();
}

console.log('\n=== 5. A REPLY STILL ARRIVING IS KEPT AS IT COMES ===');
{
  const ctl={mode:'arrive',first:'Half of the answer',version:SAME};
  const {w,d}=await boot(base(),ctl,{noFrames:true});            // no frame is ever drawn, as in a hidden tab
  w.eval('(()=>{ const real=Date.now.bind(Date); window.__shift=0; Date.now=()=>real()+window.__shift; })()');
  w.eval('newConvo(); renderSidebar();');
  await say(w,d,'a question');
  const id=w.eval('current.id');
  const last=c=>c&&c.messages[c.messages.length-1];
  let s=await stored(w,id);
  ck('the reply has started, and the browser\'s storage does not have it yet', w.eval('!!(streaming && streaming.asstId)') && !(last(s)&&last(s).role==='assistant'), s && JSON.stringify(s.messages.map(m=>m.role)));
  ck('no frame was drawn, so the words on the message are not up to date', w.eval('current.messages.slice(-1)[0].content')==='');
  Object.defineProperty(d,'visibilityState',{configurable:true,get:()=>'hidden'});
  d.dispatchEvent(new w.Event('visibilitychange')); await sleep(300);
  s=await stored(w,id);
  ck('the moment the tab is hidden, the reply so far is saved, with the words that arrived', last(s)&&last(s).role==='assistant'&&last(s).content==='Half of the answer', s && JSON.stringify(last(s)));
  ck('marked as still arriving, with a heartbeat', last(s)&&last(s).pending===true&&typeof last(s).beat==='number', s && JSON.stringify(last(s)));
  Object.defineProperty(d,'visibilityState',{configurable:true,get:()=>'visible'});
  w.eval('current.messages.slice(-1)[0].tools=[{id:"t1",tool:"terminal",label:"terminal",status:"running"}]');   // the agent starts a tool
  await sleep(2200);
  s=await stored(w,id);
  ck('a tool starting is kept within a second', last(s)&&Array.isArray(last(s).tools)&&last(s).tools.length===1&&last(s).tools[0].status==='running', s && JSON.stringify(last(s).tools));
  ctl.push(' and more words'); await sleep(200);
  w.eval('window.__shift=11000'); await sleep(2200);              // ten seconds on
  s=await stored(w,id);
  ck('every 10 s while words keep coming, they are kept', last(s)&&last(s).content==='Half of the answer and more words', s && JSON.stringify(last(s).content));
  const beat1=last(s).beat;
  w.eval('window.__shift=11000+61000'); await sleep(2200);         // a minute with nothing new
  s=await stored(w,id);
  ck('with nothing new for a minute, the heartbeat is kept going', last(s)&&last(s).beat>beat1, s && (last(s).beat-beat1));
  ctl.push(' - the end.'); ctl.end(); await sleep(400);
  s=await stored(w,id);
  ck('when the reply ends it is saved finished: whole, and no longer arriving', last(s)&&last(s).content==='Half of the answer and more words - the end.'&&!last(s).pending, s && JSON.stringify(last(s)));
  w.close();
}
{
  // a chat that takes long to write out (pictures) is kept less often, so saving never stalls the reply
  const ctl={mode:'arrive',first:'Words',version:SAME};
  const {w,d}=await boot(base(),ctl,{noFrames:true});
  w.eval('(()=>{ const real=Date.now.bind(Date); window.__shift=0; Date.now=()=>real()+window.__shift; })()');
  w.eval('newConvo(); renderSidebar();');
  await say(w,d,'a question about these pictures');
  const id=w.eval('current.id');
  const last=c=>c&&c.messages[c.messages.length-1];
  w.eval('window.__put=IDB.put; IDB.put=function(c){ const t=performance.now(); while(performance.now()-t<400){} return window.__put(c); };');   // each save takes 0.4 s
  Object.defineProperty(d,'visibilityState',{configurable:true,get:()=>'hidden'});
  d.dispatchEvent(new w.Event('visibilitychange')); await sleep(800);
  Object.defineProperty(d,'visibilityState',{configurable:true,get:()=>'visible'});
  let s=await stored(w,id);
  ck('a slow chat is still kept the moment the tab is hidden', last(s)&&last(s).content==='Words', s && JSON.stringify(last(s).content));
  ctl.push(' and more'); await sleep(200);
  w.eval('window.__shift=11000'); await sleep(2200);
  s=await stored(w,id);
  ck('ten seconds on, a chat whose save took 0.4 s is not written again yet (saving stays under a fiftieth of the time)', last(s)&&last(s).content==='Words', s && JSON.stringify(last(s).content));
  w.eval('window.__shift=21000'); await sleep(2200);
  s=await stored(w,id);
  ck('twenty seconds on, it is', last(s)&&last(s).content==='Words and more', s && JSON.stringify(last(s).content));
  w.eval('current.messages.slice(-1)[0].approvals=[{id:"ap1",tool:"terminal",command:"rm -rf build",choices:["once","deny"],status:"pending"}]');
  await sleep(2200);
  s=await stored(w,id);
  ck('an approval the agent waits on is kept at once all the same', last(s)&&Array.isArray(last(s).approvals)&&last(s).approvals.length===1, s && JSON.stringify(last(s).approvals));
  w.eval('IDB.put=window.__put;'); ctl.end(); await sleep(300); w.close();
}
{
  // a Swipe that has brought nothing yet keeps, on disk, the version it shows
  const ctl={mode:'answer',text:'the first version',version:SAME};
  const {w,d}=await boot(base(),ctl,{noFrames:true});
  w.eval('newConvo(); renderSidebar();');
  await say(w,d,'a question'); await sleep(200);
  const id=w.eval('current.id');
  ctl.mode='arrive'; ctl.first='';
  d.querySelector('.msg.assistant [data-regen]').click(); await sleep(300);
  ck('Swipe has started a new version, nothing of it here yet', w.eval('!!(streaming && streaming.asstId)') && w.eval('current.messages.slice(-1)[0].pending')===true);
  Object.defineProperty(d,'visibilityState',{configurable:true,get:()=>'hidden'});
  d.dispatchEvent(new w.Event('visibilitychange')); await sleep(300);
  let s=await stored(w,id), m=s&&s.messages[s.messages.length-1];
  ck('hidden before anything arrived, the chat on disk still shows the version it had', m&&m.content==='the first version'&&!m.pending, m && JSON.stringify({content:m.content,pending:m.pending}));
  ctl.push('a second'); await sleep(200);
  d.dispatchEvent(new w.Event('visibilitychange')); await sleep(300);
  s=await stored(w,id); m=s&&s.messages[s.messages.length-1];
  ck('once words arrive, they are kept, and the first version with them', m&&m.content==='a second'&&m.pending===true&&(m.variants||[]).some(v=>v.content==='the first version'), m && JSON.stringify({content:m.content,pending:m.pending,variants:(m.variants||[]).map(v=>v.content)}));
  ctl.end(); await sleep(300); w.close();
}
{
  // a half-kept reply another tab may still be writing is left arriving until its heartbeat is stale
  const {w}=await boot(base(),{mode:'answer',version:SAME});
  const now=Date.now(), mins=n=>now-n*60000;
  const chat=(id,upd,extra)=>({id,title:id,createdAt:mins(120),updatedAt:upd,cfg:{},messages:[{id:id+'u',role:'user',content:'q'},
    Object.assign({id:id+'a',role:'assistant',content:'half an answer',thinking:'',model:'m',variants:[],vi:0,pending:true},extra)]});
  const seed=[chat('fresh',now-20000,{beat:now-20000}), chat('stale',mins(5),{beat:mins(5)}),
              chat('oldlong',mins(60),{}), chat('oldrecent',mins(1),{})];
  await w.eval('(cs)=>Promise.all(cs.map(c=>IDB.put(c)))')(seed);
  const again=await boot(null,null,{keep:true}); await sleep(300);
  const got={}; for(const c of await again.w.eval('IDB.all()')) got[c.id]=c.messages[1];
  ck('a reply with a fresh heartbeat is left arriving (another tab is still writing it)', got.fresh&&got.fresh.pending===true, JSON.stringify(got.fresh));
  ck('one whose heartbeat is 5 minutes old is settled: kept as a version, no longer arriving', got.stale&&!got.stale.pending&&got.stale.content==='half an answer'&&got.stale.variants.length===1, JSON.stringify(got.stale));
  ck('one kept before heartbeats, in a chat untouched for an hour, is settled as before', got.oldlong&&!got.oldlong.pending, JSON.stringify(got.oldlong));
  ck('one kept before heartbeats, in a chat touched a minute ago, is left as before', got.oldrecent&&got.oldrecent.pending===true, JSON.stringify(got.oldrecent));
  again.w.close(); w.close();
}

console.log('\n=== 6. SAVE IN THE FULL-SCREEN EDITOR WRITES TO THE BLOCK ITSELF ===');
{
  const {w,d,toasts}=await boot(base(),{mode:'answer',version:SAME});
  w.eval('openSettings(); addInjection();');
  const bid=w.eval('PS().injections.slice(-1)[0].id');
  d.querySelector('[data-injtext="'+bid+'"]').click();
  d.querySelector('#bigArea').value='Written in the full-screen editor.';
  w.eval('renderInjections()');                                  // the list is drawn again (a setting changed elsewhere)
  d.querySelector('#bigSave').click(); await sleep(100);
  ck('Save keeps the text though the list was drawn again meanwhile', w.eval('injById("'+bid+'").text')==='Written in the full-screen editor.', w.eval('injById("'+bid+'").text'));
  ck('the editor closes, and the block\'s preview shows the text', !d.querySelector('#bigModal').classList.contains('show') && d.querySelector('[data-injtext="'+bid+'"]').value==='Written in the full-screen editor.');
  ck('and it is stored', JSON.parse(w.localStorage.getItem('cozychat:settings')).presets.some(p=>(p.injections||[]).some(i=>i.id===bid&&i.text==='Written in the full-screen editor.')));
  d.querySelector('[data-injtext="'+bid+'"]').click();
  d.querySelector('#bigArea').value='More words, for a block about to go.';
  w.eval('PS().injections=PS().injections.filter(i=>i.id!=="'+bid+'"); PS().order=PS().order.filter(x=>x!=="'+bid+'"); renderInjections();');   // deleted elsewhere
  d.querySelector('#bigSave').click(); await sleep(100);
  ck('a block deleted meanwhile: the editor stays open, with what was written in it', d.querySelector('#bigModal').classList.contains('show') && d.querySelector('#bigArea').value==='More words, for a block about to go.');
  ck('and says so', toasts.some(x=>/deleted meanwhile/.test(x)), JSON.stringify(toasts));
  w.close();
}

console.log('\n=== 8. A BACKUP FILE IS CHECKED WHOLE BEFORE ANYTHING IS ASKED OR REPLACED ===');
{
  const ctl={mode:'answer',version:SAME};
  const {w,d,confirms,toasts}=await boot(base(),ctl);
  w.eval('newConvo(); renderSidebar();'); await say(w,d,'kept one');
  w.eval('newConvo(); renderSidebar();'); await say(w,d,'kept two');
  await w.eval('newDoc("notes.md","my notes")');
  w.eval('S.theme="light"; saveSettings();');
  const snap=async()=>JSON.stringify([((await w.eval('IDB.all()'))||[]).map(c=>c.id+':'+c.messages.length).sort(),
    ((await w.eval('IDB.docAll()'))||[]).map(x=>x.id+':'+x.text).sort(), w.localStorage.getItem('cozychat:settings')]);
  const before=await snap();
  const restore=async body=>{ confirms.n=0; toasts.length=0; await w.eval('(f)=>handleRestore(f)')({text:async()=>body}); await sleep(300); };
  const good=(o)=>Object.assign({app:'cozy-chat',settings:base({theme:'dark'}),conversations:[{id:'b1',title:'From backup',createdAt:1,updatedAt:2,cfg:{},messages:[{id:'m1',role:'user',content:'restored'}]}],docs:[{id:'f1',name:'b.md',text:'from backup',updatedAt:2}]},o||{});
  const bad=[
    ['a file that is not JSON', '{"conversations": [', /isn.t JSON/],
    ['conversations that are not a list', JSON.stringify(good({conversations:{b1:{}}})), /no list of conversations/],
    ['a conversation with no id', JSON.stringify(good({conversations:[{title:'x',messages:[]}]})), /conversation 1 has no usable id/],
    ['a conversation with an id the phone could not keep', JSON.stringify(good({conversations:[{id:'a/../b',title:'x',messages:[]}]})), /conversation 1 has no usable id/],
    ['a message that is not one', JSON.stringify(good({conversations:[{id:'c1',title:'x',messages:[null]}]})), /conversation 1 has no readable messages/],
    ['two conversations with one id', JSON.stringify(good({conversations:[{id:'c1',messages:[]},{id:'c1',messages:[]}]})), /two conversations share the id c1/],
    ['files that are not a list', JSON.stringify(good({docs:'notes'})), /files aren.t a list/],
    ['settings that are not settings', JSON.stringify(good({settings:'dark'})), /settings aren.t settings/],
  ];
  for (const [name,body,why] of bad){
    await restore(body);
    ck(name+': nothing is asked', confirms.n===0, confirms.n+' questions');
    ck(name+': nothing is changed', (await snap())===before);
    ck(name+': and it says why', toasts.some(x=>/Nothing was restored/.test(x)&&why.test(x)), JSON.stringify(toasts));
  }
  // a backup the browser refuses part of, as it is being stored, changes nothing either
  const put0=global.IDBObjectStore.prototype.put;
  global.IDBObjectStore.prototype.put=function(v){ if(v&&v.id==='boom') throw new w.DOMException('The quota has been exceeded.','QuotaExceededError'); return put0.apply(this,arguments); };
  await restore(JSON.stringify(good({conversations:[{id:'ok1',messages:[]},{id:'boom',messages:[]}]})));
  global.IDBObjectStore.prototype.put=put0;
  ck('a backup the browser cannot store all of: asked once, then nothing is changed', confirms.n===1 && (await snap())===before);
  ck('and it says it could not restore, not that the file was wrong', toasts.some(x=>/Couldn.t restore/.test(x)&&/Nothing was changed/.test(x)) && !toasts.some(x=>/didn.t look like/.test(x)), JSON.stringify(toasts));
  // and a good backup still restores, after asking once
  await restore(JSON.stringify(good()));
  ck('a good backup still restores, after asking once', confirms.n===1 && w.eval('convos.map(c=>c.id).join()')==='b1' && w.eval('docs.map(x=>x.text).join()')==='from backup' && w.eval('S.theme')==='dark',
     confirms.n+' '+w.eval('convos.map(c=>c.id).join()')+' '+w.eval('S.theme'));
  w.close();
}

console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})();
