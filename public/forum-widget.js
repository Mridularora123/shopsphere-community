// /public/forum-widget.js
(function () {
  var TIMEOUT_MS = 10000;

  /* ---------- tiny DOM helpers ---------- */
  function qs(s, r) { return (r || document).querySelector(s); }
  function qsa(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
    });
  }
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

  /* ---------- branding auto-adoption ---------- */
  function adoptBranding() {
    try {
      var root = document.documentElement;
      var bodyCS = getComputedStyle(document.body);
      var fg = bodyCS.color || '#111827';
      var bg = bodyCS.backgroundColor || '#ffffff';

      // infer accent from links
      var a = document.createElement('a'); a.style.display = 'none'; a.href = '#'; document.body.appendChild(a);
      var accent = getComputedStyle(a).color || '#ff7a59';
      document.body.removeChild(a);

      // meta overrides
      var mAccent = document.querySelector('meta[name="forum-accent"]');
      var mRadius = document.querySelector('meta[name="forum-radius"]');

      root.style.setProperty('--c-text', fg);
      root.style.setProperty('--c-bg', '#ffffff');
      root.style.setProperty('--c-page', bg);
      root.style.setProperty('--c-accent', (mAccent && mAccent.content) || accent);
      if (mRadius && mRadius.content) root.style.setProperty('--radius', mRadius.content);
    } catch (_) { /* ignore */ }
  }

  /* ---------- modern styles (Coda-like layout & Mosaic branding) ---------- */
  function injectStyles() {
    if (document.getElementById('community-style')) return;
    var css = [
      ':root{--c-bg:#fff;--c-page:#faf7f2;--c-soft:#f6f7f9;--c-soft2:#f0f2f5;--c-border:#e5e7eb;--c-text:#111827;--c-mut:#6b7280;--c-accent:#ff7a59;--c-accent-2:#0a66c2;--radius:12px;--shadow:0 1px 2px rgba(0,0,0,.06),0 6px 16px rgba(0,0,0,.06)}',

      /* Container & page bg */
      '.community-box{font-family:inherit;max-width:1100px;margin:0 auto;padding:12px}',
      'body .community-scope{background:var(--c-page)}',

      /* Auth gate */
      '.auth-gate{display:flex;flex-direction:column;align-items:flex-start;gap:10px}',
      '.auth-title{font-size:18px;font-weight:700;color:var(--c-text)}',
      '.auth-desc{color:var(--c-mut);margin:0}',
      '.auth-features{margin:0 0 4px 18px;color:var(--c-text)}',
      '.auth-features li{margin:2px 0}',
      '.auth-actions{display:flex;gap:8px;flex-wrap:wrap}',

      /* Hero */
      '.community-hero{padding:28px 14px 16px;border-radius:var(--radius);background:var(--c-page)}',
      '.hero-title{font-weight:800;font-size:34px;line-height:1.1;margin:0;color:var(--c-text)}',
      '.hero-sub{margin:8px 0 14px 0;color:var(--c-mut)}',
      '.hero-search{position:relative}',
      '.hero-search input{width:100%;padding:14px 44px 14px 44px;border:1px solid var(--c-border);border-radius:999px;background:#fff}',
      '.search-ico{position:absolute;left:14px;top:50%;transform:translateY(-50%);pointer-events:none}',

      /* Section heads */
      '.section-head{display:flex;justify-content:space-between;align-items:center;margin:18px 0 10px 0}',
      '.section-head h3{margin:0;font-size:16px;font-weight:700;color:var(--c-text)}',
      '.see-more{font-size:13px;color:var(--c-accent-2);text-decoration:underline;cursor:pointer}',

      /* Grid: Top Categories + Highlights */
      '.dash{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:8px}',
      '.card{background:#fff;border:1px solid var(--c-border);border-radius:var(--radius);box-shadow:var(--shadow)}',
      '.card-pad{padding:10px}',
      '.cat-grid{display:flex;flex-direction:column;gap:10px}',
      '.cat-item{display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--c-border);border-radius:12px;background:#fff;cursor:pointer}',
      '.cat-item:hover{box-shadow:0 0 0 3px rgba(0,0,0,.04)}',
      '.cat-item.active{box-shadow:0 0 0 3px rgba(255,122,89,.25);border-color:var(--c-accent)}',
      '.cat-icon{width:26px;height:26px;border-radius:8px;background:var(--c-soft)}',
      '.cat-name{font-weight:600}',
      '.cat-meta{color:var(--c-mut);font-size:12px}',

      '.hl-list{display:flex;flex-direction:column;gap:10px}',
      '.hl-item{padding:12px;border:1px solid var(--c-border);border-radius:12px;background:#fff}',
      '.hl-title{font-weight:600}',
      '.hl-meta{color:var(--c-mut);font-size:12px;margin-top:2px}',

      /* Controls row (tabs + filters + bell) */
      '.controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:14px 0;position:relative}',
      '.tabbar{display:flex;gap:6px;background:#fff;border:1px solid var(--c-border);border-radius:999px;padding:3px}',
      '.tab{padding:7px 12px;border-radius:999px;cursor:pointer;color:var(--c-text)}',
      '.tab.active{background:var(--c-accent);color:#fff}',

      '.community-input,.community-textarea{flex:1 1 auto;padding:10px 12px;border:1px solid var(--c-border);border-radius:10px;background:#fff;min-width:0}',
      '.community-textarea{width:100%}',
      '.community-btn{color:#121212!important;padding:9px 12px;border:1px solid var(--c-border);border-radius:999px;background:#fff;cursor:pointer;line-height:1}',
      '.community-btn:hover{box-shadow:0 0 0 3px rgba(0,0,0,.04)}',
      '.primary{background:var(--c-accent);color:#fff;border-color:var(--c-accent)}',
      '.primary:hover{box-shadow:0 0 0 4px rgba(255,122,89,.25)}',
      '.badge{display:inline-block;background:#eef;border:1px solid #dde;padding:2px 6px;border-radius:6px;font-size:11px;margin-left:6px}',

      /* Stream grid (list + rail) */
      '.stream{display:grid;grid-template-columns:1fr 300px;gap:16px}',
      '.rail-card{background:#fff;border:1px solid var(--c-border);border-radius:var(--radius);box-shadow:var(--shadow);padding:12px}',

      /* Thread cards */
      '.community-card{background:#fff;border:1px solid var(--c-border);border-radius:var(--radius);padding:14px;margin:12px 0;box-shadow:var(--shadow)}',
      '.card-head{display:flex;justify-content:space-between;align-items:center;gap:10px}',
      '.thread-title{font-weight:700;font-size:18px}',
      '.community-tag{display:inline-block;background:var(--c-soft);border:1px solid var(--c-border);border-radius:999px;padding:2px 8px;margin-right:6px;font-size:12px}',
      '.community-meta{color:var(--c-mut);font-size:12px}',
      '.metrics{display:inline-flex;gap:10px;margin-top:6px;color:var(--c-mut);font-size:12px}',
      '.metric{display:inline-flex;align-items:center;gap:6px}',

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

      '@media (max-width:980px){.dash{grid-template-columns:1fr}.stream{grid-template-columns:1fr}}',
      '@media (max-width:600px){.community-btn{width:auto}.community-input{min-width:180px}}'
    ].join('');
    var style = document.createElement('style');
    style.id = 'community-style';
    style.innerHTML = css;
    document.head.appendChild(style);
    adoptBranding();
  }

  /* ---------- Markdown renderer (safe subset) ---------- */
  function renderMarkdown(md) {
    let s = escapeHtml(md || '');

    // Images: ![alt](http...)
    s = s.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g,
      function (_m, alt, url) { return '<img src="' + url + '" alt="' + escapeHtml(alt) + '" loading="lazy">'; });

    // Links with text
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
    return parts.length ? ('?' + parts.join('&')) : ''; // (will be fixed below)
  }
  // Fix the small typo above by redefining toQuery cleanly:
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

    // merge query
    var merged = Object.assign({}, opts.qs || {});
    if (shop) merged.shop = shop;

    // Force POST for non-GET/POST (Shopify App Proxy limitation)
    var originalMethod = (opts.method || 'GET').toUpperCase();
    var method = originalMethod;
    if (method !== 'GET' && method !== 'POST') {
      merged._method = method;         // e.g. _method=PUT / DELETE
      method = 'POST';
    }

    var q = toQuery(merged);
    var url = base + (base.indexOf('?') >= 0 ? (q ? '&' + q.slice(1) : '') : q);

    var headers = { 'Content-Type': 'application/json' };
    if (originalMethod !== method) {
      headers['X-HTTP-Method-Override'] = originalMethod;
    }

    return withTimeout(fetch(url, {
      method: method,
      headers: headers,
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

  /* ---------- UI template (hero + sections + stream) ---------- */
  function template(root) {
    injectStyles();

    root.innerHTML = [
      '<div class="community-box community-scope">',

      // HERO
      '  <header class="community-hero">',
      '    <h1 class="hero-title" id="community-title">Community</h1>',
      '    <p class="hero-sub" id="community-subtitle">We’re happy to have you here. If you need help, please search before you post.</p>',
      '    <div class="hero-search">',
      '      <span class="search-ico">🔎</span>',
      '      <input id="forum-search" aria-label="Search" placeholder="Search topics, posts, and categories…" />',
      '      <div id="forum-suggest" style="position:absolute;top:46px;left:0;right:0;background:#fff;border:1px solid var(--c-border);display:none;z-index:5;border-radius:10px;overflow:hidden"></div>',
      '    </div>',
      '  </header>',

      // DASH: Top Categories / Highlights
      '  <section class="dash">',
      '    <div>',
      '      <div class="section-head"><h3>Top Categories</h3><span class="see-more" id="cats-more" role="button" tabindex="0">See more</span></div>',
      '      <div class="card card-pad">',
      '        <div id="top-cats" class="cat-grid" role="list"></div>',
      '      </div>',
      '      <!-- hidden native select & list for filters/event plumbing -->',
      '      <select id="cat-filter" class="community-input" aria-label="Category filter" style="display:none"></select>',
      '      <ul id="topic-list" style="display:none"></ul>',
      '    </div>',

      '    <div>',
      '      <div class="section-head"><h3>Highlights</h3><span class="see-more" id="hl-more" role="button" tabindex="0">See more</span></div>',
      '      <div class="card card-pad">',
      '        <div id="highlights" class="hl-list" role="list"></div>',
      '      </div>',
      '    </div>',
      '  </section>',

      // CONTROLS (tabs + filters + bell)
      '  <div class="controls">',
      '    <div class="tabbar" role="tablist" aria-label="Sort tabs">',
      '      <button id="tab-latest" class="tab active" role="tab" aria-selected="true">Latest</button>',
      '      <button id="tab-top" class="tab" role="tab" aria-selected="false">Top</button>',
      '    </div>',
      '    <select id="forum-period" class="community-input" aria-label="Top period" style="width:auto;display:none">',
      '      <option value="day">Day</option>',
      '      <option value="week" selected>Week</option>',
      '      <option value="month">Month</option>',
      '    </select>',
      '    <input id="forum-from" type="date" class="community-input" aria-label="From date" style="width:auto"/>',
      '    <input id="forum-to" type="date" class="community-input" aria-label="To date" style="width:auto"/>',
      '    <button id="forum-apply" class="community-btn" type="button" aria-label="Apply filters">Apply</button>',
      '    <button id="notif-btn" class="community-btn" type="button" style="margin-left:auto;position:relative">🔔 <span id="notif-badge" class="badge" style="display:none;margin-left:6px">0</span></button>',
      '    <div id="notif-panel" class="rail-card" style="display:none;position:absolute;right:0;top:44px;max-width:380px;z-index:50"></div>',
      '  </div>',

      // COMPOSE
      '  <div id="rte-bar"></div>',
      '  <textarea id="thread-body" class="community-textarea" rows="4" placeholder="Write details... Supports Markdown for headings, lists, links, and images."></textarea>',
      '  <div id="thread-preview" style="display:none;background:var(--c-soft);border:1px solid var(--c-border);padding:10px;border-radius:10px;"></div>',
      '  <div class="community-row" style="margin-top:8px">',
      '    <input id="thread-title" class="community-input" aria-label="Thread title" placeholder="Start a new thread (title)"/>',
      '    <input id="thread-tags" class="community-input" aria-label="Tags" placeholder="tags (comma separated)"/>',
      '    <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="thread-anon" aria-label="Post anonymously"/><span class="community-meta">Anonymous</span></label>',
      '    <button id="thread-preview-toggle" class="community-btn" type="button" aria-pressed="false">Preview</button>',
      '    <button id="thread-submit" class="community-btn primary">Post</button>',
      '  </div>',

      // STREAM (list + rail)
      '  <section class="stream">',
      '    <main class="community-main">',
      '      <div id="t-msg" class="community-meta" aria-live="polite" style="min-height:2px;margin:0px 0"></div>',
      '      <div id="threads" role="list"></div>',
      '      <div id="load-more-wrap" style="text-align:center;margin:12px 0;display:none">',
      '        <button id="load-more" class="community-btn" type="button" aria-label="Load more threads">Load more</button>',
      '      </div>',
      '    </main>',
      '    <aside>',
      '      <div id="spotlight" class="rail-card" style="display:none"></div>',
      '    </aside>',
      '  </section>',

      '</div>'
    ].join('\n');

    // mount simple RTE toolbar
    var body = qs('#thread-body', root);
    var bar = makeToolbar(body);
    qs('#rte-bar', root).appendChild(bar);

    // Hero overrides via meta tags
    var mTitle = document.querySelector('meta[name="forum-hero-title"]');
    var mSub = document.querySelector('meta[name="forum-hero-subtitle"]');
    if (mTitle && mTitle.content) qs('#community-title', root).textContent = mTitle.content;
    if (mSub && mSub.content) qs('#community-subtitle', root).textContent = mSub.content;
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
  function metric(val, icon, label) {
    var n = (typeof val === 'number') ? val : 0;
    return '<span class="metric" aria-label="' + label + '"><span>' + icon + '</span>' + n + '</span>';
  }

  function renderThreads(container, items, cid) {
    container.insertAdjacentHTML('beforeend', (items || []).map(function (t) {
      var isClosed = !!(t.closedAt || t.closed);
      var closedBadge = isClosed ? '<span class="badge">Closed</span>' : '';
      var pinnedBadge = t.pinned ? '<span class="badge">Pinned</span>' : '';
      var votes = typeof t.votes === 'number' ? t.votes : 0;

      // best-effort comment count
      var cc = t.commentsCount; if (cc == null) cc = t.commentCount;
      if (cc == null) cc = t.replies;
      if (cc == null) cc = t.replyCount;
      if (cc == null) cc = t.numComments;
      if (cc == null) cc = 0;

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
        '    <button class="vote" type="button" role="button" tabindex="0" aria-label="Upvote thread" aria-pressed="false" data-type="thread" data-id="' + t._id + '" data-voted="0">▲ ' + votes + '</button>',
        '  </div>',
        '  <div class="community-meta">' + new Date(t.createdAt).toLocaleString() + '</div>',
        '  <div class="thread-body">' + renderMarkdown(t.body || '') + '</div>',
        '  <div style="margin:6px 0;">' + (t.tags || []).map(function (x) { return '<span class="community-tag">#' + escapeHtml(x) + '</span>'; }).join('') + '</div>',
        '  <div class="metrics" aria-hidden="false">' + metric(cc, '💬', 'comments') + metric(votes, '▲', 'upvotes') + '</div>',
        '  <div id="poll-' + t._id + '" class="poll-wrap" style="margin:8px 0"></div>',
        threadActionsHTML(t, cid),
        commentAccordion,
        '</div>'
      ].join('');
    }).join(''));
  }

  /* ---------- comments (with reply dropdowns) ---------- */
  function renderCommentTree(list, cid) {
    function one(c, depth) {
      var pad = 'style="margin-left:' + (depth * 0) + 'px"';
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
        '<button class="vote" type="button" role="button" tabindex="0" aria-label="Upvote comment" aria-pressed="false" data-type="comment" data-id="' + c._id + '" data-voted="0" style="margin-right:8px">▲ ' + votes + '</button>' +
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

    // Voting (delegated so it works for comments loaded later)
    function handleVote(el) {
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

    container.addEventListener('click', function (ev) {
      var el = ev.target.closest('.vote');
      if (el && container.contains(el)) handleVote(el);
    });
    container.addEventListener('keydown', function (ev) {
      var el = ev.target.closest('.vote');
      if (!el) return;
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        handleVote(el);
      }
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

    // Edit / Delete thread (delegated)
    container.addEventListener('click', function (ev) {
      const btnEdit = ev.target.closest('.t-edit');
      if (btnEdit && container.contains(btnEdit)) {
        const id = btnEdit.getAttribute('data-id');
        const area = document.getElementById('t-edit-' + id);
        if (area) area.style.display = (area.style.display === 'block') ? 'none' : 'block';
        return;
      }
      const btnCancel = ev.target.closest('.t-cancel');
      if (btnCancel && container.contains(btnCancel)) {
        const id = btnCancel.getAttribute('data-id');
        const area = document.getElementById('t-edit-' + id);
        if (area) area.style.display = 'none';
        return;
      }
      const btnSave = ev.target.closest('.t-save');
      if (btnSave && container.contains(btnSave)) {
        const id = btnSave.getAttribute('data-id');
        const area = document.getElementById('t-edit-' + id);
        if (!area) return;
        const title = (area.querySelector('.t-edit-title').value || '').trim();
        const body = (area.querySelector('.t-edit-body').value || '').trim();
        if (!title) { alert('Title required'); return; }
        btnSave.disabled = true;
        api('/threads/' + encodeURIComponent(id), { method: 'PUT', body: { title: title, body: body, customer_id: cid } })
          .then(function (out) {
            if (!out || !out.success) throw new Error((out && out.message) || 'Save failed');
            const card = area.closest('.community-card');
            if (card) {
              const t = card.querySelector('.thread-title'); if (t) t.textContent = title;
              const b = card.querySelector('.thread-body'); if (b) b.innerHTML = renderMarkdown(body);
            }
            area.style.display = 'none';
          })
          .catch(function (e) { alert('Save failed: ' + e.message); })
          .finally(function () { btnSave.disabled = false; });
        return;
      }
      const btnDel = ev.target.closest('.t-delete');
      if (btnDel && container.contains(btnDel)) {
        const id = btnDel.getAttribute('data-id');
        if (!confirm('Delete this thread?')) return;
        btnDel.disabled = true;
        api('/threads/' + encodeURIComponent(id), { method: 'DELETE', body: { customer_id: cid } })
          .then(function (out) {
            if (!out || !out.success) throw new Error((out && out.message) || 'Delete failed');
            const card = btnDel.closest('.community-card');
            if (card) card.remove();
          })
          .catch(function (e) { alert('Delete failed: ' + e.message); })
          .finally(function () { btnDel.disabled = false; });
      }
    });

    // Lazy-load comments/polls when accordion opens
    qsa('.comments-accordion', container).forEach(function (d) {
      d.addEventListener('toggle', function () {
        if (d.open) {
          var tid = d.getAttribute('data-tid');
          loadCommentsForThread(tid, cid);
          loadPoll(tid, SHOP, cid);
        }
      });
    });

    wireCommentReplies(container, cid, SHOP);
  }

  /* ---------- categories (select + cards) ---------- */
  function renderTopicList(items) {
    var html = ['<li><button class="topic-item active" data-id=""><span class="topic-hash">#</span> All</button></li>']
      .concat((items || []).map(function (c) {
        return '<li><button class="topic-item" data-id="' + c._id + '"><span class="topic-hash">#</span> ' + escapeHtml(c.name) + '</button></li>';
      })).join('');
    return html;
  }

  function renderTopCategoryCards(items) {
    items = (items || []).slice(0, 3);
    if (!items.length) return '<div class="community-meta">No categories yet</div>';
    return items.map(function (c) {
      var count = c.threadCount || c.postCount || c.count || '';
      var meta = count ? ('<span class="cat-meta">' + count + ' posts</span>') : '';
      return [
        '<div class="cat-item" role="button" tabindex="0" data-id="' + c._id + '">',
        '  <div class="cat-icon" aria-hidden="true"></div>',
        '  <div>',
        '    <div class="cat-name">' + escapeHtml(c.name) + '</div>',
        '    ' + meta,
        '  </div>',
        '</div>'
      ].join('');
    }).join('');
  }

  function loadCategories(sel, tMsg, SHOP) {
    return api('/categories', { qs: { shop: SHOP } })
      .then(function (data) {
        var items = data.items || [];
        // native select
        var opts = ['<option value="">All categories</option>'].concat(items.map(function (c) {
          return '<option value="' + c._id + '">' + escapeHtml(c.name) + '</option>';
        })).join('');
        sel.innerHTML = opts;

        // hidden topic list for plumbing
        var list = qs('#topic-list');
        if (list) list.innerHTML = renderTopicList(items);

        // Render Top Categories cards
        var wrap = qs('#top-cats');
        if (wrap) {
          wrap.innerHTML = renderTopCategoryCards(items);
          wrap.addEventListener('click', function (e) {
            var card = e.target.closest('.cat-item'); if (!card) return;
            sel.value = card.getAttribute('data-id') || '';
            wrap.querySelectorAll('.cat-item').forEach(function (x) { x.classList.remove('active'); });
            card.classList.add('active');
            wrap.dispatchEvent(new CustomEvent('topic-change', { bubbles: true }));
          });
          wrap.addEventListener('keydown', function (e) {
            if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('cat-item')) {
              e.preventDefault(); e.target.click();
            }
          });
        }

        // "See more" helper
        var more = qs('#cats-more');
        if (more) more.addEventListener('click', function () {
          alert('Use the filters below or click a category card to narrow posts.');
        });
      })
      .catch(function (e) { setMsg(tMsg, 'Could not load categories: ' + e.message, true); });
  }

  /* ---------- highlights (pinned / top threads) ---------- */
  function renderHighlightItem(t) {
    var when = new Date(t.createdAt).toLocaleString();
    var votes = typeof t.votes === 'number' ? t.votes : 0;
    return [
      '<div class="hl-item">',
      '  <div class="hl-title">' + escapeHtml(t.title) + '</div>',
      '  <div class="hl-meta">' + when + ' · ▲ ' + votes + '</div>',
      '</div>'
    ].join('');
  }
  function loadHighlights() {
    var box = qs('#highlights');
    if (!box) return;
    box.innerHTML = '<div class="community-meta">Loading…</div>';

    // Try "top" threads for the week (Coda-like "Maker Highlights")
    return api('/threads', { qs: { sort: 'top', period: 'week', limit: 3 } })
      .then(function (res) {
        var items = (res && res.items) || [];
        if (!items.length) {
          box.innerHTML = '<div class="community-meta">No highlights yet</div>';
          return;
        }
        box.innerHTML = items.slice(0, 3).map(renderHighlightItem).join('');
      })
      .catch(function (e) {
        box.innerHTML = '<div class="community-meta">Failed to load: ' + e.message + '</div>';
      });
  }

  /* ---------- spotlight (announcement card on the rail) ---------- */
  function loadSpotlight(cid) {
    var spot = qs('#spotlight');
    if (!spot) return;
    spot.style.display = 'none';

    // Reuse notifications to surface the latest announcement
    return api('/notifications', { qs: { customer_id: cid, limit: 20 } })
      .then(function (j) {
        var items = (j && j.items) || [];
        var ann = items.find(function (n) { return n.type === 'announcement'; });
        if (!ann) return;

        var when = new Date(ann.createdAt).toLocaleString();
        var body = (ann.payload && ann.payload.message) || 'Announcement';
        spot.innerHTML = [
          '<div style="font-weight:700;margin-bottom:6px">📣 ', escapeHtml(body), '</div>',
          (ann.payload && ann.payload.link
            ? '<a href="' + escapeHtml(ann.payload.link) + '" target="_blank" rel="nofollow noopener" class="community-btn">Learn more</a>'
            : '<div class="community-meta">' + when + '</div>')
        ].join('');
        spot.style.display = 'block';
      })
      .catch(function () { /* ignore */ });
  }

  /* ---------- controls + threads ---------- */
  function getControls(root) {
    var topActive = !!(qs('#tab-top', root) && qs('#tab-top', root).classList.contains('active'));
    return {
      category: (qs('#cat-filter', root).value || ''),
      sort: topActive ? 'top' : '',
      period: topActive ? (qs('#forum-period', root).value || '') : '',
      from: (qs('#forum-from', root).value || ''),
      to: (qs('#forum-to', root).value || ''),
      search: (qs('#forum-search', root).value || '').trim()
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
        wireThreadActions(container, cid, SHOP);
        // Render polls immediately for each thread card
        items.forEach(function (t) { loadPoll(t._id, SHOP, cid); });
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
        setMsg(tMsg, 'Could not load threads: ' + e.message + ', please try again.', true);
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

      // Ensure styles exist even if we exit early for login gate
      injectStyles();

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
        root.innerHTML = [
          '<div class="community-box community-scope">',
          '  <div class="community-card auth-gate" role="region" aria-labelledby="auth-title">',
          '    <div class="auth-title" id="auth-title">Join the community</div>',
          '    <p class="auth-desc">Sign in to start new threads, up-vote ideas, and reply to others.</p>',
          '    <ul class="auth-features">',
          '      <li>Post questions & feedback</li>',
          '      <li>Vote on ideas you like</li>',
          '      <li>Join Polls</li>',
          '    </ul>',
          '    <div class="auth-actions">',
          '      <a class="community-btn primary" href="/account/login">Sign in</a>',
          '      <a class="community-btn" href="/account/register">Create account</a>',
          '    </div>',
          '  </div>',
          '</div>'
        ].join('');
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

        // Tabs for Latest/Top
        var tabLatest = qs('#tab-latest', root);
        var tabTop = qs('#tab-top', root);
        var periodSel = qs('#forum-period', root);

        function setTab(isTop) {
          if (isTop) {
            tabTop.classList.add('active'); tabTop.setAttribute('aria-selected', 'true');
            tabLatest.classList.remove('active'); tabLatest.setAttribute('aria-selected', 'false');
            periodSel.style.display = 'inline-block';
          } else {
            tabLatest.classList.add('active'); tabLatest.setAttribute('aria-selected', 'true');
            tabTop.classList.remove('active'); tabTop.setAttribute('aria-selected', 'false');
            periodSel.style.display = 'none';
          }
          loadNow();
        }

        tabLatest && tabLatest.addEventListener('click', function () { setTab(false); });
        tabTop && tabTop.addEventListener('click', function () { setTab(true); });
        periodSel && periodSel.addEventListener('change', function () { loadNow(); });

        qs('#forum-apply', root).addEventListener('click', function () { loadNow(); });

        // Search, categories, highlights, spotlight
        wireSuggest(root, SHOP, loadNow);
        loadCategories(sel, tMsg, SHOP).then(function () { return loadNow(); });
        var topCats = qs('#top-cats', root);
        if (topCats) topCats.addEventListener('topic-change', function () { loadNow(); });

        loadHighlights();
        loadSpotlight(cid);

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
            body: { title: title, body: body, tags: tags, isAnonymous: anon, categoryId: categoryId, customer_id: cid, display_name: displayName }
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
              list.scrollIntoView({ behavior: 'smooth', block: 'start' });
            })
            .catch(function (e) { setMsg(tMsg, 'Failed: ' + e.message, true); });
        });
      });
    }
  };
})();
