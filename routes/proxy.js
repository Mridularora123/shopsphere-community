import express from 'express';
import sanitizeHtml from 'sanitize-html';
import { verifyAppProxy } from '../lib/appProxyVerify.js';
import Thread from '../models/Thread.js';
import Comment from '../models/Comment.js';
import Category from '../models/Category.js';
import Poll from '../models/Poll.js';
import Vote from '../models/Vote.js';
import Report from '../models/Report.js';

const router = express.Router();

router.use((req,res,next)=>{
  const ok = verifyAppProxy(req, process.env.APP_PROXY_SHARED_SECRET);
  if (!ok) return res.status(401).json({ success:false, message:'Invalid signature' });
  next();
});

// Helper
const clean = (s)=>sanitizeHtml(s||'', { allowedTags: [], allowedAttributes: {} }).slice(0, 8000);

// List categories
router.get('/categories', async (req,res)=>{
  const { shop } = req.query;
  const items = await Category.find({ shop }).sort({ order:1, name:1 }).lean();
  res.json({ success:true, items });
});

// List threads
router.get('/threads', async (req,res)=>{
  const { shop, categoryId } = req.query;
  const q = { shop, status:'approved' };
  if (categoryId) q.categoryId = categoryId;
  const items = await Thread.find(q).sort({ pinned:-1, createdAt:-1 }).limit(100).lean();
  res.json({ success:true, items });
});

// Create thread
router.post('/threads', async (req,res)=>{
  const { shop } = req.query;
  const { title, body, categoryId, tags = [], isAnonymous=false, customer_id, display_name } = req.body || {};
  if (!title) return res.json({ success:false, message:'Title required' });
  const t = await Thread.create({
    shop,
    title: String(title).slice(0,180),
    body: clean(body),
    categoryId: categoryId || null,
    tags: Array.isArray(tags) ? tags.slice(0,10).map(s=>String(s).slice(0,30)) : [],
    author: { customerId: customer_id || null, isAnonymous: !!isAnonymous, displayName: display_name || '' },
    status: (process.env.AUTO_APPROVE === 'true') ? 'approved' : 'pending'
  });
  res.json({ success:true, id:t._id, message: t.status==='approved' ? 'Posted' : 'Submitted for review' });
});

// Comments
router.get('/comments', async (req,res)=>{
  const { shop, threadId } = req.query;
  const items = await Comment.find({ shop, threadId, status:'approved' }).sort({ createdAt:1 }).lean();
  res.json({ success:true, items });
});

router.post('/comments', async (req,res)=>{
  const { shop } = req.query;
  const { threadId, body, isAnonymous=false, parentId=null, customer_id, display_name } = req.body || {};
  if (!threadId || !body) return res.json({ success:false, message:'Missing fields' });
  const c = await Comment.create({
    shop, threadId, parentId,
    body: clean(body),
    author: { customerId: customer_id || null, isAnonymous: !!isAnonymous, displayName: display_name || '' },
    status: (process.env.AUTO_APPROVE === 'true') ? 'approved' : 'pending'
  });
  if (c.status === 'approved'){
    await Thread.findByIdAndUpdate(threadId, { $inc: { commentsCount: 1 } });
  }
  res.json({ success:true, id:c._id, message: c.status==='approved' ? 'Posted' : 'Submitted for review' });
});

// Votes
router.post('/votes', async (req,res)=>{
  const { shop } = req.query;
  const { targetType, targetId, customer_id, fingerprint } = req.body || {};
  if (!targetType || !targetId) return res.json({ success:false, message:'Missing fields' });
  try{
    await Vote.create({ shop, targetType, targetId, customerId: customer_id || null, fingerprint: fingerprint || '' });
    if (targetType === 'thread'){
      await Thread.findByIdAndUpdate(targetId, { $inc: { votes: 1 } });
    } else {
      await Comment.findByIdAndUpdate(targetId, { $inc: { votes: 1 } });
    }
    res.json({ success:true });
  }catch(e){
    res.json({ success:false, message:'Already voted' });
  }
});

// Reports
router.post('/reports', async (req,res)=>{
  const { shop } = req.query;
  const { targetType, targetId, reason, customer_id, isAnonymous=false } = req.body || {};
  if (!targetType || !targetId || !reason) return res.json({ success:false, message:'Missing fields' });
  await Report.create({ shop, targetType, targetId, reason: clean(reason), createdBy: { customerId: customer_id || null, isAnonymous } });
  res.json({ success:true });
});

// Polls
router.get('/polls/:threadId', async (req,res)=>{
  const { shop } = req.query;
  const { threadId } = req.params;
  const poll = await (await import('../models/Poll.js')).default.findOne({ shop, threadId }).lean();
  res.json({ success:true, poll });
});

router.post('/polls/:threadId/vote', async (req,res)=>{
  const { shop } = req.query;
  const { threadId } = req.params;
  const { optionId } = req.body || {};
  const Poll = (await import('../models/Poll.js')).default;
  const poll = await Poll.findOne({ shop, threadId });
  if (!poll || poll.status !== 'open') return res.json({ success:false, message:'Poll closed' });
  const opt = poll.options.find(o=>o.id===optionId);
  if (!opt) return res.json({ success:false, message:'Invalid option' });
  opt.votes += 1;
  await poll.save();
  res.json({ success:true });
});

router.get('/ping', (req, res) => res.json({ ok: true }));

export default router;
