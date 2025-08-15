import crypto from 'crypto';
import fetch from 'node-fetch';
import Shop from '../models/Shop.js';

export function authStart(req, res){
  const shop = (req.query.shop || '').toLowerCase();
  if (!shop || !shop.endsWith('.myshopify.com')) return res.status(400).send('Invalid shop');
  const state = crypto.randomBytes(8).toString('hex');
  const redirectUri = process.env.REDIRECT_URI || `${process.env.APP_URL}/auth/callback`;
  const scopes = process.env.SCOPES || '';
  const url = `https://${shop}/admin/oauth/authorize?client_id=${process.env.SHOPIFY_API_KEY}`+
              `&scope=${encodeURIComponent(scopes)}`+
              `&redirect_uri=${encodeURIComponent(redirectUri)}`+
              `&state=${state}`;
  res.cookie('shopify_state', state, { httpOnly:true, sameSite:'lax' });
  res.redirect(url);
}

export async function authCallback(req, res){
  const { shop, hmac, code, state } = req.query;
  if (state !== req.cookies?.shopify_state) return res.status(400).send('Bad state');
  // Verify HMAC
  const map = { ...req.query };
  delete map.signature; delete map.hmac;
  const msg = Object.keys(map).sort().map(k=>`${k}=${map[k]}`).join('&');
  const digest = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET).update(msg).digest('hex');
  if (digest !== hmac) return res.status(400).send('HMAC failed');

  // Exchange code
  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method:'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code
    })
  });
  const json = await tokenRes.json();
  if (!json.access_token) return res.status(400).send('Token error');
  await Shop.findOneAndUpdate({ shop }, { accessToken: json.access_token, installedAt: new Date() }, { upsert:true });
  res.redirect('/admin'); // Non-embedded admin
}
