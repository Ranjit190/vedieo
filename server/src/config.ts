import os from 'os';
import { types } from 'mediasoup';

/**
 * Resolves the address announced in ICE candidates: the ANNOUNCED_IP env var
 * when set, otherwise the machine's first non-internal LAN IPv4 address
 * (skipping docker/tunnel/bridge interfaces), falling back to 127.0.0.1.
 * @returns {string} The announced address.
 */
function getAnnouncedAddress(): string {
  if (process.env.ANNOUNCED_IP) {
    return process.env.ANNOUNCED_IP;
  }
  const skippedInterfaces = /^(docker|veth|br-|tun|tap|virbr|lo)/;
  const interfaces = os.networkInterfaces();
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (skippedInterfaces.test(name) || !addresses) {
      continue;
    }
    const ipv4 = addresses.find((address) => address.family === 'IPv4' && !address.internal);
    if (ipv4) {
      return ipv4.address;
    }
  }
  return '127.0.0.1';
}

const announcedAddress = getAnnouncedAddress();
console.log(`Announcing media address: ${announcedAddress}`);

/**
 * Central configuration for the media server: HTTP port, mediasoup worker
 * settings, router media codecs and WebRTC transport options.
 */
const config = {
  listenPort: Number(process.env.PORT) || 4000,
  clientOrigin: process.env.CLIENT_ORIGIN || '*',
  numWorkers: Math.min(Number(process.env.NUM_WORKERS) || 1, os.cpus().length),
  worker: {
    rtcMinPort: Number(process.env.RTC_MIN_PORT) || 40000,
    rtcMaxPort: Number(process.env.RTC_MAX_PORT) || 40100,
    logLevel: 'warn' as types.WorkerLogLevel,
    logTags: ['info', 'ice', 'dtls', 'rtp'] as types.WorkerLogTag[]
  },
  router: {
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000
        }
      }
    ] as types.RtpCodecCapability[]
  },
  webRtcTransport: {
    listenInfos: [
      {
        protocol: 'udp',
        ip: '0.0.0.0',
        announcedAddress
      },
      {
        protocol: 'tcp',
        ip: '0.0.0.0',
        announcedAddress
      }
    ] as types.TransportListenInfo[],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 1000000
  }
};

export default config;
