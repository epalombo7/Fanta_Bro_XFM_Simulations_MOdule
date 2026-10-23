// Inlines assets/engine.js into assets/index.html for the Expo WebView, which loads the page
// as a single HTML string and cannot fetch engine.js beside it. Output is generated; edit the sources.
const fs=require('fs'),path=require('path');
const dir=path.join(__dirname,'..','assets'),tag='<script src="engine.js"></script>';
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8'),engine=fs.readFileSync(path.join(dir,'engine.js'),'utf8');
if(!html.includes(tag))throw Error('index.html must load engine.js via '+tag);
fs.writeFileSync(path.join(dir,'webview.html'),html.replace(tag,()=>'<script>'+engine+'</script>'));
console.log('Wrote assets/webview.html');
