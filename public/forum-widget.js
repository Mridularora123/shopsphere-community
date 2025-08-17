/* /public/forum-widget.js */
(function () {
  // ---------- Config ----------
  var TIMEOUT_MS = 10000;

  // ---------- Small helpers ----------
  function qs(s, r) { return (r || document).querySelector(s); }
  function qsa(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
    });
  }
  function setMsg(el, text, isError) {
    el.textContent = text || '';
    el.style.color = isError ? '#b00020' : '#666';
  }
  function withTimeout(promise, ms) {
    var t;
    var timeout = new Promise(function (_, rej) {
      t = setTimeout(function () { rej(new Error('Request timed out')); }, ms || TIMEOUT_MS);
    });
    return Promise.race([promise, timeout]).finally(function () { clearTimeout(t); });
  }
  function isDesignMode() {
    try { return !!(window.Shopify && Shopify.designMode); } catch (_) { return false; }
  }

  // ---------- Customer detection (reliable) ----------
  function getCustomer() {
    if (window.__FORUM_CUSTOMER__ && window.__FORUM_CUSTOMER__.id) {
      return window.__FORUM_CUSTOMER__;
    }
    if (window.Shopify && Shopify.customer && Shopify.customer.id) {
      return Shopify.customer;
    }
    return null;
  }
  function isLoggedIn() { return !!(getCustomer() && getCustomer().id); }

  // ---------- API ----------
  function api(path, opts) {
    opts = opts || {};
    var url = (window.__FORUM_PROXY__ || '/apps/community') + path;
    return withTimeout(fetch(url, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: opts.body ? JSON.stringify(opts.body) : undefined
    })).then(function (r) {
      if (!r.ok) {
        var err = new Error('API error: ' + r.status);
        err.status = r.status;
        throw err;
      }
      return r.json();
    });
  }
  function pingProxy() { return api('/ping').then(function (j) { return { ok: true, json: j }; }, function (e) { return { ok: false, error: e }; }); }

  // ---------- UI template ----------
  function template(root) {
    root.innerHTML = [
      '<div class="community-box">',
      '  <div id="login-banner" class="community-meta" style="margin:0 0 8px 0"></div>',
      '  <div id="t-msg" class="community-meta" style="min-height:18px;margin-bottom:6px"></div>',
      '  <div class="community-row">',
      '    <select id="cat-filter"></select>',
      '    <input id="thread-title" class="community-input" placeholder="Start a new thread (title)" />',
      '  </div>',
      '  <textarea id="thread-body" class="community-textarea" rows="3" placeholder="Write details..."></textarea>',
      '  <div class="community-row">',
      '    <input id="thread-tags" class="community-input" placeholder="tags (comma separated)" />',
      '    <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="thread-anon"/> <span class="community-meta">Anonymous</span></label>',
      '    <button id="thread-submit" class="community-btn">Post</button>',
      '  </div>',
      '  <hr/>',
      '  <div id="threads"></div>',
      '</div>'
    ].join('\n');
  }

  function lockGuestUI(root, loggedIn) {
    var banner = qs('#login-banner', root);
    if (!loggedIn) {
      banner.innerHTML = 'Please <a href="/account/login">log in</a> to participate. You can still browse threads.';
      qsa('#thread-title, #thread-body, #thread-tags, #thread-anon, #thread-submit', root)
        .forEach(function (el) { if (el) el.disabled = true; });
    } else {
      banner.innerHTML = '';
      qsa('#thread-title, #thread-body, #thread-tags, #thread-anon, #thread-submit', root)
        .forEach(function (el) { if (el) el.disabled = false; });
    }
  }

  function renderThreads(container, items, loggedIn) {
    container.innerHTML = (items || []).map(function (t) {
      return [
        '<div class="community-card">',
        '  <div style="display:flex;justify-content:space-between;align-items:center">',
        '    <div><strong>' + escapeHtml(t.title) + '</strong> ' +
        (t.pinned ? '<span class="badge">Pinned</span>' : '') + ' ' +
        (t.closed ? '<span class="badge">Closed</span>' : '') + '</div>',
        '    <button class="vote" data-id="' + t._id + '" ' + (loggedIn ? '' : 'disabled') + ' title="Upvote" style="cursor:pointer;background:none;border:none">▲ ' + (t.votes || 0) + '</button>',
        '  </div>',
        '  <div class="community-meta">' + new Date(t.createdAt).toLocaleString() + '</div>',
        '  <div>' + escapeHtml(t.body || '') + '</div>',
        '  <div style="margin:6px 0;">' + (t.tags || []).map(function (x) {
          return '<span class="community-tag">' + escapeHtml(x) + '</span>';
        }).join('') + '</div>',
        '  <div id="comments-' + t._id + '"></div>',
        '  <div class="community-row">',
        '    <input data-tid="' + t._id + '" class="community-input comment-input" placeholder="Write a comment..." ' + (loggedIn ? '' : 'disabled') + ' />',
        '    <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" class="comment-anon" data-tid="' + t._id + '" ' + (loggedIn ? '' : 'disabled') + '/><span class="community-meta">Anonymous</span></label>',
        '    <button data-tid="' + t._id + '" class="community-btn comment-btn" ' + (loggedIn ? '' : 'disabled') + '>Reply</button>',
        '    <button data-tid="' + t._id + '" class="community-btn report-btn" ' + (loggedIn ? '' : 'disabled') + ' title="Report">Report</button>',
        '  </div>',
        '</div>'
      ].join('');
    }).join('');
  }

  function wireThreadActions(container, tMsg, loggedIn) {
    // Votes
    qsa('.vote', container).forEach(function (el) {
      if (!loggedIn) return;
      var lock = false;
      el.addEventListener('click', function () {
        if (lock) return;
        lock = true;
        var id = el.getAttribute('data-id');
        var c = getCustomer();
        api('/votes', {
          method: 'POST',
          body: { targetType: 'thread', targetId: id, customer_id: c.id }
        }).then(function (out) {
          if (out && out.success) {
            var n = parseInt((el.textContent.match(/\d+/) || ['0'])[0], 10) + 1;
            el.textContent = '▲ ' + n;
          } else {
            setMsg(tMsg, (out && out.message) || 'Vote failed', true);
          }
        }).catch(function (e) {
          setMsg(tMsg, 'Vote failed: ' + e.message, true);
        }).finally(function () { lock = false; });
      });
    });

    // Comments
    qsa('.comment-btn', container).forEach(function (btn) {
      if (!loggedIn) return;
      btn.addEventListener('click', function () {
        var tid = btn.getAttribute('data-tid');
        var input = qs('.comment-input[data-tid="' + tid + '"]', container);
        var anon = qs('.comment-anon[data-tid="' + tid + '"]', container).checked;
        if (!input || !input.value.trim()) return;
        var c = getCustomer();
        api('/comments', {
          method: 'POST',
          body: { threadId: tid, body: input.value, isAnonymous: anon, customer_id: c.id }
        }).then(function (out) {
          input.value = '';
          setMsg(tMsg, (out && out.message) || (out && out.success ? 'Submitted for review' : 'Failed'), !(out && out.success));
        }).catch(function (e) {
          setMsg(tMsg, 'Failed: ' + e.message, true);
        });
      });
    });

    // Reports
    qsa('.report-btn', container).forEach(function (btn) {
      if (!loggedIn) return;
      btn.addEventListener('click', function () {
        var tid = btn.getAttribute('data-tid');
        var reason = prompt('Why are you reporting this?');
        if (!reason) return;
        var c = getCustomer();
        api('/reports', {
          method: 'POST',
          body: { targetType: 'thread', targetId: tid, reason: reason, customer_id: c.id }
        }).then(function (out) {
          setMsg(tMsg, out && out.success ? 'Reported' : 'Report failed', !(out && out.success));
        }).catch(function (e) {
          setMsg(tMsg, 'Report failed: ' + e.message, true);
        });
      });
    });
  }

  function loadCategories(sel, tMsg) {
    return api('/categories').then(function (data) {
      var opts = ['<option value="">All categories</option>'].concat(
        (data.items || []).map(function (c) {
          return '<option value="' + c._id + '">' + escapeHtml(c.name) + '</option>';
        })
      ).join('');
      sel.innerHTML = opts;
    }).catch(function (e) {
      setMsg(tMsg, 'Could not load categories: ' + e.message, true);
    });
  }

  function loadThreads(container, tMsg, loggedIn) {
    var cat = qs('#cat-filter').value;
    var q = cat ? ('?categoryId=' + encodeURIComponent(cat)) : '';
    container.innerHTML = '<div class="community-meta">Loading…</div>';
    return api('/threads' + q).then(function (data) {
      renderThreads(container, data.items || [], loggedIn);
      wireThreadActions(container, tMsg, loggedIn);
    }).catch(function (e) {
      container.innerHTML = '';
      setMsg(tMsg, 'Could not load threads: ' + e.message, true);
    });
  }

  // ---------- PUBLIC: mount ----------
  window.ForumWidget = {
    mount: function (selector, opts) {
      opts = opts || {};
      var root = qs(selector);
      if (!root) return;

      // Theme Editor: show safe note, no network
      if (isDesignMode()) {
        root.innerHTML =
          '<div class="community-box">Community widget preview is unavailable in the Theme Editor. ' +
          'Open the storefront (View store) to test.</div>';
        return;
      }

      // Proxy base for all calls
      window.__FORUM_PROXY__ = opts.proxyUrl || '/apps/community';

      // Render UI immediately
      template(root);
      var loggedIn = isLoggedIn();
      lockGuestUI(root, loggedIn);

      var tMsg = qs('#t-msg', root);
      var sel = qs('#cat-filter', root);
      var list = qs('#threads', root);

      // Health check first
      pingProxy().then(function (res) {
        if (!res.ok) {
          var status = (res.error && res.error.status) || 'unknown';
          setMsg(tMsg, 'App proxy not reachable (status ' + status + '). Check App Proxy URL & secret.', true);
          return;
        }

        // Load data
        loadCategories(sel, tMsg).then(function () {
          return loadThreads(list, tMsg, loggedIn);
        });

        sel.addEventListener('change', function () { loadThreads(list, tMsg, loggedIn); });

        // Create thread (gated)
        qs('#thread-submit', root).addEventListener('click', function () {
          if (!isLoggedIn()) return; // button disabled anyway; double-guard
          var title = (qs('#thread-title', root).value || '').trim();
          if (!title) return setMsg(tMsg, 'Title required', true);

          var body = (qs('#thread-body', root).value || '').trim();
          var tags = (qs('#thread-tags', root).value || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
          var anon = !!qs('#thread-anon', root).checked;
          var categoryId = sel.value || null;
          var c = getCustomer();

          api('/threads', {
            method: 'POST',
            body: { title: title, body: body, tags: tags, isAnonymous: anon, categoryId: categoryId, customer_id: c.id }
          }).then(function (out) {
            setMsg(tMsg, (out && out.message) || (out && out.success ? 'Submitted for review' : 'Failed'), !(out && out.success));
            qs('#thread-title', root).value = '';
            qs('#thread-body', root).value = '';
            qs('#thread-tags', root).value = '';
            loadThreads(list, tMsg, loggedIn);
          }).catch(function (e) {
            setMsg(tMsg, 'Failed: ' + e.message, true);
          });
        });
      });
    }
  };
})();
