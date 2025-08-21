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

// If you want to verify in this file too, uncomment the next line and implement verifyProxy()
// import crypto from 'crypto';

import authRoutes from './routes/auth.js';
import proxyRoutes from './routes/proxy.js';
import adminRoutes from './routes/admin.js';

// ⬇️ models for the weekly digest task (unchanged)
import Thread from './models/Thread.js';
import Notification from './models/Notification.js';
import NotificationSettings from './models/NotificationSettings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

/* --------------------------- Trust reverse proxy --------------------------- */
// Required for rate limiting and correct IPs behind Render/Shopify proxies.
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
    contentSecurityPolicy: false, // we set our own CSP below
    frameguard: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
  })
);

// Minimal CSP for embedded Shopify apps and proxy requests
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

/* --------- Helper: canonical shop extraction for App Proxy hits ----------- */
/**
 * This middleware extracts a canonical shop domain from the request forwarded by Shopify.
 * - Prefer the X-Shopify-Shop-Domain header (added by Shopify)
 * - Fallback to ?shop= query if needed
 * It then exposes it as req.shop and mirrors to req.query.shop so existing
 * route code that reads req.query.shop keeps working unchanged.
 *
 * NOTE: You said your proxyRoutes already verifies the signature — great.
 * If you want to also verify here, add a verifyProxy(req) check before calling next().
 */
function setShopFromProxy(req, _res, next) {
  const hdr = (req.get('X-Shopify-Shop-Domain') || '').toLowerCase();
  const q = (req.query.shop || '').toLowerCase();
  const shop = hdr || q || '';
  req.shop = shop;
  // Keep compatibility with existing handlers that read req.query.shop:
  if (shop) req.query.shop = shop;
  next();
}

/* --------------------------------- Routes --------------------------------- */
app.use('/auth', authRoutes); // OAuth

// ✅ Canonical App Proxy mount point used by your frontend (ForumWidget uses /apps/community)
app.use('/apps/community', setShopFromProxy, proxyRoutes);

// ✅ Aliases for backwards compatibility (if you still hit /proxy or /proxy/api anywhere)
app.use('/proxy', setShopFromProxy, proxyRoutes);
app.use('/proxy/api', setShopFromProxy, proxyRoutes);

// Admin UI
app.use('/admin', adminRoutes);

/* ---------------------- Weekly roundup task (top threads) ------------------ */
app.post('/tasks/weekly-digest', async (req, res) => {
  if (req.headers['x-task-key'] !== process.env.TASK_KEY) {
    return res.status(401).send('unauthorized');
  }

  try {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);

    // top 5 threads by votes in the last 7 days (approved only), grouped per shop
    const topByShop = await Thread.aggregate([
      { $match: { status: 'approved', createdAt: { $gte: weekAgo } } },
      { $sort: { votes: -1, createdAt: -1 } },
      {
        $group: {
          _id: '$shop',
          threads: { $push: { _id: '$_id', title: '$title', votes: '$votes' } }
        }
      },
      { $project: { _id: 1, threads: { $slice: ['$threads', 5] } } }
    ]);

    let total = 0;

    for (const row of topByShop) {
      const shop = row._id;
      const threads = row.threads || [];
      if (!threads.length) continue;

      // who wants a weekly digest for this shop?
      const subs = await NotificationSettings.find({ shop, weeklyDigest: true })
        .select('userId')
        .lean();

      const docs = subs.map(s => ({
        shop,
        userId: String(s.userId),
        type: 'digest',
        targetType: 'system',
        targetId: '',
        payload: { threads },
      }));

      if (docs.length) {
        const r = await Notification.insertMany(docs, { ordered: false });
        total += r.length;
      }
    }

    res.json({ ok: true, pushed: total });
  } catch (err) {
    console.error('weekly-digest error:', err);
    res.status(500).json({ ok: false, message: err?.message || 'failed' });
  }
});

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
