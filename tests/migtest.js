// TEST FILE - not for pasting into SillyTavern. Run with: node tests/migtest.js
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync('./out/index.html','utf8');
const ck=(n,ok,x)=>console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);

// Build a v1-era database: version 1, convos store only, with real data in it.
function seedOldDB(){
  return new Promise(res=>{
    const r=indexedDB.open('cozychat',1);
    r.onupgradeneeded=()=>{ r.result.createObjectStore('convos',{keyPath:'id'}); };
    r.onsuccess=()=>{
      const db=r.result;
      const t=db.transaction('convos','readwrite');
      t.objectStore('convos').put({id:'old1',title:'Chat from v1',createdAt:1,updatedAt:1,
        messages:[{id:'m1',role:'user',content:'this must survive'},
                  {id:'m2',role:'assistant',content:'and so must this'}]});
      t.oncomplete=()=>{ db.close(); res(); };
    };
  });
}
(async()=>{
  await seedOldDB();
  console.log('seeded a version-1 database with 1 conversation\n');
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
    beforeParse(w){
      w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
      w.navigator.storage={estimate:async()=>({usage:0})};
      w.requestAnimationFrame=cb=>setTimeout(cb,0);
      w.confirm=()=>true;w.prompt=(q,d)=>d||'X';
      // a v1-shaped settings blob: loose system prompt, no presets
      w.localStorage.setItem('cozychat:settings',JSON.stringify({
        providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:9000}],
        activeProvider:'p1',system:'MY OLD SYSTEM PROMPT',
        injections:[{id:'i1',name:'old block',text:'OLD BLOCK',role:'system',pos:'depth',depth:1,enabled:true}],
        theme:'dark'}));
    }});
  setTimeout(()=>{
    const w=dom.window,d=dom.window.document;
    ck('old conversation still loads', w.eval('convos.length')===1, w.eval('convos[0]&&convos[0].title'));
    ck('its messages are intact', w.eval('convos[0].messages.length')===2);
    ck('message text unchanged', w.eval('convos[0].messages[0].content')==='this must survive');
    ck('it renders in the thread', d.querySelector('#threadInner').textContent.includes('this must survive'));
    ck('new docs store created', w.eval('Array.isArray(docs)'));
    ck('old system prompt migrated into a set', w.eval('PS().system')==='MY OLD SYSTEM PROMPT', w.eval('PS().name'));
    ck('old instruction block migrated', w.eval('PS().injections.length')===1, w.eval('PS().injections[0].text'));
    ck('migrated block still reaches the prompt',
        w.eval('(function(){current=convos[0];return assembleMessages("openai").messages.some(m=>m.content==="OLD BLOCK");})()'));
    ck('system prompt still reaches the payload',
        w.eval('assembleMessages("openai").system')==='MY OLD SYSTEM PROMPT');
    // docs store is usable after the upgrade
    w.eval('newDoc("t.md","x")').then(()=>{
      ck('can write to the new store after upgrade', w.eval('docs.length')===1);
      process.exit(0);
    });
  },1000);
})();
