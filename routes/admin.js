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
import NotificationSettings from '../models/NotificationSettings.js';

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

// Never let a notification failure break the admin UI
async function safeNotify(doc) {
  try {
    if (doc) await Notification.create(doc);
  } catch (e) {
    console.warn('[notify] failed:', e?.message || e);
  }
}

// Safer than res.redirect('back') which depends on Referer header
function goBack(req, res, fallback = '/admin') {
  const back = req.get('Referrer') || fallback;
  res.redirect(back);
}

/* ------------------------------ Admin styling ---------------------------- */
const ADMIN_CSS = `
:root{
  --bg:#f7f9fc;--card:#fff;--text:#1f2328;--muted:#57606a;--border:#e6e8f0;
  --accent:#1473e6;--danger:#c62828;--warning:#b35;
}
*{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0;background:var(--bg);color:var(--text);
  font:14px/1.45 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.container{max-width:980px;margin:24px auto;padding:0 16px}
.header{display:flex;gap:12px;align-items:center;justify-content:space-between;margin-bottom:16px}
.header h1{margin:0;font-size:22px}
.nav{display:flex;flex-wrap:wrap;gap:8px}
.nav a{
  display:inline-block;background:#fff;border:1px solid var(--border);border-radius:8px;
  padding:6px 10px;text-decoration:none
}
.card{
  background:var(--card);border:1px solid var(--border);border-radius:12px;
  padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.05);margin:12px 0
}
.grid{display:grid;gap:12px}
@media(min-width:720px){.grid-2{grid-template-columns:1fr 1fr}}
.list{list-style:none;margin:0;padding:0}
.list li{
  display:flex;justify-content:space-between;align-items:center;
  padding:10px 8px;border-top:1px solid var(--border)
}
.list li:first-child{border-top:none}
.item-main{min-width:0}
.actions{display:flex;gap:6px;flex-wrap:wrap;margin-left:8px}
.btn{
  appearance:none;border:1px solid var(--border);background:#fff;
  border-radius:8px;padding:6px 10px;cursor:pointer
}
.btn:hover{box-shadow:0 1px 0 rgba(0,0,0,.06)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.btn.danger{border-color:var(--danger);color:var(--danger)}
.btn.warn{border-color:var(--warning);color:var(--warning)}
.btn.ghost{background:#f6f8fa}
input,textarea,select{
  width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;background:#fff
}
label{display:block;margin:6px 0 4px;font-weight:600;color:var(--muted)}
.form-row{display:flex;gap:8px;flex-wrap:wrap}
.form-row>*{flex:1}
.badge{display:inline-block;background:#eef;border:1px solid var(--border);padding:2px 6px;border-radius:6px;margin-left:6px;color:var(--muted);font-size:12px}
pre{
  background:#f6f8fa;border:1px solid var(--border);border-radius:10px;
  padding:12px;overflow:auto;white-space:pre-wrap
}
.small{font-size:12px;color:var(--muted)}
hr{border:none;border-top:1px solid var(--border);margin:16px 0}
`;

