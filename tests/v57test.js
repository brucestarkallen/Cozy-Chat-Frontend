// TEST FILE — run with: node tests/v57test.js
// Guards v5.7.0: search can come back with pictures. Tavily's ride along on
// the same request, Serper's cost one deliberate extra call, Exa's are the
// pages' own — and a failed image fetch never sinks the text results. The
// strip renders under your message, the model is told which images the user
// is already looking at, the toggle really turns the spend off, and markdown
// image syntax finally renders as an image.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=(o={})=>Object.assign({
  providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000}],
  activeProvider:'p1',presets:[{id:'d',name:'D',system:'',injections:[],order:['__main__','__chat__']}],
  activePreset:'d',prompts:[],projects:[],temperature:1,maxTokens:4096,effort:'off',squashSystem:true,
  showThinking:true,showTools:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:true,provider:'tavily',key:'tk',count:3,relay:'',always:true,images:true}},o);
const ev=(w,el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true}));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sseOnce=t=>({getReader(){let used=false;return{read(){
  if(used)return Promise.resolve({done:true});used=true;
  return Promise.resolve({done:false,value:new TextEncoder().encode(t)});}};}});
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
const okChat=()=>({ok:true,body:sseOnce('data: '+JSON.stringify({choices:[{delta:{content:'reply'}}]})+'\n\n')});
async function ask(w,d,t){d.querySelector('#input').value=t;ev(w,d.querySelector('#input'),'input');ev(w,d.querySelector('#sendBtn'),'click');await sleep(900);}

