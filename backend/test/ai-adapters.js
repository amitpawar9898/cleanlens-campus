const assert=require('node:assert/strict');
const cfg=require('../src/config');
const ai=require('../src/services/ai');
const response=(body,status=200)=>({ok:status>=200&&status<300,status,statusText:'Mock response',json:async()=>body});
const analysis={relevant:true,condition:'Needs Improvement',confidence:87,issues:[{name:'Overflowing bin',severity:'High',confidence:87}],category:'Waste',priority:'High',title:'Overflowing bin',description:'The bin is full. Empty and clean the area.',building:'Main',floor:'Ground',spot:'Lobby'};
const providers={
  anthropic:j=>({content:[{type:'text',text:JSON.stringify(j)}]}),
  openai:j=>({choices:[{message:{content:JSON.stringify(j)}}]}),
  google:j=>({candidates:[{content:{parts:[{text:JSON.stringify(j)}]}}]}),
  ollama:j=>({message:{content:JSON.stringify(j)}})
};
const originalFetch=global.fetch;
(async()=>{
  for(const name of Object.keys(providers)){
    cfg.aiProvider=name;cfg.anthropicKey='mock-anthropic';cfg.openaiKey='mock-openai';cfg.googleKey='mock-google';cfg.ollamaUrl='http://localhost:11434';cfg.ollamaModel='mock-vision-model';
    global.fetch=async(_url,options)=>{const body=JSON.parse(options.body);const isCompare=JSON.stringify(body).includes('BEFORE cleaning');return response(providers[name](isCompare?{before_score:35,after_score:90,notes:'The visible floor is cleaner.'}:analysis))};
    const out=await ai.analyze(Buffer.from('image'), 'image/png','Main: Ground [Lobby]');
    assert.equal(out.condition,analysis.condition);assert.equal(out.issues[0].name,analysis.issues[0].name);assert.equal(out.mode.includes(name==='google'?'Gemini':name==='anthropic'?'Claude':name==='openai'?'OpenAI':'Ollama'),true);
    const compare=await ai.compare({buf:Buffer.from('before'),mime:'image/png'},{buf:Buffer.from('after'),mime:'image/png'});
    assert.equal(compare.improvement,55);assert.equal(compare.after_score,90);
  }
  cfg.aiProvider='anthropic';cfg.anthropicKey='';global.fetch=originalFetch;
  await assert.rejects(()=>ai.analyze(Buffer.from('image'),'image/png',''),e=>e.status===503);
  cfg.aiProvider='auto';
  console.log('PASS mocked provider adapter contract (Anthropic, OpenAI, Gemini, Ollama)');
  console.log('PASS missing-provider configuration fails clearly');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{global.fetch=originalFetch});