// Shared page shell for fallback HTML
function page(title, innerHTML) {
  const nav = `
    <nav class="nav">
      <a href="/admin/threads">Threads</a>
      <a href="/admin/comments">Comments</a>
      <a href="/admin/reports">Reports</a>
      <a href="/admin/categories">Categories</a>
      <a href="/admin/polls">Polls</a>
      <a href="/admin/exports">Export CSV</a>
      <a href="/admin/notifications">Notifications</a>
      <a href="/admin/announce">Announcements</a>
    </nav>
  `;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <style>${ADMIN_CSS}</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${esc(title)}</h1>
      ${nav}
    </div>
    ${innerHTML}
  </div>
</body>
</html>`;
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

    const fallback = page(
      'ShopSphere Community · Admin',
      `
      <div class="grid grid-2">
        <div class="card">
          <h2 style="margin-top:0">Overview</h2>
          <ul class="list">
            <li><div class="item-main"><strong>Pending threads</strong></div><span>${pendingT}</span></li>
            <li><div class="item-main"><strong>Pending comments</strong></div><span>${pendingC}</span></li>
            <li><div class="item-main"><strong>Open reports</strong></div><span>${reports}</span></li>
          </ul>
        </div>
        <div class="card">
          <h2 style="margin-top:0">Quick links</h2>
          <div class="actions">
            <a class="btn" href="/admin/threads">Threads</a>
            <a class="btn" href="/admin/comments">Comments</a>
            <a class="btn" href="/admin/reports">Reports</a>
            <a class="btn" href="/admin/categories">Categories</a>
            <a class="btn" href="/admin/polls">Polls</a>
            <a class="btn" href="/admin/exports">Export CSV</a>
            <a class="btn" href="/admin/notifications">Notifications</a>
            <a class="btn" href="/admin/announce">Announcements</a>
          </div>
        </div>
      </div>
      `
    );

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
  <div class="item-main">
    <b><a href="/admin/threads/${t._id}">${esc(t.title || '(untitled)')}</a></b>
    ${t.pinned ? ' <span class="badge">pinned</span>' : ''}
    ${t.closedAt ? ' <span class="badge">closed</span>' : ''}
    ${t.locked ? ' <span class="badge">locked</span>' : ''}
    <span class="small"> · ${esc(t.status || 'pending')} · ${t._id}</span>
  </div>
  <div class="actions">
    <form action="/admin/threads/${t._id}/approve" method="post">
      <button class="btn primary" type="submit">Approve</button>
    </form>
    <form action="/admin/threads/${t._id}/reject" method="post">
      <button class="btn warn" type="submit">Reject</button>
    </form>
    <form action="/admin/threads/${t._id}/${t.pinned ? 'unpin' : 'pin'}" method="post">
      <button class="btn" type="submit">${t.pinned ? 'Unpin' : 'Pin'}</button>
    </form>
    <form action="/admin/threads/${t._id}/${t.closedAt ? 'reopen' : 'close'}" method="post">
      <button class="btn" type="submit">${t.closedAt ? 'Reopen' : 'Close'}</button>
    </form>
    <form action="/admin/threads/${t._id}/${t.locked ? 'unlock' : 'lock'}" method="post">
      <button class="btn" type="submit">${t.locked ? 'Unlock' : 'Lock'}</button>
    </form>
    <form action="/admin/threads/${t._id}/delete" method="post" onsubmit="return confirm('Delete thread?');">
      <button class="btn danger" type="submit">Delete</button>
    </form>
  </div>
</li>`
      )
      .join('');

    const fallback = page(
      `Threads (${esc(status)})`,
      `
      <div class="card">
        <p class="small" style="margin:0 0 12px 0">
          <a href="/admin/threads?status=pending">Pending</a> ·
          <a href="/admin/threads?status=approved">Approved</a> ·
          <a href="/admin/threads?status=rejected">Rejected</a>
        </p>
        ${
          status === 'pending'
            ? `
        <form action="/admin/threads/approve-all" method="post" style="margin-bottom:12px">
          <button class="btn primary" type="submit">Approve ALL pending</button>
        </form>` : ''
        }
        <ul class="list">${list || '<li>(none)</li>'}</ul>
        <p style="margin-top:12px"><a class="btn ghost" href="/admin">Back</a></p>
      </div>
      `
    );

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
  <div class="item-main">
    <b>${esc(c.author?.displayName || c.author?.name || 'anon')}</b>:
    ${esc((c.body || '').slice(0, 240))}
    <span class="small"> · ${esc(c.status || 'pending')} · ${c._id}</span>
  </div>
  <div class="actions">
    ${
      c.status !== 'approved'
        ? `<form action="/admin/comments/${c._id}/approve" method="post">
             <button class="btn primary" type="submit">Approve</button>
           </form>`
        : ''
    }
    ${
      c.status !== 'rejected'
        ? `<form action="/admin/comments/${c._id}/reject" method="post">
             <button class="btn warn" type="submit">Reject</button>
           </form>`
        : ''
    }
    <form action="/admin/comments/${c._id}/edit" method="post">
      <input type="hidden" name="body" value="${esc((c.body || '').slice(0, 5000))}">
      <button class="btn" type="submit">Quick Save</button>
    </form>
    <form action="/admin/comments/${c._id}/reject-with-reason" method="post">
      <input name="reason" placeholder="reason" />
      <button class="btn warn" type="submit">Reject+Reason</button>
    </form>
    <form action="/admin/comments/${c._id}/delete" method="post" onsubmit="return confirm('Delete comment?');">
      <button class="btn danger" type="submit">Delete</button>
    </form>
  </div>
