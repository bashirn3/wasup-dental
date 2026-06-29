# Google Cloud setup — OAuth 2.0 (prod-ready) + Places API

Two things live in Google Cloud for this app:

1. **OAuth 2.0 client** — powers "Sign in with Google" (via Clerk, using our own credentials so it's production-ready, not Clerk's shared dev keys).
2. **Places API (New) key** — powers the business-name search in onboarding.

---

## 1. Create the project

1. [console.cloud.google.com](https://console.cloud.google.com) → New Project → name it `rapidmot-prod`.
2. Note the project ID.

## 2. OAuth consent screen (production)

1. **APIs & Services → OAuth consent screen**.
2. User type: **External**.
3. App name: `RapidMOT` · support email + developer contact: your email.
4. App domain: `https://YOUR_APP_DOMAIN` (e.g. `https://app.rapidmot.co`), add privacy policy + terms URLs when ready.
5. Scopes: only the defaults needed for sign-in — `openid`, `email`, `profile` (non-sensitive, no verification review required).
6. **Publish the app** (move from Testing → In production) so logins aren't capped at 100 test users.

## 3. OAuth 2.0 Client ID

**APIs & Services → Credentials → Create credentials → OAuth client ID**

- Application type: **Web application**
- Name: `rapidmot-web`

### Authorized JavaScript origins (allowed origins)

```
http://localhost:3000
https://YOUR_APP_DOMAIN
https://accounts.YOUR_APP_DOMAIN
```

### Authorized redirect URIs (callback URLs)

Clerk handles the OAuth callback, so the redirect URIs are Clerk's:

```
# Development instance
https://YOUR-CLERK-SLUG.clerk.accounts.dev/v1/oauth_callback

# Production instance (after you add your domain in Clerk)
https://clerk.YOUR_APP_DOMAIN/v1/oauth_callback
```

> Find the exact value in Clerk Dashboard → **SSO connections → Google → Use custom credentials** — it displays the "Authorized Redirect URI" to paste here.

Save → copy the **Client ID** and **Client Secret**.

## 4. Wire it into Clerk

1. Clerk Dashboard → **SSO connections → Google**.
2. Toggle **Use custom credentials**.
3. Paste the Client ID + Client Secret from step 3.
4. In production, also configure your domain under Clerk → **Domains** so `accounts.YOUR_APP_DOMAIN` and `clerk.YOUR_APP_DOMAIN` resolve.

Result: OAuth 2.0 sign-in with Google under our own brand and quota, production-ready.

## 5. Places API (New) key

1. **APIs & Services → Library** → enable **Places API (New)**.
2. **Credentials → Create credentials → API key** → name `rapidmot-places-server`.
3. Restrict it:
   - **API restrictions**: Places API (New) only.
   - **Application restrictions**: none needed (the key is only used server-side in our API route — never shipped to the browser).
4. Put it in `.env.local` as `GOOGLE_MAPS_API_KEY`.

## 6. Env summary

| Variable | Where from |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk dashboard |
| `CLERK_SECRET_KEY` | Clerk dashboard |
| `GOOGLE_MAPS_API_KEY` | Step 5 (server-side only) |

The map itself (MapLibre GL + OpenFreeMap tiles) needs no key.
