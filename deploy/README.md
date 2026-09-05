# Deploying to Oracle Cloud Always Free

Backend (mediasoup media server) on an Oracle Cloud Always Free VM with Docker + Caddy (automatic HTTPS), frontend on Vercel.

## 1. Create the VM

1. Oracle Cloud Console → Compute → Instances → **Create instance**
2. Image: **Ubuntu 24.04**; Shape: **VM.Standard.A1.Flex** (Ampere ARM, Always Free — e.g. 2 OCPU / 12 GB). If A1 capacity is unavailable, retry later or use the AMD **VM.Standard.E2.1.Micro**.
3. Make sure **Assign a public IPv4 address** is checked and add your SSH key.
4. Note the **public IP** after creation — it is used for both `ANNOUNCED_IP` and the sslip.io domain.

## 2. Open ports in the VCN Security List

Networking → Virtual Cloud Networks → your VCN → the subnet's **Security List** → Add Ingress Rules (source `0.0.0.0/0`):

| Protocol | Port(s)      | Purpose                          |
|----------|--------------|----------------------------------|
| TCP      | 80           | Let's Encrypt certificate issue  |
| TCP      | 443          | HTTPS/WSS signaling (Caddy)      |
| UDP      | 40000-40100  | WebRTC media                     |
| TCP      | 40000-40100  | WebRTC media fallback            |

## 3. Open the same ports in the VM's own firewall

**Important Oracle gotcha:** Ubuntu images on Oracle ship with iptables rules that reject almost everything, so opening the Security List alone is NOT enough. SSH into the VM and run:

```bash
sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 6 -p udp --dport 40000:40100 -j ACCEPT
sudo iptables -I INPUT 6 -p tcp --dport 40000:40100 -j ACCEPT
sudo netfilter-persistent save
```

## 4. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# log out and back in so the group applies
```

## 5. Deploy the backend

```bash
git clone <your-repo-url> vedio-call
cd vedio-call/deploy
cp .env.example .env
nano .env   # set ANNOUNCED_IP, DOMAIN, CLIENT_ORIGIN (see comments in the file)
docker compose up -d --build
```

The image is built on the VM itself, so the mediasoup worker binary automatically matches the ARM architecture.

Verify:

```bash
docker compose logs media-server | grep -E "Announcing|listening"
curl https://<your-domain>/health    # → {"status":"ok"}
```

`Announcing media address` must show the **public** IP from `.env` — if it shows a `10.x.x.x` address, `ANNOUNCED_IP` was not set.

## 6. Point the Vercel frontend at it

In the Vercel project → Settings → Environment Variables:

```
NEXT_PUBLIC_SERVER_URL=https://<your-domain>
```

(e.g. `https://143.47.0.0.sslip.io`) — then redeploy the frontend.

## 7. Test

Open the Vercel URL on two devices, join the same group id. If media does not flow but signaling works (participants appear without video), the UDP ports are blocked — re-check steps 2 and 3.

## Updating

```bash
cd vedio-call && git pull
cd deploy && docker compose up -d --build
```
