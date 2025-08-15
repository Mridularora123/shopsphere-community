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
    contentSecurityPolicy: false, // set our own CSP next
    frameguard: false,            // remove X-Frame-Options
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
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: false }));

// Rate limit
app.use(rateLimit({ windowMs: 60 * 1000, max: 200 }));

/* -------------------------------- Static ------------------------------ */
app.use(express.static(path.join(__dirname, 'public')));

/* -------------------------------- Views ------------------------------- */
app.set('views', path.join(__dirname, 'views'));
const ejs = (await import('ejs')).default;
app.engine('html', ejs.renderFile);
app.set('view engine', 'html');

/* ------------------------------- Health ------------------------------- */
app.get('/health', (_req, res) => res.json({ ok: true }));

/* ---------------------- Embedded root (serves HTML) ------------------- */
app.get('/', (req, res) => {
  const file = path.join(__dirname, 'public', 'embedded.html');
  let html = fs.readFileSync(file, 'utf8');
  html = html.replace('{{SHOPIFY_API_KEY}}', process.env.SHOPIFY_API_KEY || '');
  res.type('html').send(html);
});

/* -------------------------------- Routes ------------------------------ */
app.use('/auth', authRoutes);   // OAuth
app.use('/proxy', proxyRoutes); // App Proxy endpoints
app.use('/admin', adminRoutes); // Moderation UI

/* ---------------------------- 404 + Errors ---------------------------- */
app.use((req, res) => res.status(404).json({ success: false, message: 'Not found' }));

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).send('Internal Server Error');
});

/* ------------------------------ Listen ------------------------------- */
app.listen(PORT, () => console.log('Server on', PORT));
