// TEST FILE — run with: node tests/v5291datatest.js
// The second round of data fixes after v5.28.9, in the page alone. What needs
// the phone's real server and a real browser is in tests/v5291data_e2e.py.
//   1. a chat this tab and the phone both moved on from the version this tab
//      last had (its base) merges field by field and takes its messages from
//      whichever side changed them: a rename, a pin, a chat setting, deleted
//      messages all stay; a copy (null) only when both changed the messages;
//      a reply still arriving is one message wherever it is held; with no
//      base, nothing is dropped, as before. A file the same way. What the
//      journal keeps beside a change names the messages they share instead
//      of holding them twice, and gives them back whole.
//   4. a tab in the background holds no event stream (a browser gives one
//      server six connections), and opens one again, reading what changed,
//      when it is back in view; a tab opened in the background opens none
//      until then; coming back looks for a new version of the app once
const fs=require('fs');const {JSDOM,VirtualConsole}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const unhandled=[]; process.on('unhandledRejection',e=>unhandled.push(String((e&&e.message)||e)));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const J=JSON.stringify;

function page(src,before){ return new Promise(res=>{
  const vc=new VirtualConsole(); vc.on('jsdomError',()=>{});
  const dom=new JSDOM(src,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',virtualConsole:vc,beforeParse(w){
    w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;w.navigator.storage={estimate:async()=>({usage:0})};
    w.requestAnimationFrame=cb=>setTimeout(cb,0); w.confirm=()=>true;
    if(before) before(w);
    else w.fetch=()=>Promise.reject(new Error('no network here'));
  }});
  setTimeout(()=>res(dom.window),800);
});}

