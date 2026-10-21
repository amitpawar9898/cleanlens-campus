require('dotenv').config();
const e = process.env, prod = e.NODE_ENV === 'production';
const cfg = {
  prod, port: +e.PORT || 4000,
  dbUrl: e.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/cleanlens',
  jwtSecret: e.JWT_SECRET || 'dev-secret-change-me', accessTtl: e.ACCESS_TTL || '15m', refreshDays: +e.REFRESH_DAYS || 30,
  corsOrigin: e.CORS_ORIGIN || '*', uploadDir: e.UPLOAD_DIR || 'uploads',
  aiProvider:e.AI_PROVIDER||'auto',
  publicRegistration:e.PUBLIC_REGISTRATION===undefined?true:e.PUBLIC_REGISTRATION==='true',
  anthropicKey: e.ANTHROPIC_API_KEY || '', anthropicModel: e.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
  openaiKey:e.OPENAI_API_KEY||'',openaiModel:e.OPENAI_MODEL||'gpt-4o-mini',
  googleKey:e.GEMINI_API_KEY||e.GOOGLE_API_KEY||'',geminiModel:e.GEMINI_MODEL||'gemini-3.8-flash',
  geminiApiKey:e.GEMINI_API_KEY||e.GOOGLE_API_KEY||'',
  enableGeminiFallback:e.ENABLE_GEMINI_FALLBACK===undefined?true:e.ENABLE_GEMINI_FALLBACK==='true',
  geminiVerifyAll:e.GEMINI_VERIFY_ALL==='true',
  geminiTimeoutMs:Math.min(60000,Math.max(1000,Number(e.GEMINI_TIMEOUT_MS)||25000)),
  yoloConfidence:Math.min(.9,Math.max(.01,Number(e.YOLO_CONFIDENCE)||.2)),
  geminiMinLocalObjects:Math.max(1,Math.min(20,Number(e.GEMINI_MIN_LOCAL_OBJECTS)||2)),
  ollamaUrl:e.OLLAMA_BASE_URL||'',ollamaModel:e.OLLAMA_MODEL||'',
  frontendUrl:e.FRONTEND_URL||'http://localhost:4000',emailProvider:e.EMAIL_PROVIDER||'console',emailApiKey:e.EMAIL_API_KEY||'',
  sms: { provider: e.SMS_PROVIDER || 'console', twilioSid: e.TWILIO_SID, twilioToken: e.TWILIO_TOKEN, twilioFrom: e.TWILIO_FROM, fast2sms: e.FAST2SMS_KEY },
  seed: { email: e.SEED_ADMIN_EMAIL || '', password: e.SEED_ADMIN_PASSWORD || '' }
};
if (!['auto','anthropic','openai','google','ollama'].includes(cfg.aiProvider)) { console.error('AI_PROVIDER must be auto, anthropic, openai, google, or ollama.'); process.exit(1); }
if (prod && cfg.jwtSecret === 'dev-secret-change-me') { console.error('Set JWT_SECRET in production.'); process.exit(1); }
module.exports = cfg;
