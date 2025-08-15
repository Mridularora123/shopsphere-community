# Shopify Forum (Partner App) — Full Starter

Private community forum for Shopify stores, installable via **Shopify Partners > Apps** (OAuth), with:
- Threads, comments (single-level replies; easy to extend)
- Anonymous or named posting
- Admin approval (moderation)
- Categories, upvotes, polls, reports
- Members-only participation (must be logged-in customer)
- Storefront widget via **App Proxy**
- Non-embedded Admin panel

## 1) Configure a Partner App
1. Go to Shopify Partner Dashboard → **Apps → Create app**.
2. App type: Custom (single-merchant) or draft.
3. Set:
   - **App URL:** `https://YOUR-RENDER-APP.onrender.com`
   - **Allowed redirection URL(s):** `https://YOUR-RENDER-APP.onrender.com/auth/callback`
4. Copy **API key** and **API secret**.

### App Proxy
- Extensions → **App Proxy**:
  - Prefix: `apps`
  - Subpath: `community`
  - Proxy URL: `https://YOUR-RENDER-APP.onrender.com/proxy`
- Save → copy **Shared secret** (put into `.env` as `APP_PROXY_SHARED_SECRET`).

## 2) Environment variables
Create `.env` from `.env.example` and fill:
```
PORT=10000
APP_URL=https://YOUR-RENDER-APP.onrender.com
SHOPIFY_API_KEY=xxx
SHOPIFY_API_SECRET=yyy
SCOPES=read_customers
REDIRECT_URI=https://YOUR-RENDER-APP.onrender.com/auth/callback
APP_PROXY_SHARED_SECRET=zzz
MONGODB_URI=your_mongo_uri
ADMIN_PASSWORD=your_admin_password
SESSION_SECRET=long_random
ALLOW_ANONYMOUS=true
AUTO_APPROVE=false
EDIT_WINDOW_MINUTES=15
```

## 3) Deploy on Render
- New Web Service → Node → connect repo
- Start command: `node server.js`
- Add all env vars above
- Deploy → copy live URL

## 4) Install on your store
- In Partner app → **Test on development store** → choose store
- This opens `/auth?shop=your-store.myshopify.com` and completes OAuth
- After install, go to `https://YOUR-RENDER-APP.onrender.com/admin` for moderation

## 5) Add widget to your theme
Create a Page “Community” and paste:
```liquid
<div id="forum-root"></div>
<link rel="stylesheet" href="https://YOUR-RENDER-APP.onrender.com/styles.css">
<script src="https://YOUR-RENDER-APP.onrender.com/forum-widget.js"></script>
<script>
  document.addEventListener('DOMContentLoaded', function(){
    ForumWidget.mount('#forum-root', { proxyUrl: '/apps/community' });
  });
</script>
```
> The widget requires customers to be **logged in**.

## 6) Use the Admin
Open `https://YOUR-RENDER-APP.onrender.com/admin` (non-embedded).  
User: `admin` • Pass: `ADMIN_PASSWORD`.

- **Threads**: approve/reject, pin/unpin, close/reopen
- **Comments**: approve/reject
- **Categories**: create/delete
- **Polls**: attach to a thread, close
- **Reports**: resolve

## Notes
- This starter doesn’t call the Admin API after install; OAuth is used only to install from Partner dashboard. (Scopes kept minimal.)
- App Proxy HMAC verifies storefront requests.
- Extend comments to nested by using `parentId` and building a tree in the widget.
