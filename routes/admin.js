// routes/admin.js
import express from 'express';
import basicAuth from 'express-basic-auth';
import sanitizeHtml from 'sanitize-html';

import Thread from '../models/Thread.js';
import Comment from '../models/Comment.js';
import Category from '../models/Category.js';
import Poll from '../models/Poll.js';
import Report from '../models/Report.js';
import Vote from '../models/Vote.js';
import Notification from '../models/Notification.js';

const router = express.Router();

// Parse form posts from admin pages
router.use(express.urlencoded({ extended: true }));

/* ---------- Auth (username=admin, password from ADMIN_PASSWORD) ---------- */
if (!process.env.ADMIN_PASSWORD) {
  console.warn('ADMIN_PASSWORD is not set. /admin will use a weak default.');
}
router.use(
  basicAuth({
    users: { admin: process.env.ADMIN_PASSWORD || 'admin' },
    challenge: true,
    unauthorizedResponse: () => 'Auth required',
    realm: 'shopsphere-admin',
  })
);

/* ---------------------- helpers: sanitize / render / redirect ------------ */
const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function renderOrFallback(res, view, data, fallbackHTML) {
  res.render(view, data, (err, html) => {
    if (err) {
      res.type('html').send(fallbackHTML);
    } else {
      res.send(html);
    }
  });
}

/**
 * Safe redirect back for Shopify embedded apps.
 * Tries to send the user back to a path inside *this app*.
 * If referrer is missing or points elsewhere, falls back to a provided path.
 * Always uses 303 to turn POST into GET.
 */
function backTo(req, res, fallbackPath = '/admin') {
  const ref = req.get('referer') || req.get('referrer') || '';
  try {
    const u = new URL(ref);
    // Only allow redirecting back to our own app paths (mounted at /admin)
    if (u.pathname.startsWith('/admin')) {
      return res.redirect(303, u.pathname + u.search);
    }
  } catch (_) {
    // ignore parse errors
  }
  return res.redirect(303, fallbackPath);
}

