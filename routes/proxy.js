// routes/proxy.js (final)
import express from 'express';
import sanitizeHtml from 'sanitize-html';
// NOTE: server.js already verifies the proxy signature globally for /proxy/*
// If you still want a second check, you can keep verifyAppProxy here.
// import { verifyAppProxy } from '../lib/appProxyVerify.js';

import Thread from '../models/Thread.js';
import Comment from '../models/Comment.js';
import Category from '../models/Category.js';
import Poll from '../models/Poll.js';
import Vote from '../models/Vote.js';
import Report from '../models/Report.js';

const router = express.Router();

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

// Pull shop domain from server middleware (req.shopDomain), or query/header.
const getShop = (req) =>
  req.shopDomain ||
  req.query.shop ||
  req.headers['x-shopify-shop-domain'] ||
  '';

const clean = (s) =>
  sanitizeHtml(s || '', { allowedTags: [], allowedAttributes: {} }).slice(0, 8000);

// If you *really* want to verify again at router level, uncomment:
// router.use((req, res, next) => {
//   const ok = verifyAppProxy(req, process.env.SHOPIFY_SHARED_SECRET);
//   if (!ok) return res.status(401).json({ success: false, message: 'Invalid signature' });
//   next();
// });

/* ------------------------------------------------------------------ */
/* Categories                                                         */
/* ------------------------------------------------------------------ */

