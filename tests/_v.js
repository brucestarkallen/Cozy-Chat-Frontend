const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const st={providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000}],
 activeProvider:'p1',presets:[{id:'d',name:'D',system:'s',injections:[],order:['__main__','__chat__']}],
 activePreset:'d',prompts:[],temperature:1,maxTokens:4096,effort:'off',squashSystem:true,
 showThinking:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
 search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}};
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
 beforeParse(w){w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
  w.navigator.storage={estimate:async()=>({usage:0})};w.requestAnimationFrame=cb=>setTimeout(cb,0);
  w.localStorage.setItem('cozychat:settings',JSON.stringify(st));}});
setTimeout(async()=>{const w=dom.window;
 try{await w.eval('Promise.all([DB.clear(),DB.docClear()])');}catch(_){}
 const echoed='Here are the changes.\n\n[no file edits were proposed in this reply \u2014 nothing was changed. If the user asked for changes, they have NOT been made; making them requires a <docedits> block.]';
 console.log('echo parse ->',JSON.stringify(JSON.parse(w.eval('JSON.stringify(parseDocEdits('+JSON.stringify(echoed)+'))'))));
 console.log('echo strip intact ->',w.eval('stripDocEdits('+JSON.stringify(echoed)+')')===echoed);
 const prose='Ask me to use a <docedits> block if you want it changed.';
 console.log('prose parse ->',JSON.stringify(JSON.parse(w.eval('JSON.stringify(parseDocEdits('+JSON.stringify(prose)+'))'))));
 console.log('prose strip intact ->',w.eval('stripDocEdits('+JSON.stringify(prose)+')')===prose);
 const realcut='ok\n<docedits>\n[{"file":"f.md","find":"BODY","replace":"NEW"},{"file":"f.md","fi';
 const rc=JSON.parse(w.eval('JSON.stringify(parseDocEdits('+JSON.stringify(realcut)+'))'));
 console.log('real truncation still caught ->',rc.edits.length===1&&!!rc.warn);
 const nothing='ok\n<docedits>\n[{"fi';
 const rn=JSON.parse(w.eval('JSON.stringify(parseDocEdits('+JSON.stringify(nothing)+'))'));
 console.log('nothing-usable still errors ->',rn.edits.length===0&&/cut off before anything usable/.test(rn.error||''));
 const emptycut='ok\n<docedits>\n[]';
 const re=JSON.parse(w.eval('JSON.stringify(parseDocEdits('+JSON.stringify(emptycut)+'))'));
 console.log('emptied cut-off block keeps its warning ->',!!re.error,JSON.stringify(re.error||'').slice(0,60));
 w.eval(`convos=[];docs=[{id:'d1',name:'f.md',text:'BODY',updatedAt:1,undo:[]}];
  current={id:'c1',title:'t',docIds:['d1'],filesOn:true,messages:[
   {id:'u1',role:'user',content:'hi',ts:1},{id:'a1',role:'assistant',content:'First.',ts:2},
   {id:'u2',role:'user',content:'more',ts:3},{id:'a2',role:'assistant',content:'Second.',ts:4}]};convos=[current];`);
 const r=JSON.parse(w.eval('JSON.stringify(assembleMessages("openai",current))'));
 const as=r.messages.filter(m=>m.role==='assistant');
 console.log('note on older reply ->',/nothing was changed/.test(as[0].content));
 console.log('note on newest reply ->',/nothing was changed/.test(as[1].content));
 console.log('note is attributed ->',/\[cozy —/.test(as[1].content));
 console.log('note names no tag ->',as[1].content.indexOf('<docedits>')<0);
 process.exit(0);},900);
