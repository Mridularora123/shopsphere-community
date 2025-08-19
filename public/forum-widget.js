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

  /* ---------- robust shop & customer detection ---------- */
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
    try { if (window.Shopify && Shopify.shop) return normalizeShop(Shopify.shop); } catch (_) {}
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
  function getCustomerName() {
    // optional helper; filled by your Liquid snippet
    var m = document.querySelector('meta[name="forum-customer-name"]');
    if (m && m.content) return m.content.trim();
    if (window.__community && window.__community.customerName) return String(window.__community.customerName);
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
    var shop = window.__FORUM_SHOP__ || getShop();

    // Merge caller qs + shop
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

  /* ---------- UI template ---------- */
  function template(root) {
    root.innerHTML = [
      '<div class="community-box">',
      '  <div id="t-msg" class="community-meta" style="min-height:18px;margin-bottom:6px"></div>',
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

  /* ---------- comments (threaded) ---------- */
  function renderCommentTree(list) {
    function one(c, depth) {
      var pad = 'style="margin-left:' + (depth * 16) + 'px"';
      var anon = c && c.author && c.author.isAnonymous;
      var name = anon ? 'anon' : (c && c.author && (c.author.displayName || c.author.name) || 'anon');
      var safeName = escapeHtml(name);
      var safeBody = escapeHtml(c.body || '');
      var self = (
        '<div class="community-comment" ' + pad + '>' +
          '<b>' + safeName + '</b>: ' + safeBody +
          ' <button class="reply-btn" data-cid="' + c._id + '" data-depth="' + (c.depth || 0) + '" style="margin-left:6px">Reply</button>' +
        '</div>'
      );
      var kids = (c.children || []).map(function (k) { return one(k, depth + 1); }).join('');
      return self + kids;
    }
    return (list || []).map(function (c) { return one(c, 0); }).join('') || '<div class="community-meta">No comments yet</div>';
  }

  function loadCommentsForThread(tid) {
    var box = document.getElementById('comments-' + tid);
    if (!box) return;
    box.innerHTML = '<div class="community-meta">Loading comments…</div>';
    api('/comments', { qs: { threadId: tid } })
      .then(function (j) {
        if (!j || !j.success) { box.innerHTML = '<div class="community-meta">Failed to load</div>'; return; }
        box.innerHTML = renderCommentTree(j.items || []);
      })
      .catch(function (e) { box.innerHTML = '<div class="community-meta">Failed: ' + e.message + '</div>'; });
  }

  /* ---------- reply UI inside comments ---------- */
  function wireCommentReplies(container, cid, SHOP) {
    container.addEventListener('click', function (ev) {
      var btn = ev.target.closest('.reply-btn');
      if (!btn) return;
      if (!cid) return alert('Please log in to participate.');

      var parentId = btn.getAttribute('data-cid');
      var depth = parseInt(btn.getAttribute('data-depth') || '0', 10);
      if (depth >= 3) { alert('Max reply depth reached'); return; }

      // prevent duplicate form under same parent
      var existing = btn.parentElement.querySelector('.reply-form');
      if (existing) { existing.querySelector('textarea').focus(); return; }

      var f = document.createElement('div');
      f.className = 'reply-form';
      f.style.margin = '6px 0 6px 0';
      f.innerHTML = [
        '<div class="community-row" style="margin-left:8px">',
        '  <textarea class="community-textarea" rows="2" placeholder="Write a reply..."></textarea>',
        '  <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" class="reply-anon"/><span class="community-meta">Anonymous</span></label>',
        '  <button class="community-btn do-send">Send</button>',
        '  <button class="community-btn do-cancel" type="button" style="background:#eee;color:#333">Cancel</button>',
        '</div>'
      ].join('');
      btn.insertAdjacentElement('afterend', f);

      f.querySelector('.do-cancel').addEventListener('click', function () {
        f.remove();
      });

      f.querySelector('.do-send').addEventListener('click', function () {
        var txt = (f.querySelector('textarea').value || '').trim();
        var anon = !!f.querySelector('.reply-anon').checked;
        if (!txt) return;

        var displayName = anon ? '' : getCustomerName();

        api('/comments', {
          method: 'POST',
          qs: { shop: SHOP },
          body: { threadId: btn.closest('.community-card').querySelector('.comment-input').getAttribute('data-tid'), parentId: parentId, body: txt, isAnonymous: anon, customer_id: cid, display_name: displayName }
        })
          .then(function (out) {
            alert((out && out.message) || (out && out.success ? 'Submitted for review' : 'Failed'));
            // reload comments
            var tid = btn.closest('.community-card').querySelector('.comment-input').getAttribute('data-tid');
            loadCommentsForThread(tid);
            f.remove();
          })
          .catch(function (e) { alert('Failed: ' + e.message); });
      });
    });
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
      } catch (_) {}
      input.addEventListener('input', debounce(function () {
        localStorage.setItem(key, JSON.stringify({ b: input.value, at: Date.now() }));
      }, 300));
    });

    // Voting (toggle) — threads (and future comments if you add .vote with data-type="comment")
    qsa('.vote', container).forEach(function (el) {
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');

      function doVote() {
        if (!cid) { alert('Please log in to participate.'); return; }
        if (el.__voteLock) return;
        el.__voteLock = true;

        var id = el.getAttribute('data-id');
        var targetType = el.getAttribute('data-type') || 'thread';
        var current = parseInt((el.textContent.match(/\d+/) || ['0'])[0], 10);
        var wasVoted = el.getAttribute('data-voted') === '1';

        api('/votes/toggle', {
          method: 'POST',
          qs: { shop: SHOP },
          body: { targetType: targetType, targetId: id, customer_id: cid }
        })
          .then(function (out) {
            if (!out || !out.success) throw new Error((out && out.message) || 'Vote failed');
            var nowVoted = !!out.voted;
            var delta = (nowVoted ? 1 : 0) - (wasVoted ? 1 : 0);
            var next = Math.max(0, current + delta);
            el.setAttribute('data-voted', nowVoted ? '1' : '0');
            el.textContent = '▲ ' + next;
            if (nowVoted) el.classList.add('voted'); else el.classList.remove('voted');
          })
          .catch(function (e) { alert('Vote failed: ' + e.message); })
          .finally(function () { el.__voteLock = false; });
      }

      el.addEventListener('click', doVote);
      el.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); doVote(); } });
    });

    // Comment submit (top-level under each thread card)
    qsa('.comment-btn', container).forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!cid) return alert('Please log in to participate.');
        var tid = btn.getAttribute('data-tid');
        var input = qs('.comment-input[data-tid="' + tid + '"]', container);
        var anon = qs('.comment-anon[data-tid="' + tid + '"]', container).checked;
        if (!input || !input.value.trim()) return;

        var displayName = anon ? '' : getCustomerName();

        api('/comments', {
          method: 'POST',
          qs: { shop: SHOP },
          body: { threadId: tid, body: input.value, isAnonymous: anon, customer_id: cid, display_name: displayName }
        })
          .then(function (out) {
            var key = 'forum_draft_' + SHOP + '_' + (cid || 'anon') + '_comment_' + tid;
            localStorage.removeItem(key);
            input.value = '';
            alert((out && out.message) || (out && out.success ? 'Submitted for review' : 'Failed'));
            loadCommentsForThread(tid);
          })
          .catch(function (e) { alert('Failed: ' + e.message); });
      });
    });

    // Report
    qsa('.report-btn', container).forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!cid) return alert('Please log in to participate.');
        var tid = btn.getAttribute('data-tid');
        var reason = prompt('Why are you reporting this?'); if (!reason) return;
        api('/reports', { method: 'POST', qs: { shop: SHOP }, body: { targetType: 'thread', targetId: tid, reason: reason, customer_id: cid } })
          .then(function (out) { alert(out && out.success ? 'Reported' : 'Failed'); })
          .catch(function (e) { alert('Failed: ' + e.message); });
      });
    });

    // Enable inline reply forms + send
    wireCommentReplies(container, cid, SHOP);
  }

  /* ---------- categories ---------- */
  function loadCategories(sel, tMsg, SHOP) {
    return api('/categories', { qs: { shop: SHOP } })
      .then(function (data) {
        var opts = ['<option value="">All categories</option>'].concat((data.items || []).map(function (c) {
          return '<option value="' + c._id + '">' + escapeHtml(c.name) + '</option>';
        })).join('');
        sel.innerHTML = opts;
      })
      .catch(function (e) { setMsg(tMsg, 'Could not load categories: ' + e.message, true); });
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

  function loadThreads(container, tMsg, cid, SHOP, root) {
    var ctl = getControls(root);
    var params = { };
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
        // load approved comments for each thread
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
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); hide(); load(); } });
    input.addEventListener('blur', function () { setTimeout(hide, 150); });

    box.addEventListener('mousedown', function (e) {
      var item = e.target.closest('.s-item'); if (!item) return;
      var text = item.textContent.trim();
      if (text.startsWith('#')) input.value = 'tag:' + text.slice(1) + ' ';
      else if (text.startsWith('📂')) {
        var slug = (text.match(/\(([^)]+)\)\s*$/) || [])[1] || '';
        input.value = 'cat:' + slug + ' ';
      } else { input.value = text; }
      hide(); load();
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
    try {
      var saved = JSON.parse(localStorage.getItem(key) || '{}');
      if (saved.t) title.value = saved.t;
      if (saved.b) body.value = saved.b;
    } catch (_) {}
    var save = debounce(function () { localStorage.setItem(key, JSON.stringify({ t: title.value, b: body.value, at: Date.now() })); }, 300);
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
      var tMsg = qs('#t-msg', root);
      var sel = qs('#cat-filter', root);
      var list = qs('#threads', root);

      var loadNow = function () { return loadThreads(list, tMsg, cid, SHOP, root); };

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
        periodSel.addEventListener('change', loadNow);
        qs('#forum-apply', root).addEventListener('click', loadNow);

        wireSuggest(root, SHOP, loadNow);

        loadCategories(sel, tMsg, SHOP).then(function () { return loadNow(); });
        sel.addEventListener('change', loadNow);

        var draft = wireThreadDraft(root, SHOP, cid);
        qs('#thread-submit', root).addEventListener('click', function () {
          var title = (qs('#thread-title', root).value || '').trim();
          if (!title) return setMsg(tMsg, 'Title required', true);
          var body = (qs('#thread-body', root).value || '').trim();
          var tags = (qs('#thread-tags', root).value || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
          var anon = !!qs('#thread-anon', root).checked;
          var categoryId = sel.value || null;
          var displayName = anon ? '' : getCustomerName();

          api('/threads', { method: 'POST', qs: { shop: SHOP }, body: { title: title, body: body, tags: tags, isAnonymous: anon, categoryId: categoryId, customer_id: cid, display_name: displayName } })
            .then(function (out) {
              setMsg(tMsg, (out && out.message) || (out && out.success ? 'Submitted for review' : 'Failed'), !out || !out.success);
              qs('#thread-title', root).value = ''; qs('#thread-body', root).value = ''; qs('#thread-tags', root).value = '';
              if (draft) draft.clear();
              var preview = qs('#thread-preview', root); var toggle = qs('#thread-preview-toggle', root);
              if (preview.style.display === 'block') { preview.style.display = 'none'; qs('#thread-body', root).style.display = 'block'; toggle.textContent = 'Preview'; }
              loadNow();
            })
            .catch(function (e) { setMsg(tMsg, 'Failed: ' + e.message, true); });
        });
      });
    }
  };
})();