// GET /apps/community/api/categories  →  forwarded to  /proxy/api/categories
router.get('/api/categories', async (req, res) => {
  try {
    const shop = getShop(req);
    if (!shop) return res.status(400).json({ success: false, message: 'Missing shop' });

    // Your Category model uses fields: { shop, name, order, ... }
    const items = await Category.find({ shop }).sort({ order: 1, name: 1 }).lean();
    return res.json({ success: true, items });
  } catch (e) {
    console.error('GET /api/categories error:', e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/* ------------------------------------------------------------------ */
/* Threads                                                            */
/* ------------------------------------------------------------------ */

// GET /apps/community/api/threads → /proxy/api/threads
router.get('/api/threads', async (req, res) => {
  try {
    const shop = getShop(req);
    if (!shop) return res.status(400).json({ success: false, message: 'Missing shop' });

    const { categoryId } = req.query;
    const q = { shop, status: 'approved' };
    if (categoryId) q.categoryId = categoryId;

    const items = await Thread.find(q)
      .sort({ pinned: -1, createdAt: -1 })
      .limit(100)
      .lean();

    return res.json({ success: true, items });
  } catch (e) {
    console.error('GET /api/threads error:', e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /apps/community/api/threads → /proxy/api/threads
router.post('/api/threads', async (req, res) => {
  try {
    const shop = getShop(req);
    if (!shop) return res.status(400).json({ success: false, message: 'Missing shop' });

    const {
      title,
      body,
      categoryId,
      tags = [],
      isAnonymous = false,
      customer_id,
      display_name,
    } = req.body || {};

    if (!title) return res.json({ success: false, message: 'Title required' });

    const t = await Thread.create({
      shop,
      title: String(title).slice(0, 180),
      body: clean(body),
      categoryId: categoryId || null,
      tags: Array.isArray(tags) ? tags.slice(0, 10).map((s) => String(s).slice(0, 30)) : [],
      author: {
        customerId: customer_id || null,
        isAnonymous: !!isAnonymous,
        displayName: display_name || '',
      },
      status: process.env.AUTO_APPROVE === 'true' ? 'approved' : 'pending',
    });

    return res.json({
      success: true,
      id: t._id,
      message: t.status === 'approved' ? 'Posted' : 'Submitted for review',
    });
  } catch (e) {
    console.error('POST /api/threads error:', e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/* ------------------------------------------------------------------ */
/* Comments                                                           */
/* ------------------------------------------------------------------ */

router.get('/api/comments', async (req, res) => {
  try {
    const shop = getShop(req);
    const { threadId } = req.query;
    if (!shop || !threadId) {
      return res.status(400).json({ success: false, message: 'Missing shop or threadId' });
    }

    const items = await Comment.find({ shop, threadId, status: 'approved' })
      .sort({ createdAt: 1 })
      .lean();

    return res.json({ success: true, items });
  } catch (e) {
    console.error('GET /api/comments error:', e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/api/comments', async (req, res) => {
  try {
    const shop = getShop(req);
    if (!shop) return res.status(400).json({ success: false, message: 'Missing shop' });

    const {
      threadId,
      body,
      isAnonymous = false,
      parentId = null,
      customer_id,
      display_name,
    } = req.body || {};

    if (!threadId || !body) {
      return res.json({ success: false, message: 'Missing fields' });
    }

    const c = await Comment.create({
      shop,
      threadId,
      parentId,
      body: clean(body),
      author: {
        customerId: customer_id || null,
        isAnonymous: !!isAnonymous,
        displayName: display_name || '',
      },
      status: process.env.AUTO_APPROVE === 'true' ? 'approved' : 'pending',
    });

    if (c.status === 'approved') {
      await Thread.findByIdAndUpdate(threadId, { $inc: { commentsCount: 1 } });
    }

    return res.json({
      success: true,
      id: c._id,
      message: c.status === 'approved' ? 'Posted' : 'Submitted for review',
    });
  } catch (e) {
    console.error('POST /api/comments error:', e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/* ------------------------------------------------------------------ */
/* Votes                                                              */
/* ------------------------------------------------------------------ */

router.post('/api/votes', async (req, res) => {
  try {
    const shop = getShop(req);
    if (!shop) return res.status(400).json({ success: false, message: 'Missing shop' });

    const { targetType, targetId, customer_id, fingerprint } = req.body || {};
    if (!targetType || !targetId) {
      return res.json({ success: false, message: 'Missing fields' });
    }

    try {
      await Vote.create({
        shop,
        targetType,
        targetId,
        customerId: customer_id || null,
        fingerprint: fingerprint || '',
      });

      if (targetType === 'thread') {
        await Thread.findByIdAndUpdate(targetId, { $inc: { votes: 1 } });
      } else {
        await Comment.findByIdAndUpdate(targetId, { $inc: { votes: 1 } });
      }

      return res.json({ success: true });
    } catch (_dup) {
      return res.json({ success: false, message: 'Already voted' });
    }
  } catch (e) {
    console.error('POST /api/votes error:', e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/* ------------------------------------------------------------------ */
/* Reports                                                            */
/* ------------------------------------------------------------------ */

router.post('/api/reports', async (req, res) => {
  try {
    const shop = getShop(req);
    if (!shop) return res.status(400).json({ success: false, message: 'Missing shop' });

    const { targetType, targetId, reason, customer_id, isAnonymous = false } = req.body || {};
    if (!targetType || !targetId || !reason) {
      return res.json({ success: false, message: 'Missing fields' });
    }

    await Report.create({
      shop,
      targetType,
      targetId,
      reason: clean(reason),
      createdBy: { customerId: customer_id || null, isAnonymous },
    });

    return res.json({ success: true });
  } catch (e) {
    console.error('POST /api/reports error:', e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/* ------------------------------------------------------------------ */
/* Polls                                                              */
/* ------------------------------------------------------------------ */

// GET poll for a thread
router.get('/api/polls/:threadId', async (req, res) => {
  try {
    const shop = getShop(req);
    const { threadId } = req.params;
    if (!shop || !threadId) {
      return res.status(400).json({ success: false, message: 'Missing shop or threadId' });
    }
    const poll = await Poll.findOne({ shop, threadId }).lean();
    return res.json({ success: true, poll });
  } catch (e) {
    console.error('GET /api/polls/:threadId error:', e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Vote on a poll option
router.post('/api/polls/:threadId/vote', async (req, res) => {
  try {
    const shop = getShop(req);
    const { threadId } = req.params;
    const { optionId } = req.body || {};
    if (!shop || !threadId || !optionId) {
      return res.status(400).json({ success: false, message: 'Missing fields' });
    }

    const poll = await Poll.findOne({ shop, threadId });
    if (!poll || poll.status !== 'open') {
      return res.json({ success: false, message: 'Poll closed' });
    }
    const opt = poll.options.find((o) => o.id === optionId);
    if (!opt) return res.json({ success: false, message: 'Invalid option' });

    opt.votes += 1;
    await poll.save();

    return res.json({ success: true });
  } catch (e) {
    console.error('POST /api/polls/:threadId/vote error:', e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/* ------------------------------------------------------------------ */

router.get('/api/ping', (_req, res) => res.json({ ok: true }));

export default router;
