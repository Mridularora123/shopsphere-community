// routes/auth.js
import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import fetch from 'node-fetch';
import Shop from '../models/Shop.js';

const router = express.Router();

// cookies for state/host
router.use(cookieParser());

/**
 * /auth  — start OAuth
 * expects ?shop={shop}.myshopify.com (Shopify will also pass ?host in embedded flows)
 */
router.get('/', async (req, res) => {
  const shop = String(req.query.shop || '').toLowerCase();
  const host = req.query.host ? String(req.query.host) : '';

  if (!shop || !shop.endsWith('.myshopify.com')) {
    return res.status(400).send('Missing or invalid shop');
  }

  const state = crypto.randomBytes(8).toString('hex');
  const redirectUri = process.env.REDIRECT_URI || `${process.env.APP_URL}/auth/callback`;
  const scopes = process.env.SCOPES || 'read_customers';

  // Persist state + context in cookies for callback
  res.cookie('shopify_state', state, { httpOnly: true, sameSite: 'lax', secure: true });
  res.cookie('shopify_shop', shop, { httpOnly: true, sameSite: 'lax', secure: true });
  if (host) {
    res.cookie('shopify_host', host, { httpOnly: true, sameSite: 'lax', secure: true });
  }

  const url =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(process.env.SHOPIFY_API_KEY)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`;

  return res.redirect(url);
});

/**
 * /auth/callback — complete OAuth
 * verifies HMAC + state, exchanges code, stores token, and redirects to embedded root
 */
router.get('/callback', async (req, res) => {
  try {
    const { shop, hmac, code, state } = req.query;

    // Basic checks
    if (!shop || !hmac || !code || !state) {
      return res.status(400).send('Required parameters missing');
    }
    if (state !== req.cookies?.shopify_state) {
      return res.status(400).send('Invalid OAuth state');
    }

    // Verify HMAC (Shopify)
    const map = { ...req.query };
    delete map.signature;
    delete map.hmac;
    const msg = Object.keys(map)
      .sort()
      .map((k) => `${k}=${map[k]}`)
      .join('&');
    const verified =
      crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET).update(msg).digest('hex') === hmac;

    if (!verified) {
      return res.status(400).send('HMAC verification failed');
    }

    // Exchange temporary code for permanent access token
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code
      })
    });

    const json = await tokenRes.json();
    if (!json.access_token) {
      return res.status(400).send('Failed to obtain access token');
    }

    // Save shop + token
    await Shop.findOneAndUpdate(
      { shop },
      { accessToken: json.access_token, installedAt: new Date() },
      { upsert: true }
    );

    // Figure out host for embedded redirect
    let host = req.query.host || req.cookies?.shopify_host;
    if (!host) {
      // Build host (base64 of {shop}/admin)
      host = Buffer.from(`${shop}/admin`, 'utf8').toString('base64');
    }

    // Clean up transient cookies
    res.clearCookie('shopify_state');
    // keep shop/host cookies if you want to reuse them; optional to clear
    // res.clearCookie('shopify_shop');
    // res.clearCookie('shopify_host');

    // Redirect to embedded root so App Bridge initializes inside Admin
    return res.redirect(`/?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}&embedded=1`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    return res.status(500).send('OAuth error');
  }
});

export default router;
