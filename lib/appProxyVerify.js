import crypto from 'crypto';
export function verifyAppProxy(req, sharedSecret) {
  const params = { ...req.query };
  const sig = params.signature || params.hmac;
  if (!sig) return false;
  delete params.signature; delete params.hmac;
  const message = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('');
  const digest = crypto.createHmac('sha256', sharedSecret).update(message).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest,'utf8'), Buffer.from(sig,'utf8'));
  } catch {
    return false;
  }
}
