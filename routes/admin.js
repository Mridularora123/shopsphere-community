// routes/admin.js
import express from 'express';
import basicAuth from 'express-basic-auth';
import sanitizeHtml from 'sanitize-html';

import Thread from '../models/Thread.js';
import Comment from '../models/Comment.js';
import Category from '../models/Category.js';
import Poll from '../models/Poll.js';
import Report from '../models/Report.js';

const router = express.Router();

// in case the app doesn't do it globally, parse form posts here too
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

/* ---------------------- tiny helpers: sanitize / render ------------------- */
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
  <a href="/admin/polls">Polls</a>
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

// Thread detail (with comments)
router.get('/threads/:id', async (req, res, next) => {
  try {
    const t = await Thread.findById(req.params.id).lean();
    if (!t) return res.status(404).send('Thread not found');

    const comments = await Comment.find({ threadId: t._id })
      .sort({ createdAt: 1 })
      .lean();

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
</li>`
      )
      .join('');

    const fallback = `<!doctype html><html><body style="font-family:system-ui,Segoe UI,Roboto,Arial;margin:24px">
<h2>${esc(t.title || '(untitled)')}</h2>
<p><i>Status:</i> ${esc(t.status || 'pending')} ${t.pinned ? '· pinned' : ''} ${t.closed ? '· closed' : ''}</p>
<pre style="background:#f6f6f6;padding:12px;border-radius:8px">${esc(t.body || '')}</pre>

<div style="margin:10px 0">
  <form action="/admin/threads/${t._id}/approve" method="post" style="display:inline;margin-right:6px">
    <button type="submit">Approve</button>
  </form>
  <form action="/admin/threads/${t._id}/reject" method="post" style="display:inline;margin-right:6px">
    <button type="submit">Reject</button>
  </form>
  <form action="/admin/threads/${t._id}/${t.pinned ? 'unpin' : 'pin'}" method="post" style="display:inline;margin-right:6px">
    <button type="submit">${t.pinned ? 'Unpin' : 'Pin'}</button>
  </form>
  <form action="/admin/threads/${t._id}/${t.closed ? 'reopen' : 'close'}" method="post" style="display:inline">
    <button type="submit">${t.closed ? 'Reopen' : 'Close'}</button>
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
    await Thread.updateMany({ status: 'pending' }, { $set: { status: 'approved', approvedAt: new Date() } });
    res.redirect('/admin/threads?status=pending');
  } catch (e) {
    next(e);
  }
});

// thread moderation actions
router.post('/threads/:id/approve', async (req, res, next) => {
  try {
    await Thread.findByIdAndUpdate(req.params.id, { status: 'approved', approvedAt: new Date() });
    res.redirect('back');
  } catch (e) { next(e); }
});
router.post('/threads/:id/reject', async (req, res, next) => {
  try {
    await Thread.findByIdAndUpdate(req.params.id, { status: 'rejected', rejectedAt: new Date() });
    res.redirect('back');
  } catch (e) { next(e); }
});
router.post('/threads/:id/pin', async (req, res, next) => {
  try {
    await Thread.findByIdAndUpdate(req.params.id, { pinned: true });
    res.redirect('back');
  } catch (e) { next(e); }
});
router.post('/threads/:id/unpin', async (req, res, next) => {
  try {
    await Thread.findByIdAndUpdate(req.params.id, { pinned: false });
    res.redirect('back');
  } catch (e) { next(e); }
});
router.post('/threads/:id/close', async (req, res, next) => {
  try {
    await Thread.findByIdAndUpdate(req.params.id, { closed: true });
    res.redirect('back');
  } catch (e) { next(e); }
});
router.post('/threads/:id/reopen', async (req, res, next) => {
  try {
    await Thread.findByIdAndUpdate(req.params.id, { closed: false });
    res.redirect('back');
  } catch (e) { next(e); }
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
    res.redirect('back');
  } catch (e) { next(e); }
});

router.post('/comments/:id/reject', async (req, res, next) => {
  try {
    await Comment.findByIdAndUpdate(req.params.id, { status: 'rejected', rejectedAt: new Date() });
    res.redirect('back');
  } catch (e) { next(e); }
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
  } catch (err) { next(err); }
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
    res.redirect('back');
  } catch (e) { next(e); }
});

router.post('/categories/:id/delete', async (req, res, next) => {
  try {
    await Category.findByIdAndDelete(req.params.id);
    res.redirect('back');
  } catch (e) { next(e); }
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
  } catch (err) { next(err); }
});

router.post('/reports/:id/resolve', async (req, res, next) => {
  try {
    await Report.findByIdAndUpdate(req.params.id, { status: 'resolved', resolvedAt: new Date() });
    res.redirect('back');
  } catch (e) { next(e); }
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
  } catch (err) { next(err); }
});

router.post('/polls/create', async (req, res, next) => {
  try {
    const { shop, threadId, question, options } = req.body || {};
    const cleanedQ = sanitizeHtml((question || '').slice(0, 160), { allowedTags: [], allowedAttributes: {} });

    const parsed = (options || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((t, i) => ({ id: String(i + 1), text: sanitizeHtml(t, { allowedTags: [], allowedAttributes: {} }) }));

    await Poll.create({
      shop: (shop || '').trim(),
      threadId: (threadId || '').trim() || null,
      question: cleanedQ,
      options: parsed,
    });

    res.redirect('back');
  } catch (e) { next(e); }
});

router.post('/polls/:id/close', async (req, res, next) => {
  try {
    await Poll.findByIdAndUpdate(req.params.id, { status: 'closed' });
    res.redirect('back');
  } catch (e) { next(e); }
});

export default router;
