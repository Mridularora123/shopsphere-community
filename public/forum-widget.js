// /public/forum-widget.js
(function(){
  var TIMEOUT_MS = 10000;

  function qs(s,r){return (r||document).querySelector(s);}
  function qsa(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));}
  function escapeHtml(s){return (s||'').replace(/[&<>"']/g,function(m){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m];});}
  function setMsg(el,t,isErr){el.textContent=t||'';el.style.color=isErr?'#b00020':'#666';if(t)setTimeout(function(){el.textContent='';},3500);}
  function loading(el,on){if(!el)return;el.innerHTML=on?'<div class="community-meta">Loading…</div>':'';}
  function isDesignMode(){try{return !!(window.Shopify&&Shopify.designMode);}catch(_){return false;}}

  /* ---------- ROBUST CUSTOMER DETECTION ---------- */
  function getCustomerId(){
    // 1) Our meta tag (added in custom.liquid)
    var m=document.querySelector('meta[name="forum-customer-id"]');
    if(m&&m.content){ return m.content.trim(); }

    // 2) Liquid-injected global (if the theme allows inline scripts)
    if (window.__FORUM_CUSTOMER__ && window.__FORUM_CUSTOMER__.id) return String(window.__FORUM_CUSTOMER__.id);

    // 3) Shopify global (some themes expose it)
    try{ if(window.Shopify&&Shopify.customer&&Shopify.customer.id) return String(Shopify.customer.id); }catch(_){}

    return null;
  }

  /* ---------- fetch helpers ---------- */
  function withTimeout(p,ms){
    var t;var timeout=new Promise(function(_,rej){t=setTimeout(function(){rej(new Error('Request timed out'));},ms||TIMEOUT_MS);});
    return Promise.race([p,timeout]).finally(function(){clearTimeout(t);});
  }
  function api(path,opts){
    opts=opts||{};
    var url=(window.__FORUM_PROXY__||'/apps/community')+path;
    return withTimeout(fetch(url,{
      method:opts.method||'GET',
      headers:{'Content-Type':'application/json'},
      credentials:'same-origin',
      body:opts.body?JSON.stringify(opts.body):undefined
    })).then(function(r){
      if(!r.ok){var e=new Error('API error: '+r.status);e.status=r.status;throw e;}
      return r.json();
    });
  }
  function pingProxy(){
    return api('/ping').then(function(j){return{ok:true,json:j};},function(e){return{ok:false,error:e};});
  }

  /* ---------- UI ---------- */
  function template(root){
    root.innerHTML=[
      '<div class="community-box">',
      '  <div id="t-msg" class="community-meta" style="min-height:18px;margin-bottom:6px"></div>',
      '  <div class="community-row">',
      '    <select id="cat-filter"></select>',
      '    <input id="thread-title" class="community-input" placeholder="Start a new thread (title)"/>',
      '  </div>',
      '  <textarea id="thread-body" class="community-textarea" rows="3" placeholder="Write details..."></textarea>',
      '  <div class="community-row">',
      '    <input id="thread-tags" class="community-input" placeholder="tags (comma separated)"/>',
      '    <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="thread-anon"/><span class="community-meta">Anonymous</span></label>',
      '    <button id="thread-submit" class="community-btn">Post</button>',
      '  </div>',
      '  <hr/>',
      '  <div id="threads"></div>',
      '</div>'
    ].join('\n');
  }

  function renderThreads(container,items){
    container.innerHTML=(items||[]).map(function(t){
      return [
        '<div class="community-card">',
        '  <div style="display:flex;justify-content:space-between;align-items:center">',
        '    <div><strong>'+escapeHtml(t.title)+'</strong> '+(t.pinned?'<span class="badge">Pinned</span>':'')+' '+(t.closed?'<span class="badge">Closed</span>':'')+'</div>',
        '    <button class="vote" data-id="'+t._id+'" style="cursor:pointer;background:none;border:none">▲ '+(t.votes||0)+'</button>',
        '  </div>',
        '  <div class="community-meta">'+new Date(t.createdAt).toLocaleString()+'</div>',
        '  <div>'+escapeHtml(t.body||'')+'</div>',
        '  <div style="margin:6px 0;">'+(t.tags||[]).map(function(x){return '<span class="community-tag">'+escapeHtml(x)+'</span>';}).join('')+'</div>',
        '  <div id="comments-'+t._id+'"></div>',
        '  <div class="community-row">',
        '    <input data-tid="'+t._id+'" class="community-input comment-input" placeholder="Write a comment..."/>',
        '    <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" class="comment-anon" data-tid="'+t._id+'"/><span class="community-meta">Anonymous</span></label>',
        '    <button data-tid="'+t._id+'" class="community-btn comment-btn">Reply</button>',
        '    <button data-tid="'+t._id+'" class="community-btn report-btn" title="Report">Report</button>',
        '  </div>',
        '</div>'
      ].join('');
    }).join('');
  }

  function wireThreadActions(container,cid){
    qsa('.vote',container).forEach(function(el){
      var lock=false;
      el.addEventListener('click',function(){
        if(lock)return; if(!cid) return alert('Please log in to participate.');
        lock=true;
        api('/votes',{method:'POST',body:{targetType:'thread',targetId:el.getAttribute('data-id'),customer_id:cid}})
          .then(function(out){
            if(out&&out.success){var n=parseInt((el.textContent.match(/\d+/)||['0'])[0],10)+1;el.textContent='▲ '+n;}
            else alert((out&&out.message)||'Vote failed');
          }).catch(function(e){alert('Vote failed: '+e.message);}).finally(function(){lock=false;});
      });
    });

    qsa('.comment-btn',container).forEach(function(btn){
      btn.addEventListener('click',function(){
        if(!cid) return alert('Please log in to participate.');
        var tid=btn.getAttribute('data-tid');
        var input=qs('.comment-input[data-tid="'+tid+'"]',container);
        var anon=qs('.comment-anon[data-tid="'+tid+'"]',container).checked;
        if(!input||!input.value.trim()) return;
        api('/comments',{method:'POST',body:{threadId:tid,body:input.value,isAnonymous:anon,customer_id:cid}})
          .then(function(out){input.value='';alert((out&&out.message)||(out&&out.success?'Submitted for review':'Failed'));})
          .catch(function(e){alert('Failed: '+e.message);});
      });
    });

    qsa('.report-btn',container).forEach(function(btn){
      btn.addEventListener('click',function(){
        if(!cid) return alert('Please log in to participate.');
        var tid=btn.getAttribute('data-tid');
        var reason=prompt('Why are you reporting this?'); if(!reason) return;
        api('/reports',{method:'POST',body:{targetType:'thread',targetId:tid,reason:reason,customer_id:cid}})
          .then(function(out){alert(out&&out.success?'Reported':'Failed');})
          .catch(function(e){alert('Failed: '+e.message);});
      });
    });
  }

  function loadCategories(sel,tMsg){
    return api('/categories').then(function(data){
      var opts=['<option value="">All categories</option>'].concat((data.items||[]).map(function(c){
        return '<option value="'+c._id+'">'+escapeHtml(c.name)+'</option>';
      })).join('');
      sel.innerHTML=opts;
    }).catch(function(e){setMsg(tMsg,'Could not load categories: '+e.message,true);});
  }

  function loadThreads(container,tMsg,cid){
    var cat=qs('#cat-filter').value;
    var q=cat?('?categoryId='+encodeURIComponent(cat)):'';
    loading(container,true);
    return api('/threads'+q).then(function(data){
      renderThreads(container,data.items||[]);
      wireThreadActions(container,cid);
    }).catch(function(e){
      container.innerHTML='';
      setMsg(tMsg,'Could not load threads: '+e.message,true);
    });
  }

  /* ---------- PUBLIC API ---------- */
  window.ForumWidget={
    mount:function(selector,opts){
      opts=opts||{};
      var root=qs(selector); if(!root) return;

      if(isDesignMode()){
        root.innerHTML='<div class="community-box">Community widget preview is unavailable in the Theme Editor. Open the storefront (View store) to test.</div>';
        return;
      }

      window.__FORUM_PROXY__=opts.proxyUrl||'/apps/community';

      // Read customer id via meta / fallbacks
      var cid=getCustomerId();
      if(!cid){
        root.innerHTML='<div class="community-box">Please <a href="/account/login">log in</a> to view and participate in the community.</div>';
        return;
      }

      // Render UI
      template(root);
      var tMsg=qs('#t-msg',root);
      var sel=qs('#cat-filter',root);
      var list=qs('#threads',root);

      // Quick proxy health check
      pingProxy().then(function(res){
        if(!res.ok){
          var status=(res.error&&res.error.status)||'unknown';
          setMsg(tMsg,'App proxy not reachable (status '+status+'). Check App Proxy & shared secret.',true);
          return;
        }
        loadCategories(sel,tMsg).then(function(){return loadThreads(list,tMsg,cid);});
        sel.addEventListener('change',function(){loadThreads(list,tMsg,cid);});
        qs('#thread-submit',root).addEventListener('click',function(){
          if(!cid) return setMsg(tMsg,'Please log in first',true);
          var title=(qs('#thread-title',root).value||'').trim();
          if(!title) return setMsg(tMsg,'Title required',true);
          var body=(qs('#thread-body',root).value||'').trim();
          var tags=(qs('#thread-tags',root).value||'').split(',').map(function(s){return s.trim();}).filter(Boolean);
          var anon=!!qs('#thread-anon',root).checked;
          var categoryId=sel.value||null;
          api('/threads',{method:'POST',body:{title:title,body:body,tags:tags,isAnonymous:anon,categoryId:categoryId,customer_id:cid}})
            .then(function(out){
              setMsg(tMsg,(out&&out.message)||(out&&out.success?'Submitted for review':'Failed'),!out||!out.success);
              qs('#thread-title',root).value='';qs('#thread-body',root).value='';qs('#thread-tags',root).value='';
              loadThreads(list,tMsg,cid);
            }).catch(function(e){setMsg(tMsg,'Failed: '+e.message,true);});
        });
      });
    }
  };
})();
