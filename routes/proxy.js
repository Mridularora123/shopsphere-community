// routes/proxy.js
import express from 'express';
import sanitizeHtml from 'sanitize-html';
import { verifyAppProxy } from '../lib/appProxyVerify.js';

import Thread from '../models/Thread.js';
import Comment from '../models/Comment.js';
import Category from '../models/Category.js';
import Poll from '../models/Poll.js';
import PollVoter from '../models/PollVoter.js';
import Vote from '../models/Vote.js';
import Report from '../models/Report.js';

const router = express.Router();

/* ---------------------------- App Proxy Auth ---------------------------- */
router.use((req, res, next) => {
  const ok = verifyAppProxy(req, process.env.APP_PROXY_SHARED_SECRET);
  if (!ok) return res.status(401).json({ success: false, message: 'Invalid signature' });
  next();
});

/* ---------------------------- Helper functions -------------------------- */
const clean = (s) =>
  sanitizeHtml(s || '', { allowedTags: [], allowedAttributes: {} }).slice(0, 8000);

const parseLimit = (v) => Math.min(100, Math.max(1, parseInt(v || '20', 10)));

const sortMap = (s) => {
  switch (s) {
    case 'top':
      return { votes: -1, createdAt: -1 };
    case 'discussed':
      return { commentsCount: -1, createdAt: -1 };
    case 'hot':
      return { hot: -1, createdAt: -1 };
    default:
      return { pinned: -1, createdAt: -1 }; // "new"
  }
};

/* -------------------------------- Categories --------------------------- */
router.get('/categories', async (req, res) => {
  const { shop } = req.query;
  const items = await Category.find({ shop }).sort({ order: 1, name: 1 }).lean();
  res.json({ success: true, items });
});

/* -------------------------------- Threads ------------------------------ */
// List threads with filters, search, sort, pagination
router.get('/threads', async (req, res) => {
  const { shop, categoryId, tag, q, cursor, limit, sort } = req.query;
  if (!shop) return res.json({ success: false, message: 'shop required' });

  const lim = parseLimit(limit);
  const base = { shop, status: 'approved' };
  if (categoryId) base.categoryId = categoryId;
  if (tag) base.tags = tag;
  if (cursor) base._id = { $lt: cursor };

  const isSearch = !!q;
  const query = isSearch ? { ...base, $text: { $search: q } } : base;
  const projection = isSearch ? { score: { $meta: 'textScore' } } : undefined;
  const ordering = isSearch ? { score: { $meta: 'textScore' } } : sortMap(sort);

  const items = await Thread.find(query, projection).sort(ordering).limit(lim).lean();
  const next = items.length === lim ? String(items[items.length - 1]._id) : null;

  res.json({ success: true, items, next });
});

// Create thread (pending unless AUTO_APPROVE=true)
router.post('/threads', async (req, res) => {
  const { shop } = req.query;
  const { title, body, categoryId, tags = [], isAnonymous = false, customer_id, display_name } = req.body || {};
  if (!shop) return res.json({ success: false, message: 'shop required' });
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
    locked: false,
  });

  res.json({
    success: true,
    id: t._id,
    message: t.status === 'approved' ? 'Posted' : 'Submitted for review',
  });
});

/* -------------------------------- Comments ----------------------------- */
// Create comment (supports threading up to depth 3)
router.post('/comments', async (req, res) => {
  const { shop } = req.query;
  const { threadId, body, isAnonymous = false, parentId = null, customer_id, display_name } = req.body || {};
  if (!shop) return res.json({ success: false, message: 'shop required' });
  if (!threadId || !body) return res.json({ success: false, message: 'Missing fields' });

  let depth = 0;
  if (parentId) {
    const parent = await Comment.findById(parentId).lean();
    if (!parent) return res.json({ success: false, message: 'Parent not found' });
    depth = Math.min(3, (parent.depth || 0) + 1);
    if (depth > 3) return res.json({ success: false, message: 'Max reply depth reached' });
  }

  const c = await Comment.create({
    shop,
    threadId,
    parentId,
    depth,
    body: clean(body),
    author: { customerId: customer_id || null, isAnonymous: !!isAnonymous, displayName: display_name || '' },
    status: process.env.AUTO_APPROVE === 'true' ? 'approved' : 'pending',
    locked: false,
  });

  if (c.status === 'approved') {
    await Thread.updateOne({ _id: threadId }, { $inc: { commentsCount: 1 } });
  }

  res.json({
    success: true,
    id: c._id,
    message: c.status === 'approved' ? 'Posted' : 'Submitted for review',
  });
});

// Get comments as a threaded tree
router.get('/comments', async (req, res) => {
  const { shop, threadId } = req.query;
  if (!shop || !threadId) return res.json({ success: false, message: 'shop and threadId required' });

  const flat = await Comment.find({ shop, threadId, status: 'approved' }).sort({ createdAt: 1 }).lean();
  const byId = new Map(flat.map((c) => [String(c._id), { ...c, children: [] }]));
  const roots = [];

  for (const c of byId.values()) {
    if (c.parentId && byId.get(String(c.parentId))) {
      byId.get(String(c.parentId)).children.push(c);
    } else {
      roots.push(c);
    }
  }

  res.json({ success: true, items: roots });
});

