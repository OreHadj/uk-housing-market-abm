# UK Housing Model Dashboard
Author: Max Stoddard

Local React dashboard for visualizing `input-data-versions/` model parameters, with optional version comparison and provenance tracking.

## Toolchain

Use Node 22 for dashboard work. `dashboard/.nvmrc` and `dashboard/package.json` `engines.node` are the source of truth for local development, CI, and the AWS static build.

## Run

From repository root:

```bash
./run-dashboard.sh
```

## Useful commands

```bash
cd dashboard
npm run lint
npm run build
npm run test:smoke
npm run test:experiment-smoke
npm run start:server
```

## Guided demos

Open **Home → Run demo** to choose a guide:

- **Getting started:** **Explore the dashboard**, a short tour of each page.
- **Creating experiments:** **Create a policy scenario** and **Create a
  sensitivity analysis**.
- **Exploring results:** **Explore policy results** and **Explore sensitivity
  results**.
- **Model information:** **Calibration and validation**.

The policy results walkthrough starts with the section and run selectors,
explaining that the baseline is a separately saved unchanged-policy comparison
with matching model, settings and seeds.

Creation guides use the current page-by-page builders. The policy guide uses
short bullet points and highlights the top section navigation. Practice drafts
survive refresh, and ordinary drafts are preserved. Start stays disabled until
the guide's Start step, which queues one real, short run or analysis and opens
its Report; it also stays disabled after **Return to editing**. Before that step,
policy practice can open the bundled results example and return to the same
practice draft. Finish or Exit clears the practice draft and returns Home;
exiting a results walkthrough keeps the selected results open.

Use explicit **Back** and **Next**; completing a field never advances the guide.
The results walkthroughs use protected bundled examples. If these are
unavailable, their entries are disabled and the optional practice handoff is
hidden.

Run `npm run test:guided-demos`, `npm run test:creation-guides` and
`npm run test:demo-examples` for focused coverage. Walkthrough reading durations
have not been measured.

## Settings

The fifth sidebar item, **Settings** (`/settings`), groups desktop file access,
support actions and application information. Desktop users can open the results
or logs folder and export a support bundle here. These actions appear only in
Settings, keeping the shared header and Results workflow clear.

A support bundle is a local folder containing release metadata, runtime
diagnostics and recent logs. Its saved path appears beside the export button;
it is not uploaded automatically. Opening a folder does not change where data
is stored. Browser users see application information without desktop actions.
Settings remains available while access checks are pending or the API is unavailable.
Application version comes from Electron on desktop and the frontend package at
build time in the browser; it is separate from an experiment's model version.

## Production Runtime

The frontend can call either same-origin API routes or an external API base URL.

- `VITE_API_BASE_URL` (optional): absolute HTTPS API origin for split frontend/API deploys.
  - if unset, frontend calls relative `/api/*` paths.

Dashboard API environment variables:

- `PORT` (preferred in production): HTTP port.
- `DASHBOARD_API_PORT` (local fallback): HTTP port when `PORT` is not set.
- `DASHBOARD_CORS_ORIGIN` (optional): allowed browser origin for cross-origin requests (for split frontend/API deploys).
- `DASHBOARD_ENABLE_MODEL_RUNS` (optional): set to `true` to enable model execution APIs in non-dev runtimes.
- `DASHBOARD_WRITE_USERNAME` + `DASHBOARD_WRITE_PASSWORD` (optional pair): enables write-login mode when both are set.
- `DASHBOARD_DELETE_KEY` (optional): private key required for deleting remote AWS experiment queue entries and artifacts. This is separate from the write username/password.
- `DASHBOARD_MAVEN_BIN` (optional): Maven executable used by model runs (defaults to the repo-local Maven wrapper).
- `DASHBOARD_RESULTS_CAP_MB` (optional): total `Results/` storage threshold in MB (defaults to `400`). In production, new local manual-run submissions are blocked when usage reaches or exceeds this threshold. Local Dev mode and AWS remote execution bypass it. Sensitivity analyses are not checked against it. Completed saved runs are not automatically pruned; delete results manually or increase the threshold.
- `DASHBOARD_LOG_MEMORY` (optional): set to `true` to log request duration plus RSS/heap deltas for public API routes.
- `DASHBOARD_EXECUTION_BACKEND` (optional): `local_maven` by default; set `aws_ssm` in AWS when experiment submissions should dispatch to the EC2 runner instead of running Java/Maven in the API container.
- `AWS_REGION` (AWS SSM backend): defaults to `eu-west-2` when unset.
- `AWS_RUNNER_INSTANCE_ID` (AWS SSM backend): EC2 runner instance allowed for experiment dispatch.
- `AWS_ARTIFACTS_BUCKET` (AWS SSM backend): private bucket used for source bundles, remote requests, job index, and experiment artifacts.
- `DASHBOARD_MAX_ACTIVE_REMOTE_RUNS` (AWS SSM backend): active remote run limit, default `1`.
- `DASHBOARD_CLOUD_SMOKE_BASE_URL` (CI smoke): live dashboard URL for real cloud experiment smoke runs; defaults to the CloudFront public URL.
- `DASHBOARD_SMOKE_USERNAME` + `DASHBOARD_SMOKE_PASSWORD` (CI smoke): write-login credentials used by CI to submit cheap live cloud manual and sensitivity runs.

Runtime target compatibility:

| Target | Runtime shape | Model execution | Writable/auth boundary |
| --- | --- | --- | --- |
| Dev mode | Repo-shaped local workflow using the developer machine's Node, Java, and repo-local Maven wrapper. | Enabled by default in non-production when Java and the Maven wrapper are available. | Dev bypass is active only when `NODE_ENV != production` and the selected view is `Dev mode`; no cloud or desktop runtime should depend on it. |
| Cloud mode | Lightweight public API/container path from `dashboard/Dockerfile.api`; no Electron requirement. | Local Java/Maven execution stays out of ECS. Optional `DASHBOARD_EXECUTION_BACKEND=aws_ssm` dispatches manual and sensitivity experiments to the configured EC2 runner only when it is already running and SSM-ready. | Public API image must not include Java, Maven, git, `private-datasets/`, or baseline `Results/`; write actions require configured credentials. |
| Desktop mode | Electron-owned local server on `127.0.0.1` with random port, packaged Java 25 runtime/fat jar, and Electron `userData` writable roots. | Packaged launcher for dashboard-managed manual and sensitivity runs; release resources are assembled from allowlisted input data and the runnable model jar. | Per-session bearer token and no packaged dev bypass; release data stays allowlisted and separate from cloud credentials/resources. |

Experiments availability:

- The `Experiments` navigation item, `/experiments`, and `/login` are available in dev, production, and preview views.
- Experiment, model-run, results-management, and auth-for-experiments API routes are registered in every runtime.
- Actual model execution remains controlled separately by `DASHBOARD_ENABLE_MODEL_RUNS`, Java/Maven-wrapper runtime availability, and write credentials.
- Local dev view and local `Preview desktop` allow result downloads without dashboard credentials; `Preview cloud` and production cloud require configured credentials/login for downloads.
- The homepage no longer shows git-history stats; production avoids all git/GitHub diff work entirely.

Write-access behavior:

- If `DASHBOARD_WRITE_USERNAME` and `DASHBOARD_WRITE_PASSWORD` are both unset:
  - auth is disabled,
  - local development can use write features without login.
- If both are set:
  - dashboard write actions require login (single global username/password),
  - read-only pages remain available without login.
- Remote AWS experiment deletion uses `DASHBOARD_DELETE_KEY` instead of the write login. The browser prompts for this key per delete and does not store it.
- If model runs are enabled (`DASHBOARD_ENABLE_MODEL_RUNS=true`) but credentials are unset:
  - API enters fail-closed mode for write actions (`503`),
  - login is intentionally disabled until credentials are configured,
  - read-only pages remain available.

