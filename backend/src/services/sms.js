const cfg = require('../config'), { HttpError } = require('../utils');
async function send(phone, text) {
  const s = cfg.sms;
  if (s.provider === 'twilio') {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${s.twilioSid}/Messages.json`, { method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(s.twilioSid + ':' + s.twilioToken).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: phone, From: s.twilioFrom, Body: text }) });
    if (!r.ok) throw new HttpError(502, 'SMS provider rejected the request');
  } else if (s.provider === 'fast2sms') {
    const r = await fetch('https://www.fast2sms.com/dev/bulkV2', { method: 'POST', headers: { authorization: s.fast2sms, 'content-type': 'application/json' },
      body: JSON.stringify({ route: 'q', message: text, numbers: phone.replace(/^\+?91/, '') }) });
    if (!r.ok) throw new HttpError(502, 'SMS provider rejected the request');
  } else console.log(`[SMS:console] to ${phone}: ${text}`);
}
module.exports = { send };