/* -------------------------------- Votes -------------------------------- */
// Toggle upvote for thread/comment (one per user; reversible)
router.post('/votes/toggle', async (req, res) => {
  const { shop } = req.query;
  const { targetType, targetId, customer_id, fingerprint } = req.body || {};
  if (!shop) return res.json({ success: false, message: 'shop required' });
  if (!targetType || !targetId) return res.json({ success: false, message: 'Missing fields' });

  const key = { shop, targetType, targetId, customerId: customer_id || null, fingerprint: fingerprint || '' };
  const existing = await Vote.findOne(key);

  if (existing) {
    await existing.deleteOne();
    if (targetType === 'thread') await Thread.updateOne({ _id: targetId }, { $inc: { votes: -1 } });
    else await Comment.updateOne({ _id: targetId }, { $inc: { votes: -1 } });
    return res.json({ success: true, voted: false });
  }

  try {
    await Vote.create(key);
    if (targetType === 'thread') await Thread.updateOne({ _id: targetId }, { $inc: { votes: 1 } });
    else await Comment.updateOne({ _id: targetId }, { $inc: { votes: 1 } });
    return res.json({ success: true, voted: true });
  } catch {
    // Unique index race; treat as voted
    return res.json({ success: true, voted: true });
  }
});

/* -------------------------------- Reports ------------------------------ */
router.post('/reports', async (req, res) => {
  const { shop } = req.query;
  const { targetType, targetId, reason, customer_id, isAnonymous = false } = req.body || {};
  if (!shop) return res.json({ success: false, message: 'shop required' });
  if (!targetType || !targetId || !reason) return res.json({ success: false, message: 'Missing fields' });

  await Report.create({
    shop,
    targetType,
    targetId,
    reason: clean(reason),
    createdBy: { customerId: customer_id || null, isAnonymous },
  });

  res.json({ success: true });
});

/* -------------------------------- Polls -------------------------------- */
// Create a poll (use from admin/mod UI)
router.post('/polls', async (req, res) => {
  const { shop } = req.query;
  const {
    threadId,
    question,
    options = [],                 // array of strings
    multipleAllowed = false,
    anonymous = true,
    startAt = null,
    endAt = null,
    showResults = 'afterVote',    // 'always' | 'afterVote' | 'afterClose'
  } = req.body || {};

  if (!shop) return res.json({ success: false, message: 'shop required' });
  if (!threadId || !question || !Array.isArray(options) || options.length < 2) {
    return res.json({ success: false, message: 'threadId, question and at least 2 options required' });
  }

  const poll = await Poll.create({
    shop,
    threadId,
    question: clean(question),
    options: options.map((t, i) => ({ id: String(i + 1), text: clean(t), votes: 0 })),
    multipleAllowed: !!multipleAllowed,
    anonymous: !!anonymous,
    startAt: startAt ? new Date(startAt) : null,
    endAt: endAt ? new Date(endAt) : null,
    showResults,
    status: 'open',
  });

  res.json({ success: true, pollId: poll._id });
});

// Get a poll (respect results visibility)
router.get('/polls/:threadId', async (req, res) => {
  const { shop, viewerHasVoted } = req.query;
  const { threadId } = req.params;
  if (!shop) return res.json({ success: false, message: 'shop required' });

  const poll = await Poll.findOne({ shop, threadId }).lean();
  if (!poll) return res.json({ success: true, poll: null });

  const now = new Date();
  const canShow =
    poll.showResults === 'always' ||
    (poll.showResults === 'afterVote' && viewerHasVoted === 'true') ||
    (poll.endAt && now > new Date(poll.endAt)) ||
    poll.status === 'closed';

  const payload = canShow
    ? poll
    : { ...poll, options: poll.options.map((o) => ({ id: o.id, text: o.text })) };

  res.json({ success: true, poll: payload });
});

// Vote on a poll (supports multiple-choice; idempotent per user)
router.post('/polls/:threadId/vote', async (req, res) => {
  const { shop } = req.query;
  const { threadId } = req.params;
  const { optionIds = [], customer_id, fingerprint } = req.body || {};

  if (!shop) return res.json({ success: false, message: 'shop required' });

  const poll = await Poll.findOne({ shop, threadId });
  if (!poll) return res.json({ success: false, message: 'Poll not found' });
  if (poll.status !== 'open') return res.json({ success: false, message: 'Poll closed' });

  const now = new Date();
  if (poll.startAt && now < poll.startAt) return res.json({ success: false, message: 'Not started' });
  if (poll.endAt && now > poll.endAt) return res.json({ success: false, message: 'Ended' });

  const chosen = Array.isArray(optionIds) ? optionIds : [optionIds];
  if (!poll.multipleAllowed && chosen.length > 1) {
    return res.json({ success: false, message: 'Single-choice poll' });
  }

  const userKey = customer_id || fingerprint || 'anon';
  const voterKey = { pollId: poll._id, userKey };

  // revert previous votes if any (allows "change vote")
  const prev = await PollVoter.findOne(voterKey);
  if (prev) {
    for (const id of prev.optionIds) {
      const opt = poll.options.find((o) => o.id === id);
      if (opt) opt.votes = Math.max(0, (opt.votes || 0) - 1);
    }
  }

  // apply new votes
  for (const id of chosen) {
    const opt = poll.options.find((o) => o.id === id);
    if (!opt) return res.json({ success: false, message: 'Invalid option' });
    opt.votes = (opt.votes || 0) + 1;
  }

  await poll.save();
  await PollVoter.updateOne(voterKey, { $set: { optionIds: chosen, votedAt: new Date() } }, { upsert: true });

  res.json({ success: true });
});

/* -------------------------------- Misc --------------------------------- */
router.get('/ping', (_req, res) => res.json({ ok: true }));

export default router;
