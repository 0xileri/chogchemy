# Deploy Chogchemy

Chogchemy is live at [chogchemy.up.railway.app](https://chogchemy.up.railway.app), deployed to Railway on 2026-10-11 from the private GitHub repository `0xileri/chogchemy` (branch `main`). Pushes to `main` deploy automatically.

The Railway project is **Chogchemy**, with one **chogchemy** service in its production environment. It uses the existing Dockerfile, port `10000`, a `/healthz` health check, one replica in US West, and the **chogchemy-volume** mounted at `/var/data`. SQLite invitations and generated artwork persist at `/var/data/chogchemy.sqlite`. The service has maximum resource settings of 0.5 vCPU and 0.5 GB memory; serverless sleeping is disabled.

The approved hosting budget is $10/month, excluding Orbio costs and other projects. Resource limits reduce exposure but do not enforce a dollar spending cap. Railway's hard compute spending limit applies to the entire workspace, so it was not changed: that could interrupt unrelated projects. Review this project's Usage page and the workspace bill as traffic grows; the initial $0.00 estimate is too early to establish a monthly forecast.

Live checks passed for HTTPS health, the exact canonical origin, homepage and branding assets, secure wallet sign-in with an ephemeral test wallet, Monad holdings lookup, and a real Chog NFT artwork preview. Private environment/database paths return 404. The Orbio key is stored in Railway variables; deployment verification did not dispatch a paid AI generation request. Local artwork and invitations have not been migrated to the new volume.

## Railway

1. Sign in at https://railway.com and create a project from the private GitHub repository `0xileri/chogchemy`. Configure the service before its first successful deployment; a missing public origin intentionally prevents production startup.
2. Railway uses the existing `Dockerfile`. In service Settings, configure the health check path as `/healthz`, its timeout as 300 seconds, and the On Failure restart policy with 3 retries. New services cannot opt into the deprecated `railway.json` configuration, according to the current dashboard; configure these settings directly.
3. Attach a volume mounted at `/var/data`. Keep one service replica and disable serverless/app sleeping because image-generation jobs run in the background.
4. Generate a public domain in the service's Networking settings, targeting port `10000`. Set the following service variables before deploying:

   | Variable | Value |
   | --- | --- |
   | `APP_ORIGIN` | The exact generated HTTPS URL, with no trailing slash |
   | `DATABASE_PATH` | `/var/data/chogchemy.sqlite` |
   | `IMAGE_PROVIDER` | `orbio` |
   | `ORBIO_API_KEY` | A fresh key entered privately in Railway's Variables UI |
   | `ORBIO_IMAGE_MODEL` | `openai/gpt-image-2` |
   | `ORBIO_IMAGE_QUALITY` | `medium` |
   | `GENERATION_DAILY_LIMIT` | `10` |
   | `GENERATION_HOLDER_DAILY_LIMIT` | `2` |
   | `PORT` | `10000` |

   The Dockerfile already sets `NODE_ENV=production` and `HOST=0.0.0.0`. Do not copy the local `.env` wholesale or use a localhost origin in production.
5. Review billing and any available usage controls, then deploy. Check whether a spending limit applies to the project or the entire workspace before changing it. Hobby includes $5 of monthly resource usage in its $5 subscription; usage above that is additional. Full trials have outbound access; limited trials may block the Monad RPC and image provider. Confirm your account's current terms and limits in the dashboard.
6. Verify `/healthz`, `/api/config` (the returned origin must match the public URL), branding assets, then wallet sign-in and the real-holder testing steps in README.md. Image generation is billed separately by Orbio.

The volume starts empty. Local invitations and artwork are not included in the Docker image or copied automatically. Preserve a database backup if migrating existing records.

Documentation: [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles), [volumes](https://docs.railway.com/volumes), [pricing](https://docs.railway.com/pricing/plans), [configuration](https://docs.railway.com/config-as-code/reference).

## Render

1. Sign in at https://dashboard.render.com and connect the private GitHub repository `0xileri/chogchemy`.
2. Choose **New → Blueprint**, select the repository, and use `render.yaml`.
3. Enter a fresh **Orbio** API key as `ORBIO_API_KEY` in Render's secret environment field. The blueprint selects `IMAGE_PROVIDER=orbio`. To use OpenAI directly instead, select `IMAGE_PROVIDER=openai` and configure `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL=gpt-image-2`, and `OPENAI_IMAGE_QUALITY=medium`. Never paste credentials into chat or GitHub.
4. Review the service and disk cost, then deploy. The app uses Render's `RENDER_EXTERNAL_URL` for its public origin. If you add a custom domain, set `APP_ORIGIN` to that exact HTTPS origin and redeploy. Always use one canonical origin for invitation links and wallet signatures.
5. Visit `/healthz`, then the homepage in a wallet-enabled browser. Use the real-holder testing steps in README.md.

The database and generated PNGs are stored together in `/var/data/chogchemy.sqlite`. The persistent disk is required: an ephemeral filesystem loses invitations and artwork on redeploy. Use exactly one app instance; sessions, queues and mutation coordination are in process memory. Redeploys require wallet sign-in again.

Keep `GENERATION_DAILY_LIMIT` and `GENERATION_HOLDER_DAILY_LIMIT` low while testing. These limit request counts, not dollar spend. Set a spending budget in the provider account too. Each dispatched attempt counts, even if the provider times out. An interrupted dispatched job is marked failed after restart and will not be retried automatically. A new invitation permits a new attempt, subject to quotas.

The Docker image excludes `.env`, local databases, fixture scripts and tests. Artist reference images are included intentionally when listed in `art-direction.json`. Obtain the artist's approval before adding their files. Changing the art direction requires a new fusion request and fresh signatures when both-signature mode is selected.

Documentation: [Render Blueprint reference](https://render.com/docs/blueprint-spec), [persistent disks](https://render.com/docs/disks), [Docker deployment](https://render.com/docs/docker).
