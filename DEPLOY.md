# Deploy Chogchemy

The app is prepared for one Render Docker web service with a persistent disk. This is a paid hosting configuration; review Render's current quote before approving creation. No hosting resources have been purchased or deployed by this repository.

1. Sign in at https://dashboard.render.com and connect the private GitHub repository `0xileri/chogchemy`.
2. Choose **New → Blueprint**, select the repository, and use `render.yaml`.
3. Enter a valid **OpenAI** API key in Render's secret environment field. An Orbio gateway key is not supported by this image editing adapter. Never paste credentials into chat or GitHub.
4. Review the service and disk cost, then deploy. The app uses Render's `RENDER_EXTERNAL_URL` for its public origin. If you add a custom domain, set `APP_ORIGIN` to that exact HTTPS origin and redeploy. Always use one canonical origin for invitation links and wallet signatures.
5. Visit `/healthz`, then the homepage in a wallet-enabled browser. Use the real-holder testing steps in README.md.

The database and generated PNGs are stored together in `/var/data/chogchemy.sqlite`. The persistent disk is required: an ephemeral filesystem loses invitations and artwork on redeploy. Use exactly one app instance; sessions, queues and mutation coordination are in process memory. Redeploys require wallet sign-in again.

Keep `GENERATION_DAILY_LIMIT` and `GENERATION_HOLDER_DAILY_LIMIT` low while testing. These limit request counts, not dollar spend. Set a spending budget in the provider account too. Each dispatched attempt counts, even if the provider times out. An interrupted dispatched job is marked failed after restart and will not be retried automatically. A new invitation permits a new attempt, subject to quotas.

The Docker image excludes `.env`, local databases, fixture scripts and tests. Artist reference images are included intentionally when listed in `art-direction.json`. Obtain the artist's approval before adding their files. Changing the art direction requires fresh holder approvals.

Documentation: [Render Blueprint reference](https://render.com/docs/blueprint-spec), [persistent disks](https://render.com/docs/disks), [Docker deployment](https://render.com/docs/docker).