</li>`
      )
      .join('');

    const fallback = page(
      t.title || '(untitled)',
      `
      <div class="card">
        <p class="small" style="margin:0 0 8px 0">
          <i>Status:</i> ${esc(t.status || 'pending')}
          ${t.pinned ? ' · <span class="badge">pinned</span>' : ''}
          ${t.closedAt ? ' · <span class="badge">closed</span>' : ''}
          ${t.locked ? ' · <span class="badge">locked</span>' : ''}
        </p>
        <pre>${esc(t.body || '')}</pre>

        <div class="actions" style="margin-top:10px">
          <form action="/admin/threads/${t._id}/approve" method="post">
            <button class="btn primary" type="submit">Approve</button>
          </form>
          <form action="/admin/threads/${t._id}/reject" method="post">
            <button class="btn warn" type="submit">Reject</button>
          </form>
          <form action="/admin/threads/${t._id}/reject-with-reason" method="post">
            <input name="reason" placeholder="reason" />
            <button class="btn warn" type="submit">Reject + Reason</button>
          </form>
          <form action="/admin/threads/${t._id}/${t.pinned ? 'unpin' : 'pin'}" method="post">
            <button class="btn" type="submit">${t.pinned ? 'Unpin' : 'Pin'}</button>
          </form>
          <form action="/admin/threads/${t._id}/${t.closedAt ? 'reopen' : 'close'}" method="post">
            <button class="btn" type="submit">${t.closedAt ? 'Reopen' : 'Close'}</button>
          </form>
          <form action="/admin/threads/${t._id}/${t.locked ? 'unlock' : 'lock'}" method="post">
            <button class="btn" type="submit">${t.locked ? 'Unlock' : 'Lock'}</button>
          </form>
          <form action="/admin/threads/${t._id}/delete" method="post" onsubmit="return confirm('Delete thread?');">
            <button class="btn danger" type="submit">Delete</button>
          </form>
        </div>
      </div>

      <div class="card">
        <h3 style="margin:0 0 8px 0">Edit thread</h3>
        <form action="/admin/threads/${t._id}/edit" method="post">
          <div class="form-row">
            <label style="flex:1">Title
              <input name="title" placeholder="title" value="${esc(t.title || '')}" />
            </label>
          </div>
          <label>Body
            <textarea name="body" rows="4" style="margin-top:6px">${esc(t.body || '')}</textarea>
          </label>
          <button class="btn primary" type="submit">Save</button>
        </form>
      </div>

      <div class="card">
        <h3 style="margin:0 0 8px 0">Move to category</h3>
        <form action="/admin/threads/${t._id}/move" method="post" class="form-row">
          <input name="categoryId" placeholder="categoryId" />
          <button class="btn" type="submit">Move</button>
        </form>
      </div>

      <div class="card">
        <h3 style="margin:0 0 8px 0">Comments</h3>
        <ul class="list">${clist || '<li>(none)</li>'}</ul>
        <p style="margin-top:12px">
          <a class="btn ghost" href="/admin/threads?status=pending">Back to pending</a>
          <a class="btn ghost" href="/admin">Admin home</a>
        </p>
      </div>
      `
    );

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
    res.redirect('/admin/threads?status=pending');
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
      await safeNotify({
        shop: t.shop,
        userId: String(t.author.customerId),
        type: 'moderation',
        targetType: 'thread',
        targetId: String(t._id),
        payload: { action: 'approved' },
      });
    }
    goBack(req, res, '/admin/threads?status=pending');
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
      await safeNotify({
        shop: t.shop,
        userId: String(t.author.customerId),
        type: 'moderation',
        targetType: 'thread',
        targetId: String(t._id),
        payload: { action: 'rejected' },
      });
    }
    goBack(req, res, '/admin/threads?status=pending');
  } catch (e) {
    next(e);
  }
});
router.post('/threads/:id/pin', async (req, res, next) => {
  try {
    await Thread.findByIdAndUpdate(req.params.id, { pinned: true });
    goBack(req, res, '/admin/threads?status=pending');
  } catch (e) {
    next(e);
  }
});
router.post('/threads/:id/unpin', async (req, res, next) => {
  try {
    await Thread.findByIdAndUpdate(req.params.id, { pinned: false });
    goBack(req, res, '/admin/threads?status=pending');
  } catch (e) {
    next(e);
  }
});
router.post('/threads/:id/close', async (req, res, next) => {
  try {
    await Thread.findByIdAndUpdate(req.params.id, { closedAt: new Date() });
    goBack(req, res, '/admin/threads?status=pending');   // ✅ consistent redirect
  } catch (e) { next(e); }
});

router.post('/threads/:id/reopen', async (req, res, next) => {
  try {
    await Thread.findByIdAndUpdate(req.params.id, { closedAt: null });
    goBack(req, res, '/admin/threads?status=pending');   // ✅ consistent redirect
  } catch (e) { next(e); }
});

/* -------------------- 4.1 Thread moderator controls --------------------- */
router.post('/threads/:id/move', async (req, res, next) => {
  try {
    await Thread.findByIdAndUpdate(req.params.id, {
      categoryId: req.body.categoryId || null,
    });
    goBack(req, res, '/admin/threads?status=pending');
  } catch (e) {
    next(e);
  }
});
router.post('/threads/:id/lock', async (req, res, next) => {
  try {
    await Thread.findByIdAndUpdate(req.params.id, { locked: true });
    goBack(req, res, '/admin/threads?status=pending');
  } catch (e) {
    next(e);
  }
});
router.post('/threads/:id/unlock', async (req, res, next) => {
  try {
    await Thread.findByIdAndUpdate(req.params.id, { locked: false });
    goBack(req, res, '/admin/threads?status=pending');
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
        ...(body
          ? { body: sanitizeHtml(body, { allowedTags: [], allowedAttributes: {} }) }
          : {}),
      },
      { new: true }
    );
    if (t?.author?.customerId) {
      await safeNotify({
        shop: t.shop,
        userId: String(t.author.customerId),
        type: 'moderation',
        targetType: 'thread',
        targetId: String(t._id),
        payload: { action: 'edited_by_mod' },
      });
    }
    goBack(req, res, '/admin/threads?status=pending');
  } catch (e) {
    next(e);
  }
});
router.post('/threads/:id/delete', async (req, res, next) => {
  try {
    const t = await Thread.findByIdAndDelete(req.params.id);
    if (t?.author?.customerId) {
      await safeNotify({
        shop: t.shop,
        userId: String(t.author.customerId),
        type: 'moderation',
        targetType: 'thread',
        targetId: String(t._id),
        payload: { action: 'deleted' },
      });
    }
    res.redirect('/admin/threads?status=pending');
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
      await safeNotify({
        shop: t.shop,
        userId: String(t.author.customerId),
        type: 'moderation',
        targetType: 'thread',
        targetId: String(t._id),
        payload: { action: 'rejected', reason: (req.body.reason || '').slice(0, 300) },
      });
    }
    goBack(req, res, '/admin/threads?status=pending');
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
  <div class="item-main">
    <b>${esc(c.author?.displayName || c.author?.name || 'anon')}</b>:
    ${esc((c.body || '').slice(0, 120))}
    <span class="small"> · ${esc(c.status || 'pending')} · ${c._id}</span>
  </div>
  <div class="actions">
    <form action="/admin/comments/${c._id}/approve" method="post">
      <button class="btn primary" type="submit">Approve</button>
    </form>
    <form action="/admin/comments/${c._id}/reject" method="post">
      <button class="btn warn" type="submit">Reject</button>
    </form>
    <form action="/admin/comments/${c._id}/reject-with-reason" method="post">
      <input name="reason" placeholder="reason" />
      <button class="btn warn" type="submit">Reject+Reason</button>
    </form>
    <form action="/admin/comments/${c._id}/delete" method="post" onsubmit="return confirm('Delete comment?');">
      <button class="btn danger" type="submit">Delete</button>
    </form>
  </div>
</li>`
      )
      .join('');

    const fallback = page(
      `Comments (${esc(status)})`,
      `
      <div class="card">
        <p class="small" style="margin:0 0 12px 0">
          <a href="/admin/comments?status=pending">Pending</a> ·
          <a href="/admin/comments?status=approved">Approved</a> ·
          <a href="/admin/comments?status=rejected">Rejected</a>
        </p>
        <ul class="list">${list || '<li>(none)</li>'}</ul>
        <p style="margin-top:12px"><a class="btn ghost" href="/admin">Back</a></p>
      </div>
      `
    );

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
      await safeNotify({
        shop: c.shop,
        userId: String(c.author.customerId),
        type: 'moderation',
        targetType: 'comment',
        targetId: String(c._id),
        payload: { action: 'approved' },
      });
    }
    goBack(req, res, '/admin/comments?status=pending');
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
      await safeNotify({
        shop: c.shop,
        userId: String(c.author.customerId),
        type: 'moderation',
        targetType: 'comment',
        targetId: String(c._id),
        payload: { action: 'rejected' },
      });
    }
    goBack(req, res, '/admin/comments?status=pending');
  } catch (e) {
    next(e);
  }
});

