(function(){
  function ensureMember(){
    if (!window.Shopify || !window.Shopify.customer) return false;
    return true;
  }
  function msg(el, text){ el.textContent = text; setTimeout(()=>el.textContent='', 3000); }
  function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
  async function api(path, opts={}){
    const res = await fetch(`${window.__FORUM_PROXY__}${path}`, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    return res.json();
  }
  function template(root){
    root.innerHTML = `
      <div class="community-box">
        <div class="community-row">
          <select id="cat-filter"></select>
          <input id="thread-title" class="community-input" placeholder="Start a new thread (title)" />
        </div>
        <textarea id="thread-body" class="community-textarea" rows="3" placeholder="Write details..."></textarea>
        <div class="community-row">
          <input id="thread-tags" class="community-input" placeholder="tags (comma separated)" />
          <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="thread-anon"/> <span class="community-meta">Anonymous</span></label>
          <button id="thread-submit" class="community-btn">Post</button>
        </div>
        <div id="t-msg" class="community-meta"></div>
        <hr/>
        <div id="threads"></div>
      </div>
    `;
  }
  async function loadCategories(sel){
    const data = await api('/categories');
    const opts = ['<option value="">All categories</option>'].concat(
      (data.items||[]).map(c=>`<option value="${c._id}">${escapeHtml(c.name)}</option>`)
    ).join('');
    sel.innerHTML = opts;
  }
  async function loadThreads(container){
    const cat = document.querySelector('#cat-filter').value;
    const q = cat ? `?categoryId=${encodeURIComponent(cat)}` : '';
    const data = await api('/threads'+q);
    container.innerHTML = (data.items||[]).map(t=>`
      <div class="community-card">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div><strong>${escapeHtml(t.title)}</strong> ${t.pinned?'<span class="badge">Pinned</span>':''} ${t.closed?'<span class="badge">Closed</span>':''}</div>
          <div class="vote" data-type="thread" data-id="${t._id}">▲ ${t.votes||0}</div>
        </div>
        <div class="community-meta">${new Date(t.createdAt).toLocaleString()}</div>
        <div>${escapeHtml(t.body||'')}</div>
        <div style="margin:6px 0;">${(t.tags||[]).map(x=>`<span class="community-tag">${escapeHtml(x)}</span>`).join('')}</div>
        <div id="comments-${t._id}"></div>
        <div class="community-row">
          <input data-tid="${t._id}" class="community-input comment-input" placeholder="Write a comment..." />
          <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" class="comment-anon" data-tid="${t._id}"/><span class="community-meta">Anonymous</span></label>
          <button data-tid="${t._id}" class="community-btn comment-btn">Reply</button>
          <button data-tid="${t._id}" class="community-btn report-btn" title="Report">Report</button>
        </div>
      </div>
    `).join('');
    // votes
    container.querySelectorAll('.vote').forEach(el=>{
      el.addEventListener('click', async ()=>{
        if (!ensureMember()) return alert('Please login to participate.');
        const id = el.getAttribute('data-id');
        const out = await api('/votes', { method:'POST', body:{ targetType:'thread', targetId:id, customer_id: window.Shopify.customer.id } });
        if(out.success){ const n = parseInt(el.textContent.replace(/\D/g,'')) + 1; el.textContent = '▲ ' + n; }
        else alert(out.message||'Vote failed');
      });
    });
    // comments
    container.querySelectorAll('.comment-btn').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        if (!ensureMember()) return alert('Please login to participate.');
        const tid = btn.getAttribute('data-tid');
        const input = container.querySelector(`.comment-input[data-tid="${tid}"]`);
        const anon = container.querySelector(`.comment-anon[data-tid="${tid}"]`).checked;
        if (!input.value.trim()) return;
        const out = await api('/comments', { method:'POST', body:{ threadId: tid, body: input.value, isAnonymous: anon, customer_id: window.Shopify.customer.id } });
        input.value='';
        alert(out.message || (out.success ? 'Submitted for review' : 'Failed'));
      });
    });
    // report
    container.querySelectorAll('.report-btn').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        if (!ensureMember()) return alert('Please login to participate.');
        const tid = btn.getAttribute('data-tid');
        const reason = prompt('Why are you reporting this?');
        if(!reason) return;
        const out = await api('/reports', { method:'POST', body:{ targetType:'thread', targetId: tid, reason, customer_id: window.Shopify.customer.id } });
        alert(out.success ? 'Reported' : 'Failed');
      });
    });
  }

  window.ForumWidget = {
    mount(selector, opts={}){
      const root = document.querySelector(selector);
      if (!root) return;
      window.__FORUM_PROXY__ = opts.proxyUrl || '/apps/community';
      template(root);
      const member = ensureMember();
      if (!member){
        root.innerHTML = '<div class="community-box">Please <a href="/account/login">log in</a> to view and participate in the community.</div>';
        return;
      }
      const catSel = root.querySelector('#cat-filter');
      const threadsEl = root.querySelector('#threads');
      loadCategories(catSel).then(()=> loadThreads(threadsEl));
      catSel.addEventListener('change', ()=> loadThreads(threadsEl));
      root.querySelector('#thread-submit').addEventListener('click', async ()=>{
        const title = root.querySelector('#thread-title').value.trim();
        if (!title) return msg(root.querySelector('#t-msg'), 'Title required');
        const body = root.querySelector('#thread-body').value.trim();
        const tags = root.querySelector('#thread-tags').value.split(',').map(s=>s.trim()).filter(Boolean);
        const anon = root.querySelector('#thread-anon').checked;
        const categoryId = catSel.value || null;
        const out = await api('/threads', { method:'POST', body:{ title, body, tags, isAnonymous: anon, categoryId, customer_id: window.Shopify.customer.id } });
        msg(root.querySelector('#t-msg'), out.message || (out.success ? 'Submitted for review' : 'Failed'));
        root.querySelector('#thread-title').value=''; root.querySelector('#thread-body').value=''; root.querySelector('#thread-tags').value='';
        loadThreads(threadsEl);
      });
    }
  };
})();
