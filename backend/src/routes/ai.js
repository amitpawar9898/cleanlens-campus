const router = require('express').Router(), { q } = require('../db'), { auth } = require('../middleware/auth'), { mem, validImage } = require('../middleware/upload'), { ah, HttpError } = require('../utils'), ai = require('../services/ai');
router.use(auth);
router.get('/providers/status', ah(async (req,res)=>res.json(ai.status())));
async function spotsText() {
  const { rows } = await q('SELECT b.name b,s.floor f,s.name s FROM buildings b JOIN spots s ON s.building_id=b.id ORDER BY b.name,s.floor,s.name'), m = {};
  rows.forEach(r => { ((m[r.b] = m[r.b] || {})[r.f] = m[r.b][r.f] || []).push(r.s); });
  return Object.entries(m).map(([b, f]) => b + ': ' + Object.entries(f).map(([k, v]) => k + ' [' + v.join(', ') + ']').join('; ')).join('\n');
}
router.post('/analyze', mem.single('image'), ah(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'image file is required (field name: image)');
  if(!validImage(req.file.buffer,req.file.mimetype))throw new HttpError(400,'Image content does not match its file type');
  const out = await ai.analyze(req.file.buffer, req.file.mimetype, await spotsText());
  const b = out.building && (await q('SELECT id FROM buildings WHERE name=$1', [out.building])).rows[0];
  const s = b && out.spot && (await q('SELECT id FROM spots WHERE building_id=$1 AND name=$2', [b.id, out.spot])).rows[0];
  res.json({ ...out, building_id: b ? b.id : null, spot_id: s ? s.id : null });
}));
router.post('/compare', mem.fields([{ name: 'before', maxCount: 1 }, { name: 'after', maxCount: 1 }]), ah(async (req, res) => {
  const b = req.files.before && req.files.before[0], a = req.files.after && req.files.after[0];
  if (!a || !b) throw new HttpError(400, 'Both before and after images are required');
  if(!validImage(a.buffer,a.mimetype)||!validImage(b.buffer,b.mimetype))throw new HttpError(400,'Image content does not match its file type');
  res.json(await ai.compare({ buf: b.buffer, mime: b.mimetype }, { buf: a.buffer, mime: a.mimetype }));
}));
module.exports = router;