/* ✅ SINGLE delete route: hard delete + keep counts in sync */
router.post('/comments/:id/delete', async (req, res, next) => {
  try {
    const c = await Comment.findById(req.params.id);
    if (!c) return goBack(req, res, '/admin/comments?status=pending');

    const wasApproved = c.status === 'approved';
    const threadId = c.threadId;

    await c.deleteOne();

    if (wasApproved && threadId) {
      await Thread.updateOne({ _id: threadId }, { $inc: { commentsCount: -1 } });
    }

    if (c?.author?.customerId) {
      await safeNotify({
        shop: c.shop,
        userId: String(c.author.customerId),
        type: 'moderation',
        targetType: 'comment',
        targetId: String(c._id),
        payload: { action: 'deleted' },
      });
    }

    goBack(req, res, '/admin/comments?status=pending');
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
      await safeNotify({
        shop: c.shop,
        userId: String(c.author.customerId),
        type: 'moderation',
        targetType: 'comment',
        targetId: String(c._id),
        payload: { action: 'edited_by_mod' },
      });
    }
    goBack(req, res, '/admin/comments?status=pending');
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
      await safeNotify({
        shop: c.shop,
        userId: String(c.author.customerId),
        type: 'moderation',
        targetType: 'comment',
        targetId: String(c._id),
        payload: { action: 'rejected', reason: (req.body.reason || '').slice(0, 300) },
      });
    }
    goBack(req, res, '/admin/comments?status=pending');
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
  <div class="item-main">
    ${esc(c.name)} <small>(${esc(c.slug)})</small> · order ${Number(c.order || 0)}
    <span class="small"> · ${c._id}</span>
  </div>
  <div class="actions">
    <form action="/admin/categories/${c._id}/delete" method="post">
      <button class="btn danger" type="submit">Delete</button>
    </form>
  </div>
</li>`
      )
      .join('');

    const fallback = page(
      'Categories',
      `
      <div class="card">
        <h3 style="margin:0 0 8px 0">Create category</h3>
        <form action="/admin/categories/create" method="post" style="margin-bottom:12px">
          <div class="form-row">
            <input name="shop" placeholder="shop domain" required />
            <input name="name" placeholder="name" required />
            <input name="slug" placeholder="slug" required />
            <input name="order" type="number" placeholder="order" value="0" />
          </div>
          <button class="btn primary" type="submit">Create</button>
        </form>
        <ul class="list">${list || '<li>(none)</li>'}</ul>
        <p style="margin-top:12px"><a class="btn ghost" href="/admin">Back</a></p>
      </div>
      `
    );

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
    goBack(req, res, '/admin/categories');
  } catch (e) {
    next(e);
  }
});
router.post('/categories/:id/delete', async (req, res, next) => {
  try {
    await Category.findByIdAndDelete(req.params.id);
    goBack(req, res, '/admin/categories');
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
  <div class="item-main">
    <b>${esc(r.type || 'report')}</b> on ${esc(r.targetType || 'item')}
    <small class="small">${r.targetId}</small> · ${esc(r.reason || '')}
  </div>
  <div class="actions">
    <form action="/admin/reports/${r._id}/resolve" method="post">
      <button class="btn primary" type="submit">Resolve</button>
    </form>
  </div>
</li>`
      )
      .join('');

    const fallback = page(
      'Reports (open)',
      `
      <div class="card">
        <ul class="list">${list || '<li>(none)</li>'}</ul>
        <p style="margin-top:12px"><a class="btn ghost" href="/admin">Back</a></p>
      </div>
      `
    );

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
    goBack(req, res, '/admin/reports');
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
  <div class="item-main"><b>${esc(p.question || '(no question)')}</b> · ${(p.options || []).length} options</div>
  <div class="actions">
    <form action="/admin/polls/${p._id}/close" method="post">
      <button class="btn warn" type="submit">Close</button>
    </form>
  </div>
