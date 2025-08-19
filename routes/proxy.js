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
import { hotScore } from '../lib/hotScore.js';
import Notification from '../models/Notification.js';

const router = express.Router();

/* ---------------------------- Helpers ---------------------------------- */
function normalizeShop(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '') // drop scheme
    .replace(/\/.*$/, '')        // drop any path/trailing slash
    .trim();
}

// ✅ Allow safe inline HTML for headings, lists, links, images, etc.
const CLEAN_OPTS = {
  allowedTags: [
    'p', 'br', 'strong', 'em', 'b', 'i', 'u',
    'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'blockquote',
    'a', 'img',
    'code', 'pre'
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt']
  },
  allowedSchemes: ['http', 'https', 'mailto', 'data'],
  // strip everything else
  disallowedTagsMode: 'discard',
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }),
    img: (tagName, attribs) => {
      // Basic guard: allow only http(s)/data URIs
      const src = String(attribs.src || '');
      const ok = /^https?:\/\//i.test(src) || /^data:image\//i.test(src);
      return ok ? { tagName: 'img', attribs: { src, alt: attribs.alt || '' } } : { tagName: 'span' };
    }
  }
};

const clean = (s) => sanitizeHtml(s || '', CLEAN_OPTS).slice(0, 8000);

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

/* ---------------------------- Content rules ---------------------------- */
const BANNED = (process.env.BANNED_WORDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const MAX_LINKS = parseInt(process.env.MAX_LINKS_PER_POST || '5', 10);
const EDIT_MIN  = parseInt(process.env.AUTHOR_EDIT_WINDOW_MIN || '30', 10);

function tooManyLinks(text) {
  const m = (text || '').match(/https?:\/\/\S+/gi);
  return (m ? m.length : 0) > MAX_LINKS;
}

function violatesBanned(text) {
  const lower = (text || '').toLowerCase();
  return BANNED.some((w) => w && lower.includes(w.toLowerCase()));
}

/* --------------------------- Auth-ish helpers -------------------------- */
// App Proxy calls don’t carry admin auth; moderation stays in /admin.
// Author permission: author can edit/delete within window.
function authorCanModify(doc, customer_id) {
  if (!doc) return false;
  if (!customer_id) return false;
  if (String(doc?.author?.customerId || '') !== String(customer_id)) return false;
  if (!doc.editableUntil) return false;
  return new Date() <= new Date(doc.editableUntil);
}

/* ------------------------- Top period to window ------------------------ */
function periodToWindow(period) {
  const now = new Date();
  const map = { day: 1, week: 7, month: 30 };
  const days = map[period] || 3650;
  const from = new Date(now.getTime() - days * 86400000);
  return { from, to: now };
}

/* ---------------------------- App Proxy Auth --------------------------- */
router.use((req, res, next) => {
  const ok = verifyAppProxy(req, process.env.APP_PROXY_SHARED_SECRET);
  if (!ok) return res.status(401).json({ success: false, message: 'Invalid signature' });
  next();
});

// Normalize ?shop for every request
router.use((req, _res, next) => {
  if (req.query && typeof req.query.shop === 'string') {
    req.query.shop = normalizeShop(req.query.shop);
  }
  next();
});

/* -------------------------------- Categories --------------------------- */
router.get('/categories', async (req, res) => {
  const shop = req.query.shop;
  const items = await Category.find({ shop }).sort({ order: 1, name: 1 }).lean();
  res.json({ success: true, items });
});

/* -------------------------------- Threads ------------------------------ */
// List threads with filters, search, sort, pagination, periods & date range
router.get('/threads', async (req, res) => {
  const shop = req.query.shop;
  const { categoryId, tag, q, cursor, limit, sort, period, from, to } = req.query;
  if (!shop) return res.json({ success: false, message: 'shop required' });

  const lim = parseLimit(limit);

  // Base filters (approved only)
  const base = { shop, status: 'approved' };
  if (categoryId) base.categoryId = categoryId;
  if (tag) base.tags = tag; // explicit ?tag=
  if (cursor) base._id = { $lt: cursor };

  // CreatedAt window (from/to or top&period)
  const created = {};
  if (from) created.$gte = new Date(from);
  if (to)   created.$lte = new Date(to);
  if (created.$gte || created.$lte) base.createdAt = created;

  if (sort === 'top' && period) {
    const w = periodToWindow(period);
    base.createdAt = { ...(base.createdAt || {}), $gte: w.from, $lte: w.to };
  }

  // Parse q for tag/category tokens
  let textQuery = '';
  let tagsInQ = [];
  let catSlug = '';

  if (q && q.trim()) {
    q.trim().split(/\s+/).forEach(tok => {
      if (/^tag:/i.test(tok)) {
        const v = tok.slice(4).trim();
        if (v) tagsInQ.push(v.toLowerCase());
      } else if (tok.startsWith('#')) {
        const v = tok.slice(1).trim();
        if (v) tagsInQ.push(v.toLowerCase());
      } else if (/^cat:/i.test(tok)) {
        catSlug = tok.slice(4).trim().toLowerCase();
      } else {
        textQuery += (textQuery ? ' ' : '') + tok;
      }
    });
  }

  if (tagsInQ.length) {
    base.tags = { $all: tagsInQ };
  }

  if (catSlug) {
    const cat = await Category.findOne({ shop, slug: catSlug }).select('_id').lean();
    if (cat) base.categoryId = String(cat._id);
    else return res.json({ success: true, items: [], next: null }); // unknown slug
  }

  const isTextSearch = !!textQuery;
  const query       = isTextSearch ? { ...base, $text: { $search: textQuery } } : base;
  const projection  = isTextSearch ? { score: { $meta: 'textScore' } } : undefined;

  let ordering = sortMap(sort);
  if (isTextSearch) ordering = { score: { $meta: 'textScore' } };

  const items = await Thread.find(query, projection).sort(ordering).limit(lim).lean();
  const next  = items.length === lim ? String(items[items.length - 1]._id) : null;

  res.json({ success: true, items, next });
});

// Create thread (pending unless AUTO_APPROVE=true) + filters + editable window + hot
router.post('/threads', async (req, res) => {
  const shop = req.query.shop;
  const { title, body, categoryId, tags = [], isAnonymous = false, customer_id, display_name } = req.body || {};
  if (!shop)  return res.json({ success: false, message: 'shop required' });
  if (!title) return res.json({ success: false, message: 'Title required' });

  const cleanBody = clean(body);

  if (violatesBanned(`${title} ${cleanBody}`))
    return res.json({ success: false, message: 'Content contains banned terms' });
  if (tooManyLinks(cleanBody))
    return res.json({ success: false, message: `Too many links (max ${MAX_LINKS})` });

  const now = new Date();
  const editableUntil = customer_id ? new Date(now.getTime() + EDIT_MIN * 60000) : null;

  const t = await Thread.create({
    shop,
    title: String(title).slice(0, 180),
    body: cleanBody,
    categoryId: categoryId || null,
    tags: Array.isArray(tags) ? tags.slice(0, 10).map((s) => String(s).slice(0, 30)) : [],
    author: {
      customerId: customer_id || null,
      isAnonymous: !!isAnonymous,
      displayName: display_name || '',
    },
    status: process.env.AUTO_APPROVE === 'true' ? 'approved' : 'pending',
    locked: false,
    closed: false,
    editableUntil,
    hot: hotScore(0, now),
  });

  res.json({
    success: true,
    id: t._id,
    message: t.status === 'approved' ? 'Posted' : 'Submitted for review',
  });
});

/* -------------------------------- Comments ----------------------------- */
// Create comment (supports threading up to depth 3) + filters + editable window
router.post('/comments', async (req, res) => {
  const shop = req.query.shop;
  const { threadId, body, isAnonymous = false, parentId = null, customer_id, display_name } = req.body || {};
  if (!shop) return res.json({ success: false, message: 'shop required' });
  if (!threadId || !body) return res.json({ success: false, message: 'Missing fields' });

  const thread = await Thread.findById(threadId).lean();
  if (!thread) return res.json({ success: false, message: 'Thread not found' });

  // ✅ TC-033: enforce both locked & closed
  if (thread.locked || thread.closed) {
    return res.json({ success: false, message: 'Thread closed for new comments' });
  }

  let depth = 0;
  if (parentId) {
    const parent = await Comment.findById(parentId).lean();
    if (!parent) return res.json({ success: false, message: 'Parent not found' });
    depth = Math.min(3, (parent.depth || 0) + 1);
    if (depth > 3) return res.json({ success: false, message: 'Max reply depth reached' });
  }

  const cleanBody = clean(body);
  if (violatesBanned(cleanBody))
    return res.json({ success: false, message: 'Content contains banned terms' });
  if (tooManyLinks(cleanBody))
    return res.json({ success: false, message: `Too many links (max ${MAX_LINKS})` });

  const now = new Date();
  const editableUntil = customer_id ? new Date(now.getTime() + EDIT_MIN * 60000) : null;

  const c = await Comment.create({
    shop,
    threadId,
    parentId,
    depth,
    body: cleanBody,
    author: { customerId: customer_id || null, isAnonymous: !!isAnonymous, displayName: display_name || '' },
    status: process.env.AUTO_APPROVE === 'true' ? 'approved' : 'pending',
    locked: false,
    editableUntil,
    votes: 0,
  });

  if (c.status === 'approved') {
    await Thread.updateOne({ _id: threadId }, { $inc: { commentsCount: 1 } });
    // minimal notification to thread author (if present and not same as commenter)
    if (thread.author?.customerId && String(thread.author.customerId) !== String(customer_id || '')) {
      await Notification.create({
        shop,
        userId: String(thread.author.customerId),
        type: 'reply',
        targetType: 'thread',
        targetId: String(threadId),
      });
    }
  }

  res.json({
    success: true,
    id: c._id,
    message: c.status === 'approved' ? 'Posted' : 'Submitted for review',
  });
});

// Get comments as a threaded tree
router.get('/comments', async (req, res) => {
  const shop = req.query.shop;
  const { threadId } = req.query;
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

/* --------------------------- Author edit / delete ----------------------- */
router.patch('/threads/:id', async (req, res) => {
  const shop = req.query.shop;
  const { id } = req.params;
  const { title, body, customer_id } = req.body || {};
  if (!shop || !customer_id) return res.json({ success: false, message: 'shop and customer_id required' });
  const t = await Thread.findById(id);
  if (!t || t.shop !== shop) return res.json({ success: false, message: 'Not found' });
  if (!authorCanModify(t, customer_id)) return res.json({ success: false, message: 'Edit window expired' });

  if (title) t.title = String(title).slice(0, 180);
  if (body)  t.body  = clean(body);
  await t.save();
  res.json({ success: true });
});

router.delete('/threads/:id', async (req, res) => {
  const shop = req.query.shop;
  const { id } = req.params;
  const { customer_id } = req.body || {};
  if (!shop || !customer_id) return res.json({ success: false, message: 'shop and customer_id required' });
  const t = await Thread.findById(id);
  if (!t || t.shop !== shop) return res.json({ success: false, message: 'Not found' });
  if (!authorCanModify(t, customer_id)) return res.json({ success: false, message: 'Delete window expired' });

  await t.deleteOne();
  res.json({ success: true });
});

router.patch('/comments/:id', async (req, res) => {
  const shop = req.query.shop;
  const { id } = req.params;
  const { body, customer_id } = req.body || {};
  if (!shop || !customer_id || !body) return res.json({ success: false, message: 'missing fields' });
  const c = await Comment.findById(id);
  if (!c || c.shop !== shop) return res.json({ success: false, message: 'Not found' });
  if (!authorCanModify(c, customer_id)) return res.json({ success: false, message: 'Edit window expired' });

  c.body = clean(body);
  await c.save();
  res.json({ success: true });
});

router.delete('/comments/:id', async (req, res) => {
  const shop = req.query.shop;
  const { id } = req.params;
  const { customer_id } = req.body || {};
  if (!shop || !customer_id) return res.json({ success: false, message: 'missing fields' });
  const c = await Comment.findById(id);
  if (!c || c.shop !== shop) return res.json({ success: false, message: 'Not found' });
  if (!authorCanModify(c, customer_id)) return res.json({ success: false, message: 'Delete window expired' });

  // hard-delete author’s own comment; storefront counts corrected by admin delete route
  await c.deleteOne();
  res.json({ success: true });
});

/* -------------------------------- Votes -------------------------------- */
// Toggle upvote for thread/comment (one per user; reversible) + refresh hot
router.post('/votes/toggle', async (req, res) => {
  const shop = req.query.shop;
  const { targetType, targetId, customer_id, fingerprint } = req.body || {};
  if (!shop) return res.json({ success: false, message: 'shop required' });
  if (!targetType || !targetId) return res.json({ success: false, message: 'Missing fields' });

  const key = { shop, targetType, targetId, customerId: customer_id || null, fingerprint: fingerprint || '' };
  const existing = await Vote.findOne(key);

  const adjust = async (delta) => {
    if (targetType === 'thread') {
      const t = await Thread.findByIdAndUpdate(targetId, { $inc: { votes: delta } }, { new: true });
      if (t) {
        t.hot = hotScore((t.votes || 0), t.createdAt);
        await t.save();
      }
    } else {
      await Comment.updateOne({ _id: targetId }, { $inc: { votes: delta } });
    }
  };

  if (existing) {
    await existing.deleteOne();
    await adjust(-1);
    return res.json({ success: true, voted: false });
  }

  try {
    await Vote.create(key);
    await adjust(1);
    return res.json({ success: true, voted: true });
  } catch {
    // Unique index race; treat as voted
    return res.json({ success: true, voted: true });
  }
});

/* -------------------------------- Reports ------------------------------ */
router.post('/reports', async (req, res) => {
  const shop = req.query.shop;
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
  const shop = normalizeShop(req.query.shop);
  const {
    threadId,
    question,
    options = [], // array of strings
    multipleAllowed = false,
    anonymous = true,
    startAt = null,
    endAt = null,
    showResults = 'afterVote', // 'always' | 'afterVote' | 'afterClose'
  } = req.body || {};

  if (!shop) return res.json({ success: false, message: 'shop required' });
  if (!threadId || !question || !Array.isArray(options) || options.length < 2) {
    return res.json({ success: false, message: 'threadId, question and at least 2 options required' });
  }

  const poll = await Poll.create({
    shop, // normalized
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
  const shop = normalizeShop(req.query.shop);
  const { threadId } = req.params;
  const { viewerHasVoted } = req.query;
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
  const shop = normalizeShop(req.query.shop);
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

/* ------------------------------ Search --------------------------------- */
// Search comments (full-text)
router.get('/comments/search', async (req, res) => {
  const shop = req.query.shop;
  const { q, threadId, limit } = req.query;
  if (!shop || !q) return res.json({ success: false, message: 'shop and q required' });

  const lim = parseLimit(limit);
  const base = { shop, status: 'approved' };
  if (threadId) base.threadId = threadId;

  const items = await Comment.find({ ...base, $text: { $search: q } }, { score: { $meta: 'textScore' } })
    .sort({ score: { $meta: 'textScore' } })
    .limit(lim)
    .lean();

  res.json({ success: true, items });
});

// Typeahead suggestions (titles + tags + categories)
router.get('/suggest', async (req, res) => {
  const shop = req.query.shop;
  const { q } = req.query;
  if (!shop || !q) return res.json({ success: false, message: 'shop and q required' });

  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  const titles = await Thread.find({ shop, status: 'approved', title: re })
    .select('title')
    .limit(5)
    .lean();

  const tagsAgg = await Thread.aggregate([
    { $match: { shop, status: 'approved', tags: { $exists: true, $ne: [] } } },
    { $unwind: '$tags' },
    { $match: { tags: re } },
    { $group: { _id: '$tags', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: 5 },
  ]);

  const cats = await Category.find({ shop, $or: [{ name: re }, { slug: re }] })
    .select('name slug')
    .limit(5)
    .lean();

  res.json({ success: true, titles, tags: tagsAgg.map((t) => t._id), categories: cats });
});

/* -------------------------------- Misc --------------------------------- */
router.get('/ping', (_req, res) => res.json({ ok: true }));

export default router;
