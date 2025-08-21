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

// Models used by the weekly-digest task
import Thread from './models/Thread.js';
import Notification from './models/Notification.js';
import NotificationSettings from './models/NotificationSettings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

/* --------------------------- Proxy / networking --------------------------- */
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : Number(process.env.TRUST_PROXY ?? 1));

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

/* ----------------------- Embedded root (serves HTML) ---------------------- */
app.get('/', (_req, res) => {
  const file = path.join(__dirname, 'public', 'embedded.html');
  let html = fs.readFileSync(file, 'utf8');
  html = html.replace('{{SHOPIFY_API_KEY}}', process.env.SHOPIFY_API_KEY || '');
  res.type('html').send(html);
});

/* ------------------------ Proxy helpers (NEW/CHANGED) --------------------- */
// 1) Stop Shopify proxy responses from being cached by the CDN
function noStore(_req, res, next) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  next();
}

// 2) Normalize the shop domain from the proxy (header or query)
//    Your route handlers can rely on req.shop being set.
function attachShopFromProxy(req, res, next) {
  const header = (req.get('X-Shopify-Shop-Domain') || '').toLowerCase().trim();
  if (!header) {
    console.warn('Missing X-Shopify-Shop-Domain on proxy request', {
      path: req.path,
      query: req.query,
      xfwdHost: req.get('x-forwarded-host'),
      host: req.get('host'),
    });
    return res.status(400).json({
      success: false,
      message: 'Missing proxy header. Ensure App Proxy points to /proxy with no extra query params.',
    });
  }
  req.shop = header;
  next();
}


/* --------------------------------- Routes --------------------------------- */
app.use('/auth', authRoutes); // OAuth

// IMPORTANT: Your Shopify App Proxy likely maps storefront /apps/community/* to this /proxy path.
// The two middlewares below ensure: (a) no CDN caching, (b) req.shop is always present for handlers.
app.use('/proxy', noStore, attachShopFromProxy, proxyRoutes);
app.use('/proxy/api', noStore, attachShopFromProxy, proxyRoutes); // optional alias

app.use('/admin', adminRoutes); // Admin UI

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
  if (req.headers['x-requested-with'] === 'XMLHttpRequest' || req.accepts('json')) {
    return res.status(500).json({ success: false, message: err?.message || 'Internal Server Error' });
  }
  return res.status(500).send('Internal Server Error');
});

/* --------------------------------- Listen --------------------------------- */
app.listen(PORT, () => console.log('Server on', PORT));

export default app;