(async()=>{

console.log('=== 1. A CHAT BOTH SIDES CHANGED, AGAINST THE VERSION THIS TAB LAST HAD ===');
{
  const w=await page(html);
  const m=(id,role,content,extra)=>Object.assign({id,role,content},extra||{});
  const B={id:'c1',title:'one',createdAt:1,updatedAt:10,cfg:{temperature:1,model:'m'},
    messages:[m('u1','user','one'),m('a1','assistant','Reply to: one'),m('u2','user','two'),m('a2','assistant','Reply to: two')]};
  const copy=o=>JSON.parse(J(o));
  /* (a page from before this had no such function, or another shape of it: that is a failed check, not a stopped run) */
  const call=(f,...a)=>{ try { return typeof w[f]==='function' ? w[f](...a) : undefined; } catch(e){ return 'threw: '+e.message; } };
  const merge=(b,l,r)=>call('mergeChat',b,l,r);
  const isO=v=>!!v&&typeof v==='object'&&Array.isArray(v.messages||[]);
  const said=c=>isO(c)&&Array.isArray(c.messages)?c.messages.map(x=>x.content):c;
  let L,R,M;

  L=copy(B); L.messages.push(m('u3','user','three'),m('a3','assistant','Reply to: three')); L.updatedAt=20;
  R=copy(B); R.title='Renamed elsewhere'; R.archived=true; R.cfg.temperature=0.25; R.updatedAt=15;
  M=merge(B,L,R);
  ck('renamed, archived and given its own temperature on the phone, a message sent here: the rename stays', isO(M)&&M.title==='Renamed elsewhere', isO(M)&&M.title);
  ck('… the archive and the temperature too', isO(M)&&M.archived===true&&M.cfg.temperature===0.25&&M.cfg.model==='m', isO(M)&&J(M.cfg));
  ck('… and the new exchange is added', J(said(M))===J(['one','Reply to: one','two','Reply to: two','three','Reply to: three']), J(said(M)));

  L=copy(B); L.title='Renamed here'; R=copy(B); R.messages=R.messages.slice(0,2);
  M=merge(B,L,R);
  ck('the last exchange deleted on the phone, renamed here: the deleted messages stay deleted, the name is taken',
     isO(M)&&J(said(M))===J(['one','Reply to: one'])&&M.title==='Renamed here', isO(M)&&J([said(M),M.title]));

  L=copy(B); L.pinned=true; R=copy(B); R.messages=[];
  M=merge(B,L,R);
  ck('emptied on the phone, pinned here: it stays empty, and pinned', isO(M)&&M.messages.length===0&&M.pinned===true, isO(M)&&J([said(M),M.pinned]));

  L=copy(B); L.messages.push(m('u3','user','three')); R=copy(B); R.messages=R.messages.slice(0,2);
  ck('the last exchange deleted on the phone, a message sent here: both changed the messages - kept apart (null), never blended',
     merge(B,L,R)===null);

  L=copy(B); L.messages.push(m('u3','user','three')); R=copy(B); R.messages.push(m('x3','user','other'));
  ck('each side wrote its own new message: kept apart', merge(B,L,R)===null);

  L=copy(B); L.messages.push(m('u3','user','three')); R=copy(B); R.messages.push(m('u3','user','three'),m('a3','assistant','Reply to: three'));
  M=merge(B,L,R);
  ck('the phone holds this tab\'s own message carried further: one chat, nothing undone',
     isO(M)&&J(said(M))===J(['one','Reply to: one','two','Reply to: two','three','Reply to: three']), isO(M)&&J(said(M)));

  L=copy(B); L.messages[0].content='one, edited here'; R=copy(B); R.title='Renamed elsewhere';
  M=merge(B,L,R);
  ck('a message edited here, renamed on the phone: the edit and the name both stay',
     isO(M)&&M.messages[0].content==='one, edited here'&&M.title==='Renamed elsewhere', isO(M)&&J([M.messages[0].content,M.title]));

  // a reply still arriving, held at different points
  const A0={id:'c2',title:'t',createdAt:1,updatedAt:10,cfg:{},messages:[m('u','user','q'),m('a','assistant','Rep',{pending:true,beat:100})]};
  L=copy(A0); L.messages[1].content='Reply to'; L.messages[1].beat=200;
  R=copy(A0); R.title='Renamed while it arrives';
  M=merge(A0,L,R);
  ck('a reply arriving here, renamed on the phone: no copy, the newer hold of the reply and the new name',
     isO(M)&&M.messages[1].content==='Reply to'&&M.title==='Renamed while it arrives', isO(M)&&J([M.messages[1].content,M.title]));
  L=copy(A0); L.messages[1].content='Reply t'; L.messages[1].beat=150;
  R=copy(A0); R.messages[1]={id:'a',role:'assistant',content:'Reply to: q'};      // finished where it was being written
  M=merge(A0,L,R);
  ck('… held half here and finished on the phone: the finished one, no copy', isO(M)&&M.messages[1].content==='Reply to: q'&&!M.messages[1].pending, isO(M)&&J(M.messages[1]));

  // a save from before bases were kept: nothing dropped
  L=copy(B); L.messages.push(m('u3','user','three')); R=copy(B); R.title='Renamed elsewhere';
  M=merge(null,L,R);
  ck('with no base (a save waiting from before this version), nothing written here is dropped', isO(M)&&M.messages.length===5, isO(M)&&J(said(M)));

  // a file
  const F={id:'f1',name:'a.md',text:'one',updatedAt:1};
  M=call('mergeFile',F,Object.assign(copy(F),{text:'written here'}),Object.assign(copy(F),{name:'b.md'}));
  ck('a file renamed on the phone and written here keeps both', isO(M)&&M.name==='b.md'&&M.text==='written here', isO(M)&&J(M));
  M=call('mergeFile',F,Object.assign(copy(F),{name:'c.md'}),Object.assign(copy(F),{text:'written there'}));
  ck('… and the other way round', isO(M)&&M.name==='c.md'&&M.text==='written there', isO(M)&&J(M));
  ck('written on both sides: kept apart', call('mergeFile',F,Object.assign(copy(F),{text:'here'}),Object.assign(copy(F),{text:'there'}))===null);

  // what the journal keeps beside a change
  const pic='data:image/jpeg;base64,'+'A'.repeat(2000000);
  const P={id:'p1',title:'pics',cfg:{},messages:[m('u1','user','look',{attachments:[{kind:'image',data:pic}]}),m('a1','assistant','Nice')]};
  const S=copy(P); S.title='renamed'; S.messages.push(m('u2','user','more'));
  const thin=call('thin',P,S);
  ck('the journal\'s base names the messages the change still holds as they were, instead of a second copy of their pictures',
     isO(thin)&&J(thin).length<1000, thin?J(thin).length+' characters':String(thin));
  const back=call('thick',thin,JSON.parse(J(S)));
  ck('… and gives them back whole', isO(back)&&J(back)===J(P), back?J(back).length:String(back));
  const S2=copy(P); S2.messages[1].content='Nice, edited';
  const thin2=call('thin',P,S2);
  ck('a message the change no longer holds as it was is kept in full', isO(thin2)&&thin2.messages[1].content==='Nice'&&thin2.messages[0].$same==='u1', thin2?J(thin2).slice(0,120):String(thin2));
  w.close();
}

console.log('\n=== 4. A TAB IN THE BACKGROUND HOLDS NO EVENT STREAM ===');
/* The page served by the phone's server (it carries the store tag), a phone
   store that answers in memory, and an EventSource that records itself. */
async function phone(opts){
  opts=opts||{};
  const src=html.replace('</head>','<meta name="cozy-store" content="2">\n</head>');
  const log={streams:[],asked:{}};
  const settings={providers:[],activeProvider:null,presets:[{id:'d',name:'D',system:'',injections:[],order:['__main__','__chat__']}],
    activePreset:'d',prompts:[],theme:'dark',seeded513:true,search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}};
  const answer=(u)=>{
    const p=String(u).replace(/^https:\/\/x\.com\//,'').split('?')[0];
    log.asked[p]=(log.asked[p]||0)+1;
    const json=o=>Promise.resolve({ok:true,status:200,json:async()=>o,text:async()=>J(o)});
    if(p==='api/store/hello') return json({app:'cozy-chat',store:2,id:'s1',dataDir:'/phone',version:'0'});
    if(p==='api/store/all') return json({id:'s1',settings:{rev:1,data:settings},chats:[],files:[]});
    if(p==='api/store/manifest') return json({id:'s1',settings:1,chats:{},files:{}});
    if(p==='api/version') return json({app:'cozy-chat',version:w0.VERSION||'0',code:'x',store:2});
    if(p==='api/store/usage') return json({bytes:0,parts:{}});
    if(p==='api/backup/list') return json({keep:14,copies:[]});
    return Promise.reject(new Error('not here: '+p));
  };
  let w0={};
  const w=await page(src,win=>{
    w0=win;
    win.fetch=answer;
    win.EventSource=class{ constructor(u){ this.url=u; this.closed=false; log.streams.push(this); setTimeout(()=>{ if(!this.closed&&this.onopen) this.onopen(); },5); } close(){ this.closed=true; } };
    if(opts.hidden) Object.defineProperty(win.document,'visibilityState',{configurable:true,get:()=>'hidden'});
  });
  await sleep(400);
  const open=()=>log.streams.filter(s=>!s.closed).length;
  const set=(state)=>{ Object.defineProperty(w.document,'visibilityState',{configurable:true,get:()=>state}); w.document.dispatchEvent(new w.Event('visibilitychange')); };
  return {w,log,open,set};
}
{
  const t=await phone();
  ck('(the page runs from the phone\'s store)', t.w.eval('DEVICE')===true&&t.w.eval('Device.isReady()')===true);
  ck('a tab in view holds one event stream', t.open()===1, t.open());
  t.set('hidden'); await sleep(50);
  ck('in the background it holds none', t.open()===0, t.open());
  const lists=t.log.asked['api/store/manifest']||0, looks=t.log.asked['api/version']||0;
  t.set('visible'); await sleep(200);
  ck('back in view it opens one again', t.open()===1&&t.log.streams.length===2, t.open()+' open of '+t.log.streams.length);
  ck('… and reads what the phone holds now (what it could not hear meanwhile)', (t.log.asked['api/store/manifest']||0)>lists, (t.log.asked['api/store/manifest']||0)-lists);
  ck('… and looks for a new version of the app once, not twice', (t.log.asked['api/version']||0)-looks===1, (t.log.asked['api/version']||0)-looks);
  t.set('hidden'); t.set('visible'); t.set('hidden'); await sleep(50);
  ck('going away and back again holds no stream it no longer needs', t.open()===0, t.open());
  t.w.close();
}
{
  const t=await phone({hidden:true});
  ck('a tab opened in the background opens its chats', t.w.eval('Device.isReady()')===true);
  ck('… but no event stream until it is in view', t.log.streams.length===0, t.log.streams.length);
  t.set('visible'); await sleep(200);
  ck('… and one when it is', t.open()===1, t.open());
  t.w.close();
}

if(unhandled.length) console.log('  (unhandled: '+J(unhandled.slice(0,3))+')');
console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})();
