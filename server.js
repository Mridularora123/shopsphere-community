import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
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

// DB
mongoose.connect(process.env.MONGODB_URI, {}).then(()=> {
  console.log('Mongo connected');
}).catch(err=>console.error('Mongo error', err));

// Security & utils
app.use(helmet({
  contentSecurityPolicy: false, // keep simple
}));
app.use(compression());
app.use(express.json({ limit:'1mb' }));
app.use(express.urlencoded({ extended:true }));
app.use(cors({ origin: false }));

// Rate limit
const limiter = rateLimit({ windowMs: 60*1000, max: 200 });
app.use(limiter);

// Static
app.use(express.static(path.join(__dirname, 'public')));

// Views
app.set('views', path.join(__dirname, 'views'));
const ejs = (await import('ejs')).default;
app.engine('html', ejs.renderFile);
app.set('view engine', 'html');

// Health
app.get('/health', (_,res)=>res.json({ ok:true }));

// OAuth install
app.use('/auth', authRoutes);

// App Proxy (storefront)
app.use('/proxy', proxyRoutes);

// Admin
app.use('/admin', adminRoutes);

// 404
app.use((req,res)=>res.status(404).json({ success:false, message:'Not found' }));

app.listen(PORT, ()=>console.log('Server on', PORT));
