// Guards the bug that hid v4.0.1 from the user: "network-first" that still
// reads the browser's HTTP cache and never reaches the server.
const fs=require('fs');
const sw=fs.readFileSync(__dirname+'/../sw.js','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};

console.log('=== the worker must bypass the HTTP cache for the app itself ===');
ck('syntax valid', (()=>{try{new Function(sw);return true}catch(e){return false}})());
ck('app requests are refetched with cache:"reload"', /cache:\s*["']reload["']/.test(sw),
   (sw.match(/cache:\s*["'][a-z-]+["']/)||[''])[0]);
ck('navigation counts as an app request', /req\.mode\s*===\s*["']navigate["']/.test(sw));
ck('index.html counts as an app request', /index\.html/.test(sw));
ck('the worker itself counts, so it can update', /sw\.js/.test(sw));
ck('cache name bumped so the old cache is dropped', /cozy-chat-v2/.test(sw));
ck('old caches are deleted on activate', /caches\.delete/.test(sw));
ck('cross-origin traffic is left alone', /url\.origin\s*!==\s*location\.origin/.test(sw));
ck('offline still falls back to cache', /caches\.match/.test(sw));
ck('non-GET is ignored', /req\.method\s*!==\s*["']GET["']/.test(sw));

console.log('\n=== simulate the worker fetch decision ===');
{
  // pull the isApp predicate out and exercise it, rather than trusting a regex
  const body = sw.slice(sw.indexOf('const isApp'), sw.indexOf('const live'));
  const isApp = new Function('req','url', 'return (function(){ ' + body + ' return isApp; })()');
  const cases = [
    ['navigation to the root', {mode:'navigate',destination:'document'}, {pathname:'/Cozy-Chat-Frontend/'}, true],
    ['direct index.html',      {mode:'cors',destination:''},             {pathname:'/Cozy-Chat-Frontend/index.html'}, true],
    ['the worker script',      {mode:'cors',destination:'script'},       {pathname:'/Cozy-Chat-Frontend/sw.js'}, true],
    ['an icon',                {mode:'cors',destination:'image'},        {pathname:'/Cozy-Chat-Frontend/icon-192.png'}, false],
    ['the manifest',           {mode:'cors',destination:''},             {pathname:'/Cozy-Chat-Frontend/manifest.webmanifest'}, false],
  ];
  for (const [name,req,url,want] of cases)
    ck(name + ' → ' + (want?'bypass cache':'normal fetch'), isApp(req,url)===want, String(isApp(req,url)));
}

console.log('\n=== the app can tell you which build it is running ===');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
ck('update check fetches with no-store', /fetch\("index\.html\?v=" \+ Date\.now\(\), \{ cache: "no-store" \}\)/.test(html));
ck('it compares version stamps', /const VERSION = "\(\[/.test(html) || /VERSION = "\(\[\\d\.\]\+\)"/.test(html));
ck('it clears caches before reloading', /caches\.delete\(k\)/.test(html));
ck('there is a button for it', /id="updateBtn"/.test(html));

console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
process.exit(fail?1:0);
