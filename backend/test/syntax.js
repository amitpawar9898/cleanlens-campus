const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const re=/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
let match,count=0;
while((match=re.exec(html))){
  if(match[1].trim())new vm.Script(match[1],{filename:`index-inline-${++count}.js`});
}
if(!count)throw new Error('No inline application script was found.');
for(const file of ['public/portal-workflow.js','public/deep-learning-report.html','src/config.js','src/services/ai.js','src/services/detection.js','src/routes/inspections.js','test/detection.js','ml/train_export.py']){
  if(!fs.existsSync(path.join(root,file)))throw new Error(`Required project file is missing: ${file}`);
}
if(!html.includes('deep-learning-report.html')||!html.includes('regtoggle'))throw new Error('Login deep-learning report link or registration toggle is missing.');
console.log(`PASS parsed ${count} inline frontend script and found the detector, API and training workflow files`);
