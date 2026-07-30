# tryatoms.app — Cloudflare Pages deploy

**Live:** https://tryatoms.app  
**Pages project:** `tryatoms` (Direct Upload)  
**Production branch name:** `master`  
**Source of truth in repo:** `www/` → `npm run build:www` → `www/dist`

## Auto-deploy

GitHub Action [`.github/workflows/tryatoms-pages.yml`](../../.github/workflows/tryatoms-pages.yml) runs on every push to `master` that touches:

- `www/**`
- `plus-pricing.json`
- `package.json` / `package-lock.json`
- `src/shared/plusPricing.ts` / `test/wwwPricing.test.ts`
- the workflow file itself

It builds `www/dist`, runs `test/wwwPricing.test.ts`, then:

```bash
npx wrangler pages deploy www/dist --project-name=tryatoms --branch=master
```

Manual run: Actions → **Deploy tryatoms.app** → **Run workflow**.

## One-time: API token secret

The Action needs a repo secret. Wrangler OAuth on a laptop is not enough for CI.

1. Open [Create API Token](https://dash.cloudflare.com/profile/api-tokens) → **Create Token** → **Custom token**.
2. Permissions: **Account** → **Cloudflare Pages** → **Edit**.
3. Account Resources: include **Hartmantai@gmail.com's Account** (or All accounts).
4. Create, copy the token once.
5. In the repo:

```bash
gh secret set CLOUDFLARE_API_TOKEN -R taihartman/obsidian-atoms
# paste token, Enter
```

Account ID is hard-coded in the workflow (`6577a026858cc2ae8626632ff6fcd4bf`).

## Manual deploy (laptop)

When the Action is unavailable:

```bash
npm run build:www
npx wrangler pages deploy www/dist --project-name=tryatoms --branch=master
```

Requires `wrangler login` (or `CLOUDFLARE_API_TOKEN` in the environment).

## Do not

- Deploy with `--branch=main` — production is **master**; `main` is a preview alias only.
- Point a second Pages project at `tryatoms.app` without removing the domain from `tryatoms` first.
- Expect Git-connected Pages for this monorepo without DNS write: Direct Upload + this Action is the supported path.

## Verify

```bash
curl -sS https://tryatoms.app/ | grep -o 'styles\.[0-9a-f]*\.css'
# should match www/dist/index.html after the deploy finishes
```