Write actions requiring login in auth-enabled mode:

- queue model runs
- cancel model runs
- clear finished jobs from queue history
- delete manual result runs from Experiments (`type=manual`, `mode=view`)
- start sensitivity experiments
- cancel sensitivity experiments
- cancel unified experiment jobs (`POST /api/experiments/jobs/:jobRef/cancel`)

Delete actions:

- dev and desktop manual/sensitivity result deletion requires normal write access and confirmation
- remote cloud manual/sensitivity result deletion requires `DASHBOARD_DELETE_KEY` via `X-Dashboard-Delete-Key` and confirmation
- unified queue deletion (`DELETE /api/experiments/jobs/:jobRef`) is allowed only for finished jobs (`succeeded`, `failed`, `canceled`) and never for queued/running jobs

Sensitivity API endpoints:

- `GET /api/experiments/sensitivity`
- `POST /api/experiments/sensitivity`
- `GET /api/experiments/sensitivity/:experimentId`
- `GET /api/experiments/sensitivity/:experimentId/results`
- `GET /api/experiments/sensitivity/:experimentId/charts`
- `GET /api/experiments/sensitivity/:experimentId/logs`
- `POST /api/experiments/sensitivity/:experimentId/cancel`

Unified experiment monitoring endpoints:

- `GET /api/experiments/jobs`
- `GET /api/experiments/jobs/:jobRef/logs`
- `POST /api/experiments/jobs/:jobRef/cancel`

Experiments route:

- Available in local dev view, production, and preview views.
- Unified page at `/experiments` with query-based selectors.
- `type=manual|sensitivity` and `mode=run|view` drive setup/results combinations.
- optional focus params: `jobRef` (run mode queue/log), `runId` (manual view), `experimentId` (sensitivity view).

KPI definitions (manual results use the selected Window setting; sensitivity results use the configured experiment window):

- `Mean`: arithmetic mean of the monthly values in the selected window.
- `CV`: `stdev / abs(mean)`; returns `null` when `abs(mean)` is near zero.
- `Annualised Trend`: OLS monthly slope multiplied by `12`; retained in backend payloads for compatibility, but not offered as an experiment KPI basis.
- `Range`: `P95 - P5` using linear percentile interpolation.

Sensitivity behavior:

- one-at-a-time numeric USER SET parameter sweeps (manual min/max, baseline-in-range required)
- 5-point sampling (`min`, `mid-lower`, `baseline`, `mid-upper`, `max`) with integer rounding and duplicate collapse
- summary-first retention by default (per-point outputs deleted after summary extraction)
- optional full-output retention under `Results/experiments/sensitivity/<experimentId>/points`
- persisted experiment metadata + chart-ready summaries under `Results/experiments/sensitivity/<experimentId>`
- summarized sensitivity live logs with worker lifecycle markers and structured progress payloads under sensitivity and unified logs endpoints; raw JVM stdout/stderr is retained in persistent model logs for debugging
- tornado charts support KPI-basis selection (`Mean`, `CV`, `Range`); backend summaries retain `annualisedTrend` for compatibility
- submission warnings flag Central Bank policy sweeps that are likely non-binding one-at-a-time for the selected baseline/range
- manual run submissions are blocked while a sensitivity experiment is active, and sensitivity submissions are blocked while manual jobs are active

### Local Auth Setup

Default local workflow (no login lockout):

```bash
cd dashboard
npm run dev
```

Local development defaults:

- when running in local dev (`NODE_ENV != production`), dashboard requests run in dev view mode by default.
- dev view mode bypasses write-auth configuration lockouts so `Experiments` run mode is usable without setting credentials.
- actual run execution still requires Java and Maven in the API runtime.
- use the runtime view selector in the app header (shown in dev) to switch between `Dev mode`, `Preview desktop`, and `Preview cloud`.

Optional local auth testing (login required):

```bash
cd dashboard
export DASHBOARD_ENABLE_MODEL_RUNS=true
export DASHBOARD_WRITE_USERNAME=admin
export DASHBOARD_WRITE_PASSWORD=change-me
npm run dev
```

