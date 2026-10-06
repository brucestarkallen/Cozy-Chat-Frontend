// TEST FILE — run with: node tests/v5282test.js
// Guards v5.28.2: a turned-down key names the connection, which side refused it, and the one place
// to fix it — Hermes' gateway checks the connection's key against its own API_SERVER_KEY; any other
// service checks the key from that service. Other errors read exactly as before.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const st={providers:[
  {id:'ph',preset:'custom',kind:'openai',name:'My Hermes',url:'http://127.0.0.1:8642/v1',apiKey:'pick-any-password',model:'hermes-agent'},
  {id:'pn',preset:'custom',kind:'openai',name:'NeuralWatt',url:'https://api.neuralwatt.com/v1',apiKey:'k',model:'glm-5.2-fast'}],
  activeProvider:'pn',presets:[{id:'d',name:'D',system:'',injections:[],order:['__main__','__chat__']}],activePreset:'d',theme:'dark'};
function boot(f){return new Promise(res=>{const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
  beforeParse(w){w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;w.navigator.storage={estimate:async()=>({usage:0})};
    w.requestAnimationFrame=cb=>setTimeout(cb,0);w.localStorage.setItem('cozychat:settings',JSON.stringify(st));if(f)w.fetch=f(w);}});
  setTimeout(()=>res(dom),750);});}
(async()=>{
  const reply=(status,body)=>w=>()=>Promise.resolve({ok:false,status,json:()=>Promise.resolve(body),text:()=>Promise.resolve(JSON.stringify(body))});
  console.log('=== 1. HERMES TURNS COZY\'S KEY DOWN ===');
  {
    const dom=await boot(reply(401,{error:{message:'Invalid gateway API key (API_SERVER_KEY)'}}));const w=dom.window;
    w.eval('newConvo(); cfgSet("providerId","ph");'); await w.eval('send("hi")');
    const m=w.eval('current.messages[current.messages.length-1].content');
    ck('it says Hermes refused the key this connection sends', /Hermes didn't accept the key this connection sends \(401\)/.test(m), m.split('\n')[0]);
    ck('it names the connection and where the key must match', /“My Hermes” has to be the same as API_SERVER_KEY in Hermes' ~\/\.hermes\/\.env/.test(m));
    ck('it says where to fix it', /Settings → Connection → My Hermes → API key/.test(m));
    ck('and keeps what Hermes said', /Hermes said: .*Invalid gateway API key/.test(m));
  }
  console.log('=== 2. A SERVICE TURNS ITS KEY DOWN ===');
  {
    const dom=await boot(reply(401,{detail:'Invalid API key'}));const w=dom.window;
    w.eval('newConvo();'); await w.eval('send("hi")');
    const m=w.eval('current.messages[current.messages.length-1].content');
    ck('it names the service and the fix', /^NeuralWatt turned down the API key \(401\)/.test(m) && /Settings → Connection → NeuralWatt → API key/.test(m), m.split('\n')[0]);
    ck('and keeps what the service said', /NeuralWatt said: .*Invalid API key/.test(m));
  }
  console.log('=== 3. OTHER REFUSALS READ AS BEFORE ===');
  {
    const dom=await boot(reply(400,{error:{message:'bad request thing'}}));const w=dom.window;
    w.eval('newConvo();'); await w.eval('send("hi")');
    const m=w.eval('current.messages[current.messages.length-1].content');
    ck('a 400 is passed through unchanged', /^NeuralWatt said no \(400\)\.\n\n/.test(m) && /bad request thing/.test(m), m.split('\n')[0]);
  }
  console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');process.exit(fail?1:0);
})();
