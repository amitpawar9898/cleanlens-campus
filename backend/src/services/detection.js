const cfg=require('../config'),{z}=require('zod'),{HttpError}=require('../utils');

const condition=z.enum(['Fresh','Damaged','Rotten/Mouldy','Uncertain']);
const objectSchema=z.object({
  label:z.string().trim().min(1).max(80),category:z.enum(['fruit','vegetable','food_waste','other']),condition,
  box_2d:z.array(z.number().int().min(0).max(1000)).length(4).refine(([y0,x0,y1,x1])=>y1>y0&&x1>x0,'Box must have positive width and height.'),
  confidence:z.number().min(0).max(100).nullable(),evidence:z.string().trim().max(240)
}).strict();
const responseSchema=z.object({objects:z.array(objectSchema).max(100),overall_condition:z.enum(['Good','Needs Improvement','Poor','Critical','Uncertain'])}).strict();
const geminiJsonSchema={type:'object',additionalProperties:false,properties:{
  objects:{type:'array',items:{type:'object',additionalProperties:false,properties:{
    label:{type:'string'},category:{type:'string',enum:['fruit','vegetable','food_waste','other']},condition:{type:'string',enum:['Fresh','Damaged','Rotten/Mouldy','Uncertain']},
    box_2d:{type:'array',items:{type:'integer',minimum:0,maximum:1000},minItems:4,maxItems:4},confidence:{type:['number','null'],minimum:0,maximum:100},evidence:{type:'string'}
  },required:['label','category','condition','box_2d','confidence','evidence']}},
  overall_condition:{type:'string',enum:['Good','Needs Improvement','Poor','Critical','Uncertain']}
},required:['objects','overall_condition']};
let testClient=null;
const overlaps=(a,b)=>{const [ay0,ax0,ay1,ax1]=a.box_2d,[by0,bx0,by1,bx1]=b.box_2d,area=Math.max(0,Math.min(ay1,by1)-Math.max(ay0,by0))*Math.max(0,Math.min(ax1,bx1)-Math.max(ax0,bx0)),aa=(ay1-ay0)*(ax1-ax0),ba=(by1-by0)*(bx1-bx0);return aa+ba-area>0?area/(aa+ba-area):0};
function merge(yolo=[],gemini=[]){const merged=(yolo||[]).map(o=>({...o}));for(const g of gemini||[]){let best=-1,bestIoU=0;for(let i=0;i<merged.length;i++){const score=overlaps(merged[i],g);if(score>bestIoU){best=i;bestIoU=score}}if(best>=0&&(bestIoU>=.65||(bestIoU>=.4&&merged[best].label.toLowerCase()===g.label.toLowerCase())))merged[best]={...merged[best],...g,source:'hybrid',yolo_label:merged[best].label};else merged.push({...g,source:'gemini'})}return merged.slice(0,100)}
function fromGeminiBox(o){const [y0,x0,y1,x1]=o.box_2d;return{...o,bbox:{x:x0/1000,y:y0/1000,width:(x1-x0)/1000,height:(y1-y0)/1000},source:'gemini'}}
async function getClient(){if(testClient)return testClient;if(!cfg.geminiApiKey)throw new HttpError(503,'Gemini image analysis is not configured.');try{const{GoogleGenAI}=await import('@google/genai');return new GoogleGenAI({apiKey:cfg.geminiApiKey})}catch{throw new HttpError(503,'Install the Google GenAI SDK with npm install @google/genai before enabling Gemini analysis.')}}
async function analyzeGemini(buf,mime){
  if(!cfg.geminiApiKey)throw new HttpError(503,'Gemini image analysis is not configured.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),cfg.geminiTimeoutMs);timer.unref?.();
  try{
    const client=await getClient();
    const prompt='Inspect this image for visible individual fruits, vegetables, prepared food, or discarded food scraps/waste. Detect each distinct visible item once; do not infer spoilage from food category or colour alone. Classify visible condition only as Fresh, Damaged, Rotten/Mouldy, or Uncertain; use Uncertain unless there is clear visible evidence (for example visible mould, decomposition, or substantial physical damage). Never state whether food is safe to eat. Do not invent labels for unclear objects: use "unknown object" and Uncertain. For every object provide a tight box_2d [ymin,xmin,ymax,xmax] normalized to integers from 0 to 1000. Set confidence to null; this vision model does not provide a calibrated per-object probability. Include short visible evidence. Return the overall visible condition.';
    const response=await client.models.generateContent({model:cfg.geminiModel,contents:[prompt,{inlineData:{mimeType:mime,data:buf.toString('base64')}}],config:{responseMimeType:'application/json',responseJsonSchema:geminiJsonSchema,abortSignal:controller.signal,httpOptions:{timeout:cfg.geminiTimeoutMs,retryOptions:{attempts:1}}}});
    if(!response?.text)throw new Error('Gemini returned no structured text.');
    let json;try{json=JSON.parse(response.text)}catch{throw new Error('Gemini returned malformed JSON.')}
    const parsed=responseSchema.safeParse(json);if(!parsed.success)throw new Error('Gemini response did not match the detection schema.');
    const objects=parsed.data.objects.map(o=>fromGeminiBox({...o,confidence:null}));return{objects,overall_condition:parsed.data.overall_condition,source:'gemini',warning:null};
  }catch(e){const timedOut=controller.signal.aborted;const message=timedOut?'Gemini analysis timed out.':String(e?.message||e);const status=e?.status||e?.statusCode||0;const quota=status===429||/quota|resource exhausted/i.test(message);const warning=timedOut?'Gemini analysis timed out; local detections were kept.':quota?'Gemini quota is unavailable; local detections were kept.':'Gemini analysis failed; local detections were kept.';return{objects:[],overall_condition:'Uncertain',source:'gemini-unavailable',warning,error_code:quota?'quota':timedOut?'timeout':'provider_error'}
  }finally{clearTimeout(timer)}
}
function assess(local){const objects=Array.isArray(local?.objects)?local.objects:[];const valid=objects.filter(o=>o?.source==='yolo'&&Number.isFinite(o.confidence));const average=valid.length?valid.reduce((n,o)=>n+o.confidence,0)/valid.length:0;return{shouldFallback:valid.length<cfg.geminiMinLocalObjects||average<cfg.yoloConfidence*100,localCount:valid.length,averageConfidence:Math.round(average)}}
function setClientForTest(client){testClient=client}
module.exports={analyzeGemini,merge,assess,overlaps,fromGeminiBox,geminiJsonSchema,responseSchema,setClientForTest};