Then open `/login` in the web app and sign in with that username/password.

Health endpoint:

- `GET /healthz`
- `GET /api/runtime-deps` (runtime diagnostics):
  - returns `java`, `maven`, `mavenBin`, `versionInfo`, and remote execution status when the AWS SSM backend is configured.

Homepage preview endpoint:

- `GET /api/home-preview?version=<version>`
- returns only the lightweight chart payload needed for the homepage hero preview
- avoids dashboard input version history, dataset attribution, and other compare-page metadata
- keeps the homepage live without forcing the full compare path on first public load

## Linux Web Deployment

Runs the dashboard as a website on a Linux machine, with model runs executed on the same machine.

Requirements:

- Node 22 with npm. If the system Node is missing or has no npm, install it with [nvm](https://github.com/nvm-sh/nvm) (`nvm install 22`).
- Java 25 JDK, for example Eclipse Temurin.
- git, and internet access for the first build and run: the Maven wrapper downloads Maven and the model dependencies.

Build and check. The `git describe` line checks out the latest release tag on `master` and prints it:

```bash
git clone https://github.com/OreHadj/uk-housing-market-abm.git
cd uk-housing-market-abm
git checkout "$(git describe --tags --abbrev=0 origin/master)"
cd dashboard
npm ci --include=dev
npm run build
npm run test:smoke
npm run test:experiment-smoke
```

For a foreground check, start the API server from `dashboard/`, replacing `<username>` and `<password>` with your credentials and keeping the values quoted:

```bash
export NODE_ENV=production
export DASHBOARD_ENABLE_MODEL_RUNS=true
export DASHBOARD_WRITE_USERNAME='<username>'
export DASHBOARD_WRITE_PASSWORD='<password>'
node dist-server/server/index.js
```

- `NODE_ENV=production` is required. Without it the server applies the local development bypass: requests can start, download and delete runs without logging in, while the dashboard still shows a Login button.
- The server listens on port 8787 on all network interfaces (`PORT` changes the port; the address cannot be changed). Block port 8787 from outside the machine with a firewall.
- Check it with `curl http://127.0.0.1:8787/healthz` and `curl http://127.0.0.1:8787/api/runtime-deps`; the second should report `java` and `maven` as available.

The API server does not serve the web pages in this configuration. Copy the built pages to `/var/www/ukhm` so nginx can serve them without access to the repository's home folder. From `dashboard/`:

```bash
sudo install -d -m 755 /var/www/ukhm
sudo cp -r dist/. /var/www/ukhm/
sudo chmod -R a+rX /var/www/ukhm
```

In nginx's HTTPS `server` block for the dashboard hostname, add:

```nginx
root /var/www/ukhm;
index index.html;

location /api/ {
    proxy_pass http://127.0.0.1:8787;
}

location / {
    try_files $uri $uri/ /index.html;
}
```

Keep `proxy_pass` without a trailing slash so nginx preserves the `/api/` prefix. The `index.html` fallback supports browser routes such as `/results`. These directives go inside a server block with the site's hostname, HTTPS listener and certificate already configured; see nginx's [proxy_pass](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass) and [try_files](https://nginx.org/en/docs/http/ngx_http_core_module.html#try_files) documentation. Check and reload with `sudo nginx -t && sudo systemctl reload nginx`.

For a quick local check without nginx, run `npx vite preview --host 127.0.0.1 --port 4173` from `dashboard/`; it forwards `/api` to port 8787.

To keep the API server running after logout and across reboots, run it as a systemd service under the normal user account that owns the repository. Runs write into `Results/` and `tmp/`, and `User=` also supplies that account's `HOME` for the Maven wrapper. Stop the foreground API server with Ctrl+C before starting the service so port 8787 is free.

Store the four variables in `/etc/ukhm-dashboard.env`, owned by root and readable and writable only by root. Create or open the file with these permissions before adding credentials:

```bash
sudo touch /etc/ukhm-dashboard.env
sudo chown root:root /etc/ukhm-dashboard.env
sudo chmod 600 /etc/ukhm-dashboard.env
sudoedit /etc/ukhm-dashboard.env
```

Put the following in that file, replacing the quoted credential placeholders:

```ini
NODE_ENV=production
DASHBOARD_ENABLE_MODEL_RUNS=true
DASHBOARD_WRITE_USERNAME='<username>'
DASHBOARD_WRITE_PASSWORD='<password>'
```

The system service manager reads this file and passes the variables to the service. Keep the password out of the unit's `Environment=` lines, which other users can inspect with `systemctl show`.

Then create `/etc/systemd/system/ukhm-dashboard.service`, replacing each `<...>` with the account name or an absolute path:

```ini
[Unit]
Description=UK Housing Model dashboard API
After=network-online.target
Wants=network-online.target

[Service]
User=<user>
WorkingDirectory=<repository folder>/dashboard
EnvironmentFile=/etc/ukhm-dashboard.env
# Delete the next two lines if Java 25 is installed
# in a system folder such as /usr/bin:
Environment="JAVA_HOME=<JDK folder>"
Environment="PATH=<JDK folder>/bin:/usr/local/bin:/usr/bin:/bin"
ExecStart="<output of command -v node>" dist-server/server/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

`ExecStart` needs the full path to `node` because Node installed with nvm is not on a service's `PATH`. Start the service with `sudo systemctl daemon-reload && sudo systemctl enable --now ukhm-dashboard`, and read its log with `journalctl -u ukhm-dashboard`. If Java cannot be found, model runs are disabled and `/api/runtime-deps` reports `java` as unavailable.

To update, run `sudo systemctl stop ukhm-dashboard`, then `git fetch origin --tags && git checkout "$(git describe --tags --abbrev=0 origin/master)"` from the repository root and `npm ci --include=dev && npm run build` in `dashboard/`. Copy `dist/` to `/var/www/ukhm` again as above, then run `sudo systemctl start ukhm-dashboard`. `--include=dev` keeps the build tools installed even when `NODE_ENV=production` is set. Saved runs in `Results/` are ignored by git, so they are kept.

Runtime notes:

- Results are written under `Results/` in the repository and survive server restarts. Logins are held in memory, so a restart signs everyone out.
- In this production setup, new local manual-run submissions are blocked when results storage reaches or exceeds the default 400 MB threshold (`DASHBOARD_RESULTS_CAP_MB`). A running simulation can exceed this threshold. Completed saved runs are not automatically pruned; delete results manually or increase the threshold. Restart the service after changing its environment file.
- Sensitivity analyses are not checked against this threshold, but their saved results count towards the storage usage that can block subsequent manual runs.
- The bundled baseline outputs in `Results/v0-output/` and `Results/v4.0-output/` already occupy approximately 132 MiB (labelled MB in the dashboard) of the default 400 MB allowance. Include this existing usage when choosing the threshold.

## AWS Deployment

The dashboard is deployed from GitHub Actions to the AWS v1 architecture described in `docs/cloud/recommended-aws-setup.md`:

- private S3 frontend bucket behind CloudFront
- ECR image for the dashboard API
- ECS/Fargate API service behind the API origin used by CloudFront
- private artifacts bucket for source bundles used by remote experiment workflows

The public AWS API is intentionally lightweight:

- Dockerfile: `dashboard/Dockerfile.api`
- base image: Node 22 Alpine, aligned with dashboard CI and the ECR scan gate
- ships only the public dashboard server plus packaged `input-data-versions` snapshots `v0`, `v0o7`, `v4.26`, and `v5o3`; `v0o7` and `v5o3` are the packaged optimized 2011 and 2024 runtime snapshots respectively, while `v4.26` remains the source baseline for the current output calibration
- does not include git, Java, Maven, or baseline `Results/` outputs
- uses compiled server output (`dist-server`) instead of running through `tsx`

The AWS frontend deploy builds only the client bundle with `npm run build:client`, uploads `dashboard/dist` to S3, and invalidates CloudFront. Server compilation remains part of local/CI full builds and the API container validation job.

AWS production keeps Java/Maven out of the ECS API container. To enable website-triggered remote experiments, configure the ECS task with:

- `DASHBOARD_EXECUTION_BACKEND=aws_ssm`
- `AWS_REGION=eu-west-2`
- `AWS_RUNNER_INSTANCE_ID=i-03c1e655fa9636710`
- `AWS_ARTIFACTS_BUCKET=uk-housing-market-abm-artifacts-prod-064123637755`
- `DASHBOARD_MAX_ACTIVE_REMOTE_RUNS=1`

Dashboard write credentials should be stored as SSM SecureString parameters and exposed to the ECS task as secrets for `DASHBOARD_WRITE_USERNAME` and `DASHBOARD_WRITE_PASSWORD`. If the runner is stopped or not SSM-ready, the API reports the backend as unavailable and the frontend disables run controls. The API does not start EC2 instances.
Remote experiment deletion should use a separate SSM SecureString exposed as `DASHBOARD_DELETE_KEY`; do not reuse the write password for this key.

Deploys are configured from `master`, gated by passing GitHub checks, and require an explicit manual GitHub Actions dispatch with **deploy_to_cloud** enabled. Pushes and pull requests validate code only and never access AWS.

GitHub Actions validates:

- `npm run lint`
- `npm run build`
- `npm run test:smoke`
- `npm run test:experiment-smoke`
- `docker build -f dashboard/Dockerfile.api .` whenever API deployment inputs change (`dashboard/server/**`, `dashboard/shared/**`, `dashboard/Dockerfile.api`, `dashboard/tsconfig.server.json`, `input-data-versions/**`, `.dockerignore`, or dashboard package manifests)
- `./mvnw test` whenever model or Maven inputs change (`src/**`, `pom.xml`, `mvnw`, `mvnw.cmd`, or `.mvn/**`)
- a real cloud experiment smoke only for an explicitly enabled manual cloud deployment, using `v0o7` with `N_STEPS=1`, `N_SIMS=1`, and sensitivity `maxWorkers=2`; the smoke fails if the EC2 runner is not already running and SSM-online

Pushes to `master` run the applicable checks only. To deploy a changed AWS surface, manually run **Dashboard CI** from `master`, choose the target, and set **deploy_to_cloud** to `true`:

- frontend changes sync `dashboard/dist` to the configured S3 bucket and invalidate CloudFront
- API changes push a new ECR image and update the configured ECS service task definition
- model, Maven, script, runner-source, or input-data changes upload a git source bundle and current-deploy manifest to the artifacts bucket

The workflow uses GitHub OIDC rather than long-lived AWS access keys. Create the deployment role with `.github/aws/github-oidc-deploy-role.yml`. The same template can also attach optional runtime policies to the ECS task role, ECS task execution role, and EC2 runner role for SSM dispatch, SecureString reads, and S3 artifact access. Then configure these repository variables:

- `AWS_DEPLOY_ROLE_ARN`
- `AWS_REGION` (defaults to `eu-west-2` when unset)
- `AWS_FRONTEND_BUCKET`
- `AWS_CLOUDFRONT_DISTRIBUTION_ID`
- `AWS_ECR_REPOSITORY` (defaults to `uk-housing-market-abm-api` when unset)
- `AWS_ECS_CLUSTER`
- `AWS_ECS_SERVICE`
- `AWS_ECS_CONTAINER_NAME` (defaults to `dashboard-api` when unset)
- `AWS_ARTIFACTS_BUCKET`
- `AWS_SOURCE_BUNDLE_PREFIX` (defaults to `tmp/github-actions/source` when unset)
- `VITE_API_BASE_URL` only when the frontend should call a separate HTTPS API origin instead of same-origin `/api/*`

Do not add static AWS access keys to repository secrets for this deployment path.
