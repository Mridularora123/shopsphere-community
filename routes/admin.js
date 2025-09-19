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

function shell(title, inner) {
  // Shared lightweight style for all admin fallbacks (no dependency)
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>${title}</title>
<style>
:root{
  --bg:#f7f7fb;--card:#fff;--text:#111827;--muted:#6b7280;--border:#e5e7eb;--primary:#0a66c2;
  --radius:14px;--shadow:0 1px 2px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.06);
}
*{box-sizing:border-box}
body{font-family:system-ui,Segoe UI,Roboto,Arial;background:var(--bg);color:var(--text);margin:0}
.wrap{max-width:1040px;margin:28px auto;padding:0 16px}
h1,h2,h3{margin:0 0 12px}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:16px}
.subtle{color:var(--muted);font-size:12px}
a{color:var(--primary);text-decoration:none}
a:hover{text-decoration:underline}
ul.clean{list-style:none;margin:0;padding:0}
li.item{padding:12px;border-top:1px solid var(--border)}
li.item:first-child{border-top:0}
.badge{display:inline-block;background:#eef3ff;border:1px solid #dbe6ff;border-radius:999px;padding:2px 8px;font-size:12px;margin-left:6px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.input,textarea,select{border:1px solid var(--border);border-radius:10px;padding:8px 10px;background:#fff;min-width:0}
textarea{width:100%}
.btn{appearance:none;border:1px solid var(--border);background:#fff;border-radius:10px;padding:8px 12px;cursor:pointer}
.btn:hover{border-color:#cbd5e1;box-shadow:0 1px 0 rgba(0,0,0,.03)}
.btn.primary{background:var(--primary);color:#fff;border-color:transparent}
.btn.danger{background:#fff0f0;color:#b91c1c;border-color:#fecaca}
.kv{display:grid;grid-template-columns:160px 1fr;gap:8px;align-items:center}
hr{border:none;border-top:1px solid var(--border);margin:16px 0}
.small{font-size:12px;color:var(--muted)}
.mt8{margin-top:8px}.mb8{margin-bottom:8px}.mt12{margin-top:12px}
</style>
</head>
<body>
  <div class="wrap">
    ${inner}
  </div>
</body>
</html>`;
}

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

    const fallback = shell(
      'ShopSphere Community · Admin',
      `
<div class="row" style="justify-content:space-between;align-items:flex-end">
  <h1>ShopSphere Community · Admin</h1>
  <div class="small">Quick overview</div>
</div>

<div class="row mt12">
  <div class="card" style="flex:1">
    <div class="small">Pending threads</div>
    <div style="font-size:28px;font-weight:700">${pendingT}</div>
  </div>
  <div class="card" style="flex:1">
    <div class="small">Pending comments</div>
    <div style="font-size:28px;font-weight:700">${pendingC}</div>
  </div>
  <div class="card" style="flex:1">
    <div class="small">Open reports</div>
    <div style="font-size:28px;font-weight:700">${reports}</div>
  </div>
</div>

<div class="card mt12">
  <div class="row">
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
        (t) => `<li class="item">
  <div class="row" style="justify-content:space-between">
    <div>
      <b><a href="/admin/threads/${t._id}">${esc(t.title || '(untitled)')}</a></b>
      ${t.pinned ? ' <span class="badge">pinned</span>' : ''}
      ${t.closedAt ? ' <span class="badge">closed</span>' : ''}
      ${t.locked ? ' <span class="badge">locked</span>' : ''}
      · <span class="small">${esc(t.status || 'pending')}</span>
      · <span class="small">${t._id}</span>
    </div>
    <div class="row">
      <form action="/admin/threads/${t._id}/approve" method="post"><button class="btn primary" type="submit">Approve</button></form>
      <form action="/admin/threads/${t._id}/reject" method="post"><button class="btn" type="submit">Reject</button></form>
      <form action="/admin/threads/${t._id}/${t.pinned ? 'unpin' : 'pin'}" method="post"><button class="btn" type="submit">${t.pinned ? 'Unpin' : 'Pin'}</button></form>
      <form action="/admin/threads/${t._id}/${t.closedAt ? 'reopen' : 'close'}" method="post"><button class="btn" type="submit">${t.closedAt ? 'Reopen' : 'Close'}</button></form>
      <form action="/admin/threads/${t._id}/${t.locked ? 'unlock' : 'lock'}" method="post"><button class="btn" type="submit">${t.locked ? 'Unlock' : 'Lock'}</button></form>
      <form action="/admin/threads/${t._id}/delete" method="post" onsubmit="return confirm('Delete thread?');"><button class="btn danger" type="submit">Delete</button></form>
    </div>
  </div>
</li>`
      )
      .join('');

    const fallback = shell(
      `Threads (${esc(status)})`,
      `
<div class="row" style="justify-content:space-between;align-items:center">
  <h2>Threads (${esc(status)})</h2>
  <div class="row">
    <a class="btn" href="/admin/threads?status=pending">Pending</a>
    <a class="btn" href="/admin/threads?status=approved">Approved</a>
    <a class="btn" href="/admin/threads?status=rejected">Rejected</a>
  </div>
</div>

${status === 'pending' ? `
<div class="card mt12">
  <form action="/admin/threads/approve-all" method="post">
    <button class="btn primary" type="submit">Approve ALL pending</button>
  </form>
</div>` : ''}

<div class="card mt12">
  <ul class="clean">${list || '<li class="item">(none)</li>'}</ul>
</div>

<p class="mt12"><a href="/admin">← Back</a></p>
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
        (c) => `<li class="item">
  <div><b>${esc(c.author?.displayName || c.author?.name || 'anon')}</b>
  <span class="small"> · ${esc(c.status || 'pending')} · ${c._id}</span></div>
  <div class="mt8">${esc((c.body || '').slice(0, 240))}</div>
  <div class="row mt8">
    ${c.status !== 'approved'
            ? `<form action="/admin/comments/${c._id}/approve" method="post"><button class="btn primary" type="submit">Approve</button></form>`
            : ''}
    ${c.status !== 'rejected'
            ? `<form action="/admin/comments/${c._id}/reject" method="post"><button class="btn" type="submit">Reject</button></form>`
            : ''}
    <form action="/admin/comments/${c._id}/edit" method="post">
      <input type="hidden" name="body" value="${esc((c.body || '').slice(0, 5000))}">
      <button class="btn" type="submit">Quick Save</button>
    </form>
    <form class="row" action="/admin/comments/${c._id}/reject-with-reason" method="post">
      <input class="input" name="reason" placeholder="reason" />
      <button class="btn" type="submit">Reject+Reason</button>
    </form>
    <form action="/admin/comments/${c._id}/delete" method="post" onsubmit="return confirm('Delete comment?');">
      <button class="btn danger" type="submit">Delete</button>
    </form>
  </div>
</li>`
      )
      .join('');

    const fallback = shell(
      esc(t.title || '(untitled)'),
      `
<div class="card">
  <h2 style="margin-bottom:6px">${esc(t.title || '(untitled)')}</h2>
  <div class="small">Status: ${esc(t.status || 'pending')} ${t.pinned ? '· pinned' : ''} ${t.closedAt ? '· closed' : ''} ${t.locked ? '· locked' : ''}</div>
  <pre style="background:#fafafa;border:1px solid #eee;border-radius:10px;padding:12px;white-space:pre-wrap">${esc(t.body || '')}</pre>

  <div class="row mt12">
    <form action="/admin/threads/${t._id}/approve" method="post"><button class="btn primary" type="submit">Approve</button></form>
    <form action="/admin/threads/${t._id}/reject" method="post"><button class="btn" type="submit">Reject</button></form>
    <form class="row" action="/admin/threads/${t._id}/reject-with-reason" method="post">
      <input class="input" name="reason" placeholder="reason" />
      <button class="btn" type="submit">Reject + Reason</button>
    </form>
    <form action="/admin/threads/${t._id}/${t.pinned ? 'unpin' : 'pin'}" method="post"><button class="btn" type="submit">${t.pinned ? 'Unpin' : 'Pin'}</button></form>
    <form action="/admin/threads/${t._id}/${t.closedAt ? 'reopen' : 'close'}" method="post"><button class="btn" type="submit">${t.closedAt ? 'Reopen' : 'Close'}</button></form>
    <form action="/admin/threads/${t._id}/${t.locked ? 'unlock' : 'lock'}" method="post"><button class="btn" type="submit">${t.locked ? 'Unlock' : 'Lock'}</button></form>
    <form action="/admin/threads/${t._id}/delete" method="post" onsubmit="return confirm('Delete thread?');"><button class="btn danger" type="submit">Delete</button></form>
  </div>

  <hr/>

  <h4>Edit thread</h4>
  <form class="kv" action="/admin/threads/${t._id}/edit" method="post">
    <label>Title</label><input class="input" name="title" placeholder="title" value="${esc(t.title || '')}" />
    <label>Body</label><textarea name="body" rows="4">${esc(t.body || '')}</textarea>
    <div></div><button class="btn primary" type="submit">Save</button>
  </form>

  <hr/>

  <h4>Move to category</h4>
  <form class="row" action="/admin/threads/${t._id}/move" method="post">
    <input class="input" name="categoryId" placeholder="categoryId" />
    <button class="btn" type="submit">Move</button>
  </form>
</div>

<div class="card mt12">
  <h3>Comments</h3>
  <ul class="clean">${clist || '<li class="item">(none)</li>'}</ul>
</div>

<p class="mt12"><a href="/admin/threads?status=pending">← Back to pending</a> · <a href="/admin">Admin home</a></p>
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
        (c) => `<li class="item">
  <div>
    <b>${esc(c.author?.displayName || c.author?.name || 'anon')}</b>
    <span class="small"> · ${esc(c.status || 'pending')} · ${c._id}</span>
  </div>
  <div class="mt8">${esc((c.body || '').slice(0, 120))}</div>
  <div class="row mt8">
    <form action="/admin/comments/${c._id}/approve" method="post"><button class="btn primary" type="submit">Approve</button></form>
    <form action="/admin/comments/${c._id}/reject" method="post"><button class="btn" type="submit">Reject</button></form>
    <form class="row" action="/admin/comments/${c._id}/reject-with-reason" method="post">
      <input class="input" name="reason" placeholder="reason" />
      <button class="btn" type="submit">Reject+Reason</button>
    </form>
    <form action="/admin/comments/${c._id}/delete" method="post" onsubmit="return confirm('Delete comment?');"><button class="btn danger" type="submit">Delete</button></form>
  </div>
</li>`
      )
      .join('');

    const fallback = shell(
      `Comments (${esc(status)})`,
      `
<div class="row" style="justify-content:space-between;align-items:center">
  <h2>Comments (${esc(status)})</h2>
  <div class="row">
    <a class="btn" href="/admin/comments?status=pending">Pending</a>
    <a class="btn" href="/admin/comments?status=approved">Approved</a>
    <a class="btn" href="/admin/comments?status=rejected">Rejected</a>
  </div>
</div>

<div class="card mt12">
  <ul class="clean">${list || '<li class="item">(none)</li>'}</ul>
</div>

<p class="mt12"><a href="/admin">← Back</a></p>
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
        (c) => `<li class="item">
  ${esc(c.name)} <span class="small">(${esc(c.slug)}) · order ${Number(c.order || 0)} · ${c._id}</span>
  <div class="row mt8">
    <form action="/admin/categories/${c._id}/delete" method="post"><button class="btn danger" type="submit">Delete</button></form>
  </div>
</li>`
      )
      .join('');

    const fallback = shell(
      'Categories',
      `
<div class="card">
  <h2>Categories</h2>
  <p>Use shop domain : 4amjw1-pc.myshopify.com</p>
  <form class="row mt12" action="/admin/categories/create" method="post">
    <input class="input" name="shop" placeholder="shop domain" required />
    <input class="input" name="name" placeholder="name" required />
    <input class="input" name="slug" placeholder="slug" required />
    <input class="input" name="order" type="number" placeholder="order" value="0" />
    <button class="btn primary" type="submit">Create</button>
  </form>
</div>

<div class="card mt12">
  <ul class="clean">${list || '<li class="item">(none)</li>'}</ul>
</div>

<p class="mt12"><a href="/admin">← Back</a></p>
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
        (r) => `<li class="item">
  <b>${esc(r.type || 'report')}</b> on ${esc(r.targetType || 'item')}
  <span class="small">${r.targetId}</span> · ${esc(r.reason || '')}
  <div class="row mt8">
    <form action="/admin/reports/${r._id}/resolve" method="post"><button class="btn primary" type="submit">Resolve</button></form>
  </div>
</li>`
      )
      .join('');

    const fallback = shell(
      'Reports (open)',
      `
<div class="card">
  <h2>Reports (open)</h2>
  <ul class="clean">${list || '<li class="item">(none)</li>'}</ul>
</div>

<p class="mt12"><a href="/admin">← Back</a></p>
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
      .map((p) => {
        const opts =
          (p.options || []).length
            ? (p.options || [])
              .map((o, i) => `<span class="badge">${esc(o.text || `Option ${i + 1}`)}</span>`)
              .join(' ')
            : '<span class="small">(no options)</span>';

        return `<li class="item">
  <div class="row" style="justify-content:space-between;align-items:flex-start">
    <div>
      <b>${esc(p.question || '(no question)')}</b>
      · <span class="small">${(p.options || []).length} options</span>
      ${p.status === 'closed' ? ' <span class="badge">closed</span>' : ''}
      <div class="mt8">${opts}</div>
      <div class="small mt8">${p._id}</div>
    </div>
    <div class="row">
      <form action="/admin/polls/${p._id}/close" method="post">
        <button class="btn" type="submit">Close</button>
      </form>
    </div>
  </div>
</li>`;
      })
      .join('');


    const fallback = shell(
      'Polls',
      `
<div class="card">
  <h2>Polls</h2>
  <p>Use shop domain : 4amjw1-pc.myshopify.com</p>
  <form class="row mt12" action="/admin/polls/create" method="post">
    <input class="input" name="shop" placeholder="shop domain" required />
    <input class="input" name="threadId" placeholder="threadId" />
    <input class="input" style="flex:1" name="question" placeholder="question" required />
    <textarea class="mt8" name="options" placeholder="One option per line" rows="5"></textarea>
    <button class="btn primary" type="submit">Create Poll</button>
  </form>
</div>

<div class="card mt12">
  <ul class="clean">${list || '<li class="item">(none)</li>'}</ul>
</div>

<p class="mt12"><a href="/admin">← Back</a></p>
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
      allowedTags: [], allowedAttributes: {},
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

    goBack(req, res, '/admin/polls');
  } catch (e) {
    next(e);
  }
});

// GET /admin/announce - simple form
router.get('/announce', (req, res) => {
  const shop = req.query.shop || '';
  res.send(shell('Announcement', `
<div class="card">
  <h1>Send Announcement</h1>
  <p>Use shop domain : 4amjw1-pc.myshopify.com</p>
  <form method="post" action="/admin/announce" style="display:grid;gap:12px;max-width:520px">
    <label>Shop<br><input class="input" name="shop" value="${shop}" required style="width:100%"></label>
    <label>Message<br><textarea class="input" name="message" rows="4" required style="width:100%"></textarea></label>

    <fieldset style="padding:8px 12px;border:1px solid var(--border);border-radius:10px">
      <legend>Audience</legend>
      <label><input type="radio" name="audience" value="all" checked> All users who’ve posted</label><br>
      <label><input type="radio" name="audience" value="one"> Single user (customerId)</label>
      <div id="uid" style="margin-top:8px;display:none">
        <input class="input" name="userId" placeholder="customerId (e.g., 8322784788675)" style="width:100%">
      </div>
    </fieldset>

    <button class="btn primary" type="submit">Send</button>
  </form>
  <p class="mt12"><a href="/admin">← Back</a></p>
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
  `));
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

    res.redirect('/admin/notifications');
  } catch (e) {
    next(e);
  }
});

// --- Simple CSV export UI ---
router.get('/exports', (req, res) => {
  const shop = (req.query.shop || '').trim();
  res.type('html').send(shell('CSV Exports', `
<div class="card">
  <h1>CSV Exports</h1>
  <p>Use shop domain : 4amjw1-pc.myshopify.com</p>
  <form id="xform" style="display:grid;gap:10px;max-width:520px">
    <label>Shop (optional)
      <input class="input" name="shop" value="${shop}" placeholder="your-shop.myshopify.com">
    </label>
    <div class="row">
      <label style="flex:1">From (YYYY-MM-DD)
        <input class="input" name="from" type="date" style="width:100%">
      </label>
      <label style="flex:1">To (YYYY-MM-DD)
        <input class="input" name="to" type="date" style="width:100%">
      </label>
    </div>

    <div class="row" style="flex-wrap:wrap;margin-top:6px">
      <button class="btn" type="button" onclick="go('threads')">Export Threads CSV</button>
      <button class="btn" type="button" onclick="go('comments')">Export Comments CSV</button>
      <button class="btn" type="button" onclick="go('votes')">Export Votes CSV</button>
      <button class="btn" type="button" onclick="go('polls')">Export Polls CSV</button>
    </div>
  </form>

  <p class="mt12"><a href="/admin">← Back</a></p>
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
`));
});


/* -------------------------- 4.3 CSV Exports ----------------------------- */
function normalizeForCsv(v) {
  if (v === null || v === undefined) return v;
  if (typeof v?.toHexString === 'function') return v.toHexString();
  if (v?._bsontype === 'ObjectID' && typeof v?.toString === 'function') return v.toString();
  if (Buffer.isBuffer(v)) return v.toString('hex');
  if (v?.type === 'Buffer' && Array.isArray(v.data)) return Buffer.from(v.data).toString('hex');
  if (v instanceof Date) return v.toISOString();
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

    docs = docs.map(d => normalizeForCsv(d));

    const csv = toCSV(docs);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${type}.csv"`);
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
          `<li class="item">
            <b>${esc(n.type)}</b> → ${esc(n.userId)} on ${esc(n.targetType)} ${esc(n.targetId)}
            ${n.payload ? `<div class="small">${esc(JSON.stringify(n.payload))}</div>` : ''}
            <div class="small">${n._id}</div>
           </li>`
      )
      .join('');
    const fallback = shell(
      'Notifications',
      `
<div class="card">
  <h2>Notifications</h2>
  <ul class="clean">${list || '<li class="item">(none)</li>'}</ul>
</div>
<p class="mt12"><a href="/admin">← Back</a></p>
      `
    );
    renderOrFallback(res, 'notifications', { items }, fallback);
  } catch (e) {
    next(e);
  }
});

export default router;
