// /public/forum-widget.js
(function () {
  var TIMEOUT_MS = 10000;

  /* ---------- tiny DOM helpers ---------- */
  function qs(s, r) { return (r || document).querySelector(s); }
  function qsa(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); }
  function setMsg(el, t, isErr) { el.textContent = t || ''; el.style.color = isErr ? '#b00020' : '#666'; if (t) setTimeout(function () { el.textContent = ''; }, 3500); }
  function loading(el, on) { if (!el) return; el.innerHTML = on ? '<div class="community-meta">Loading…</div>' : ''; }
  function isDesignMode() { try { return !!(window.Shopify && Shopify.designMode); } catch (_) { return false; } }
  var debounce = function (fn, ms) { var t; return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms || 200); }; };

  /* ---------- robust shop, customer & display name detection ---------- */
  function normalizeShop(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .trim();
  }
  function getShop() {
    // meta
    var m = document.querySelector('meta[name="forum-shop"]');
    if (m && m.content) return normalizeShop(m.content);
    // window var
    if (window.__FORUM_SHOP) return normalizeShop(window.__FORUM_SHOP);
    // Shopify global
    try { if (window.Shopify && Shopify.shop) return normalizeShop(Shopify.shop); } catch (_) {}
    // hostname fallback
    var h = (location.hostname || '').toLowerCase();
    if (h.endsWith('.myshopify.com')) return normalizeShop(h);
    return '';
  }
  function getCustomerId() {
    var m = document.querySelector('meta[name="forum-customer-id"]');
    if (m && m.content) return m.content.trim();
    if (window.__FORUM_CUSTOMER__ && window.__FORUM_CUSTOMER__.id) return String(window.__FORUM_CUSTOMER__.id);
    try { if (window.Shopify && Shopify.customer && Shopify.customer.id) return String(Shopify.customer.id); } catch (_) {}
    return null;
  }
  function getDisplayName() {
    // Optional meta you can set via Liquid: <meta name="forum-customer-name" content="{{ customer.first_name }} {{ customer.last_name }}">
    var m = document.querySelector('meta[name="forum-customer-name"]');
    if (m && m.content) return m.content.trim();
    if (window.__FORUM_CUSTOMER__ && window.__FORUM_CUSTOMER__.name) return String(window.__FORUM_CUSTOMER__.name);
    // Some themes expose first/last name (rare)
    try {
      if (window.Shopify && Shopify.customer) {
        var c = Shopify.customer;
        if (c.first_name || c.last_name) return ((c.first_name || '') + ' ' + (c.last_name || '')).trim();
      }
    } catch(_) {}
    return '';
  }

  /* ---------- fetch helpers with query support ---------- */
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

    // append qs object if provided
    if (opts.qs) {
      var q = toQuery(opts.qs);
      if (q) base += (base.indexOf('?') >= 0 ? '&' : '?') + q.slice(1);
    }

    // ensure we always append ?shop=...
    var shop = window.__FORUM_SHOP__ || getShop();
    if (shop) base += (base.indexOf('?') >= 0 ? '&' : '?') + 'shop=' + encodeURIComponent(shop);

    return withTimeout(fetch(base, {
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

  /* ---------- UI template ---------- */
  function template(root) {
    root.innerHTML = [
      '<div class="community-box">',
      '  <div id="t-msg" class="community-meta" style="min-height:18px;margin-bottom:6px"></div>',

      // Controls row: search + suggest + sort + period + date range
      '  <div class="community-row" style="flex-wrap:wrap;gap:8px;align-items:center">',
      '    <div style="position:relative">',
      '      <input id="forum-search" class="community-input" placeholder="Search titles, tags, categories…" style="min-width:220px"/>',
      '      <div id="forum-suggest" style="position:absolute;top:34px;left:0;right:0;background:#fff;border:1px solid #ddd;display:none;z-index:5"></div>',
      '    </div>',
      '    <select id="forum-sort" class="community-input" style="width:auto">',
      '      <option value="">New</option>',
      '      <option value="top">Top</option>',
      '      <option value="discussed">Most discussed</option>',
      '      <option value="hot">Hot</option>',
      '    </select>',
      '    <select id="forum-period" class="community-input" style="width:auto;display:none">',
      '      <option value="day">Day</option>',
      '      <option value="week" selected>Week</option>',
      '      <option value="month">Month</option>',
      '    </select>',
      '    <input id="forum-from" type="date" class="community-input" style="width:auto"/>',
      '    <input id="forum-to" type="date" class="community-input" style="width:auto"/>',
      '    <button id="forum-apply" class="community-btn" type="button">Apply</button>',
      '  </div>',

      // New thread composer
      '  <div class="community-row" style="margin-top:8px">',
      '    <select id="cat-filter" class="community-input"></select>',
      '    <input id="thread-title" class="community-input" placeholder="Start a new thread (title)"/>',
      '  </div>',
      '  <textarea id="thread-body" class="community-textarea" rows="3" placeholder="Write details..."></textarea>',
      '  <pre id="thread-preview" style="display:none;background:#fafafa;border:1px solid #eee;padding:10px;border-radius:6px;white-space:pre-wrap"></pre>',
      '  <div class="community-row">',
      '    <input id="thread-tags" class="community-input" placeholder="tags (comma separated)"/>',
      '    <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="thread-anon"/><span class="community-meta">Anonymous</span></label>',
      '    <button id="thread-preview-toggle" class="community-btn" type="button">Preview</button>',
      '    <button id="thread-submit" class="community-btn">Post</button>',
      '  </div>',

      '  <hr/>',
      '  <div id="threads"></div>',
      '</div>'
    ].join('\n');
  }

  /* ---------- thread list rendering ---------- */
  function renderThreads(container, items) {
    container.innerHTML = (items || []).map(function (t) {
      return [
        '<div class="community-card">',
        '  <div style="display:flex;justify-content:space-between;align-items:center">',
        '    <div><strong>' + escapeHtml(t.title) + '</strong> ' + (t.pinned ? '<span class="badge">Pinned</span>' : '') + ' ' + (t.closed ? '<span class="badge">Closed</span>' : '') + '</div>',
        '    <button class="vote" data-type="thread" data-id="' + t._id + '" data-voted="0" style="cursor:pointer;background:none;border:none">▲ ' + (t.votes || 0) + '</button>',
        '  </div>',
        '  <div class="community-meta">' + new Date(t.createdAt).toLocaleString() + '</div>',
        '  <div>' + escapeHtml(t.body || '') + '</div>',
        '  <div style="margin:6px 0;">' + (t.tags || []).map(function (x) { return '<span class="community-tag">' + escapeHtml(x) + '</span>'; }).join('') + '</div>',
        '  <div id="comments-' + t._id + '"></div>',
        '  <div class="community-row">',
        '    <input data-tid="' + t._id + '" class="community-input comment-input" placeholder="Write a comment..."/>',
        '    <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" class="comment-anon" data-tid="' + t._id + '"/><span class="community-meta">Anonymous</span></label>',
        '    <button data-tid="' + t._id + '" class="community-btn comment-btn">Reply</button>',
        '    <button data-tid="' + t._id + '" class="community-btn report-btn" title="Report">Report</button>',
        '  </div>',
        '</div>'
      ].join('');
    }).join('');
  }

  /* ---------- comments: render tree + wires for replies ---------- */
  function renderCommentTree(list, tid) {
    function one(c, depth) {
      var pad = 'style="margin-left:' + (depth * 16) + 'px;margin-top:6px"';
      var a = escapeHtml(c.author && (c.author.displayName || c.author.name) || 'anon');
      var b = escapeHtml(c.body || '');
      var canReply = (typeof c.depth === 'number' ? c.depth : depth) < 3; // UI guard; server also enforces
      var replyBtn = canReply ? (' <button class="reply-btn" data-cid="' + c._id + '" data-depth="' + (typeof c.depth === 'number' ? c.depth : depth) + '" data-tid="' + tid + '" style="margin-left:8px">Reply</button>') : '';
      return '<div class="community-comment" ' + pad + '><b>' + a + ':</b> ' + b + replyBtn + '</div>' +
        (c.children || []).map(function (k) { return one(k, (typeof c.depth === 'number' ? c.depth : depth) + 1); }).join('');
    }
    return (list || []).map(function (c) { return one(c, c.depth || 0); }).join('') || '<div class="community-meta">No comments yet</div>';
  }

  function wireCommentReplies(scope, SHOP, cid) {
    // event delegation: add inline reply form when clicking "Reply"
    scope.addEventListener('click', function (ev) {
      var btn = ev.target.closest('.reply-btn'); if (!btn) return;
      if (!cid) { alert('Please log in to participate.'); return; }

      var depth = parseInt(btn.getAttribute('data-depth') || '0', 10);
      if (depth >= 3) { alert('Max reply depth reached'); return; }

      // prevent duplicate forms
      if (btn.__hasForm) return;
      btn.__hasForm = true;

      var parent = btn.parentNode;
      var tid = btn.getAttribute('data-tid');
      var cidParent = btn.getAttribute('data-cid');

      var wrap = document.createElement('div');
      wrap.style.marginLeft = '12px';
      wrap.innerHTML =
        '<div class="community-row" style="margin-top:6px">' +
        '  <input class="community-input inline-reply-body" placeholder="Write a reply..."/>' +
        '  <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" class="inline-reply-anon"/><span class="community-meta">Anonymous</span></label>' +
        '  <button class="community-btn inline-reply-send">Send</button>' +
        '  <button class="community-btn inline-reply-cancel" style="background:#eee;color:#333">Cancel</button>' +
        '</div>';

      parent.appendChild(wrap);

      var bodyEl = qs('.inline-reply-body', wrap);
      var anonEl = qs('.inline-reply-anon', wrap);
      var send = qs('.inline-reply-send', wrap);
      var cancel = qs('.inline-reply-cancel', wrap);

      // draft autosave per parent comment
      var draftKey = 'forum_draft_' + SHOP + '_' + (cid || 'anon') + '_reply_' + cidParent;
      try {
        var saved = JSON.parse(localStorage.getItem(draftKey) || '{}');
        if (saved.b) bodyEl.value = saved.b;
      } catch (_) {}
      bodyEl.addEventListener('input', debounce(function () {
        localStorage.setItem(draftKey, JSON.stringify({ b: bodyEl.value, at: Date.now() }));
      }, 300));

      send.addEventListener('click', function () {
        var text = (bodyEl.value || '').trim();
        if (!text) return;
        api('/comments', {
          method: 'POST',
          body: {
            threadId: tid,
            parentId: cidParent,
            body: text,
            isAnonymous: !!anonEl.checked,
            customer_id: cid,
            display_name: getDisplayName()
          }
        }).then(function (out) {
          localStorage.removeItem(draftKey);
          if (!out || !out.success) { alert((out && out.message) || 'Failed'); return; }
          // reload comments after posting
          loadCommentsForThread(tid);
        }).catch(function (e) { alert('Failed: ' + e.message); })
          .finally(function () { btn.__hasForm = false; wrap.remove(); });
      });

      cancel.addEventListener('click', function () {
        btn.__hasForm = false; wrap.remove();
      });
    });
  }

  function loadCommentsForThread(tid) {
    var box = document.getElementById('comments-' + tid);
    if (!box) return;
    box.innerHTML = '<div class="community-meta">Loading comments…</div>';
    api('/comments', { qs: { threadId: tid } })
      .then(function (j) {
        if (!j || !j.success) { box.innerHTML = '<div class="community-meta">Failed to load</div>'; return; }
        box.innerHTML = renderCommentTree(j.items || [], tid);
        // wire reply buttons in this comments box
        wireCommentReplies(box, (window.__FORUM_SHOP__ || getShop()), getCustomerId());
      })
      .catch(function (e) { box.innerHTML = '<div class="community-meta">Failed: ' + e.message + '</div>'; });
  }

  /* ---------- wire actions on threads after render ---------- */
  function wireThreadActions(container, cid, SHOP) {
    // Restore & autosave comment drafts per thread
    qsa('.comment-input', container).forEach(function (input) {
      var tid = input.getAttribute('data-tid');
      var key = 'forum_draft_' + SHOP + '_' + (cid || 'anon') + '_comment_' + tid;
      try {
        var saved = JSON.parse(localStorage.getItem(key) || '{}');
        if (saved.b) input.value = saved.b;
      } catch (_) { }
      input.addEventListener('input', debounce(function () {
        localStorage.setItem(key, JSON.stringify({ b: input.value, at: Date.now() }));
      }, 300));
    });

    // Voting (toggle) — threads (and comments if you add buttons with data-type="comment")
    qsa('.vote', container).forEach(function (el) {
      el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0');
      function doVote() {
        if (!cid) { alert('Please log in to participate.'); return; }
        if (el.__voteLock) return; el.__voteLock = true;

        var id = el.getAttribute('data-id');
        var targetType = el.getAttribute('data-type') || 'thread';
        var current = parseInt((el.textContent.match(/\d+/) || ['0'])[0], 10);
        var wasVoted = el.getAttribute('data-voted') === '1';

        api('/votes/toggle', {
          method: 'POST',
          body: { targetType: targetType, targetId: id, customer_id: cid }
        }).then(function (out) {
          if (!out || !out.success) throw new Error((out && out.message) || 'Vote failed');
          var nowVoted = !!out.voted;
          var delta = (nowVoted ? 1 : 0) - (wasVoted ? 1 : 0);
          var next = Math.max(0, current + delta);
          el.setAttribute('data-voted', nowVoted ? '1' : '0');
          el.textContent = '▲ ' + next;
          if (nowVoted) el.classList.add('voted'); else el.classList.remove('voted');
        }).catch(function (e) { alert('Vote failed: ' + e.message); })
          .finally(function () { el.__voteLock = false; });
      }
      el.addEventListener('click', doVote);
      el.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); doVote(); } });
    });

    // Comment submit (top-level)
    qsa('.comment-btn', container).forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!cid) return alert('Please log in to participate.');
        var tid = btn.getAttribute('data-tid');
        var input = qs('.comment-input[data-tid="' + tid + '"]', container);
        var anon = qs('.comment-anon[data-tid="' + tid + '"]', container).checked;
        if (!input || !input.value.trim()) return;
        api('/comments', {
          method: 'POST',
          body: {
            threadId: tid,
            body: input.value,
            isAnonymous: anon,
            customer_id: cid,
            display_name: getDisplayName()
          }
        }).then(function (out) {
          var key = 'forum_draft_' + SHOP + '_' + (cid || 'anon') + '_comment_' + tid;
          localStorage.removeItem(key);
          input.value = '';
          alert((out && out.message) || (out && out.success ? 'Submitted for review' : 'Failed'));
          loadCommentsForThread(tid);
        }).catch(function (e) { alert('Failed: ' + e.message); });
      });
    });

    // Report
    qsa('.report-btn', container).forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!cid) return alert('Please log in to participate.');
        var tid = btn.getAttribute('data-tid');
        var reason = prompt('Why are you reporting this?'); if (!reason) return;
        api('/reports', { method: 'POST', body: { targetType: 'thread', targetId: tid, reason: reason, customer_id: cid } })
          .then(function (out) { alert(out && out.success ? 'Reported' : 'Failed'); })
          .catch(function (e) { alert('Failed: ' + e.message); });
      });
    });
  }

  /* ---------- categories ---------- */
  function loadCategories(sel, tMsg, SHOP) {
    return api('/categories', { qs: { shop: SHOP } }).then(function (data) {
      var opts = ['<option value="">All categories</option>'].concat((data.items || []).map(function (c) {
        return '<option value="' + c._id + '">' + escapeHtml(c.name) + '</option>';
      })).join('');
      sel.innerHTML = opts;
    }).catch(function (e) { setMsg(tMsg, 'Could not load categories: ' + e.message, true); });
  }

  /* ---------- threads (with sort/period/date/search) ---------- */
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

  /* ---------- load threads (and their comments) ---------- */
  function loadThreads(container, tMsg, cid, SHOP, root) {
    var ctl = getControls(root);
    var params = {};
    if (ctl.category) params.categoryId = ctl.category;
    if (ctl.search) params.q = ctl.search;
    if (ctl.sort) params.sort = ctl.sort;
    if (ctl.sort === 'top' && ctl.period) params.period = ctl.period;
    if (ctl.from) params.from = ctl.from;
    if (ctl.to) params.to = ctl.to;

    loading(container, true);
    return api('/threads', { qs: params })
      .then(function (data) {
        var items = data.items || [];
        renderThreads(container, items);

        // load approved comments per thread
        items.forEach(function (t) { loadCommentsForThread(t._id); });

        wireThreadActions(container, cid, SHOP);
      })
      .catch(function (e) {
        container.innerHTML = '';
        setMsg(tMsg, 'Could not load threads: ' + e.message, true);
      });
  }

  /* ---------- suggest (typeahead) ---------- */
  function wireSuggest(root, SHOP, load) {
    var input = qs('#forum-search', root);
    var box = qs('#forum-suggest', root);
    function hide() { box.style.display = 'none'; box.innerHTML = ''; }
    function show(html) { box.innerHTML = html; box.style.display = html ? 'block' : 'none'; }
    function row(html) { return '<div class="s-item" style="padding:6px 8px;cursor:pointer;border-top:1px solid #eee">' + html + '</div>'; }

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
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); hide(); load(); }
    });
    input.addEventListener('blur', function () { setTimeout(hide, 150); });

    box.addEventListener('mousedown', function (e) {
      var item = e.target.closest('.s-item'); if (!item) return;
      var text = item.textContent.trim();
      if (text.startsWith('#')) input.value = 'tag:' + text.slice(1) + ' ';
      else if (text.startsWith('📂')) {
        var slug = (text.match(/\(([^)]+)\)\s*$/) || [])[1] || '';
        input.value = 'cat:' + slug + ' ';
      } else {
        input.value = text;
      }
      hide();
      load();
    });
  }

  /* ---------- thread draft autosave + preview ---------- */
  function wireThreadDraft(root, SHOP, cid) {
    var title = qs('#thread-title', root);
    var body = qs('#thread-body', root);
    var preview = qs('#thread-preview', root);
    var toggleBtn = qs('#thread-preview-toggle', root);
    if (!title || !body || !toggleBtn) return;

    var key = 'forum_draft_' + SHOP + '_' + (cid || 'anon') + '_thread';
    // restore
    try {
      var saved = JSON.parse(localStorage.getItem(key) || '{}');
      if (saved.t) title.value = saved.t;
      if (saved.b) body.value = saved.b;
    } catch (_) { }

    var save = debounce(function () {
      localStorage.setItem(key, JSON.stringify({ t: title.value, b: body.value, at: Date.now() }));
    }, 300);
    title.addEventListener('input', save);
    body.addEventListener('input', save);

    var on = false;
    toggleBtn.addEventListener('click', function () {
      on = !on;
      toggleBtn.textContent = on ? 'Edit' : 'Preview';
      body.style.display = on ? 'none' : 'block';
      preview.style.display = on ? 'block' : 'none';
      preview.textContent = (title.value ? ('# ' + title.value + '\n\n') : '') + (body.value || '');
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

      // Private forum: require login
      if (!cid) {
        root.innerHTML = '<div class="community-box">Please <a href="/account/login">log in</a> to view and participate in the community.</div>';
        return;
      }
      if (!SHOP) {
        root.innerHTML = '<div class="community-box">Shop domain not detected. Add <meta name="forum-shop" content="{{ shop.permanent_domain }}"> to theme.</div>';
        return;
      }

      // Render UI
      template(root);
      var tMsg = qs('#t-msg', root);
      var sel = qs('#cat-filter', root);
      var list = qs('#threads', root);

      var loadNow = function () { return loadThreads(list, tMsg, cid, SHOP, root); };

      // health check
      pingProxy().then(function (res) {
        if (!res.ok) {
          var status = (res.error && res.error.status) || 'unknown';
          setMsg(tMsg, 'App proxy not reachable (status ' + status + '). Check App Proxy & shared secret.', true);
          return;
        }

        // sort/period wiring
        var sortSel = qs('#forum-sort', root);
        var periodSel = qs('#forum-period', root);
        function togglePeriod() { periodSel.style.display = (sortSel.value === 'top') ? 'inline-block' : 'none'; }
        sortSel.addEventListener('change', function () { togglePeriod(); loadNow(); });
        periodSel.addEventListener('change', loadNow);
        qs('#forum-apply', root).addEventListener('click', loadNow);

        // suggest
        wireSuggest(root, SHOP, loadNow);

        // categories + initial threads
        loadCategories(sel, tMsg, SHOP).then(function () { return loadNow(); });

        // change category
        sel.addEventListener('change', loadNow);

        // post new thread
        var draft = wireThreadDraft(root, SHOP, cid);
        qs('#thread-submit', root).addEventListener('click', function () {
          var title = (qs('#thread-title', root).value || '').trim();
          if (!title) return setMsg(tMsg, 'Title required', true);
          var body = (qs('#thread-body', root).value || '').trim();
          var tags = (qs('#thread-tags', root).value || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
          var anon = !!qs('#thread-anon', root).checked;
          var categoryId = sel.value || null;

          api('/threads', {
            method: 'POST',
            body: {
              title: title,
              body: body,
              tags: tags,
              isAnonymous: anon,
              categoryId: categoryId,
              customer_id: cid,
              display_name: getDisplayName()
            }
          }).then(function (out) {
            setMsg(tMsg, (out && out.message) || (out && out.success ? 'Submitted for review' : 'Failed'), !out || !out.success);
            // clear fields + draft
            qs('#thread-title', root).value = ''; qs('#thread-body', root).value = ''; qs('#thread-tags', root).value = '';
            if (draft) draft.clear();
            // ensure preview closed
            var preview = qs('#thread-preview', root); var toggle = qs('#thread-preview-toggle', root);
            if (preview.style.display === 'block') { preview.style.display = 'none'; qs('#thread-body', root).style.display = 'block'; toggle.textContent = 'Preview'; }
            loadNow();
          }).catch(function (e) { setMsg(tMsg, 'Failed: ' + e.message, true); });
        });
      });
    }
  };
})();
