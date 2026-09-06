# Deploying the backend to AWS EC2 with HTTPS

The same `deploy/` files (Docker Compose + Caddy) used for Oracle work unchanged on EC2. Caddy terminates HTTPS on port 443 with an automatic Let's Encrypt certificate and proxies signaling to the Node server; WebRTC media flows directly over UDP (already encrypted by DTLS-SRTP).

## 1. Launch the instance

1. EC2 Console → **Launch instance**
2. AMI: **Ubuntu Server 24.04 LTS**; type: `t3.small` (or `t3.micro` on the 12-month free tier)
3. Create/select a key pair for SSH
4. Storage: 15+ GB

## 2. Allocate an Elastic IP

EC2 → Elastic IPs → **Allocate** → **Associate** with the instance. This keeps the public IP stable across restarts — it is used for both `ANNOUNCED_IP` and the sslip.io hostname, so it must not change.

## 3. Security group inbound rules

| Type       | Protocol | Port range   | Source    | Purpose                         |
|------------|----------|--------------|-----------|---------------------------------|
| SSH        | TCP      | 22           | My IP     | Administration                  |
| HTTP       | TCP      | 80           | 0.0.0.0/0 | Let's Encrypt certificate issue |
| HTTPS      | TCP      | 443          | 0.0.0.0/0 | Signaling (Socket.IO over WSS)  |
| Custom UDP | UDP      | 40000-40100  | 0.0.0.0/0 | WebRTC media                    |
| Custom TCP | TCP      | 40000-40100  | 0.0.0.0/0 | WebRTC media fallback           |

Do NOT open port 4000 — the Node server is only reached through Caddy.

## 4. Install Docker on the instance

```bash
ssh -i your-key.pem ubuntu@<elastic-ip>
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit   # log out and back in so the docker group applies
```

## 5. Deploy

```bash
git clone <your-repo-url> vedio-call
cd vedio-call/deploy
cp .env.example .env
nano .env
```

Set the three values (example for Elastic IP 3.110.25.40):

```
ANNOUNCED_IP=3.110.25.40
DOMAIN=3.110.25.40.sslip.io
CLIENT_ORIGIN=https://your-app.vercel.app
```

Then:

```bash
docker compose up -d --build
```

First start takes a couple of minutes (image build + certificate issuance).

**Note:** when no mediasoup prebuilt worker matches the instance's kernel, the build compiles the worker from source — this can take 10–20 minutes on small instances and needs ~1.5 GB of memory. On a t3.micro (1 GB RAM) add swap first or the build may be killed:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 6. Verify

```bash
docker compose logs media-server | grep -E "Announcing|listening"
# → Announcing media address: 3.110.25.40   (MUST be the public IP, not 172.31.x.x)
docker compose logs caddy | grep -i certificate
curl https://3.110.25.40.sslip.io/health
# → {"status":"ok"}
```

## 7. Wire up the frontend

Vercel → project → Settings → Environment Variables:

```
NEXT_PUBLIC_SERVER_URL=https://3.110.25.40.sslip.io
```

Redeploy the frontend. Done — open the Vercel URL on two devices and join the same group id.

## Troubleshooting

- **Build fails with `python: not found` / `couldn't fetch any mediasoup-worker prebuilt binary`**: pull the latest code — the Dockerfile installs the build toolchain in its build stage for exactly this case.
- **Build killed / hangs while compiling the worker**: out of memory — add the swap from step 5.
- **Certificate not issued**: port 80 not open in the security group, or another process holds 80/443 on the instance.
- **Participants appear but no audio/video**: UDP 40000–40100 not open, or `ANNOUNCED_IP` shows a private 172.31.x.x address in the logs — fix `.env` and `docker compose up -d`.
- **Socket connection blocked / CORS errors in console**: `CLIENT_ORIGIN` doesn't exactly match the Vercel URL (no trailing slash), or the frontend still points at an old backend URL — remember `NEXT_PUBLIC_*` requires a Vercel redeploy to take effect.
- **Live media state**: `https://<domain>/debug/rooms` shows every room, producer and consumer with RTP stats.

## Deploying code updates (backend + frontend)

Follow this whenever the app's code changed (new features, fixes) and both EC2 and Vercel need the new version.

### Step 1 — Push the changes (local machine)

```bash
cd vedio-call
git add -A
git commit -m "feat: <describe the change>"
git push
```

### Step 2 — Update the backend (EC2)

```bash
ssh -i your-key.pem ubuntu@<elastic-ip>
cd vedio-call
git pull
cd deploy
docker compose up -d --build
```

`up -d --build` rebuilds the image with the new code and swaps the running container; the rebuild reuses cached layers, so it is fast unless `package.json` changed (a dependency change re-runs `npm ci`, and on this instance that can re-compile the mediasoup worker — allow 10–20 minutes).

Verify the new backend:

```bash
docker compose ps                       # media-server should be "running (healthy)"
docker compose logs --tail 20 media-server
curl https://<your-domain>/health       # → {"status":"ok"}
```

Ongoing calls are dropped during the swap (~a few seconds of downtime) — participants just rejoin.

### Step 3 — Update the frontend (Vercel)

Nothing to do in most cases: **Vercel auto-deploys every push to the main branch** (step 1 already triggered it). Check the deployment status under the project's **Deployments** tab; the new version is live when the latest deployment shows "Ready".

Manual redeploy is only needed when an **environment variable** changed (e.g. a new `NEXT_PUBLIC_SERVER_URL`): Settings → Environment Variables → edit, then Deployments → ⋯ on the latest → **Redeploy** (env values are baked in at build time).

### Step 4 — Confirm end to end

1. Open the Vercel URL in two browsers/devices (hard-refresh: Ctrl+Shift+R, so no old bundle is cached)
2. Join the same group id and check the changed behavior works over the deployed setup
3. `https://<your-domain>/debug/rooms` shows the live producers/consumers if media needs inspecting

**Order tip:** deploy the backend (step 2) before or together with the frontend. When a change touches the signaling protocol on both sides — new events or payload fields — an old backend with a new frontend (or the reverse) can misbehave until both are updated.
