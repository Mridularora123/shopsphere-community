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

import authRoutes from './routes/auth.js';
import proxyRoutes from './routes/proxy.js';
import adminRoutes from './routes/admin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);   // ✅ important for Render/Shopify proxies

const PORT = process.env.PORT || 10000;

/* --------------------------- Trust reverse proxy --------------------------- */
// Required for express-rate-limit v7 when X-Forwarded-For exists (Render/NGINX).
app.set(
  'trust proxy',
  process.env.TRUST_PROXY === 'true' ? true : Number(process.env.TRUST_PROXY ?? 1)
);

/* ------------------------- MongoDB connection ----------------------------- */
mongoose
  .connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 })
  .then(() => console.log('Mongo connected'))
  .catch((err) => console.error('Mongo error', err));

/* ---------------------------- Security / basics --------------------------- */
app.use(
  helmet({
    contentSecurityPolicy: false,   // we set our own CSP below
    frameguard: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
  })
);

// Minimal CSP for embedded Shopify apps
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
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: '*' }));

/* ------------------------------ Rate limiting ----------------------------- */
// Must be after trust proxy and before routes using req.ip
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
app.use('/auth', authRoutes);        // OAuth
app.use('/proxy', proxyRoutes);      // App Proxy endpoints (also verifies signature)
app.use('/proxy/api', proxyRoutes);  // optional alias
app.use('/admin', adminRoutes);      // Admin UI

/* ---------------------------- 404 + Error handlers ------------------------ */
app.use((req, res) => res.status(404).json({ success: false, message: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  // Return JSON to avoid a blank error screen in embedded admin
  if (req.headers['x-requested-with'] === 'XMLHttpRequest' || req.accepts('json')) {
    return res.status(500).json({ success: false, message: err?.message || 'Internal Server Error' });
  }
  return res.status(500).send('Internal Server Error');
});

/* --------------------------------- Listen --------------------------------- */
app.listen(PORT, () => console.log('Server on', PORT));

export default app;
