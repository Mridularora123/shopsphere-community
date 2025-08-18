// /public/forum-widget.js
(function(){
  var TIMEOUT_MS = 10000;

  /* ---------- tiny DOM helpers ---------- */
  function qs(s,r){return (r||document).querySelector(s);}
  function qsa(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));}
  function escapeHtml(s){return (s||'').replace(/[&<>"']/g,function(m){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m];});}
  function setMsg(el,t,isErr){el.textContent=t||'';el.style.color=isErr?'#b00020':'#666';if(t)setTimeout(function(){el.textContent='';},3500);}
  function loading(el,on){if(!el)return;el.innerHTML=on?'<div class="community-meta">Loading…</div>':'';}
  function isDesignMode(){try{return !!(window.Shopify&&Shopify.designMode);}catch(_){return false;}}

  /* ---------- robust shop & customer detection ---------- */
  function getShop(){
    // 1) meta tag <meta name="forum-shop" content="myshop.myshopify.com">
    var m=document.querySelector('meta[name="forum-shop"]');
    if(m&&m.content) return m.content.trim();
    // 2) window var (theme can set) window.__FORUM_SHOP
    if (window.__FORUM_SHOP) return String(window.__FORUM_SHOP);
    // 3) Shopify global
    try{ if(window.Shopify && Shopify.shop) return String(Shopify.shop); }catch(_){}
    return null;
  }
  function getCustomerId(){
    // 1) meta tag
    var m=document.querySelector('meta[name="forum-customer-id"]');
    if(m&&m.content){ return m.content.trim(); }
    // 2) window var
    if (window.__FORUM_CUSTOMER__ && window.__FORUM_CUSTOMER__.id) return String(window.__FORUM_CUSTOMER__.id);
    // 3) Shopify global
    try{ if(window.Shopify&&Shopify.customer&&Shopify.customer.id) return String(Shopify.customer.id); }catch(_){}
    return null;
  }

  /* ---------- fetch helpers with query support ---------- */
  function withTimeout(p,ms){
    var t;var timeout=new Promise(function(_,rej){t=setTimeout(function(){rej(new Error('Request timed out'));},ms||TIMEOUT_MS);});
    return Promise.race([p,timeout]).finally(function(){clearTimeout(t);});
  }
  function toQuery(params){
    if(!params) return '';
    var parts=[];
    Object.keys(params).forEach(function(k){
      var v=params[k];
      if(v==null || v==='') return;
      parts.push(encodeURIComponent(k)+'='+encodeURIComponent(v));
    });
    return parts.length?('?'+parts.join('&')):'';
  }
  function api(path,opts){
    opts=opts||{};
    var base=(window.__FORUM_PROXY__||'/apps/community');
    var url=base+path+(opts.qs?toQuery(opts.qs):'');
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
  var debounce=function(fn,ms){var t;return function(){var a=arguments;clearTimeout(t);t=setTimeout(function(){fn.apply(null,a);},ms||200);};};

  /* ---------- UI template ---------- */
  function template(root){
    root.innerHTML=[
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
  function renderThreads(container,items){
    container.innerHTML=(items||[]).map(function(t){
      return [
        '<div class="community-card">',
        '  <div style="display:flex;justify-content:space-between;align-items:center">',
        '    <div><strong>'+escapeHtml(t.title)+'</strong> '+(t.pinned?'<span class="badge">Pinned</span>':'')+' '+(t.closed?'<span class="badge">Closed</span>':'')+'</div>',
        '    <button class="vote" data-id="'+t._id+'" data-voted="0" style="cursor:pointer;background:none;border:none">▲ '+(t.votes||0)+'</button>',
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

  /* ---------- wire actions on threads after render ---------- */
  function wireThreadActions(container,cid,SHOP){
    // Restore & autosave comment drafts per thread
    qsa('.comment-input',container).forEach(function(input){
      var tid=input.getAttribute('data-tid');
      var key='forum_draft_'+SHOP+'_'+(cid||'anon')+'_comment_'+tid;
      try{
        var saved=JSON.parse(localStorage.getItem(key)||'{}');
        if(saved.b) input.value=saved.b;
      }catch(_){}
      input.addEventListener('input',debounce(function(){
        localStorage.setItem(key, JSON.stringify({ b: input.value, at: Date.now() }));
      },300));
    });

    // Voting (toggle)
    qsa('.vote',container).forEach(function(el){
      var lock=false;
      el.addEventListener('click',function(){
        if(lock)return;
        if(!cid) return alert('Please log in to participate.');
        lock=true;
        var tid=el.getAttribute('data-id');
        api('/votes/toggle',{method:'POST',qs:{shop:SHOP},body:{targetType:'thread',targetId:tid,customer_id:cid}})
          .then(function(out){
            if(out&&out.success){
              var current=parseInt((el.textContent.match(/\d+/)||['0'])[0],10);
              var voted=el.getAttribute('data-voted')==='1';
              if(out.voted && !voted){ current+=1; el.setAttribute('data-voted','1'); }
              if(!out.voted && voted){ current=Math.max(0,current-1); el.setAttribute('data-voted','0'); }
              el.textContent='▲ '+current;
            } else {
              alert((out&&out.message)||'Vote failed');
            }
          }).catch(function(e){alert('Vote failed: '+e.message);})
          .finally(function(){lock=false;});
      });
    });

    // Comment submit
    qsa('.comment-btn',container).forEach(function(btn){
      btn.addEventListener('click',function(){
        if(!cid) return alert('Please log in to participate.');
        var tid=btn.getAttribute('data-tid');
        var input=qs('.comment-input[data-tid="'+tid+'"]',container);
        var anon=qs('.comment-anon[data-tid="'+tid+'"]',container).checked;
        if(!input||!input.value.trim()) return;
        api('/comments',{method:'POST',qs:{shop:SHOP},body:{threadId:tid,body:input.value,isAnonymous:anon,customer_id:cid}})
          .then(function(out){
            // clear draft
            var key='forum_draft_'+SHOP+'_'+(cid||'anon')+'_comment_'+tid;
            localStorage.removeItem(key);
            input.value='';
            alert((out&&out.message)||(out&&out.success?'Submitted for review':'Failed'));
          })
          .catch(function(e){alert('Failed: '+e.message);});
      });
    });

    // Report
    qsa('.report-btn',container).forEach(function(btn){
      btn.addEventListener('click',function(){
        if(!cid) return alert('Please log in to participate.');
        var tid=btn.getAttribute('data-tid');
        var reason=prompt('Why are you reporting this?'); if(!reason) return;
        api('/reports',{method:'POST',qs:{shop:SHOP},body:{targetType:'thread',targetId:tid,reason:reason,customer_id:cid}})
          .then(function(out){alert(out&&out.success?'Reported':'Failed');})
          .catch(function(e){alert('Failed: '+e.message);});
      });
    });
  }

  /* ---------- categories ---------- */
  function loadCategories(sel,tMsg,SHOP){
    return api('/categories',{qs:{shop:SHOP}}).then(function(data){
      var opts=['<option value="">All categories</option>'].concat((data.items||[]).map(function(c){
        return '<option value="'+c._id+'">'+escapeHtml(c.name)+'</option>';
      })).join('');
      sel.innerHTML=opts;
    }).catch(function(e){setMsg(tMsg,'Could not load categories: '+e.message,true);});
  }

  /* ---------- threads (with sort/period/date/search) ---------- */
  function getControls(root){
    return {
      category: qs('#cat-filter',root).value || '',
      sort: qs('#forum-sort',root).value || '',
      period: qs('#forum-period',root).style.display!=='none' ? (qs('#forum-period',root).value||'') : '',
      from: qs('#forum-from',root).value || '',
      to: qs('#forum-to',root).value || '',
      search: qs('#forum-search',root).value.trim()
    };
  }

  function loadThreads(container,tMsg,cid,SHOP,root){
    var ctl=getControls(root);
    var params={ shop: SHOP };
    if(ctl.category) params.categoryId=ctl.category;
    if(ctl.search) params.q=ctl.search;
    if(ctl.sort) params.sort=ctl.sort;
    if(ctl.sort==='top' && ctl.period) params.period=ctl.period;
    if(ctl.from) params.from=ctl.from;
    if(ctl.to) params.to=ctl.to;

    loading(container,true);
    return api('/threads',{qs:params}).then(function(data){
      renderThreads(container,data.items||[]);
      wireThreadActions(container,cid,SHOP);
    }).catch(function(e){
      container.innerHTML='';
      setMsg(tMsg,'Could not load threads: '+e.message,true);
    });
  }

  /* ---------- suggest (typeahead) ---------- */
  function wireSuggest(root,SHOP,load){
    var input=qs('#forum-search',root);
    var box=qs('#forum-suggest',root);
    function hide(){ box.style.display='none'; box.innerHTML=''; }
    function show(html){ box.innerHTML=html; box.style.display = html ? 'block' : 'none'; }
    function row(html){ return '<div class="s-item" style="padding:6px 8px;cursor:pointer;border-top:1px solid #eee">'+html+'</div>'; }

    var doSuggest=debounce(function(){
      var q=input.value.trim(); if(!q){ hide(); return; }
      api('/suggest',{qs:{shop:SHOP,q:q}}).then(function(data){
        data=data||{};
        var titles=(data.titles||[]).map(function(t){return row(escapeHtml(t.title));}).join('');
        var tags=(data.tags||[]).map(function(t){return row('#'+escapeHtml(t));}).join('');
        var cats=(data.categories||[]).map(function(c){return row('📂 '+escapeHtml(c.name)+' ('+escapeHtml(c.slug)+')');}).join('');
        var content='';
        if(titles) content+='<div style="padding:6px 8px;font-weight:600;background:#fafafa;border-bottom:1px solid #eee">Titles</div>'+titles;
        if(tags) content+='<div style="padding:6px 8px;font-weight:600;background:#fafafa;border-bottom:1px solid #eee">Tags</div>'+tags;
        if(cats) content+='<div style="padding:6px 8px;font-weight:600;background:#fafafa;border-bottom:1px solid #eee">Categories</div>'+cats;
        show(content||'');
      }).catch(function(){ hide(); });
    },150);

    input.addEventListener('input',doSuggest);
    input.addEventListener('keydown',function(e){
      if(e.key==='Enter'){ e.preventDefault(); hide(); load(); }
    });
    input.addEventListener('blur',function(){ setTimeout(hide,150); });

    box.addEventListener('mousedown',function(e){
      var item=e.target.closest('.s-item'); if(!item) return;
      var text=item.textContent.trim();
      if(text.startsWith('#')) input.value='tag:'+text.slice(1)+' ';
      else if(text.startsWith('📂')) {
        var slug=(text.match(/\(([^)]+)\)\s*$/)||[])[1]||'';
        input.value='cat:'+slug+' ';
      } else {
        input.value=text;
      }
      hide();
      load();
    });
  }

  /* ---------- thread draft autosave + preview ---------- */
  function wireThreadDraft(root,SHOP,cid){
    var title=qs('#thread-title',root);
    var body=qs('#thread-body',root);
    var preview=qs('#thread-preview',root);
    var toggleBtn=qs('#thread-preview-toggle',root);
    if(!title||!body||!toggleBtn) return;

    var key='forum_draft_'+SHOP+'_'+(cid||'anon')+'_thread';
    // restore
    try{
      var saved=JSON.parse(localStorage.getItem(key)||'{}');
      if(saved.t) title.value=saved.t;
      if(saved.b) body.value=saved.b;
    }catch(_){}

    var save=debounce(function(){
      localStorage.setItem(key, JSON.stringify({ t: title.value, b: body.value, at: Date.now() }));
    },300);
    title.addEventListener('input',save);
    body.addEventListener('input',save);

    var on=false;
    toggleBtn.addEventListener('click',function(){
      on=!on;
      toggleBtn.textContent = on ? 'Edit' : 'Preview';
      body.style.display = on ? 'none' : 'block';
      preview.style.display = on ? 'block' : 'none';
      preview.textContent = (title.value?('# '+title.value+'\n\n'):'') + (body.value||'');
    });

    return {
      clear:function(){ localStorage.removeItem(key); }
    };
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

      var SHOP=getShop();
      var cid=getCustomerId();

      // This forum is private: require login to view/participate
      if(!cid){
        root.innerHTML='<div class="community-box">Please <a href="/account/login">log in</a> to view and participate in the community.</div>';
        return;
      }
      if(!SHOP){
        root.innerHTML='<div class="community-box">Shop domain not detected. Add <meta name="forum-shop" content="{{ shop.permanent_domain }}"> to theme.</div>';
        return;
      }

      // Render UI
      template(root);
      var tMsg=qs('#t-msg',root);
      var sel=qs('#cat-filter',root);
      var list=qs('#threads',root);

      // helpers to reload
      var loadNow=function(){ return loadThreads(list,tMsg,cid,SHOP,root); };

      // Quick proxy health check
      pingProxy().then(function(res){
        if(!res.ok){
          var status=(res.error&&res.error.status)||'unknown';
          setMsg(tMsg,'App proxy not reachable (status '+status+'). Check App Proxy & shared secret.',true);
          return;
        }

        // controls wiring
        var sortSel=qs('#forum-sort',root);
        var periodSel=qs('#forum-period',root);
        function togglePeriod(){ periodSel.style.display = (sortSel.value==='top') ? 'inline-block' : 'none'; }
        sortSel.addEventListener('change',function(){ togglePeriod(); loadNow(); });
        periodSel.addEventListener('change',loadNow);
        qs('#forum-apply',root).addEventListener('click',loadNow);

        // suggest
        wireSuggest(root,SHOP,loadNow);

        // categories + initial threads
        loadCategories(sel,tMsg,SHOP).then(function(){ return loadNow(); });

        // change category
        sel.addEventListener('change',loadNow);

        // post new thread
        var draft=wireThreadDraft(root,SHOP,cid);
        qs('#thread-submit',root).addEventListener('click',function(){
          var title=(qs('#thread-title',root).value||'').trim();
          if(!title) return setMsg(tMsg,'Title required',true);
          var body=(qs('#thread-body',root).value||'').trim();
          var tags=(qs('#thread-tags',root).value||'').split(',').map(function(s){return s.trim();}).filter(Boolean);
          var anon=!!qs('#thread-anon',root).checked;
          var categoryId=sel.value||null;

          api('/threads',{method:'POST',qs:{shop:SHOP},body:{title:title,body:body,tags:tags,isAnonymous:anon,categoryId:categoryId,customer_id:cid}})
            .then(function(out){
              setMsg(tMsg,(out&&out.message)||(out&&out.success?'Submitted for review':'Failed'),!out||!out.success);
              // clear fields + draft
              qs('#thread-title',root).value='';qs('#thread-body',root).value='';qs('#thread-tags',root).value='';
              if(draft) draft.clear();
              // return to edit mode if preview was open
              var preview=qs('#thread-preview',root); var toggle=qs('#thread-preview-toggle',root);
              if(preview.style.display==='block'){ preview.style.display='none'; qs('#thread-body',root).style.display='block'; toggle.textContent='Preview'; }
              loadNow();
            }).catch(function(e){setMsg(tMsg,'Failed: '+e.message,true);});
        });
      });
    }
  };
})();
