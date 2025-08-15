import express from 'express';
import basicAuth from 'express-basic-auth';
import sanitizeHtml from 'sanitize-html';
import Thread from '../models/Thread.js';
import Comment from '../models/Comment.js';
import Category from '../models/Category.js';
import Poll from '../models/Poll.js';
import Report from '../models/Report.js';

const router = express.Router();

router.use(basicAuth({
  users: { admin: process.env.ADMIN_PASSWORD || 'admin' },
  challenge: true,
  unauthorizedResponse: ()=>'Auth required'
}));

router.get('/', async (req,res)=>{
  const pendingT = await Thread.countDocuments({ status:'pending' });
  const pendingC = await Comment.countDocuments({ status:'pending' });
  const reports = await Report.countDocuments({ status:'open' });
  res.render('dashboard', { pendingT, pendingC, reports });
});

// Threads moderation
router.get('/threads', async (req,res)=>{
  const { status='pending' } = req.query;
  const items = await Thread.find({ status }).sort({ createdAt:-1 }).lean();
  res.render('threads', { items, status });
});
router.post('/threads/:id/approve', async (req,res)=>{
  await Thread.findByIdAndUpdate(req.params.id, { status:'approved' });
  res.redirect('back');
});
router.post('/threads/:id/reject', async (req,res)=>{
  await Thread.findByIdAndUpdate(req.params.id, { status:'rejected' });
  res.redirect('back');
});
router.post('/threads/:id/pin', async (req,res)=>{
  await Thread.findByIdAndUpdate(req.params.id, { pinned:true });
  res.redirect('back');
});
router.post('/threads/:id/unpin', async (req,res)=>{
  await Thread.findByIdAndUpdate(req.params.id, { pinned:false });
  res.redirect('back');
});
router.post('/threads/:id/close', async (req,res)=>{
  await Thread.findByIdAndUpdate(req.params.id, { closed:true });
  res.redirect('back');
});
router.post('/threads/:id/reopen', async (req,res)=>{
  await Thread.findByIdAndUpdate(req.params.id, { closed:false });
  res.redirect('back');
});

// Comments moderation
router.get('/comments', async (req,res)=>{
  const { status='pending' } = req.query;
  const items = await Comment.find({ status }).sort({ createdAt:-1 }).lean();
  res.render('comments', { items, status });
});
router.post('/comments/:id/approve', async (req,res)=>{
  const c = await Comment.findByIdAndUpdate(req.params.id, { status:'approved' }, { new:true });
  if (c?.threadId) await Thread.findByIdAndUpdate(c.threadId, { $inc: { commentsCount: 1 } });
  res.redirect('back');
});
router.post('/comments/:id/reject', async (req,res)=>{
  await Comment.findByIdAndUpdate(req.params.id, { status:'rejected' });
  res.redirect('back');
});

// Categories
router.get('/categories', async (req,res)=>{
  const items = await Category.find({}).sort({ order:1 }).lean();
  res.render('categories', { items });
});
router.post('/categories/create', async (req,res)=>{
  const { shop, name, slug, order=0 } = req.body || {};
  await Category.create({ shop, name: (name||'').slice(0,60), slug: (slug||'').slice(0,80), order: Number(order)||0 });
  res.redirect('back');
});
router.post('/categories/:id/delete', async (req,res)=>{
  await Category.findByIdAndDelete(req.params.id);
  res.redirect('back');
});

// Reports
router.get('/reports', async (req,res)=>{
  const items = await Report.find({ status:'open' }).sort({ createdAt:-1 }).lean();
  res.render('reports', { items });
});
router.post('/reports/:id/resolve', async (req,res)=>{
  await Report.findByIdAndUpdate(req.params.id, { status:'resolved' });
  res.redirect('back');
});

// Polls (attach to threads)
router.get('/polls', async (req,res)=>{
  const items = await Poll.find({}).sort({ createdAt:-1 }).lean();
  res.render('polls', { items });
});
router.post('/polls/create', async (req, res) => {
  const { shop, threadId, question, options } = req.body || {};

  // Split by actual newlines safely (Windows, Mac, Linux)
  const parsed = (options || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
    .map((t, i) => ({ id: String(i + 1), text: t }));

  await Poll.create({
    shop,
    threadId,
    question: (question || '').slice(0, 160),
    options: parsed
  });

  res.redirect('back');
});

router.post('/polls/:id/close', async (req,res)=>{
  await Poll.findByIdAndUpdate(req.params.id, { status:'closed' });
  res.redirect('back');
});

export default router;
