// Inlines assets/engine.js (and league.js, the real league) into assets/index.html for the Expo WebView, which loads the page
// as a single HTML string and cannot fetch engine.js beside it. Output is generated; edit the sources.
const fs=require('fs'),path=require('path');
const dir=path.join(__dirname,'..','assets'),tag='<script src="engine.js"></script>';
let html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
if(!html.includes(tag))throw Error('index.html must load engine.js via '+tag);
// Inline every local script the page loads (engine.js, and league.js when the pipeline has produced it)
for(const f of ['engine.js','league.js']){const t=`<script src="${f}"></script>`,p=path.join(dir,f);if(html.includes(t))html=html.replace(t,()=>fs.existsSync(p)?'<script>'+fs.readFileSync(p,'utf8')+'</script>':'')}
fs.writeFileSync(path.join(dir,'webview.html'),html);
console.log('Wrote assets/webview.html');