/* --------------------- zero-dep CSV export helpers ----------------------- */
function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}
function flattenDoc(doc, prefix = '', out = {}) {
  const obj = doc && typeof doc.toObject === 'function' ? doc.toObject() : doc;
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v == null) {
      out[key] = '';
    } else if (v instanceof Date) {
      out[key] = v.toISOString();
    } else if (isPlainObject(v)) {
      flattenDoc(v, key, out);
    } else if (Array.isArray(v)) {
      out[key] = v
        .map((x) =>
          isPlainObject(x) ? JSON.stringify(x) : x instanceof Date ? x.toISOString() : String(x)
        )
        .join('|');
    } else {
      out[key] = String(v);
    }
  }
  return out;
}
function toCSV(docs) {
  const rows = (docs || []).map((d) => flattenDoc(d));
  const headers = Array.from(
    rows.reduce((set, r) => {
      Object.keys(r).forEach((k) => set.add(k));
      return set;
    }, new Set())
  );
  const escCsv = (val) => {
    const s = val == null ? '' : String(val);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [];
  lines.push(headers.map(escCsv).join(','));
  for (const r of rows) lines.push(headers.map((h) => escCsv(r[h] ?? '')).join(','));
  return lines.join('\r\n');
}

/* --------------------------------- Home ---------------------------------- */
router.get('/', async (_req, res, next) => {
  try {
    const [pendingT, pendingC, reports] = await Promise.all([
      Thread.countDocuments({ status: 'pending' }).catch(() => 0),
      Comment.countDocuments({ status: 'pending' }).catch(() => 0),
      Report.countDocuments({ status: 'open' }).catch(() => 0),
    ]);

    const fallback = `<!doctype html><html><body style="font-family:system-ui,Segoe UI,Roboto,Arial;margin:24px">
<h1>ShopSphere Community · Admin</h1>
<ul>
  <li><strong>Pending threads:</strong> ${pendingT}</li>
  <li><strong>Pending comments:</strong> ${pendingC}</li>
  <li><strong>Open reports:</strong> ${reports}</li>
</ul>
<p>
  <a href="/admin/threads">Threads</a> ·
  <a href="/admin/comments">Comments</a> ·
  <a href="/admin/reports">Reports</a> ·
  <a href="/admin/categories">Categories</a> ·
  <a href="/admin/polls">Polls</a> ·
  <a href="/admin/export?type=threads">Export CSV</a> ·
  <a href="/admin/notifications">Notifications</a>
</p>
</body></html>`;

    renderOrFallback(res, 'dashboard', { pendingT, pendingC, reports }, fallback);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------- Threads --------------------------------- */
// List (default: pending)
router.get('/threads', async (req, res, next) => {
  try {
    const status = (req.query.status || 'pending').toString();
    const items = await Thread.find({ status }).sort({ createdAt: -1 }).lean();

    const list = (items || [])
      .map(
        (t) => `<li>
  <b><a href="/admin/threads/${t._id}">${esc(t.title || '(untitled)')}</a></b>
  ${t.pinned ? ' · <span style="color:#b35">pinned</span>' : ''}
  ${t.closed ? ' · <span style="color:#555">closed</span>' : ''}
  ${t.locked ? ' · <span style="color:#a33">locked</span>' : ''}
  · ${esc(t.status || 'pending')}
  · <small>${t._id}</small>
  <form action="/admin/threads/${t._id}/approve" method="post" style="display:inline;margin-left:8px">
    <button type="submit">Approve</button>
  </form>
  <form action="/admin/threads/${t._id}/reject" method="post" style="display:inline">
    <button type="submit">Reject</button>
  </form>
  <form action="/admin/threads/${t._id}/${t.pinned ? 'unpin' : 'pin'}" method="post" style="display:inline">
    <button type="submit">${t.pinned ? 'Unpin' : 'Pin'}</button>
  </form>
  <form action="/admin/threads/${t._id}/${t.closed ? 'reopen' : 'close'}" method="post" style="display:inline">
    <button type="submit">${t.closed ? 'Reopen' : 'Close'}</button>
  </form>
  <form action="/admin/threads/${t._id}/${t.locked ? 'unlock' : 'lock'}" method="post" style="display:inline">
    <button type="submit">${t.locked ? 'Unlock' : 'Lock'}</button>
  </form>
  <form action="/admin/threads/${t._id}/delete" method="post" style="display:inline" onsubmit="return confirm('Delete thread?');">
    <button type="submit">Delete</button>
  </form>
</li>`
      )
      .join('');

    const fallback = `<!doctype html><html><body style="font-family:system-ui,Segoe UI,Roboto,Arial;margin:24px">
<h2>Threads (${esc(status)})</h2>
<p>
  <a href="/admin/threads?status=pending">Pending</a> ·
  <a href="/admin/threads?status=approved">Approved</a> ·
  <a href="/admin/threads?status=rejected">Rejected</a>
</p>
${status === 'pending' ? `
<form action="/admin/threads/approve-all" method="post" style="margin-bottom:12px">
  <button type="submit">Approve ALL pending</button>
</form>` : ''}

<ul>${list || '<li>(none)</li>'}</ul>
<p><a href="/admin">Back</a></p>
</body></html>`;

    renderOrFallback(res, 'threads', { items, status }, fallback);
  } catch (err) {
    next(err);
  }
});

// Thread detail (with comments + mod tools)
router.get('/threads/:id', async (req, res, next) => {
  try {
    const t = await Thread.findById(req.params.id).lean();
    if (!t) return res.status(404).send('Thread not found');

    const comments = await Comment.find({ threadId: t._id }).sort({ createdAt: 1 }).lean();

    const clist = (comments || [])
      .map(
        (c) => `<li>
  <b>${esc(c.author?.displayName || c.author?.name || 'anon')}</b>:
  ${esc((c.body || '').slice(0, 240))}
  · ${esc(c.status || 'pending')}
  <small>(${c._id})</small>
  ${c.status !== 'approved'
            ? `<form action="/admin/comments/${c._id}/approve" method="post" style="display:inline;margin-left:6px">
         <button type="submit">Approve</button>
       </form>`
            : ''}
  ${c.status !== 'rejected'
            ? `<form action="/admin/comments/${c._id}/reject" method="post" style="display:inline">
         <button type="submit">Reject</button>
       </form>`
            : ''}
  <form action="/admin/comments/${c._id}/edit" method="post" style="display:inline;margin-left:6px">
    <input type="hidden" name="body" value="${esc((c.body || '').slice(0, 5000))}">
    <button type="submit">Quick Save</button>
  </form>
  <form action="/admin/comments/${c._id}/reject-with-reason" method="post" style="display:inline">
    <input name="reason" placeholder="reason" />
    <button type="submit">Reject+Reason</button>
  </form>
  <form action="/admin/comments/${c._id}/delete" method="post" style="display:inline" onsubmit="return confirm('Delete comment?');">
    <button type="submit">Delete</button>
  </form>
</li>`
      )
      .join('');

    const fallback = `<!doctype html><html><body style="font-family:system-ui,Segoe UI,Roboto,Arial;margin:24px">
<h2>${esc(t.title || '(untitled)')}</h2>
<p><i>Status:</i> ${esc(t.status || 'pending')} ${t.pinned ? '· pinned' : ''} ${t.closed ? '· closed' : ''} ${t.locked ? '· locked' : ''}</p>
<pre style="background:#f6f6f6;padding:12px;border-radius:8px">${esc(t.body || '')}</pre>

<div style="margin:10px 0">
  <form action="/admin/threads/${t._id}/approve" method="post" style="display:inline;margin-right:6px">
    <button type="submit">Approve</button>
  </form>
  <form action="/admin/threads/${t._id}/reject" method="post" style="display:inline;margin-right:6px">
    <button type="submit">Reject</button>
  </form>
  <form action="/admin/threads/${t._id}/reject-with-reason" method="post" style="display:inline;margin-right:6px">
    <input name="reason" placeholder="reason" />
    <button type="submit">Reject + Reason</button>
  </form>
  <form action="/admin/threads/${t._id}/${t.pinned ? 'unpin' : 'pin'}" method="post" style="display:inline;margin-right:6px">
    <button type="submit">${t.pinned ? 'Unpin' : 'Pin'}</button>
  </form>
  <form action="/admin/threads/${t._id}/${t.closed ? 'reopen' : 'close'}" method="post" style="display:inline;margin-right:6px">
    <button type="submit">${t.closed ? 'Reopen' : 'Close'}</button>
  </form>
  <form action="/admin/threads/${t._id}/${t.locked ? 'unlock' : 'lock'}" method="post" style="display:inline;margin-right:6px">
    <button type="submit">${t.locked ? 'Unlock' : 'Lock'}</button>
  </form>
  <form action="/admin/threads/${t._id}/delete" method="post" style="display:inline;margin-right:6px" onsubmit="return confirm('Delete thread?');">
    <button type="submit">Delete</button>
  </form>
</div>

<div style="margin:10px 0">
  <h4>Edit thread</h4>
  <form action="/admin/threads/${t._id}/edit" method="post">
    <input name="title" placeholder="title" value="${esc(t.title || '')}" style="width:360px" />
    <br/>
    <textarea name="body" rows="4" cols="70" style="margin-top:6px">${esc(t.body || '')}</textarea>
    <br/>
    <button type="submit">Save</button>
  </form>
</div>

<div style="margin:10px 0">
  <h4>Move to category</h4>
  <form action="/admin/threads/${t._id}/move" method="post">
    <input name="categoryId" placeholder="categoryId" />
    <button type="submit">Move</button>
  </form>
</div>

<h3>Comments</h3>
<ul>${clist || '<li>(none)</li>'}</ul>
<p><a href="/admin/threads?status=pending">Back to pending</a> · <a href="/admin">Admin home</a></p>
</body></html>`;

    renderOrFallback(res, 'thread-detail', { thread: t, comments }, fallback);
  } catch (err) {
    next(err);
  }
});

// approve all pending
router.post('/threads/approve-all', async (_req, res, next) => {
  try {
    await Thread.updateMany(
      { status: 'pending' },
      { $set: { status: 'approved', approvedAt: new Date() } }
    );
    res.redirect(303, '/admin/threads?status=pending');
  } catch (e) {
    next(e);
  }
});

// thread moderation actions (+ notifications for TC-081)
router.post('/threads/:id/approve', async (req, res, next) => {
  try {
    const t = await Thread.findByIdAndUpdate(
      req.params.id,
      { status: 'approved', approvedAt: new Date() },
      { new: true }
    );
    if (t?.author?.customerId) {
      await Notification.create({
        shop: t.shop,
        userId: String(t.author.customerId),
        type: 'moderation',
        targetType: 'thread',
        targetId: String(t._id),
        payload: { action: 'approved' },
      });
    }
    backTo(req, res, '/admin/threads?status=pending');
  } catch (e) {
    next(e);
  }
});
router.post('/threads/:id/reject', async (req, res, next) => {
  try {
    const t = await Thread.findByIdAndUpdate(
      req.params.id,
      { status: 'rejected', rejectedAt: new Date() },
      { new: true }
    );
    if (t?.author?.customerId) {
      await Notification.create({
        shop: t.shop,
        userId: String(t.author.customerId),
        type: 'moderation',
        targetType: 'thread',
        targetId: String(t._id),
        payload: { action: 'rejected' },
      });
    }
    backTo(req, res, '/admin/threads?status=pending');
  } catch (e) {
    next(e);
  }
});
router.post('/threads/:id/pin', async (req, res, next) => {
  try {
    await Thread.findByIdAndUpdate(req.params.id, { pinned: true });
    backTo(req, res, '/admin/threads?status=pending');
  } catch (e) {
    next(e);
  }
});
router.post('/threads/:id/unpin', async (req, res, next) => {
  try {
    await Thread.findByIdAndUpdate(req.params.id, { pinned: false });
    backTo(req, res, '/admin/threads?status=pending');
  } catch (e) {
    next(e);
  }
});
router.post('/threads/:id/close', async (req, res, next) => {
  try {
    await Thread.findByIdAndUpdate(req.params.id, { closed: true });
    backTo(req, res, '/admin/threads?status=pending');
  } catch (e) {
    next(e);
  }
});
router.post('/threads/:id/reopen', async (req, res, next) => {
  try {
    await Thread.findByIdAndUpdate(req.params.id, { closed: false });
    backTo(req, res, '/admin/threads?status=pending');
  } catch (e) {
    next(e);
  }
});

/* -------------------- 4.1 Thread moderator controls --------------------- */
router.post('/threads/:id/move', async (req, res, next) => {
  try {
    await Thread.findByIdAndUpdate(req.params.id, {
      categoryId: req.body.categoryId || null,
    });
    backTo(req, res, '/admin/threads?status=pending');
  } catch (e) {
    next(e);
  }
});
router.post('/threads/:id/lock', async (req, res, next) => {
  try {
    await Thread.findByIdAndUpdate(req.params.id, { locked: true });
    backTo(req, res, '/admin/threads?status=pending');
  } catch (e) {
    next(e);
  }
});
router.post('/threads/:id/unlock', async (req, res, next) => {
  try {
    await Thread.findByIdAndUpdate(req.params.id, { locked: false });
    backTo(req, res, '/admin/threads?status=pending');
  } catch (e) {
    next(e);
  }
});
router.post('/threads/:id/edit', async (req, res, next) => {
  try {
    const { title, body } = req.body || {};
    const t = await Thread.findByIdAndUpdate(
      req.params.id,
      {
        ...(title ? { title: String(title).slice(0, 180) } : {}),
        ...(body ? { body: sanitizeHtml(body, { allowedTags: [], allowedAttributes: {} }) } : {}),
      },
      { new: true }
    );
    if (t?.author?.customerId) {
      await Notification.create({
        shop: t.shop,
        userId: String(t.author.customerId),
        type: 'moderation',
        targetType: 'thread',
        targetId: String(t._id),
        payload: { action: 'edited_by_mod' },
      });
    }
    backTo(req, res, `/admin/threads/${req.params.id}`);
  } catch (e) {
    next(e);
  }
});
router.post('/threads/:id/delete', async (req, res, next) => {
  try {
    const t = await Thread.findByIdAndDelete(req.params.id);
    if (t?.author?.customerId) {
      await Notification.create({
        shop: t.shop,
        userId: String(t.author.customerId),
        type: 'moderation',
        targetType: 'thread',
        targetId: String(t._id),
        payload: { action: 'deleted' },
      });
    }
    res.redirect(303, '/admin/threads?status=pending');
  } catch (e) {
    next(e);
  }
});
router.post('/threads/:id/reject-with-reason', async (req, res, next) => {
  try {
    const t = await Thread.findByIdAndUpdate(
      req.params.id,
      {
        status: 'rejected',
        rejectedAt: new Date(),
        moderationNote: (req.body.reason || '').slice(0, 300),
      },
      { new: true }
    );
    if (t?.author?.customerId) {
      await Notification.create({
        shop: t.shop,
        userId: String(t.author.customerId),
        type: 'moderation',
        targetType: 'thread',
        targetId: String(t._id),
        payload: { action: 'rejected', reason: (req.body.reason || '').slice(0, 300) },
      });
    }
    backTo(req, res, '/admin/threads?status=pending');
  } catch (e) {
    next(e);
  }
});

/* ------------------------------- Comments -------------------------------- */
router.get('/comments', async (req, res, next) => {
  try {
    const status = (req.query.status || 'pending').toString();
    const items = await Comment.find({ status }).sort({ createdAt: -1 }).lean();

    const list = (items || [])
      .map(
        (c) => `<li>
  <b>${esc(c.author?.displayName || c.author?.name || 'anon')}</b>:
  ${esc((c.body || '').slice(0, 120))}
  · ${esc(c.status || 'pending')}
  · <small>${c._id}</small>
  <form action="/admin/comments/${c._id}/approve" method="post" style="display:inline;margin-left:6px">
    <button type="submit">Approve</button>
  </form>
  <form action="/admin/comments/${c._id}/reject" method="post" style="display:inline">
    <button type="submit">Reject</button>
  </form>
  <form action="/admin/comments/${c._id}/reject-with-reason" method="post" style="display:inline">
    <input name="reason" placeholder="reason" />
    <button type="submit">Reject+Reason</button>
  </form>
  <form action="/admin/comments/${c._id}/delete" method="post" style="display:inline" onsubmit="return confirm('Delete comment?');">
    <button type="submit">Delete</button>
  </form>
</li>`
      )
      .join('');

    const fallback = `<!doctype html><html><body style="font-family:system-ui,Segoe UI,Roboto,Arial;margin:24px">
<h2>Comments (${esc(status)})</h2>
<p>
  <a href="/admin/comments?status=pending">Pending</a> ·
  <a href="/admin/comments?status=approved">Approved</a> ·
  <a href="/admin/comments?status=rejected">Rejected</a>
</p>
<ul>${list || '<li>(none)</li>'}</ul>
<p><a href="/admin">Back</a></p>
</body></html>`;

    renderOrFallback(res, 'comments', { items, status }, fallback);
  } catch (err) {
    next(err);
  }
});

router.post('/comments/:id/approve', async (req, res, next) => {
  try {
    const c = await Comment.findByIdAndUpdate(
      req.params.id,
      { status: 'approved', approvedAt: new Date() },
      { new: true }
    );
    if (c?.threadId) {
      await Thread.findByIdAndUpdate(c.threadId, { $inc: { commentsCount: 1 } });
    }
    if (c?.author?.customerId) {
      await Notification.create({
        shop: c.shop,
        userId: String(c.author.customerId),
        type: 'moderation',
        targetType: 'comment',
        targetId: String(c._id),
        payload: { action: 'approved' },
      });
    }
    const fallback = c?.threadId ? `/admin/threads/${c.threadId}` : '/admin/comments?status=pending';
    backTo(req, res, fallback);
  } catch (e) {
    next(e);
  }
});

router.post('/comments/:id/reject', async (req, res, next) => {
  try {
    const c = await Comment.findByIdAndUpdate(
      req.params.id,
      { status: 'rejected', rejectedAt: new Date() },
      { new: true }
    );
    if (c?.author?.customerId) {
      await Notification.create({
        shop: c.shop,
        userId: String(c.author.customerId),
        type: 'moderation',
        targetType: 'comment',
        targetId: String(c._id),
        payload: { action: 'rejected' },
      });
    }
    const fallback = c?.threadId ? `/admin/threads/${c.threadId}` : '/admin/comments?status=pending';
    backTo(req, res, fallback);
  } catch (e) {
    next(e);
  }
});

/* ✅ SINGLE delete route: hard delete + keep counts in sync */
router.post('/comments/:id/delete', async (req, res, next) => {
  try {
    const c = await Comment.findById(req.params.id);
    if (!c) return backTo(req, res, '/admin/comments?status=pending');

    const wasApproved = c.status === 'approved';
    const threadId = c.threadId;

    await c.deleteOne();

    if (wasApproved && threadId) {
      await Thread.updateOne({ _id: threadId }, { $inc: { commentsCount: -1 } });
    }

    if (c?.author?.customerId) {
      await Notification.create({
        shop: c.shop,
        userId: String(c.author.customerId),
        type: 'moderation',
        targetType: 'comment',
        targetId: String(c._id),
        payload: { action: 'deleted' },
      });
    }

    const fallback = threadId ? `/admin/threads/${threadId}` : '/admin/comments?status=pending';
    backTo(req, res, fallback);
  } catch (e) {
    next(e);
  }
});

router.post('/comments/:id/edit', async (req, res, next) => {
  try {
    const { body } = req.body || {};
    const c = await Comment.findByIdAndUpdate(
      req.params.id,
      { body: sanitizeHtml(body || '', { allowedTags: [], allowedAttributes: {} }) },
      { new: true }
    );
    if (c?.author?.customerId) {
      await Notification.create({
        shop: c.shop,
        userId: String(c.author.customerId),
        type: 'moderation',
        targetType: 'comment',
        targetId: String(c._id),
        payload: { action: 'edited_by_mod' },
      });
    }
    const fallback = c?.threadId ? `/admin/threads/${c.threadId}` : '/admin/comments?status=pending';
    backTo(req, res, fallback);
  } catch (e) {
    next(e);
  }
});

router.post('/comments/:id/reject-with-reason', async (req, res, next) => {
  try {
    const c = await Comment.findByIdAndUpdate(
      req.params.id,
      {
        status: 'rejected',
        rejectedAt: new Date(),
        moderationNote: (req.body.reason || '').slice(0, 300),
      },
      { new: true }
    );
    if (c?.author?.customerId) {
      await Notification.create({
        shop: c.shop,
        userId: String(c.author.customerId),
        type: 'moderation',
        targetType: 'comment',
        targetId: String(c._id),
        payload: { action: 'rejected', reason: (req.body.reason || '').slice(0, 300) },
      });
    }
    const fallback = c?.threadId ? `/admin/threads/${c.threadId}` : '/admin/comments?status=pending';
    backTo(req, res, fallback);
  } catch (e) {
    next(e);
  }
});

/* ------------------------------- Categories ------------------------------ */
router.get('/categories', async (_req, res, next) => {
  try {
    const items = await Category.find({}).sort({ order: 1 }).lean();

    const list = (items || [])
      .map(
        (c) => `<li>
  ${esc(c.name)} <small>(${esc(c.slug)})</small> · order ${Number(c.order || 0)}
  · <small>${c._id}</small>
  <form action="/admin/categories/${c._id}/delete" method="post" style="display:inline;margin-left:6px">
    <button type="submit">Delete</button>
  </form>
</li>`
      )
      .join('');

    const fallback = `<!doctype html><html><body style="font-family:system-ui,Segoe UI,Roboto,Arial;margin:24px">
<h2>Categories</h2>
<form action="/admin/categories/create" method="post" style="margin-bottom:12px">
  <input name="shop" placeholder="shop domain" required />
  <input name="name" placeholder="name" required />
  <input name="slug" placeholder="slug" required />
  <input name="order" type="number" placeholder="order" value="0" />
  <button type="submit">Create</button>
</form>
<ul>${list || '<li>(none)</li>'}</ul>
<p><a href="/admin">Back</a></p>
</body></html>`;

    renderOrFallback(res, 'categories', { items }, fallback);
  } catch (err) {
    next(err);
  }
});
router.post('/categories/create', async (req, res, next) => {
  try {
    const { shop, name, slug, order = 0 } = req.body || {};
    await Category.create({
      shop: (shop || '').trim(),
      name: sanitizeHtml((name || '').slice(0, 60), { allowedTags: [], allowedAttributes: {} }),
      slug: sanitizeHtml((slug || '').slice(0, 80), { allowedTags: [], allowedAttributes: {} }),
      order: Number(order) || 0,
    });
    res.redirect(303, '/admin/categories');
  } catch (e) {
    next(e);
  }
});
router.post('/categories/:id/delete', async (req, res, next) => {
  try {
    await Category.findByIdAndDelete(req.params.id);
    res.redirect(303, '/admin/categories');
  } catch (e) {
    next(e);
  }
});

/* -------------------------------- Reports -------------------------------- */
router.get('/reports', async (_req, res, next) => {
  try {
    const items = await Report.find({ status: 'open' }).sort({ createdAt: -1 }).lean();

    const list = (items || [])
      .map(
        (r) => `<li>
  <b>${esc(r.type || 'report')}</b> on ${esc(r.targetType || 'item')}
  <small>${r.targetId}</small> · ${esc(r.reason || '')}
  <form action="/admin/reports/${r._id}/resolve" method="post" style="display:inline;margin-left:6px">
    <button type="submit">Resolve</button>
  </form>
</li>`
      )
      .join('');

    const fallback = `<!doctype html><html><body style="font-family:system-ui,Segoe UI,Roboto,Arial;margin:24px">
<h2>Reports (open)</h2>
<ul>${list || '<li>(none)</li>'}</ul>
<p><a href="/admin">Back</a></p>
</body></html>`;

    renderOrFallback(res, 'reports', { items }, fallback);
  } catch (err) {
    next(err);
  }
});
router.post('/reports/:id/resolve', async (req, res, next) => {
  try {
    await Report.findByIdAndUpdate(req.params.id, {
      status: 'resolved',
      resolvedAt: new Date(),
    });
    res.redirect(303, '/admin/reports');
  } catch (e) {
    next(e);
  }
});

/* --------------------------------- Polls --------------------------------- */
router.get('/polls', async (_req, res, next) => {
  try {
    const items = await Poll.find({}).sort({ createdAt: -1 }).lean();

    const list = (items || [])
      .map(
        (p) => `<li>
  <b>${esc(p.question || '(no question)')}</b> · ${(p.options || []).length} options
  <form action="/admin/polls/${p._id}/close" method="post" style="display:inline;margin-left:6px">
    <button type="submit">Close</button>
  </form>
</li>`
      )
      .join('');

    const fallback = `<!doctype html><html><body style="font-family:system-ui,Segoe UI,Roboto,Arial;margin:24px">
<h2>Polls</h2>
<form action="/admin/polls/create" method="post" style="margin-bottom:12px">
  <input name="shop" placeholder="shop domain" required />
  <input name="threadId" placeholder="threadId" />
  <input name="question" placeholder="question" required style="width:360px" />
  <br/>
  <textarea name="options" placeholder="One option per line" rows="5" cols="40" style="margin-top:6px"></textarea>
  <br/>
  <button type="submit">Create Poll</button>
</form>
<ul>${list || '<li>(none)</li>'}</ul>
<p><a href="/admin">Back</a></p>
</body></html>`;

    renderOrFallback(res, 'polls', { items }, fallback);
  } catch (err) {
    next(err);
  }
});
router.post('/polls/create', async (req, res, next) => {
  try {
    const { shop, threadId, question, options } = req.body || {};
    const cleanedQ = sanitizeHtml((question || '').slice(0, 160), {
      allowedTags: [],
      allowedAttributes: {},
    });

    const parsed = (options || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((t, i) => ({
        id: String(i + 1),
        text: sanitizeHtml(t, { allowedTags: [], allowedAttributes: {} }),
      }));

    await Poll.create({
      shop: (shop || '').trim(),
      threadId: (threadId || '').trim() || null,
      question: cleanedQ,
      options: parsed,
    });

    res.redirect(303, '/admin/polls');
  } catch (e) {
    next(e);
  }
});
router.post('/polls/:id/close', async (req, res, next) => {
  try {
    await Poll.findByIdAndUpdate(req.params.id, { status: 'closed' });
    res.redirect(303, '/admin/polls');
  } catch (e) {
    next(e);
  }
});

/* -------------------------- 4.3 CSV Exports ----------------------------- */
// GET /admin/export?type=threads|comments|votes|polls&shop=...&from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/export', async (req, res, next) => {
  try {
    const { type = 'threads', shop, from, to } = req.query;
    const base = shop ? { shop } : {};
    if (from || to) {
      base.createdAt = {};
      if (from) base.createdAt.$gte = new Date(from);
      if (to) base.createdAt.$lte = new Date(to);
    }

    let docs = [];
    switch (type) {
      case 'threads':
        docs = await Thread.find(base).lean();
        break;
      case 'comments':
        docs = await Comment.find(base).lean();
        break;
      case 'votes':
        docs = await Vote.find(base).lean();
        break;
      case 'polls':
        docs = await Poll.find(base).lean();
        break;
      default:
        return res.status(400).send('Invalid type');
    }

    const csv = toCSV(docs);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${type}.csv"`);
    res.send(csv);
  } catch (e) {
    next(e);
  }
});

/* ------------------------------ Notifications --------------------------- */
router.get('/notifications', async (_req, res, next) => {
  try {
    const items = await Notification.find({}).sort({ createdAt: -1 }).limit(200).lean();
    const list = (items || [])
      .map(
        (n) =>
          `<li>${esc(n.type)} → ${esc(n.userId)} on ${esc(n.targetType)} ${esc(
            n.targetId
          )} ${n.payload ? esc(JSON.stringify(n.payload)) : ''} <small>${n._id}</small></li>`
      )
      .join('');
    const fallback = `<!doctype html><html><body style="font-family:system-ui,Segoe UI,Roboto,Arial;margin:24px">
<h2>Notifications</h2><ul>${list || '<li>(none)</li>'}</ul><p><a href="/admin">Back</a></p></body></html>`;
    renderOrFallback(res, 'notifications', { items }, fallback);
  } catch (e) {
    next(e);
  }
});

export default router;
