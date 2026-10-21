const multer = require('multer'), path = require('path'), fs = require('fs'), crypto = require('crypto'), cfg = require('../config'), { HttpError } = require('../utils');
fs.mkdirSync(cfg.uploadDir, { recursive: true });
const ok = ['image/jpeg', 'image/png', 'image/webp'];
const filter = (req, f, cb) => ok.includes(f.mimetype) ? cb(null, true) : cb(new HttpError(400, 'Only JPG, PNG or WEBP images are allowed'));
const limits = { fileSize: 5 * 1024 * 1024, files: 5 };
const validImage = (buf,mime) => {
  if(!Buffer.isBuffer(buf))return false;
  if(mime==='image/jpeg')return buf.length>=3&&buf[0]===0xff&&buf[1]===0xd8&&buf[2]===0xff;
  if(mime==='image/png')return buf.length>=8&&buf.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if(mime==='image/webp')return buf.length>=12&&buf.toString('ascii',0,4)==='RIFF'&&buf.toString('ascii',8,12)==='WEBP';
  return false;
};
const disk = multer({ limits, fileFilter: filter, storage: multer.diskStorage({
  destination: cfg.uploadDir,
  filename: (r, f, cb) => cb(null, crypto.randomBytes(12).toString('hex') + path.extname(f.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')) }) });
const mem = multer({ limits, fileFilter: filter, storage: multer.memoryStorage() });
module.exports = { disk, mem, validImage, url: f => '/uploads/' + f.filename };
