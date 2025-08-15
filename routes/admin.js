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
      // If no EJS view exists, show a minimal HTML fallback
      res.type('html').send(fallbackHTML);
    } else {
      res.send(html);
    }
  });
}

/* --------------------------------- Home ---------------------------------- */
router.get('/', async (req, res, next) => {
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
<p><a href="/admin/threads">Threads</a> · <a href="/admin/comments">Comments</a> · <a href="/admin/reports">Reports</a> · <a href="/admin/categories">Categories</a> · <a href="/admin/polls">Polls</a></p>
</body></html>`;

    renderOrFallback(res, 'dashboard', { pendingT, pendingC, reports }, fallback);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------- Threads --------------------------------- */
router.get('/threads', async (req, res, next) => {
  try {
    const status = (req.query.status || 'pending').toString();
    const items = await Thread.find({ status }).sort({ createdAt: -1 }).lean();

    const list = (items || [])
      .map(
        (t) =>
          `<li><b>${esc(t.title || '(untitled)')}</b> · ${esc(
            t.status || 'pending'
          )} · <small>${t._id}</small></li>`
      )
      .join('');

    const fallback = `<!doctype html><html><body style="font-family:system-ui,Segoe UI,Roboto,Arial;margin:24px">
<h2>Threads (${esc(status)})</h2>
<ul>${list || '<li>(none)</li>'}</ul>
<p><a href="/admin">Back</a></p>
</body></html>`;

    renderOrFallback(res, 'threads', { items, status }, fallback);
  } catch (err) {
    next(err);
  }
});

router.post('/threads/:id/approve', async (req, res, next) => {
  try {
    await Thread.findByIdAndUpdate(req.params.id, { status: 'approved' });
    res.redirect('back');
  } catch (e) {
    next(e);
  }
});

router.post('/threads/:id/reject', async (req, res, next) => {
  try {
    await Thread.findByIdAndUpdate(req.params.id, { status: 'rejected' });
    res.redirect('back');
  } catch (e) {
    next(e);
  }
});

router.post('/threads/:id/pin', async (req, res, next) => {
  try {
    await Thread.findByIdAndUpdate(req.params.id, { pinned: true });
    res.redirect('back');
  } catch (e) {
    next(e);
  }
});

router.post('/threads/:id/unpin', async (req, res, next) => {
  try {
    await Thread.findByIdAndUpdate(req.params.id, { pinned: false });
    res.redirect('back');
  } catch (e) {
    next(e);
  }
});

router.post('/threads/:id/close', async (req, res, next) => {
  try {
    await Thread.findByIdAndUpdate(req.params.id, { closed: true });
    res.redirect('back');
  } catch (e) {
    next(e);
  }
});

router.post('/threads/:id/reopen', async (req, res, next) => {
  try {
    await Thread.findByIdAndUpdate(req.params.id, { closed: false });
    res.redirect('back');
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
        (c) =>
          `<li><b>${esc(c.author || 'anon')}</b>: ${esc(
            (c.body || '').slice(0, 120)
          )} · ${esc(c.status || 'pending')} · <small>${c._id}</small></li>`
      )
      .join('');

    const fallback = `<!doctype html><html><body style="font-family:system-ui,Segoe UI,Roboto,Arial;margin:24px">
<h2>Comments (${esc(status)})</h2>
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
      { status: 'approved' },
      { new: true }
    );
    if (c?.threadId) {
      await Thread.findByIdAndUpdate(c.threadId, { $inc: { commentsCount: 1 } });
    }
    res.redirect('back');
  } catch (e) {
    next(e);
  }
});

router.post('/comments/:id/reject', async (req, res, next) => {
  try {
    await Comment.findByIdAndUpdate(req.params.id, { status: 'rejected' });
    res.redirect('back');
  } catch (e) {
    next(e);
  }
});

/* ------------------------------- Categories ------------------------------ */
router.get('/categories', async (req, res, next) => {
  try {
    const items = await Category.find({}).sort({ order: 1 }).lean();

    const list = (items || [])
      .map(
        (c) =>
          `<li>${esc(c.name)} <small>(${esc(c.slug)})</small> · order ${Number(
            c.order || 0
          )} · <small>${c._id}</small></li>`
      )
      .join('');

    const fallback = `<!doctype html><html><body style="font-family:system-ui,Segoe UI,Roboto,Arial;margin:24px">
<h2>Categories</h2>
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
      shop,
      name: (name || '').slice(0, 60),
      slug: (slug || '').slice(0, 80),
      order: Number(order) || 0,
    });
    res.redirect('back');
  } catch (e) {
    next(e);
  }
});

router.post('/categories/:id/delete', async (req, res, next) => {
  try {
    await Category.findByIdAndDelete(req.params.id);
    res.redirect('back');
  } catch (e) {
    next(e);
  }
});

/* -------------------------------- Reports -------------------------------- */
router.get('/reports', async (req, res, next) => {
  try {
    const items = await Report.find({ status: 'open' })
      .sort({ createdAt: -1 })
      .lean();

    const list = (items || [])
      .map(
        (r) =>
          `<li><b>${esc(r.type || 'report')}</b> on ${esc(
            r.targetType || 'item'
          )} <small>${r.targetId}</small> · ${esc(
            r.reason || ''
          )}</li>`
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
    await Report.findByIdAndUpdate(req.params.id, { status: 'resolved' });
    res.redirect('back');
  } catch (e) {
    next(e);
  }
});

/* --------------------------------- Polls --------------------------------- */
router.get('/polls', async (req, res, next) => {
  try {
    const items = await Poll.find({}).sort({ createdAt: -1 }).lean();

    const list = (items || [])
      .map(
        (p) =>
          `<li><b>${esc(p.question || '(no question)')}</b> · ${
            (p.options || []).length
          } options</li>`
      )
      .join('');

    const fallback = `<!doctype html><html><body style="font-family:system-ui,Segoe UI,Roboto,Arial;margin:24px">
<h2>Polls</h2>
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

    // Split by newlines safely (Windows/Mac/Linux)
    const parsed = (options || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((t, i) => ({ id: String(i + 1), text: t }));

    await Poll.create({
      shop,
      threadId,
      question: (question || '').slice(0, 160),
      options: parsed,
    });

    res.redirect('back');
  } catch (e) {
    next(e);
  }
});

router.post('/polls/:id/close', async (req, res, next) => {
  try {
    await Poll.findByIdAndUpdate(req.params.id, { status: 'closed' });
    res.redirect('back');
  } catch (e) {
    next(e);
  }
});

export default router;