(async()=>{

console.log('=== 1. MARKDOWN IMAGES RENDER ===');
{
  const dom=await boot(base());
  const w=dom.window;
  const md=w.eval(`renderMarkdown("Look: ![Ichigo](https://img.x/ichigo.png) and [a link](https://x.y/z)")`);
  ck('image syntax becomes an image', /<img class="md-img" src="https:\/\/img\.x\/ichigo\.png"/.test(md), md.slice(0,140));
  ck('wrapped in a link to itself', /<a href="https:\/\/img\.x\/ichigo\.png"[^>]*><img/.test(md));
  ck('plain links stay links, not images', /<a href="https:\/\/x\.y\/z"[^>]*>a link<\/a>/.test(md) && (md.match(/<img/g)||[]).length===1);
  const bad=w.eval(`renderMarkdown("![x](javascript:alert(1))")`);
  ck('a non-http target never becomes an image', bad.indexOf('<img')<0, bad);
  // Hermes inlines downloaded/generated images as data-URL markdown
  const du=w.eval(`renderMarkdown("Here: ![image](data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==)")`);
  ck('a data-URL image renders as an image', /<img class="md-img" src="data:image\/png;base64,iVBORw0KGgoAAAANSUhEUg==/.test(du), du.slice(0,120));
  ck('without a pointless data: link around it', du.indexOf('<a href="data:')<0);
  const dbad=w.eval(`renderMarkdown("![x](data:text/html;base64,PHNjcmlwdD4=)")`);
  ck('only image mimes qualify', dbad.indexOf('<img')<0, dbad);
  // an old Hermes server leaks its MEDIA tag as raw text — explain it instead
  const mn=w.eval(`renderMarkdown("Here you go:\\n\\nMEDIA:/tmp/ichigo_final.png\\n\\nEnjoy.")`);
  ck('a leaked MEDIA tag becomes an explanation', /media-note/.test(mn) && mn.indexOf('/tmp/ichigo_final.png')>=0 && mn.indexOf('Update hermes-agent')>=0,
     mn.slice(0,160));
  ck('the raw tag itself is gone from the prose', !/>\s*MEDIA:/.test(mn));
  const mc=w.eval('renderMarkdown("```\\nMEDIA:/tmp/x.png\\n```")');
  ck('inside a code block it stays literal', /MEDIA:\/tmp\/x\.png/.test(mc) && mc.indexOf('media-note')<0);
}

console.log('=== 2. TAVILY: PICTURES RIDE THE SAME REQUEST ===');
{
  let searchBody=null, chatBody=null;
  const dom=await boot(base(),w=>(url,opts)=>{
    if(String(url).includes('tavily')){searchBody=JSON.parse(opts.body);
      return Promise.resolve({ok:true,json:async()=>({
        results:[{title:'Bleach wiki',url:'https://w.x/b',content:'characters'}],
        images:['https://img.x/rukia.jpg',{url:'https://img.x/zaraki.jpg',description:'Kenpachi Zaraki'}]})});}
    chatBody=JSON.parse(opts.body); return Promise.resolve(okChat());
  });
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  await ask(w,d,'what do bleach characters look like');
  ck('the same call asked for images', searchBody && searchBody.include_images===true, JSON.stringify(searchBody));
  const m=w.eval('current.messages[0]');
  ck('both image shapes were understood', m.images.length===2 && m.images[0].url==='https://img.x/rukia.jpg' && m.images[1].title==='Kenpachi Zaraki',
     JSON.stringify(m.images));
  const strip=d.querySelector('.msg.user .img-strip');
  ck('a strip renders under the message', !!strip && strip.querySelectorAll('img').length===2);
  ck('each picture opens its source', strip.querySelector('a').getAttribute('href')==='https://img.x/rukia.jpg');
  const lastUser=chatBody.messages[chatBody.messages.length-1].content;
  ck('the model is told what the user already sees', lastUser.indexOf('<image_results')>=0 && lastUser.indexOf('already shown to the user')>=0);
  ck('down to the exact pictures', lastUser.indexOf('https://img.x/zaraki.jpg')>=0 && lastUser.indexOf('Kenpachi Zaraki')>=0);
  ck('text sources still injected beside them', lastUser.indexOf('<web_results>')>=0 && lastUser.indexOf('w.x/b')>=0);
}

console.log('=== 3. THE TOGGLE REALLY TURNS THE SPEND OFF ===');
{
  let searchBody=null;
  const dom=await boot(base({search:{on:true,provider:'tavily',key:'tk',count:3,relay:'',always:true,images:false}}),
    w=>(url,opts)=>{
      if(String(url).includes('tavily')){searchBody=JSON.parse(opts.body);
        return Promise.resolve({ok:true,json:async()=>({results:[{title:'t',url:'https://w.x',content:'c'}],images:['https://img.x/a.jpg']})});}
      return Promise.resolve(okChat());
    });
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  await ask(w,d,'q');
  ck('the request stops asking for images', searchBody.include_images===false);
  ck('and even offered ones are not kept', !w.eval('current.messages[0].images'));
  ck('so no strip renders', !d.querySelector('.img-strip'));
}

console.log('=== 4. SERPER: ONE EXTRA CALL, NEVER A SINKING ONE ===');
{
  let calls=[];
  const dom=await boot(base({search:{on:true,provider:'serper',key:'sk',count:3,relay:'',always:true,images:true}}),
    w=>(url,opts)=>{
      calls.push(String(url));
      if(/serper\.dev\/search/.test(url)) return Promise.resolve({ok:true,json:async()=>({organic:[{title:'t',link:'https://w.x',snippet:'s'}]})});
      if(/serper\.dev\/images/.test(url)){
        const b=JSON.parse(opts.body);
        w.__imgReq=b;
        return Promise.resolve({ok:true,json:async()=>({images:[{title:'Ichigo',imageUrl:'https://img.x/full.jpg',thumbnailUrl:'https://img.x/thumb.jpg',link:'https://page.x'}]})});
      }
      return Promise.resolve(okChat());
    });
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  await ask(w,d,'ichigo');
  ck('the images endpoint was called once', calls.filter(u=>/images/.test(u)).length===1);
  ck('asking for a handful, not the world', w.__imgReq.num===6);
  const im=w.eval('current.messages[0].images[0]');
  ck('the strip uses the thumbnail, the link keeps the page', im.url==='https://img.x/thumb.jpg' && im.link==='https://page.x' && im.full==='https://img.x/full.jpg');
}
{
  const dom=await boot(base({search:{on:true,provider:'serper',key:'sk',count:3,relay:'',always:true,images:true}}),
    w=>(url,opts)=>{
      if(/serper\.dev\/search/.test(url)) return Promise.resolve({ok:true,json:async()=>({organic:[{title:'t',link:'https://w.x',snippet:'s'}]})});
      if(/serper\.dev\/images/.test(url)) return Promise.reject(new Error('images backend down'));
      return Promise.resolve(okChat());
    });
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  await ask(w,d,'q');
  const msgs=w.eval('current.messages');
  ck('a dead image endpoint never sinks the search', (msgs[0].sources||[]).length===1 && !msgs.some(m=>m.role==='error'), JSON.stringify(msgs[0].sources));
  ck('the reply still arrived', msgs[1] && msgs[1].content==='reply');
}

console.log('=== 5. EXA: THE PAGES\u2019 OWN PICTURES ===');
{
  const dom=await boot(base({search:{on:true,provider:'exa',key:'ek',count:3,relay:'',always:true,images:true}}),
    w=>(url,opts)=>{
      if(String(url).includes('exa.ai')) return Promise.resolve({ok:true,json:async()=>({results:[
        {title:'A',url:'https://a.x',text:'aa',image:'https://img.x/a.png'},
        {title:'B',url:'https://b.x',text:'bb'}]})});
      return Promise.resolve(okChat());
    });
  const w=dom.window,d=w.document;
  w.eval('newConvo()');
  await ask(w,d,'q');
  const imgs=w.eval('current.messages[0].images');
  ck('only results that carry an image contribute one', imgs.length===1 && imgs[0].url==='https://img.x/a.png' && imgs[0].link==='https://a.x');
}

console.log('');
console.log(fail?('FAILED '+fail):'ALL PASS','('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})();