</li>`
      )
      .join('');

    const fallback = page(
      'Polls',
      `
      <div class="card">
        <h3 style="margin:0 0 8px 0">Create poll</h3>
        <form action="/admin/polls/create" method="post" style="margin-bottom:12px">
          <div class="form-row">
            <input name="shop" placeholder="shop domain" required />
            <input name="threadId" placeholder="threadId" />
          </div>
          <label>Question
            <input name="question" placeholder="question" required />
          </label>
          <label>Options
            <textarea name="options" placeholder="One option per line" rows="5" style="margin-top:6px"></textarea>
          </label>
          <button class="btn primary" type="submit">Create Poll</button>
        </form>
        <ul class="list">${list || '<li>(none)</li>'}</ul>
        <p style="margin-top:12px"><a class="btn ghost" href="/admin">Back</a></p>
      </div>
      `
    );

    renderOrFallback(res, 'polls', { items }, fallback);
  } catch (err) {
    next(err);
  }
});
router.post('/polls/create', async (req, res, next) => {
  try {
    const { shop, threadId, question, options } = req.body || {};
    const cleanedQ = sanitizeHtml((question || '').slice(0, 160), {
      allowedTags: [],      allowedAttributes: {},
    });

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

    goBack(req, res, '/admin/polls');
  } catch (e) {
    next(e);
  }
});
// POST /polls/:id/close
router.post('/polls/:id/close', async (req, res, next) => {
  try {
    const { id } = req.params;

    // 1) close the poll
    await Poll.findByIdAndUpdate(id, { status: 'closed' });

    // 2) notify the thread author that this poll ended
    const poll = await Poll.findById(id).lean();
    if (poll?.threadId) {
      const t = await Thread.findById(poll.threadId).select('shop author.customerId').lean();
      if (t?.author?.customerId) {
        await Notification.create({
          shop: t.shop,
          userId: String(t.author.customerId),
          type: 'poll_end',
          targetType: 'poll',
          targetId: String(poll._id),
          payload: { threadId: String(poll.threadId) }
        });
      }
    }

    // back to polls list
    goBack(req, res, '/admin/polls');
  } catch (e) {
    next(e);
  }
});

// GET /admin/announce - simple form
router.get('/announce', (req, res) => {
  const shop = req.query.shop || '';
  const html = page(
    'Send Announcement',
    `
    <div class="card">
      <form method="post" action="/admin/announce" style="display:grid;gap:12px;max-width:620px">
        <label>Shop
          <input name="shop" value="${esc(shop)}" required>
        </label>
        <label>Message
          <textarea name="message" rows="4" required></textarea>
        </label>

        <fieldset style="padding:8px 12px;border:1px solid var(--border);border-radius:10px;background:#fff">
          <legend>Audience</legend>
          <label style="display:block;margin:6px 0">
            <input type="radio" name="audience" value="all" checked> All users who’ve posted
          </label>
          <label style="display:block;margin:6px 0">
            <input type="radio" name="audience" value="one"> Single user (customerId)
          </label>
          <div id="uid" style="margin-top:8px;display:none">
            <input name="userId" placeholder="customerId (e.g., 8322784788675)" style="width:100%">
          </div>
        </fieldset>

        <div class="actions">
          <button class="btn primary" type="submit">Send</button>
          <a class="btn ghost" href="/admin">Back</a>
        </div>
      </form>
    </div>

    <script>
      const radios = document.querySelectorAll('input[name="audience"]');
      const uid = document.getElementById('uid');
      function toggle() {
        uid.style.display = document.querySelector('input[name="audience"]:checked').value === 'one' ? 'block' : 'none';
      }
      radios.forEach(r => r.addEventListener('change', toggle));
      toggle();
    </script>
    `
  );
  res.send(html);
});

// POST /admin/announce - create announcement notifications
router.post('/announce', async (req, res, next) => {
  try {
    const { shop, message, audience = 'all', userId } = req.body || {};
    if (!shop || !message) return res.status(400).send('shop and message required');

    let userIds = [];
    if (audience === 'one') {
      if (!userId) return res.status(400).send('userId required for audience=one');
      userIds = [String(userId)];
    } else {
      // "all" → all distinct customerIds who have posted anything
      const [t, c] = await Promise.all([
        Thread.distinct('author.customerId', { shop, 'author.customerId': { $ne: null } }),
        Comment.distinct('author.customerId', { shop, 'author.customerId': { $ne: null } }),
      ]);
      userIds = Array.from(new Set([...(t || []).map(String), ...(c || []).map(String)])).filter(Boolean);
    }

    const docs = userIds.map(uid => ({
      shop,
      userId: uid,
      type: 'announcement',
      targetType: 'system',
      targetId: '',
      payload: { message: String(message).slice(0, 500) },
    }));

    if (docs.length) await Notification.insertMany(docs, { ordered: false });

    res.redirect('/admin/notifications'); // or '/admin' if you prefer
  } catch (e) {
    next(e);
  }
});

// --- Simple CSV export UI ---
// GET /admin/exports
router.get('/exports', (req, res) => {
  const shop = (req.query.shop || '').trim();
  const html = page(
    'CSV Exports',
    `
    <div class="card">
      <form id="xform" style="display:grid;gap:10px;max-width:620px">
        <label>Shop (optional)
          <input name="shop" value="${esc(shop)}" placeholder="your-shop.myshopify.com">
        </label>
        <div class="form-row">
          <label>From (YYYY-MM-DD)
            <input name="from" type="date">
          </label>
          <label>To (YYYY-MM-DD)
            <input name="to" type="date">
          </label>
        </div>

        <div class="actions" style="margin-top:6px;flex-wrap:wrap">
          <button class="btn" type="button" onclick="go('threads')">Export Threads CSV</button>
          <button class="btn" type="button" onclick="go('comments')">Export Comments CSV</button>
          <button class="btn" type="button" onclick="go('votes')">Export Votes CSV</button>
          <button class="btn" type="button" onclick="go('polls')">Export Polls CSV</button>
          <a class="btn ghost" href="/admin">Back</a>
        </div>
      </form>
    </div>

    <script>
      function go(type) {
        var f = document.getElementById('xform');
        var shop = (f.shop.value || '').trim();
        var from = (f.from.value || '').trim();
        var to   = (f.to.value || '').trim();

        var url = '/admin/export?type=' + encodeURIComponent(type);
        if (shop) url += '&shop=' + encodeURIComponent(shop);
        if (from) url += '&from=' + encodeURIComponent(from);
        if (to)   url += '&to='   + encodeURIComponent(to);

        window.open(url, '_blank');
      }
    </script>
    `
  );
  res.type('html').send(html);
});

/* -------------------------- 4.3 CSV Exports ----------------------------- */
// GET /admin/export?type=threads|comments|votes|polls&shop=...&from=YYYY-MM-DD&to=YYYY-MM-DD
// --- helper: normalize values for CSV (ObjectId/Buffer/Date) ---
function normalizeForCsv(v) {
  if (v === null || v === undefined) return v;

  // Mongo ObjectId (works without importing mongoose)
  if (typeof v?.toHexString === 'function') return v.toHexString();
  if (v?._bsontype === 'ObjectID' && typeof v?.toString === 'function') return v.toString();

  // Buffers or { type:'Buffer', data:[...] }
  if (Buffer.isBuffer(v)) return v.toString('hex');
  if (v?.type === 'Buffer' && Array.isArray(v.data)) return Buffer.from(v.data).toString('hex');

  // Dates
  if (v instanceof Date) return v.toISOString();

  // Arrays / plain objects → recurse
  if (Array.isArray(v)) return v.map(normalizeForCsv);
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = normalizeForCsv(v[k]);
    return out;
  }

  return v;
}

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

    // ✅ Make ObjectIds readable & remove Buffer columns
    docs = docs.map(d => normalizeForCsv(d));

    const csv = toCSV(docs);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${type}.csv"`);
    // (optional) prepend BOM so Excel opens UTF-8 cleanly:
    res.send('\uFEFF' + csv);
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
          `<li>
            <div class="item-main">
              ${esc(n.type)} → ${esc(n.userId)} on ${esc(n.targetType)} ${esc(n.targetId)}
              ${n.payload ? `<span class="small">${esc(JSON.stringify(n.payload))}</span>` : ''}
              <small class="small">${n._id}</small>
            </div>
          </li>`
      )
      .join('');
    const fallback = page(
      'Notifications',
      `<div class="card"><ul class="list">${list || '<li>(none)</li>'}</ul><p style="margin-top:12px"><a class="btn ghost" href="/admin">Back</a></p></div>`
    );
    renderOrFallback(res, 'notifications', { items }, fallback);
  } catch (e) {
    next(e);
  }
});

export default router;
