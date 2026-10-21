const router = require('express').Router(), bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken'), crypto = require('crypto'), { z } = require('zod');
const cfg = require('../config'), { q, pool } = require('../db'), { auth } = require('../middleware/auth'), { ah, HttpError } = require('../utils'), sms = require('../services/sms'), email = require('../services/email');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const phoneRe = /^\+?[0-9]{10,15}$/;
async function tokens(u) {
  const access = jwt.sign({ sub: u.id, role: u.role }, cfg.jwtSecret, { expiresIn: cfg.accessTtl });
  const refresh = crypto.randomBytes(48).toString('hex');
  await q("INSERT INTO refresh_tokens(user_id,token_hash,expires_at) VALUES($1,$2,now()+($3||' days')::interval)", [u.id, sha(refresh), String(cfg.refreshDays)]);
  return { access_token: access, refresh_token: refresh, token_type: 'Bearer', user: { id: u.id, name: u.name, email: u.email, role: u.role, department_id: u.department_id } };
}
router.post('/register', ah(async (req, res) => {
  if (!cfg.publicRegistration) throw new HttpError(403,'Public student registration is disabled. Ask a campus administrator to create your account.');
  const b = z.object({ name: z.string().min(2).max(80), email: z.string().email(), password: z.string().min(8).max(100), phone: z.string().regex(phoneRe).optional() }).parse(req.body);
  const { rows } = await q("INSERT INTO users(name,email,phone,password_hash,role) VALUES($1,lower($2),$3,$4,'student') RETURNING *", [b.name, b.email, b.phone || null, await bcrypt.hash(b.password, 10)]);
  res.status(201).json(await tokens(rows[0]));
}));
router.post('/login', ah(async (req, res) => {
  const b = z.object({ email: z.string().min(3), password: z.string().min(1) }).parse(req.body);
  const { rows } = await q('SELECT * FROM users WHERE email=lower($1)', [b.email]);
  const u = rows[0];
  if (!u || !u.is_active || !(await bcrypt.compare(b.password, u.password_hash))) throw new HttpError(401, 'Wrong email or password');
  res.json(await tokens(u));
}));
router.post('/forgot-password', ah(async(req,res)=>{
  const {email:address}=z.object({email:z.string().email()}).parse(req.body),u=(await q('SELECT id,email FROM users WHERE email=lower($1) AND is_active',[address])).rows[0];
  if(!u)return res.json({ok:true,message:'If the account exists, password reset instructions will be sent.'});
  if(cfg.prod&&(cfg.emailProvider!=='resend'||!cfg.emailApiKey))return res.json({ok:true,message:'If the account exists, password reset instructions will be sent.'});
  const token=crypto.randomBytes(32).toString('hex');
  await q('UPDATE password_resets SET used=true WHERE user_id=$1 AND NOT used',[u.id]);
  await q("INSERT INTO password_resets(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 minutes')",[u.id,sha(token)]);
  try{const delivery=await email.sendPasswordReset(u.email,token);res.json({ok:true,message:'If the account exists, password reset instructions will be sent.',...(delivery.dev?{dev_token:token}:{})})}
  catch(error){await q('UPDATE password_resets SET used=true WHERE token_hash=$1',[sha(token)]);if(!cfg.prod)throw new HttpError(502,'Password reset email could not be sent');res.json({ok:true,message:'If the account exists, password reset instructions will be sent.'})}
}));
router.post('/reset-password', ah(async(req,res)=>{
  const b=z.object({token:z.string().min(32).max(200),new_password:z.string().min(8).max(100)}).parse(req.body),client=await pool.connect();
  try{await client.query('BEGIN');const reset=(await client.query('SELECT * FROM password_resets WHERE token_hash=$1 AND NOT used AND expires_at>now() FOR UPDATE',[sha(b.token)])).rows[0];
    if(!reset)throw new HttpError(400,'Reset link is invalid or expired');
    await client.query('UPDATE users SET password_hash=$1 WHERE id=$2',[await bcrypt.hash(b.new_password,12),reset.user_id]);
    await client.query('UPDATE refresh_tokens SET revoked=true WHERE user_id=$1',[reset.user_id]);
    await client.query('UPDATE password_resets SET used=true WHERE user_id=$1',[reset.user_id]);
    await client.query('COMMIT');res.json({ok:true,message:'Password updated. Sign in with your new password.'});
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));
router.post('/refresh', ah(async (req, res) => {
  const { refresh_token } = z.object({ refresh_token: z.string().min(10) }).parse(req.body);
  const { rows } = await q('SELECT * FROM refresh_tokens WHERE token_hash=$1 AND NOT revoked AND expires_at>now()', [sha(refresh_token)]);
  if (!rows[0]) throw new HttpError(401, 'Invalid refresh token');
  await q('UPDATE refresh_tokens SET revoked=true WHERE id=$1', [rows[0].id]);
  const u = (await q('SELECT * FROM users WHERE id=$1 AND is_active', [rows[0].user_id])).rows[0];
  if (!u) throw new HttpError(401, 'Account disabled');
  res.json(await tokens(u));
}));
router.post('/logout', ah(async (req, res) => {
  const { refresh_token } = z.object({ refresh_token: z.string() }).parse(req.body);
  await q('UPDATE refresh_tokens SET revoked=true WHERE token_hash=$1', [sha(refresh_token)]); res.json({ ok: true });
}));
router.post('/otp/request', ah(async (req, res) => {
  const { phone } = z.object({ phone: z.string().regex(phoneRe) }).parse(req.body);
  const u = (await q('SELECT id FROM users WHERE phone=$1 AND is_active', [phone])).rows[0];
  const recent = (await q("SELECT count(*)::int n FROM otp_codes WHERE phone=$1 AND created_at>now()-interval '10 minutes'", [phone])).rows[0].n;
  if (recent >= 3) throw new HttpError(429, 'Too many OTP requests. Try again in a few minutes.');
  const out = { ok: true, expires_in: 300 };
  if (u) {
    const code = String(crypto.randomInt(100000, 1000000));
    await q("INSERT INTO otp_codes(phone,code_hash,expires_at) VALUES($1,$2,now()+interval '5 minutes')", [phone, sha(code + phone)]);
    await sms.send(phone, `Your SIT CleanLens OTP is ${code}. Valid for 5 minutes.`);
    if (cfg.sms.provider === 'console' && !cfg.prod) out.dev_code = code;
  }
  res.json(out);
}));
router.post('/otp/verify', ah(async (req, res) => {
  const b = z.object({ phone: z.string().regex(phoneRe), code: z.string().length(6) }).parse(req.body);
  const o = (await q('SELECT * FROM otp_codes WHERE phone=$1 AND NOT used AND expires_at>now() ORDER BY id DESC LIMIT 1', [b.phone])).rows[0];
  if (!o || o.attempts >= 5) throw new HttpError(400, 'OTP expired or too many attempts');
  if (o.code_hash !== sha(b.code + b.phone)) { await q('UPDATE otp_codes SET attempts=attempts+1 WHERE id=$1', [o.id]); throw new HttpError(400, 'Wrong OTP'); }
  await q('UPDATE otp_codes SET used=true WHERE id=$1', [o.id]);
  const u = (await q('SELECT * FROM users WHERE phone=$1 AND is_active', [b.phone])).rows[0];
  res.json(await tokens(u));
}));
router.get('/me', auth, (req, res) => res.json(req.user));
router.patch('/me', auth, ah(async (req, res) => {
  const b = z.object({ name: z.string().min(2).max(80).optional(), phone: z.string().regex(phoneRe).optional() }).parse(req.body);
  const { rows } = await q('UPDATE users SET name=COALESCE($1,name),phone=COALESCE($2,phone) WHERE id=$3 RETURNING id,name,email,phone,role,department_id', [b.name, b.phone, req.user.id]);
  res.json(rows[0]);
}));
router.post('/change-password', auth, ah(async (req, res) => {
  const b = z.object({ current_password: z.string(), new_password: z.string().min(8).max(100) }).parse(req.body);
  const u = (await q('SELECT password_hash FROM users WHERE id=$1', [req.user.id])).rows[0];
  if (!(await bcrypt.compare(b.current_password, u.password_hash))) throw new HttpError(400, 'Current password is wrong');
  await q('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(b.new_password, 10), req.user.id]);
  await q('UPDATE refresh_tokens SET revoked=true WHERE user_id=$1', [req.user.id]); res.json({ ok: true });
}));
module.exports = router;
