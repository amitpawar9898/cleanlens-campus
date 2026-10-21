const cfg=require('../config');
exports.sendPasswordReset=async(to,token)=>{
  if(cfg.emailProvider==='console'&&!cfg.prod)return {dev:true};
  if(cfg.emailProvider!=='resend'||!cfg.emailApiKey)throw new Error('Password reset email provider is not configured');
  const link=cfg.frontendUrl.replace(/\/$/,'')+'/?reset_token='+encodeURIComponent(token);
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+cfg.emailApiKey,'content-type':'application/json'},body:JSON.stringify({from:process.env.EMAIL_FROM||'SIT CleanLens <onboarding@resend.dev>',to:[to],subject:'Reset your SIT CleanLens password',text:`Use this one-time link to reset your password. It expires in 30 minutes.\n\n${link}\n\nIf you did not request a reset, you can ignore this message.`})});
  if(!response.ok)throw new Error('Email provider rejected the password reset message');return {dev:false};
};
