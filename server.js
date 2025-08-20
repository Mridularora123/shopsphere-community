// server.js
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
import morgan from 'morgan';

import authRoutes from './routes/auth.js';
import proxyRoutes from './routes/proxy.js';
import adminRoutes from './routes/admin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

/* --------------------------- Trust reverse proxy --------------------------- */
/* Required for express-rate-limit v7 when X-Forwarded-For is present (Render). */
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : Number(process.env.TRUST_PROXY ?? 1));

/* ------------------------- MongoDB connection ----------------------------- */
mongoose
  .connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 })
  .then(() => console.log('Mongo connected'))
  .catch((err) => console.error('Mongo error', err));

/* ---------------------------- Security / basics --------------------------- */
// Allow Shopify Admin to iframe this app; disable Helmet bits that conflict.
app.use(
  helmet({
    contentSecurityPolicy: false,   // we set our own CSP below
    frameguard: false,              // remove X-Frame-Options
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
  })
);

// Minimal CSP for embedded apps
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self' https: data: blob:; " +
      "script-src 'self' https: 'unsafe-inline'; " +
      "style-src 'self' https: 'unsafe-inline'; " +
      "img-src 'self' https: data:; " +
      "connect-src 'self' https:; " +
      "frame-ancestors https://admin.shopify.com https://*.myshopify.com;"
  );
  next();
});

app.use(compression());
app.use(morgan('tiny'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: '*' }));

/* ------------------------------ Rate limiting ----------------------------- */
/* Must be AFTER trust proxy and BEFORE routes that rely on req.ip */
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: Number(process.env.RATE_LIMIT || 200),
    standardHeaders: true,
    legacyHeaders: false,
  })
);

/* ---------------------- Static assets with CORS/CORP ---------------------- */
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders(res, filePath) {
      // So Shopify storefront can load cross-origin assets
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  })
);

/* --------------------------------- Views ---------------------------------- */
app.set('views', path.join(__dirname, 'views'));
const ejs = (await import('ejs')).default;
app.engine('html', ejs.renderFile);
app.set('view engine', 'html');

/* -------------------------------- Health ---------------------------------- */
app.get('/health', (_req, res) => res.json({ ok: true }));

/* ----------------------- Embedded root (serves HTML) ----------------------- */
app.get('/', (_req, res) => {
  const file = path.join(__dirname, 'public', 'embedded.html');
  let html = fs.readFileSync(file, 'utf8');
  html = html.replace('{{SHOPIFY_API_KEY}}', process.env.SHOPIFY_API_KEY || '');
  res.type('html').send(html);
});

/* --------------------------------- Routes --------------------------------- */
// OAuth
app.use('/auth', authRoutes);

// Shopify App Proxy endpoints (your proxy router verifies the signature)
app.use('/proxy', proxyRoutes);
app.use('/proxy/api', proxyRoutes);

// Admin moderation UI
app.use('/admin', adminRoutes);

/* ---------------------------- 404 + Error handlers ------------------------ */
app.use((req, res) => res.status(404).json({ success: false, message: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  // Return JSON so Shopify admin “embedded app” doesn’t render a blank page
  if (req.headers['x-requested-with'] === 'XMLHttpRequest' || req.accepts('json')) {
    return res.status(500).json({ success: false, message: err?.message || 'Internal Server Error' });
  }
  return res.status(500).send('Internal Server Error');
});

/* --------------------------------- Listen --------------------------------- */
app.listen(PORT, () => console.log('Server on', PORT));

export default app;
