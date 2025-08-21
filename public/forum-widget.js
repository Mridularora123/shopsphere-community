// /public/forum-widget.js
(function () {
  var TIMEOUT_MS = 10000;

  /* ---------- tiny DOM helpers ---------- */
  function qs(s, r) { return (r || document).querySelector(s); }
  function qsa(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); }
  function loadCss(href) {
    if (document.querySelector('link[href="' + href + '"]')) return;
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href;
    document.head.appendChild(l);
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) return resolve();
      var s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  async function ensureToastEditor() {
    loadCss('https://uicdn.toast.com/editor/latest/toastui-editor.min.css');
    await loadScript('https://uicdn.toast.com/editor/latest/toastui-editor-all.min.js');
  }

  function setMsg(el, t, isErr) { el.textContent = t || ''; el.style.color = isErr ? '#b00020' : '#2f6f2f'; }
  function loading(el, on) { if (!el) return; el.innerHTML = on ? '<div class="community-meta">Loading…</div>' : ''; }
  function isDesignMode() { try { return !!(window.Shopify && Shopify.designMode); } catch (_) { return false; } }
  var debounce = function (fn, ms) { var t; return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms || 200); }; };

  /* ---------- modern styles (no functionality change) ---------- */
  function injectStyles() {
    if (document.getElementById('community-style')) return;
    var css = [
      ':root{--c-bg:#fff;--c-soft:#f6f7f9;--c-soft2:#f0f2f5;--c-border:#e5e7eb;--c-text:#111827;--c-mut:#6b7280;--c-accent:#ff7a59;--c-accent-2:#0a66c2;--radius:12px;--shadow:0 1px 2px rgba(0,0,0,.06),0 6px 16px rgba(0,0,0,.06)}',
      '.community-box{font-family:system-ui,Segoe UI,Roboto,Arial;max-width:1100px;margin:0 auto;padding:8px}',
      '.community-layout{display:grid;grid-template-columns:260px 1fr;gap:18px}',
      '.community-sidebar{position:sticky;top:12px;height:fit-content}',
      '.side-card{background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--radius);box-shadow:var(--shadow)}',
      '.side-header{padding:12px 14px;border-bottom:1px solid var(--c-border);font-weight:700;color:var(--c-text)}',
      '.topic-list{list-style:none;margin:0;padding:8px}',
      '.topic-item{width:100%;display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;border:1px solid transparent;background:transparent;cursor:pointer;color:var(--c-text)}',
      '.topic-item:hover{background:var(--c-soft)}',
      '.topic-item.active{background:#fff;border-color:var(--c-accent);box-shadow:0 0 0 3px rgba(255,122,89,.15)}',
      '.topic-hash{color:var(--c-mut);}',
      '.community-main .controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}',
      '.community-input,.community-textarea{flex:1 1 auto;padding:10px 12px;border:1px solid var(--c-border);border-radius:10px;background:#fff;min-width:0}',
      '.community-textarea{width:100%}',
      '.community-btn{color:#fff;padding:9px 12px;border:1px solid var(--c-border);border-radius:999px;background:#fff;cursor:pointer;line-height:1}',
      '.community-btn:hover{box-shadow:0 0 0 3px rgba(0,0,0,.04)}',
      '.primary{background:var(--c-accent);color:#fff;border-color:var(--c-accent)}',
      '.primary:hover{box-shadow:0 0 0 4px rgba(255,122,89,.25)}',
      '.community-card{background:#fff;border:1px solid var(--c-border);border-radius:var(--radius);padding:14px;margin:12px 0;box-shadow:var(--shadow)}',
      '.card-head{display:flex;justify-content:space-between;align-items:center;gap:10px}',
      '.thread-title{font-weight:700;font-size:18px}',
      '.community-tag{display:inline-block;background:var(--c-soft);border:1px solid var(--c-border);border-radius:999px;padding:2px 8px;margin-right:6px;font-size:12px}',
      '.community-meta{color:var(--c-mut);font-size:12px}',
      '.badge{display:inline-block;background:#eef;border:1px solid #dde;padding:2px 6px;border-radius:6px;font-size:11px;margin-left:6px}',
      '.vote{border:1px solid var(--c-border);background:#fff;border-radius:999px;padding:7px 10px;line-height:1;cursor:pointer;min-width:52px;display:inline-flex;align-items:center;justify-content:center;box-shadow:inset 0 -2px 0 rgba(0,0,0,.04)}',
      '.vote:hover{box-shadow:0 0 0 3px rgba(10,102,194,.12)}',
      '.vote.voted{font-weight:700;border-color:var(--c-accent);box-shadow:0 0 0 3px rgba(255,122,89,.18)}',
      '.thread-body,.comment-body{color:var(--c-text);font-size:15px;line-height:1.58;margin-top:6px}',
      '.thread-body img,.comment-body img{max-width:100%;height:auto;border-radius:8px;display:block;margin:10px 0}',
      '.thread-body a,.comment-body a{color:var(--c-accent-2);text-decoration:underline}',
      /* reduce big default margins just inside our bodies */
      '.thread-body h1,.comment-body h1{font-size:22px;margin:8px 0 6px 0}',
      '.thread-body h2,.comment-body h2{font-size:18px;margin:6px 0 4px 0}',
      '.thread-body ul,.comment-body ul{margin:6px 0 6px 18px}',
      '.reply-form .community-textarea{min-height:60px}',
      '.comment-actions{display:inline-flex;gap:8px;margin-left:8px}',
      '.s-item:hover{background:#f6f6f6}',
      /* comments accordion */
      '.comments-accordion{margin-top:8px;border-top:1px dashed var(--c-border);padding-top:8px}',
      '.comments-accordion>summary{cursor:pointer;user-select:none;list-style:none}',
      '.comments-accordion>summary::-webkit-details-marker{display:none}',
      '.comments-accordion>summary .summary-pill{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid var(--c-border);border-radius:999px;background:#fff}',
      '.replies details{margin:6px 0 0 32px}',
      '.replies summary{cursor:pointer;color:var(--c-accent-2)}',
      '.community-row{display:flex;gap:8px;align-items:center}',
      '.filter-bar{display:flex;gap:8px;flex-wrap:wrap}',
      '.notif-panel{position:fixed;right:12px;top:90px;background:#fff;border:1px solid var(--c-border);border-radius:10px;width:380px;max-height:320px;overflow:auto;padding:8px;box-shadow:0 8px 20px rgba(0,0,0,.08);z-index:50}',
      '@media (max-width:980px){.community-layout{grid-template-columns:1fr}}',
      '@media (max-width:600px){.community-btn{width:auto}.community-input{min-width:180px}}'
    ].join('');
    var style = document.createElement('style');
    style.id = 'community-style';
    style.innerHTML = css;
    document.head.appendChild(style);
  }

  /* ---------- Markdown renderer (safe subset) ---------- */
  function renderMarkdown(md) {
    let s = escapeHtml(md || '');

    // Images: ![alt](http...)
    s = s.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g,
      function (_m, alt, url) { return '<img src="' + url + '" alt="' + escapeHtml(alt) + '" loading="lazy">'; });

    // Links with text: [text](http...)
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      function (_m, text, url) { return '<a href="' + url + '" target="_blank" rel="nofollow noopener">' + escapeHtml(text) + '</a>'; });

    // Empty-text links: [](http...) → “visit link”
    s = s.replace(/\[\s*\]\((https?:\/\/[^\s)]+)\)/g,
      function (_m, url) { return '<a href="' + url + '" target="_blank" rel="nofollow noopener">visit link</a>'; });

    // Bare image URLs
    s = s.replace(/(^|\s)(https?:\/\/[^\s]+?\.(?:png|jpe?g|gif|webp))(?!\))/gi,
      function (_m, lead, url) { return lead + '<img src="' + url + '" alt="" loading="lazy">'; });

    // Headings
    s = s.replace(/^\s*###\s+(.+)$/gm, '<h3>$1</h3>');
    s = s.replace(/^\s*##\s+(.+)$/gm, '<h2>$1</h2>');
    s = s.replace(/^\s*#\s+(.+)$/gm, '<h1>$1</h1>');

    // Bullet list items → wrap groups in <ul>
    s = s.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>');
    s = s.replace(/(?:<li>.*<\/li>\s*)+/g, function (m) { return '<ul>' + m + '</ul>'; });

    // Emphasis
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Paragraphs / line breaks
    s = s.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>');

    return '<p>' + s + '</p>';
  }

  /* ---------- shop & customer ---------- */
  function normalizeShop(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .trim();
  }
  function getShop() {
    var m = document.querySelector('meta[name="forum-shop"]');
    if (m && m.content) return normalizeShop(m.content);
    if (window.__FORUM_SHOP) return normalizeShop(window.__FORUM_SHOP);
    try { if (window.Shopify && Shopify.shop) return normalizeShop(Shopify.shop); } catch (_) { }
    var h = (location.hostname || '').toLowerCase();
    if (h.endsWith('.myshopify.com')) return normalizeShop(h);
    return '';
  }
  function getCustomerId() {
    var m = document.querySelector('meta[name="forum-customer-id"]');
    if (m && m.content) return m.content.trim();
    if (window.__FORUM_CUSTOMER__ && window.__FORUM_CUSTOMER__.id) return String(window.__FORUM_CUSTOMER__.id);
    try { if (window.Shopify && Shopify.customer && Shopify.customer.id) return String(Shopify.customer.id); } catch (_) { }
    return null;
  }
  function getCustomerName() {
    var m = document.querySelector('meta[name="forum-customer-name"]');
    if (m && m.content) return m.content.trim();
    if (window.__community && window.__community.customerName) return String(window.__community.customerName);
    try {
      if (window.Shopify && Shopify.customer && Shopify.customer.first_name) {
        var f = Shopify.customer.first_name || '';
        var l = Shopify.customer.last_name || '';
        return (f + ' ' + l).trim();
      }
    } catch (_) { }
    return '';
  }

  /* ---------- fetch helpers ---------- */
  function withTimeout(p, ms) {
    var t; var timeout = new Promise(function (_, rej) { t = setTimeout(function () { rej(new Error('Request timed out')); }, ms || TIMEOUT_MS); });
    return Promise.race([p, timeout]).finally(function () { clearTimeout(t); });
  }
  function toQuery(params) {
    if (!params) return '';
    var parts = [];
    Object.keys(params).forEach(function (k) {
      var v = params[k];
      if (v == null || v === '') return;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    return parts.length ? ('?' + parts.join('&')) : '';
  }
  function api(path, opts) {
    opts = opts || {};
    var base = (window.__FORUM_PROXY__ || '/apps/community') + path;
    var shop = window.__FORUM_SHOP__ || getShop();

    var merged = Object.assign({}, opts.qs || {});
    if (shop) merged.shop = shop;

    var q = toQuery(merged);
    var url = base + (base.indexOf('?') >= 0 ? (q ? '&' + q.slice(1) : '') : q);

    return withTimeout(fetch(url, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: opts.body ? JSON.stringify(opts.body) : undefined
    })).then(function (r) {
      if (!r.ok) { var e = new Error('API error: ' + r.status); e.status = r.status; throw e; }
      return r.json();
    });
  }
  function pingProxy() {
    return api('/ping').then(function (j) { return { ok: true, json: j }; }, function (e) { return { ok: false, error: e }; });
  }

  /* ---------- simple Markdown toolbar (textarea) ---------- */
  function surroundSelection(textarea, before, after) {
    textarea.focus();
    var start = textarea.selectionStart || 0;
    var end = textarea.selectionEnd || 0;
    var val = textarea.value;
    var selected = val.slice(start, end);
    var replacement = before + selected + (after == null ? '' : after);
    textarea.value = val.slice(0, start) + replacement + val.slice(end);
    textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function makeToolbar(target) {
    var bar = document.createElement('div');
    bar.className = 'community-row';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Formatting toolbar');
    bar.style.margin = '8px 0';

    function btn(text, title, onClick) {
      var b = document.createElement('button');
      b.className = 'community-btn';
      b.type = 'button';
      b.textContent = text;
      b.title = title;
      b.addEventListener('click', function () { onClick(target); });
      return b;
    }

    bar.appendChild(btn('H1', 'Heading', function (ta) { surroundSelection(ta, '# ', ''); }));
    bar.appendChild(btn('H2', 'Subheading', function (ta) { surroundSelection(ta, '## ', ''); }));
    bar.appendChild(btn('• List', 'Bulleted list', function (ta) { surroundSelection(ta, '- ', ''); }));
    bar.appendChild(btn('Link', 'Insert link', function (ta) {
      var url = prompt('Enter URL'); if (!url) return;
      surroundSelection(ta, '[', '](' + url + ')');
    }));
    bar.appendChild(btn('Image', 'Insert image/GIF', function (ta) {
      var url = prompt('Image URL'); if (!url) return;
      surroundSelection(ta, '![](', url + ')');
    }));
    return bar;
  }

  /* ---------- UI template (two-column layout) ---------- */
  function template(root) {
    injectStyles();
    root.innerHTML = [
      '<div class="community-box">',
      '  <div class="community-layout">',
      '    <aside class="community-sidebar">',
      '      <div class="side-card">',
      '        <div class="side-header">Categories</div>',
      '        <ul id="topic-list" class="topic-list" role="list"></ul>',
      '      </div>',
      '      <!-- hidden native select for accessibility/fallback -->',
      '      <select id="cat-filter" class="community-input" aria-label="Category filter" style="display:none"></select>',
      '    </aside>',
      '    <main class="community-main">',
      '      <div id="t-msg" class="community-meta" aria-live="polite" style="min-height:18px;margin:6px 0"></div>',
      '      <div class="controls">',
      '        <div style="position:relative;flex:1">',
      '          <input id="forum-search" class="community-input" aria-label="Search" placeholder="Search titles, tags, categories…" style="min-width:240px;width:100%"/>',
      '          <div id="forum-suggest" style="position:absolute;top:38px;left:0;right:0;background:#fff;border:1px solid #e5e7eb;display:none;z-index:5;border-radius:10px;overflow:hidden"></div>',
      '        </div>',
      '        <div class="filter-bar">',
      '          <select id="forum-sort" class="community-input" aria-label="Sort" style="width:auto">',
      '            <option value="">New</option>',
      '            <option value="top">Top</option>',
      '            <option value="discussed">Most discussed</option>',
      '            <option value="hot">Hot</option>',
      '          </select>',
      '          <select id="forum-period" class="community-input" aria-label="Top period" style="width:auto;display:none">',
      '            <option value="day">Day</option>',
      '            <option value="week" selected>Week</option>',
      '            <option value="month">Month</option>',
      '          </select>',
      '          <input id="forum-from" type="date" class="community-input" aria-label="From date" style="width:auto"/>',
      '          <input id="forum-to" type="date" class="community-input" aria-label="To date" style="width:auto"/>',
      '          <button id="forum-apply" class="community-btn" type="button" aria-label="Apply filters">Apply</button>',
      '          <button id="notif-btn" class="community-btn" type="button" style="position:relative">🔔 <span id="notif-badge" class="badge" style="display:none;margin-left:6px">0</span></button>',
      '          <div id="notif-panel" class="notif-panel" style="display:none"></div>',
      '        </div>',
      '      </div>',
      '      <div id="rte-bar"></div>',
      '      <textarea id="thread-body" class="community-textarea" rows="4" placeholder="Write details... Supports Markdown for headings, lists, links, and images."></textarea>',
      '      <div id="thread-preview" style="display:none;background:var(--c-soft);border:1px solid var(--c-border);padding:10px;border-radius:10px;"></div>',
      '      <div class="community-row" style="margin-top:8px">',
      '        <input id="thread-title" class="community-input" aria-label="Thread title" placeholder="Start a new thread (title)"/>',
      '        <input id="thread-tags" class="community-input" aria-label="Tags" placeholder="tags (comma separated)"/>',
      '        <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="thread-anon" aria-label="Post anonymously"/><span class="community-meta">Anonymous</span></label>',
      '        <button id="thread-preview-toggle" class="community-btn" type="button" aria-pressed="false">Preview</button>',
      '        <button id="thread-submit" class="community-btn primary">Post</button>',
      '      </div>',
      '      <div id="threads" role="list"></div>',
      '      <div id="load-more-wrap" style="text-align:center;margin:12px 0;display:none">',
      '        <button id="load-more" class="community-btn" type="button" aria-label="Load more threads">Load more</button>',
      '      </div>',
      '    </main>',
      '  </div>',
      '</div>'
    ].join('\n');

    // mount simple RTE toolbar
    var body = qs('#thread-body', root);
    var bar = makeToolbar(body);
    qs('#rte-bar', root).appendChild(bar);
  }

  /* ---------- notifications UI ---------- */
  function notifItemHTML(n) {
    var when = new Date(n.createdAt).toLocaleString();
    var body = '';
    if (n.type === 'reply') body = 'New reply on your thread';
    else if (n.type === 'mention') body = 'You were mentioned';
    else if (n.type === 'moderation') body = 'Moderation update: ' + (n.payload && n.payload.action);
    else if (n.type === 'poll_end') body = 'Poll closed';
    else if (n.type === 'announcement') body = (n.payload && n.payload.message) || 'Announcement';
    else if (n.type === 'digest') body = 'Weekly roundup';

    return '<li style="padding:6px 0;border-top:1px solid #eee">' +
      '<div><b>' + body + '</b></div>' +
      (n.payload && n.payload.threads
        ? '<div class="community-meta">' +
        (n.payload.threads || []).map(function (t) { return '• ' + escapeHtml(t.title) + ' (▲ ' + (t.votes || 0) + ')'; }).join('<br>') +
        '</div>'
        : '') +
      '<div class="community-meta">' + when + '</div>' +
      '</li>';
  }
  function renderNotifs(list) {
    if (!list || !list.length) return '<div class="community-meta">No notifications</div>';
    return '<ul style="margin:0;padding:0;list-style:none">' + list.map(notifItemHTML).join('') + '</ul>';
  }

  /* ---------- thread list rendering ---------- */
  function threadActionsHTML(t, cid) {
    var canEdit = cid && t.author && String(t.author.customerId || '') === String(cid || '') &&
      t.editableUntil && (new Date(t.editableUntil) > new Date());
    if (!canEdit) return '';
    return [
      '<div class="community-row" style="margin-top:6px">',
      '  <button class="community-btn t-edit" data-id="' + t._id + '" aria-label="Edit thread">Edit</button>',
      '  <button class="community-btn t-delete" data-id="' + t._id + '" aria-label="Delete thread">Delete</button>',
      '</div>',
      '<div class="t-edit-area" id="t-edit-' + t._id + '" style="display:none;margin-top:6px">',
      '  <input class="community-input t-edit-title" value="' + escapeHtml(t.title) + '"/>',
      '  <textarea class="community-textarea t-edit-body" rows="3">' + escapeHtml(t.body || '') + '</textarea>',
      '  <div class="community-row">',
      '    <button class="community-btn t-save" data-id="' + t._id + '" aria-label="Save edit">Save</button>',
      '    <button class="community-btn t-cancel" data-id="' + t._id + '" aria-label="Cancel edit">Cancel</button>',
      '  </div>',
      '  <div class="community-meta">You can edit/delete for a limited time.</div>',
      '</div>'
    ].join('');
  }

  function renderThreads(container, items, cid) {
    container.insertAdjacentHTML('beforeend', (items || []).map(function (t) {
      var isClosed = !!(t.closedAt || t.closed);
      var closedBadge = isClosed ? '<span class="badge">Closed</span>' : '';
      var pinnedBadge = t.pinned ? '<span class="badge">Pinned</span>' : '';
      var votes = typeof t.votes === 'number' ? t.votes : 0;

      var commentAccordion = [
        '<details class="comments-accordion" data-tid="' + t._id + '">',
        '  <summary><span class="summary-pill">💬 Comments</span></summary>',
        '  <div id="comments-' + t._id + '"></div>',
        '  <div class="community-row" style="margin-top:8px">',
        isClosed || t.locked
          ? '<div class="community-meta">Thread is ' + (isClosed ? 'closed' : 'locked') + ' — new replies are disabled.</div>'
          : [
            '  <input data-tid="' + t._id + '" class="community-input comment-input" placeholder="Write a comment..." aria-label="Write a comment"/>',
            '  <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" class="comment-anon" data-tid="' + t._id + '"/><span class="community-meta">Anonymous</span></label>',
            '  <button data-tid="' + t._id + '" class="community-btn comment-btn">Reply</button>',
            '  <button data-tid="' + t._id + '" class="community-btn report-btn" title="Report">Report</button>'
          ].join(''),
        '  </div>',
        '</details>'
      ].join('');

      return [
        '<div class="community-card" role="listitem">',
        '  <div class="card-head">',
        '    <div class="thread-title">' + escapeHtml(t.title) + ' ' + pinnedBadge + ' ' + closedBadge + '</div>',
        '    <button class="vote" aria-label="Upvote thread" aria-pressed="false" data-type="thread" data-id="' + t._id + '" data-voted="0">▲ ' + votes + '</button>',
        '  </div>',
        '  <div class="community-meta">' + new Date(t.createdAt).toLocaleString() + '</div>',
        '  <div class="thread-body">' + renderMarkdown(t.body || '') + '</div>',
        '  <div style="margin:6px 0;">' + (t.tags || []).map(function (x) { return '<span class="community-tag">#' + escapeHtml(x) + '</span>'; }).join('') + '</div>',
        threadActionsHTML(t, cid),
        commentAccordion,
        '</div>'
      ].join('');
    }).join(''));
  }

  /* ---------- comments (with reply dropdowns) ---------- */
  function renderCommentTree(list, cid) {
    function one(c, depth) {
      var pad = 'style="margin-left:' + (depth * 0) + 'px"'; // visual offset handled by replies <details>
      var anon = c && c.author && c.author.isAnonymous;
      var name = anon ? 'anon' : (c && c.author && (c.author.displayName || c.author.name) || 'anon');
      var safeName = escapeHtml(name);
      var votes = typeof c.votes === 'number' ? c.votes : 0;
      var selfActions = '';
      var canDel = cid && c.author && String(c.author.customerId || '') === String(cid || '') &&
        c.editableUntil && (new Date(c.editableUntil) > new Date());
      if (canDel) {
        selfActions += '<button class="community-btn c-delete" data-id="' + c._id + '">Delete</button>';
      }
      var replyBtn = '<button class="community-btn reply-btn" data-cid="' + c._id + '" data-depth="' + (c.depth || 0) + '">Reply</button>';

      var self =
        '<div class="community-comment" ' + pad + '>' +
        '<button class="vote" aria-label="Upvote comment" aria-pressed="false" data-type="comment" data-id="' + c._id + '" data-voted="0" style="margin-right:8px">▲ ' + votes + '</button>' +
        '<b>' + safeName + '</b>: <span class="comment-body">' + renderMarkdown(c.body || '') + '</span>' +
        ' <span class="comment-actions">' + replyBtn + ' ' + selfActions + '</span>' +
        '</div>';

      var kidsHTML = (c.children || []).map(function (k) { return one(k, depth + 1); }).join('');
      if (kidsHTML) {
        kidsHTML = '<div class="replies"><details><summary>Show replies (' + (c.children || []).length + ')</summary><div>' + kidsHTML + '</div></details></div>';
      }
      return self + kidsHTML;
    }
    return (list || []).map(function (c) { return one(c, 0); }).join('') || '<div class="community-meta">No comments yet</div>';
  }

  function loadCommentsForThread(tid, cid) {
    var box = document.getElementById('comments-' + tid);
    if (!box) return;
    if (box.__loaded) return; // only load once when accordion opens
    box.innerHTML = '<div class="community-meta">Loading comments…</div>';
    api('/comments', { qs: { threadId: tid } })
      .then(function (j) {
        if (!j || !j.success) { box.innerHTML = '<div class="community-meta">Failed to load</div>'; return; }
        box.innerHTML = renderCommentTree(j.items || [], cid);
        box.__loaded = true;
      })
      .catch(function (e) { box.innerHTML = '<div class="community-meta">Failed: ' + e.message + '</div>'; });
  }

  /* ---------- polls ---------- */
  function renderPollHTML(poll, canShowCounts) {
    var name = 'poll-' + poll._id;
    var type = poll.multipleAllowed ? 'checkbox' : 'radio';
    var opts = (poll.options || []).map(function (o) {
      var count = (canShowCounts && typeof o.votes === 'number') ? ' <span class="community-meta">(' + o.votes + ')</span>' : '';
      return (
        '<label class="community-poll-option" style="display:block;margin:4px 0">' +
        '<input type="' + type + '" name="' + name + '" value="' + o.id + '"/>' +
        ' ' + escapeHtml(o.text) + count +
        '</label>'
      );
    }).join('');
    var closed = poll.status === 'closed';
    var disabled = closed ? 'disabled' : '';
    var footer = closed
      ? '<div class="community-meta">Poll closed</div>'
      : '<button class="community-btn poll-vote-btn" ' + disabled + '>Vote</button>';
    return (
      '<div class="community-poll-card" style="padding:8px;border:1px dashed #ddd;border-radius:8px">' +
      '<div style="font-weight:600;margin-bottom:6px">' + escapeHtml(poll.question || 'Poll') + '</div>' +
      opts + footer +
      '</div>'
    );
  }
  function loadPoll(threadId, SHOP, cid) {
    var box = document.getElementById('poll-' + threadId);
    if (!box) return;
    var votedKey = 'poll_voted_' + SHOP + '_' + threadId;
    var viewerHasVoted = localStorage.getItem(votedKey) === '1';
    api('/polls/' + encodeURIComponent(threadId), { qs: { viewerHasVoted: viewerHasVoted ? 'true' : 'false' } })
      .then(function (res) {
        if (!res || !res.success || !res.poll) { box.innerHTML = ''; return; }
        var poll = res.poll;
        var canShowCounts = viewerHasVoted || poll.showResults === 'always' || poll.status === 'closed';
        box.innerHTML = renderPollHTML(poll, canShowCounts);
        var voteBtn = box.querySelector('.poll-vote-btn');
        if (!voteBtn || poll.status === 'closed') return;
        voteBtn.addEventListener('click', function () {
          var cid = getCustomerId();
          if (!cid) { alert('Please log in to vote.'); return; }
          var inputs = box.querySelectorAll('input[name="poll-' + poll._id + '"]:checked');
          var chosen = Array.prototype.map.call(inputs, function (el) { return el.value; });
          if (!chosen.length) { alert('Select at least one option'); return; }
          voteBtn.disabled = true;
          api('/polls/' + encodeURIComponent(threadId) + '/vote', {
            method: 'POST',
            body: { optionIds: chosen, customer_id: cid }
          })
            .then(function (out) {
              if (!out || !out.success) throw new Error((out && out.message) || 'Vote failed');
              localStorage.setItem(votedKey, '1');
              loadPoll(threadId, SHOP, cid);
            })
            .catch(function (e) { alert('Vote failed: ' + e.message); })
            .finally(function () { voteBtn.disabled = false; });
        });
      })
      .catch(function () { box.innerHTML = ''; });
  }

  /* ---------- inline replies ---------- */
  function wireCommentReplies(container, cid, SHOP) {
    container.addEventListener('click', function (ev) {
      var del = ev.target.closest('.c-delete');
      if (del) {
        var id = del.getAttribute('data-id');
        if (!confirm('Delete this comment?')) return;
        api('/comments/' + id, { method: 'DELETE', body: { customer_id: cid } })
          .then(function (out) {
            if (!out || !out.success) throw new Error((out && out.message) || 'Delete failed');
            del.closest('.community-comment').remove();
          })
          .catch(function (e) { alert('Failed: ' + e.message); });
        return;
      }

      var btn = ev.target.closest('.reply-btn');
      if (!btn) return;
      if (!cid) return alert('Please log in to participate.');

      var parentId = btn.getAttribute('data-cid');
      var depth = parseInt(btn.getAttribute('data-depth') || '0', 10);
      if (depth >= 3) { alert('Max reply depth reached'); return; }

      var existing = btn.parentElement.parentElement.querySelector('.reply-form');
      if (existing) { existing.querySelector('textarea').focus(); return; }

      var f = document.createElement('div');
      f.className = 'reply-form';
      f.style.margin = '6px 0 6px 0';
      f.innerHTML = [
        '<div class="community-row" style="margin-left:8px">',
        '  <textarea class="community-textarea" rows="2" placeholder="Write a reply..."></textarea>',
        '  <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" class="reply-anon"/><span class="community-meta">Anonymous</span></label>',
        '  <button class="community-btn do-send">Send</button>',
        '  <button class="community-btn do-cancel" type="button">Cancel</button>',
        '</div>'
      ].join('');
      btn.parentElement.parentElement.insertAdjacentElement('afterend', f);

      f.querySelector('.do-cancel').addEventListener('click', function () { f.remove(); });
      f.querySelector('.do-send').addEventListener('click', function () {
        var txt = (f.querySelector('textarea').value || '').trim();
        var anon = !!f.querySelector('.reply-anon').checked;
        if (!txt) return;
        var displayName = anon ? '' : getCustomerName();
        var tid = btn.closest('.community-card').querySelector('.comments-accordion').getAttribute('data-tid');
        api('/comments', {
          method: 'POST',
          body: { threadId: tid, parentId: parentId, body: txt, isAnonymous: anon, customer_id: cid, display_name: displayName }
        })
          .then(function () {
            var pending = document.createElement('div');
            pending.className = 'community-meta';
            pending.textContent = 'Reply submitted for review.';
            f.insertAdjacentElement('afterend', pending);
            f.remove();
          })
          .catch(function (e) { alert('Failed: ' + e.message); });
      });
    });
  }

  /* ---------- wire actions on threads ---------- */
  function wireThreadActions(container, cid, SHOP) {
    // Save comment drafts by thread
    qsa('.comment-input', container).forEach(function (input) {
      var tid = input.getAttribute('data-tid');
      var key = 'forum_draft_' + SHOP + '_' + (cid || 'anon') + '_comment_' + tid;
      try { var saved = JSON.parse(localStorage.getItem(key) || '{}'); if (saved.b) input.value = saved.b; } catch (_) { }
      input.addEventListener('input', debounce(function () {
        localStorage.setItem(key, JSON.stringify({ b: input.value, at: Date.now() }));
      }, 300));
    });

    // Voting
    qsa('.vote', container).forEach(function (el) {
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-pressed', 'false');
      function doVote() {
        if (!cid) { alert('Please log in to participate.'); return; }
        if (el.__voteLock) return;
        el.__voteLock = true;
        var id = el.getAttribute('data-id');
        var targetType = el.getAttribute('data-type') || 'thread';
        var current = parseInt((el.textContent.match(/\d+/) || ['0'])[0], 10);
        var wasVoted = el.getAttribute('data-voted') === '1';
        api('/votes/toggle', { method: 'POST', body: { targetType: targetType, targetId: id, customer_id: cid } })
          .then(function (out) {
            if (!out || !out.success) throw new Error((out && out.message) || 'Vote failed');
            var nowVoted = !!out.voted;
            var delta = (nowVoted ? 1 : 0) - (wasVoted ? 1 : 0);
            var next = Math.max(0, current + delta);
            el.setAttribute('data-voted', nowVoted ? '1' : '0');
            el.setAttribute('aria-pressed', nowVoted ? 'true' : 'false');
            el.textContent = '▲ ' + next;
            if (nowVoted) el.classList.add('voted'); else el.classList.remove('voted');
          })
          .catch(function (e) { alert('Vote failed: ' + e.message); })
          .finally(function () { el.__voteLock = false; });
      }
      el.addEventListener('click', doVote);
      el.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); doVote(); } });
    });

    // Submit new comment
    qsa('.comment-btn', container).forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!cid) return alert('Please log in to participate.');
        var tid = btn.getAttribute('data-tid');
        var input = qs('.comment-input[data-tid="' + tid + '"]', container);
        var anon = qs('.comment-anon[data-tid="' + tid + '"]', container).checked;
        if (!input || !input.value.trim()) return;
        var displayName = anon ? '' : getCustomerName();
        var text = input.value;
        var box = document.getElementById('comments-' + tid);
        if (box) {
          var pending = document.createElement('div');
          pending.className = 'community-meta';
          pending.textContent = 'Comment submitted for review.';
          box.appendChild(pending);
        }
        api('/comments', { method: 'POST', body: { threadId: tid, body: text, isAnonymous: anon, customer_id: cid, display_name: displayName } })
          .then(function () {
            var key = 'forum_draft_' + SHOP + '_' + (cid || 'anon') + '_comment_' + tid;
            localStorage.removeItem(key);
            input.value = '';
          })
          .catch(function (e) { alert('Failed: ' + e.message); });
      });
    });

    // Lazy-load comments when accordion opens
    qsa('.comments-accordion', container).forEach(function (d) {
      d.addEventListener('toggle', function () {
        if (d.open) {
          var tid = d.getAttribute('data-tid');
          loadCommentsForThread(tid, cid);
          loadPoll(tid, SHOP, cid); // if any
        }
      });
    });

    wireCommentReplies(container, cid, SHOP);
  }

  /* ---------- categories (sidebar + hidden select) ---------- */
  function renderTopicList(items) {
    var html = ['<li><button class="topic-item active" data-id=""><span class="topic-hash">#</span> All</button></li>']
      .concat((items || []).map(function (c) {
        return '<li><button class="topic-item" data-id="' + c._id + '"><span class="topic-hash">#</span> ' + escapeHtml(c.name) + '</button></li>';
      })).join('');
    return html;
  }

  function loadCategories(sel, tMsg, SHOP) {
    return api('/categories', { qs: { shop: SHOP } })
      .then(function (data) {
        var opts = ['<option value="">All categories</option>'].concat((data.items || []).map(function (c) {
          return '<option value="' + c._id + '">' + escapeHtml(c.name) + '</option>';
        })).join('');
        sel.innerHTML = opts;

        var list = qs('#topic-list');
        if (list) {
          list.innerHTML = renderTopicList(data.items || []);
          list.addEventListener('click', function (e) {
            var btn = e.target.closest('.topic-item'); if (!btn) return;
            qsa('.topic-item', list).forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            sel.value = btn.getAttribute('data-id') || '';
            // trigger refresh outside:
            var ev = new CustomEvent('topic-change', { bubbles: true });
            list.dispatchEvent(ev);
          });
        }
      })
      .catch(function (e) { setMsg(tMsg, 'Could not load categories: ' + e.message, true); });
  }

  /* ---------- filters + thread load ---------- */
  function getControls(root) {
    return {
      category: qs('#cat-filter', root).value || '',
      sort: qs('#forum-sort', root).value || '',
      period: qs('#forum-period', root).style.display !== 'none' ? (qs('#forum-period', root).value || '') : '',
      from: qs('#forum-from', root).value || '',
      to: qs('#forum-to', root).value || '',
      search: qs('#forum-search', root).value.trim()
    };
  }

  function loadThreads(container, tMsg, cid, SHOP, root, opts) {
    opts = opts || {};
    if (!container.__state || opts.reset) {
      container.__state = { next: null, loading: false };
      container.innerHTML = '';
    }
    if (container.__state.loading) return Promise.resolve();
    container.__state.loading = true;

    var ctl = getControls(root);
    var params = {};
    if (ctl.category) params.categoryId = ctl.category;
    if (ctl.search) params.q = ctl.search;
    if (ctl.sort) params.sort = ctl.sort;
    if (ctl.sort === 'top' && ctl.period) params.period = ctl.period;
    if (ctl.from) params.from = ctl.from;
    if (ctl.to) params.to = ctl.to;
    if (container.__state.next) params.cursor = container.__state.next;

    if (!container.__state.next) loading(container, true);
    var moreWrap = qs('#load-more-wrap', root);
    if (moreWrap) moreWrap.style.display = 'none';

    return api('/threads', { qs: params })
      .then(function (data) {
        var items = data.items || [];
        loading(container, false);
        renderThreads(container, items, cid);
        // Comments now lazy-loaded when each accordion is opened
        wireThreadActions(container, cid, SHOP);

        container.__state.next = data.next || null;
        var btn = qs('#load-more', root);
        if (container.__state.next) {
          moreWrap.style.display = 'block';
          btn.onclick = function () { loadThreads(container, tMsg, cid, SHOP, root, { reset: false }); };
          if (!container.__io) {
            var io = new IntersectionObserver(function (entries) {
              entries.forEach(function (e) {
                if (e.isIntersecting && container.__state.next) {
                  loadThreads(container, tMsg, cid, SHOP, root, { reset: false });
                }
              });
            }, { rootMargin: '200px' });
            io.observe(moreWrap);
            container.__io = io;
          }
        } else {
          moreWrap.style.display = 'none';
        }
      })
      .catch(function (e) {
        loading(container, false);
        setMsg(tMsg, 'Could not load threads: ' + e.message, true);
      })
      .finally(function () { container.__state.loading = false; });
  }

  /* ---------- suggest (typeahead) ---------- */
  function wireSuggest(root, SHOP, load) {
    var input = qs('#forum-search', root);
    var box = qs('#forum-suggest', root);
    function hide() { box.style.display = 'none'; box.innerHTML = ''; }
    function show(html) { box.innerHTML = html; box.style.display = html ? 'block' : 'none'; }
    function row(html) { return '<div class="s-item" style="padding:8px 10px;cursor:pointer;border-top:1px solid #eee">' + html + '</div>'; }

    var doSuggest = debounce(function () {
      var q = input.value.trim(); if (!q) { hide(); return; }
      api('/suggest', { qs: { q: q } }).then(function (data) {
        data = data || {};
        var titles = (data.titles || []).map(function (t) { return row(escapeHtml(t.title)); }).join('');
        var tags = (data.tags || []).map(function (t) { return row('#' + escapeHtml(t)); }).join('');
        var cats = (data.categories || []).map(function (c) { return row('📂 ' + escapeHtml(c.name) + ' (' + escapeHtml(c.slug) + ')'); }).join('');
        var content = '';
        if (titles) content += '<div style="padding:6px 8px;font-weight:600;background:#fafafa;border-bottom:1px solid #eee">Titles</div>' + titles;
        if (tags) content += '<div style="padding:6px 8px;font-weight:600;background:#fafafa;border-bottom:1px solid #eee">Tags</div>' + tags;
        if (cats) content += '<div style="padding:6px 8px;font-weight:600;background:#fafafa;border-bottom:1px solid #eee">Categories</div>' + cats;
        show(content || '');
      }).catch(function () { hide(); });
    }, 150);

    input.addEventListener('input', doSuggest);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); hide(); load({ reset: true }); } });
    input.addEventListener('blur', function () { setTimeout(hide, 150); });

    box.addEventListener('mousedown', function (e) {
      var item = e.target.closest('.s-item'); if (!item) return;
      var text = item.textContent.trim();
      if (text.startsWith('#')) input.value = 'tag:' + text.slice(1) + ' ';
      else if (text.startsWith('📂')) {
        var slug = (text.match(/\(([^)]+)\)\s*$/) || [])[1] || '';
        input.value = 'cat:' + slug + ' ';
      } else { input.value = text; }
      hide(); load({ reset: true });
    });
  }

  /* ---------- draft + preview ---------- */
  function wireThreadDraft(root, SHOP, cid) {
    var title = qs('#thread-title', root);
    var body = qs('#thread-body', root);
    var preview = qs('#thread-preview', root);
    var toggleBtn = qs('#thread-preview-toggle', root);
    if (!title || !body || !toggleBtn) return;

    var key = 'forum_draft_' + SHOP + '_' + (cid || 'anon') + '_thread';
    try {
      var saved = JSON.parse(localStorage.getItem(key) || '{}');
      if (saved.t) title.value = saved.t;
      if (saved.b) body.value = saved.b;
    } catch (_) { }
    var save = debounce(function () { localStorage.setItem(key, JSON.stringify({ t: title.value, b: body.value, at: Date.now() })); }, 300);
    title.addEventListener('input', save);
    body.addEventListener('input', save);

    var on = false;
    toggleBtn.addEventListener('click', function () {
      on = !on;
      toggleBtn.textContent = on ? 'Edit' : 'Preview';
      toggleBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      body.style.display = on ? 'none' : 'block';
      preview.style.display = on ? 'block' : 'none';
      var md = (title.value ? ('# ' + title.value + '\n\n') : '') + (body.value || '');
      preview.innerHTML = renderMarkdown(md);
    });

    return { clear: function () { localStorage.removeItem(key); } };
  }

  /* ---------- PUBLIC API ---------- */
  window.ForumWidget = {
    mount: function (selector, opts) {
      opts = opts || {};
      var root = qs(selector); if (!root) return;

      if (isDesignMode()) {
        root.innerHTML = '<div class="community-box">Community widget preview is unavailable in the Theme Editor. Open the storefront (View store) to test.</div>';
        return;
      }

      window.__FORUM_PROXY__ = opts.proxyUrl || '/apps/community';
      window.__FORUM_SHOP__ = getShop();

      var SHOP = getShop();
      var cid = getCustomerId();

      // private forum → require login
      if (!cid) {
        root.innerHTML = '<div class="community-box">Please <a href="/account/login">log in</a> to view and participate in the community.</div>';
        return;
      }
      if (!SHOP) {
        root.innerHTML = '<div class="community-box">Shop domain not detected. Add <meta name="forum-shop" content="{{ shop.permanent_domain }}"> to theme.</div>';
        return;
      }

      template(root);

      /* Notifications */
      var badge = qs('#notif-badge', root);
      var panel = qs('#notif-panel', root);
      function loadNotifs() {
        return api('/notifications', { qs: { customer_id: cid, limit: 20 } })
          .then(function (j) {
            var unread = (j && j.unread) || 0;
            if (badge) {
              badge.textContent = unread;
              badge.style.display = unread > 0 ? 'inline-block' : 'none';
            }
            if (panel) panel.innerHTML = renderNotifs(j.items || []);
          })
          .catch(function () { /* ignore */ });
      }
      var bell = qs('#notif-btn', root);
      if (bell) {
        bell.addEventListener('click', function () {
          var open = panel.style.display === 'block';
          if (!open) {
            loadNotifs().then(function () {
              panel.style.display = 'block';
              api('/notifications/mark-read', { method: 'POST', body: { customer_id: cid, all: true } })
                .then(function () { if (badge) badge.style.display = 'none'; });
            });
          } else {
            panel.style.display = 'none';
          }
        });
        document.addEventListener('click', function (e) {
          if (!panel) return;
          if (!panel.contains(e.target) && !bell.contains(e.target)) {
            panel.style.display = 'none';
          }
        });
        setInterval(loadNotifs, 60000);
        loadNotifs();
      }

      var tMsg = qs('#t-msg', root);
      var sel = qs('#cat-filter', root);
      var list = qs('#threads', root);
      var loadNow = function (opts) { return loadThreads(list, tMsg, cid, SHOP, root, Object.assign({ reset: true }, opts || {})); };

      pingProxy().then(function (res) {
        if (!res.ok) {
          var status = (res.error && res.error.status) || 'unknown';
          setMsg(tMsg, 'App proxy not reachable (status ' + status + '). Check App Proxy & shared secret.', true);
          return;
        }

        var sortSel = qs('#forum-sort', root);
        var periodSel = qs('#forum-period', root);
        function togglePeriod() { periodSel.style.display = (sortSel.value === 'top') ? 'inline-block' : 'none'; }
        sortSel.addEventListener('change', function () { togglePeriod(); loadNow(); });
        periodSel.addEventListener('change', function () { loadNow(); });
        qs('#forum-apply', root).addEventListener('click', function () { loadNow(); });

        wireSuggest(root, SHOP, loadNow);
        loadCategories(sel, tMsg, SHOP).then(function () { return loadNow(); });

        // React to sidebar topic clicks
        var topicList = qs('#topic-list', root);
        if (topicList) topicList.addEventListener('topic-change', function () { loadNow(); });

        var draft = wireThreadDraft(root, SHOP, cid);
        qs('#thread-submit', root).addEventListener('click', function () {
          var title = (qs('#thread-title', root).value || '').trim();
          if (!title) return setMsg(tMsg, 'Title required', true);
          var body = (qs('#thread-body', root).value || '').trim();
          var tags = (qs('#thread-tags', root).value || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
          var anon = !!qs('#thread-anon', root).checked;
          var categoryId = sel.value || null;
          var displayName = anon ? '' : getCustomerName();

          api('/threads', {
            method: 'POST',
            body: {
              title: title,
              body: body,
              tags: tags,
              isAnonymous: anon,
              categoryId: categoryId,
              customer_id: cid,
              display_name: displayName
            }
          })
            .then(function (out) {
              setMsg(tMsg, (out && out.message) || (out && out.success ? 'Submitted for review' : 'Failed'));
              qs('#thread-title', root).value = '';
              qs('#thread-body', root).value = '';
              qs('#thread-tags', root).value = '';
              if (draft) draft.clear();

              var preview = qs('#thread-preview', root);
              var toggle = qs('#thread-preview-toggle', root);
              if (preview.style.display === 'block') {
                preview.style.display = 'none';
                qs('#thread-body', root).style.display = 'block';
                toggle.textContent = 'Preview';
                toggle.setAttribute('aria-pressed', 'false');
              }

              var tmp = {
                _id: 'tmp-' + Date.now(),
                title: title + ' (pending review)',
                body: body,
                tags: tags,
                author: { customerId: cid },
                createdAt: new Date().toISOString(),
                pinned: false,
                closedAt: null,
                votes: 0,
                editableUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString()
              };
              renderThreads(list, [tmp], cid);
              wireThreadActions(list, cid, SHOP);
            })
            .catch(function (e) { setMsg(tMsg, 'Failed: ' + e.message, true); });
        });
      });
    }
  };
})();
