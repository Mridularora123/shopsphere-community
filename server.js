// server.js (final)

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import mongoose from 'mongoose';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';

import authRoutes from './routes/auth.js';
import proxyRoutes from './routes/proxy.js';   // should define /api/* routes (no /proxy here)
import adminRoutes from './routes/admin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

/* ------------------------- MongoDB connection ------------------------- */
mongoose
  .connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 })
  .then(() => console.log('Mongo connected'))
  .catch((err) => console.error('Mongo error', err));

/* ------------------------ Security & middlewares ---------------------- */
// Allow Shopify Admin to iframe this app
app.use(
  helmet({
    contentSecurityPolicy: false, // we’ll set our own CSP
    frameguard: false,
  })
);

// Minimal CSP for embedded apps & storefront usage
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self' https: data: blob:",
      "script-src 'self' https: 'unsafe-inline'",
      "style-src 'self' https: 'unsafe-inline'",
      "img-src 'self' https: data:",
      "connect-src 'self' https:",
      // storefront + admin can iframe
      "frame-ancestors https://admin.shopify.com https://*.myshopify.com",
    ].join('; ')
  );
  next();
});

app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: '*' }));

// Rate limit
app.use(rateLimit({ windowMs: 60 * 1000, max: 200 }));

/* ---------------------- Static assets with CORS/CORP ------------------ */
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders(res, filePath) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  })
);

/* -------------------------------- Views ------------------------------- */
app.set('views', path.join(__dirname, 'views'));
const ejs = (await import('ejs')).default;
app.engine('html', ejs.renderFile);
app.set('view engine', 'html');

/* -------------------------- Proxy signature check --------------------- */
// Uses the App Proxy shared secret from your app settings (NOT OAuth secret)
function verifyShopifyProxy(req, res, next) {
  try {
    const { signature, ...params } = req.query;
    if (!signature) return res.status(403).json({ success: false, message: 'Missing signature' });

    const message = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('');

    const expected = crypto
      .createHmac('sha256', process.env.SHOPIFY_SHARED_SECRET || '')
      .update(message)
      .digest('hex');

    if (expected !== signature) {
      return res.status(403).json({ success: false, message: 'Invalid signature' });
    }

    // Helpful: surface the shop domain for downstream handlers
    req.shopDomain = params.shop || req.headers['x-shopify-shop-domain'];
    next();
  } catch (e) {
    console.error('Proxy verify error:', e);
    return res.status(403).json({ success: false, message: 'Proxy verification failed' });
  }
}

/* ------------------------------- Health ------------------------------- */
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/proxy/health', (_req, res) => res.send('ok'));

/* ---------------------- Embedded root (serves HTML) ------------------- */
app.get('/', (req, res) => {
  const file = path.join(__dirname, 'public', 'embedded.html');
  let html = fs.readFileSync(file, 'utf8');
  html = html.replace('{{SHOPIFY_API_KEY}}', process.env.SHOPIFY_API_KEY || '');
  res.type('html').send(html);
});

/* -------------------------------- Routes ------------------------------ */
app.use('/auth', authRoutes);                // OAuth + embedded pages

// IMPORTANT: all App Proxy endpoints are under /proxy/* and verified
app.use('/proxy', verifyShopifyProxy, proxyRoutes);  // proxyRoutes should export /api/* handlers

app.use('/admin', adminRoutes);              // Moderation UI (embedded)

/* ---------------------------- 404 + Errors ---------------------------- */
app.use((req, res) => res.status(404).json({ success: false, message: 'Not found' }));

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).send('Internal Server Error');
});

/* ------------------------------ Listen ------------------------------- */
app.listen(PORT, () => console.log('Server on', PORT));
