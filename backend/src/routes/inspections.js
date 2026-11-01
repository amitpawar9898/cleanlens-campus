const router = require('express').Router(), { q, pool } = require('../db'), { auth, role } = require('../middleware/auth'), { disk, url, validImage } = require('../middleware/upload');
const { ah, HttpError, page } = require('../utils'), ai = require('../services/ai'), fs = require('fs'), path = require('path'), cfg = require('../config');
const { z } = require('zod'), { audit } = require('../services/audit'), detection=require('../services/detection');
const { signed } = require('../services/files'), sg = r => ({ ...r, image_url: signed(r.image_url) });
router.use(auth);
const checklist = ['Floors and surfaces are clean','Bins are empty and waste is sorted','Fixtures and drains are clean','Supplies are stocked','Area is safe and ready to use'];
router.post('/', disk.single('image'), ah(async (req, res) => {
  const startedAt=Date.now();
  if (!req.file) throw new HttpError(400, 'image file is required (field name: image)');
  let out = null;
  if(!validImage(fs.readFileSync(path.join(cfg.uploadDir,req.file.filename)),req.file.mimetype)){await fs.promises.unlink(path.join(cfg.uploadDir,req.file.filename)).catch(()=>{});throw new HttpError(400,'Image content does not match its file type')}
  if (req.body.client_ai) {
    try {
      out=z.object({
        relevant:z.boolean(),condition:z.enum(['Good','Needs Improvement','Poor','Critical','Unclear']).optional(),confidence:z.number().int().min(0).max(100).nullable().optional(),
        issues:z.array(z.object({name:z.string().min(1).max(120),severity:z.enum(['Low','Medium','High','Critical']),confidence:z.number().int().min(0).max(100).nullable().optional()})).max(100).optional(),
        category:z.enum(['Cleaning','Maintenance','Waste','Pest','Other']).optional(),priority:z.enum(['Low','Medium','High','Critical']).optional(),
        title:z.string().max(120).optional(),description:z.string().max(1200).optional(),building:z.string().max(120).optional(),floor:z.string().max(80).optional(),spot:z.string().max(120).optional(),mode:z.string().max(120).optional(),
        objects:z.array(z.object({label:z.string().min(1).max(80),category:z.enum(['fruit','vegetable','food_waste','other']),condition:z.enum(['Fresh','Damaged','Rotten/Mouldy','Uncertain']),box_2d:z.array(z.number().min(0).max(1000)).length(4).refine(([y0,x0,y1,x1])=>y1>y0&&x1>x0),confidence:z.number().min(0).max(100).nullable(),evidence:z.string().max(240),source:z.enum(['yolo','gemini','hybrid']).optional()}).strict()).max(100).optional(),
        overall_condition:z.enum(['Good','Needs Improvement','Poor','Critical','Uncertain']).optional(),detection_source:z.enum(['yolo','gemini','hybrid','none']).optional(),processing_ms:z.number().int().nonnegative().optional(),warning:z.string().max(240).nullable().optional(),cloud_assist:z.boolean().optional(),
        cleanlens:z.boolean().optional(),scene:z.object({label:z.enum(['clean','dirty']),p_dirty:z.number().min(0).max(1)}).strict().optional()
      }).parse(JSON.parse(req.body.client_ai));
    } catch { await fs.promises.unlink(path.join(cfg.uploadDir,req.file.filename)).catch(()=>{}); throw new HttpError(400,'The supplied inspection AI result is invalid. Analyze the photo again and retry.'); }
  }
  const localObjects=out?.objects||[],cloudRequested=req.body.cloud_assist==='true'||out?.cloud_assist===true,geminiEnabled=cfg.enableGeminiFallback&&!!cfg.geminiApiKey;
  let detectionInfo=out?.objects?{objects:out.objects,overall_condition:out.overall_condition||'Uncertain',source:out.detection_source||'yolo',warning:out.warning||null}:null;
  if(geminiEnabled&&(cfg.geminiVerifyAll||(cloudRequested&&detection.assess({objects:localObjects}).shouldFallback))){
    const gemini=await detection.analyzeGemini(fs.readFileSync(path.join(cfg.uploadDir,req.file.filename)),req.file.mimetype);
    const objects=gemini.objects.length?detection.merge(localObjects,gemini.objects):localObjects;
    const source=gemini.objects.length?(localObjects.length?'hybrid':'gemini'):localObjects.length?'yolo':'none';
    detectionInfo={objects,overall_condition:gemini.objects.length?gemini.overall_condition:(out?.overall_condition||'Uncertain'),source,warning:gemini.warning||null,processing_ms:(out?.processing_ms||0)};
    if(out)out={...out,objects,overall_condition:detectionInfo.overall_condition,detection_source:source,warning:detectionInfo.warning,mode:source==='hybrid'?'YOLO + Gemini hybrid':source==='gemini'?'Gemini vision':'YOLO11 on-device'};
  }else if((cloudRequested||cfg.geminiVerifyAll)&&!geminiEnabled){
    detectionInfo={...(detectionInfo||{objects:localObjects,overall_condition:out?.overall_condition||'Uncertain',source:localObjects.length?'yolo':'none'}),warning:cfg.enableGeminiFallback?'Gemini fallback is enabled but GEMINI_API_KEY is not configured.':'Gemini fallback is disabled by server configuration.'};
  }
  if (ai.status().configured&&!cfg.geminiApiKey) {
    const { rows } = await q('SELECT b.name b,s.floor f,s.name s FROM buildings b JOIN spots s ON s.building_id=b.id WHERE b.is_active AND s.is_active'), m = {};
    rows.forEach(r => { ((m[r.b] = m[r.b] || {})[r.f] = m[r.b][r.f] || []).push(r.s); });
    try{out = await ai.analyze(fs.readFileSync(path.join(cfg.uploadDir, req.file.filename)), req.file.mimetype, Object.entries(m).map(([b, f]) => b + ': ' + Object.entries(f).map(([k, v]) => k + ' [' + v.join(', ') + ']').join('; ')).join('\n'))}
    catch(error){await fs.promises.unlink(path.join(cfg.uploadDir,req.file.filename)).catch(()=>{});throw error}
  }
  const bid = +req.body.building_id || null, sid = +req.body.spot_id || null;
  if (bid && !(await q('SELECT 1 FROM buildings WHERE id=$1 AND is_active', [bid])).rowCount) {await fs.promises.unlink(path.join(cfg.uploadDir,req.file.filename)).catch(()=>{});throw new HttpError(400,'Selected building is inactive or does not exist.')}
  if (sid && (!bid || !(await q('SELECT 1 FROM spots WHERE id=$1 AND building_id=$2 AND is_active', [sid,bid])).rowCount)) {await fs.promises.unlink(path.join(cfg.uploadDir,req.file.filename)).catch(()=>{});throw new HttpError(400,'Selected location is not active or does not match its building.')}
  if(detectionInfo){
    const objects=detectionInfo.objects||[],confidenceValues=objects.map(o=>o.confidence).filter(Number.isFinite),average=confidenceValues.length?Math.round(confidenceValues.reduce((a,b)=>a+b,0)/confidenceValues.length):null;
    const condition=detectionInfo.overall_condition==='Uncertain'?'Unclear':detectionInfo.overall_condition;
    const category=objects.some(o=>o.category==='food_waste')?'Waste':objects.some(o=>o.category==='fruit'||o.category==='vegetable')?'Other':'Cleaning';
    const previous=out||{};
    out={relevant:objects.length>0,condition,confidence:average,issues:objects.map(o=>({name:`${o.label} · ${o.condition.toLowerCase()}`,severity:o.condition==='Rotten/Mouldy'?'High':'Medium',confidence:o.confidence})),category,priority:objects.some(o=>o.condition==='Rotten/Mouldy')?'High':'Medium',title:objects.length?`${objects.length} visible food item${objects.length===1?'':'s'} detected`:'No objects confidently detected',description:objects.length?objects.map(o=>`${o.label}: ${o.evidence||o.condition}`).join('; '):'No food items were confidently identified. Please review the image manually.',building:'',floor:'',spot:'',...previous,condition,confidence:average,objects,overall_condition:detectionInfo.overall_condition,detection_source:detectionInfo.source,warning:detectionInfo.warning,detection_duration_ms:Date.now()-startedAt};
  }
  let r;try{r=(await q('INSERT INTO inspections(inspector_id,building_id,spot_id,image_url,ai,condition,confidence,checklist) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [req.user.id, bid, sid, url(req.file), out ? JSON.stringify(out) : null, out ? out.condition||out.overall_condition||null : null, out ? out.confidence??null : null, JSON.stringify(checklist.map((label,i)=>({id:`check-${i+1}`,label,completed:false})))] )).rows[0]}
  catch(error){await fs.promises.unlink(path.join(cfg.uploadDir,req.file.filename)).catch(()=>{});throw error}
  await audit(req.user.id,'inspection.create','inspection:'+r.id,{building_id:bid,spot_id:sid});
  res.status(201).json({...sg(r),inspection_id:r.id,objects:out?.objects||[],overall_condition:out?.overall_condition||out?.condition||'Uncertain',detection_source:out?.detection_source||out?.mode||'none',detection_duration_ms:out?.detection_duration_ms||Date.now()-startedAt,warning:out?.warning||null});
}));
router.get('/', ah(async (req, res) => {
  const { limit, offset } = page(req);
  const from=req.query.from||null,to=req.query.to||null, valid=v=>!v||(/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v)));
  if(!valid(from)||!valid(to)||(from&&to&&from>to)) throw new HttpError(400,'Use valid inspection date filters (YYYY-MM-DD).');
  const {rows}=await q(`SELECT i.*,b.name building,s.name spot,u.name inspector,COALESCE((SELECT json_agg(json_build_object('id',f.id,'decision',f.decision,'corrected',f.corrected,'note',f.note,'reviewer',ru.name,'created_at',f.created_at) ORDER BY f.id DESC) FROM ai_feedback f JOIN users ru ON ru.id=f.user_id WHERE f.inspection_id=i.id),'[]') feedback FROM inspections i LEFT JOIN buildings b ON b.id=i.building_id LEFT JOIN spots s ON s.id=i.spot_id JOIN users u ON u.id=i.inspector_id
    WHERE ($1::int IS NULL OR i.building_id=$1) AND ($2::date IS NULL OR i.created_at >= $2::date) AND ($3::date IS NULL OR i.created_at < $3::date + interval '1 day')
    AND ($4='admin' OR ($4='staff' AND u.department_id=$5) OR ($4 IN ('cleaner','student') AND i.inspector_id=$6)) ORDER BY i.id DESC LIMIT ${limit} OFFSET ${offset}`,[req.query.building_id||null,from,to,req.user.role,req.user.department_id,req.user.id]);
  res.json(rows.map(sg));
}));
router.get('/:id', ah(async (req, res) => {
  const r = (await q(`SELECT i.*,b.name building,s.name spot,u.name inspector,u.department_id inspector_department,COALESCE((SELECT json_agg(json_build_object('id',f.id,'decision',f.decision,'corrected',f.corrected,'note',f.note,'reviewer',ru.name,'created_at',f.created_at) ORDER BY f.id DESC) FROM ai_feedback f JOIN users ru ON ru.id=f.user_id WHERE f.inspection_id=i.id),'[]') feedback FROM inspections i LEFT JOIN buildings b ON b.id=i.building_id LEFT JOIN spots s ON s.id=i.spot_id JOIN users u ON u.id=i.inspector_id WHERE i.id=$1`, [req.params.id])).rows[0];
  if (!r || (['cleaner','student'].includes(req.user.role)&&r.inspector_id!==req.user.id) || (req.user.role==='staff'&&r.inspector_department!==req.user.department_id)) throw new HttpError(404, 'Inspection not found'); res.json(sg(r));
}));
router.patch('/:id/checklist', role('admin','staff'), ah(async(req,res)=>{
  const b=z.object({items:z.array(z.object({id:z.string().min(1),completed:z.boolean() })).length(5),note:z.string().max(500).optional()}).parse(req.body);
  const prior=(await q('SELECT i.checklist,u.department_id FROM inspections i JOIN users u ON u.id=i.inspector_id WHERE i.id=$1',[req.params.id])).rows[0]; if(!prior||(req.user.role==='staff'&&prior.department_id!==req.user.department_id)) throw new HttpError(404,'Inspection not found');
  const submitted=new Map(b.items.map(x=>[x.id,x.completed]));
  const merged=prior.checklist.map(item=>({...item,completed:submitted.get(item.id)??false}));
  const score=Math.round(merged.filter(x=>x.completed).length/merged.length*100);
  const r=(await q('UPDATE inspections SET checklist=$1,score=$2,reviewed_by=$3,review_note=$4 WHERE id=$5 RETURNING *',[JSON.stringify(merged),score,req.user.id,b.note||null,req.params.id])).rows[0];
  await audit(req.user.id,'inspection.checklist','inspection:'+r.id,{score}); res.json(r);
}));
router.post('/:id/feedback', role('admin','staff'), ah(async(req,res)=>{
  const b=z.object({decision:z.enum(['confirmed','corrected','rejected']),corrected:z.record(z.any()).optional(),note:z.string().max(1000).optional()}).refine(v=>v.decision!=='corrected'||!!v.corrected,{message:'Corrected AI findings are required.'}).parse(req.body);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const prior=(await client.query('SELECT ai FROM inspections WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
    if(!prior) throw new HttpError(404,'Inspection not found');
    if(req.user.role==='staff'&&!(await client.query('SELECT 1 FROM inspections i JOIN users u ON u.id=i.inspector_id WHERE i.id=$1 AND u.department_id=$2',[req.params.id,req.user.department_id])).rowCount) throw new HttpError(404,'Inspection not found');
    const feedback=(await client.query('INSERT INTO ai_feedback(inspection_id,user_id,decision,original,corrected,note) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[req.params.id,req.user.id,b.decision,prior.ai?JSON.stringify(prior.ai):null,b.corrected?JSON.stringify(b.corrected):null,b.note||null])).rows[0];
    await audit(req.user.id,'inspection.ai_feedback','inspection:'+req.params.id,{decision:b.decision},client);
    await client.query('COMMIT'); res.status(201).json(feedback);
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));
module.exports = router;
