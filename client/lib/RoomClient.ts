import { Device, types } from 'mediasoup-client';
import { Socket } from 'socket.io-client';

export type ProducerSource = 'mic' | 'webcam' | 'screen';

const VIDEO_ENCODINGS: types.RtpEncodingParameters[] = [
  { scaleResolutionDownBy: 4, maxBitrate: 150000 },
  { scaleResolutionDownBy: 2, maxBitrate: 400000 },
  { scaleResolutionDownBy: 1, maxBitrate: 1200000 }
];
const VP9_SVC_ENCODINGS: types.RtpEncodingParameters[] = [
  { scalabilityMode: 'L3T3_KEY', maxBitrate: 1200000 }
];
const SCREEN_ENCODINGS: types.RtpEncodingParameters[] = [{ maxBitrate: 1500000 }];

/**
 * How a tile is currently rendered, which decides the video quality layers
 * requested for its consumers: the big stage, a grid cell, or a small
 * thumbnail (filmstrip / corner).
 */
export type TileRole = 'stage' | 'grid' | 'thumb';

const LAYERS_BY_ROLE: Record<TileRole, { spatialLayer: number; temporalLayer: number }> = {
  stage: { spatialLayer: 2, temporalLayer: 2 },
  grid: { spatialLayer: 1, temporalLayer: 2 },
  thumb: { spatialLayer: 0, temporalLayer: 1 }
};

/**
 * A remote producer announced by the server.
 */
export interface RemoteProducerInfo {
  producerId: string;
  peerId: string;
  peerName: string;
  kind: types.MediaKind;
  source: ProducerSource;
  paused?: boolean;
}

/**
 * A peer's current mute state, shown as avatar/badge UI on their tile.
 */
export interface PeerAVState {
  micMuted: boolean;
  camOff: boolean;
}

/**
 * One rendered tile: a peer's camera+mic stream, or a peer's screen share.
 */
export interface RemoteTile {
  tileKey: string;
  peerId: string;
  name: string;
  stream: MediaStream;
  isScreen: boolean;
}

/**
 * Callbacks the UI layer provides to react to room events.
 */
export interface RoomClientCallbacks {
  onTileUpdated: (tile: RemoteTile) => void;
  onTileRemoved: (tileKey: string) => void;
  onPeerStateChanged: (peerId: string, state: PeerAVState) => void;
  onError: (message: string) => void;
}

interface ConsumerEntry {
  consumer: types.Consumer;
  peerId: string;
  tileKey: string;
}

interface ProduceOptions {
  encodings?: types.RtpEncodingParameters[];
  codecOptions?: types.ProducerCodecOptions;
  codec?: types.RtpCodecCapability;
}

/**
 * Encapsulates all mediasoup-client logic for one call: device loading,
 * transport creation, producing local tracks (mic/webcam/screen) and
 * consuming remote ones grouped into per-peer tiles. The React layer calls
 * join/leave/produce/toggle and receives tiles via the provided callbacks.
 */
export default class RoomClient {
  private readonly socket: Socket;
  private readonly callbacks: RoomClientCallbacks;
  private readonly device = new Device();
  private sendTransport: types.Transport | null = null;
  private recvTransport: types.Transport | null = null;
  private readonly producers = new Map<ProducerSource, types.Producer>();
  private readonly consumers = new Map<string, ConsumerEntry>();
  private readonly tileStreams = new Map<string, MediaStream>();
  private readonly peerNames = new Map<string, string>();
  private readonly peerStates = new Map<string, PeerAVState>();
  private readonly tileRoles = new Map<string, TileRole>();
  private readonly sentLayers = new Map<string, string>();
  private readonly pendingProducers: RemoteProducerInfo[] = [];
  private ready = false;
  private closed = false;

  /**
   * Creates a room client bound to a socket and UI callbacks.
   * @param {Socket} socket - The shared Socket.IO client.
   * @param {RoomClientCallbacks} callbacks - UI event callbacks.
   */
  constructor(socket: Socket, callbacks: RoomClientCallbacks) {
    this.socket = socket;
    this.callbacks = callbacks;
  }

  /**
   * Sends a signaling request and resolves with the server acknowledgement,
   * rejecting when the server returns an error field.
   * @param {string} event - The signaling event name.
   * @param {Record<string, unknown>} data - The request payload.
   * @returns {Promise<any>} The server response.
   */
  private request(event: string, data: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      this.socket.emit(event, data, (response: any) => {
        if (response?.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      });
    });
  }

  /**
   * Joins a group: loads the device, creates both transports and consumes
   * every producer already in the room. Local tracks are produced separately
   * via produceTrack so joining with camera/mic off is possible.
   * @param {string} groupId - The group id to join.
   * @param {string} name - The user's display name.
   * @returns {Promise<void>} Resolves when fully joined.
   */
  async join(groupId: string, name: string): Promise<void> {
    if (!this.socket.connected) {
      this.socket.connect();
    }
    const joinResponse = await this.request('joinRoom', { groupId, name });
    joinResponse.peers.forEach((peer: { peerId: string; name: string }) => {
      this.peerNames.set(peer.peerId, peer.name);
    });
    this.registerSocketEvents();
    await this.device.load({ routerRtpCapabilities: joinResponse.rtpCapabilities });
    this.sendTransport = await this.createTransport('send');
    this.recvTransport = await this.createTransport('recv');
    this.ready = true;
    const initialProducers = [...joinResponse.producers, ...this.pendingProducers.splice(0)];
    for (const producerInfo of initialProducers) {
      await this.consumeProducer(producerInfo);
    }
  }

  /**
   * Creates a client-side WebRTC transport mirrored from server parameters
   * and wires its connect/produce handshakes.
   * @param {'send' | 'recv'} direction - Whether this transport sends or receives media.
   * @returns {Promise<types.Transport>} The created transport.
   */
  private async createTransport(direction: 'send' | 'recv'): Promise<types.Transport> {
    const params = await this.request('createTransport', { direction });
    const transport = direction === 'send'
      ? this.device.createSendTransport(params)
      : this.device.createRecvTransport(params);
    transport.on('connect', (payload, callback, errback) => {
      const { dtlsParameters } = payload;
      this.request('connectTransport', { transportId: transport.id, dtlsParameters })
        .then(() => callback())
        .catch((error) => errback(error as Error));
    });
    if (direction === 'send') {
      transport.on('produce', (payload, callback, errback) => {
        const { kind, rtpParameters, appData } = payload;
        this.request('produce', { transportId: transport.id, kind, rtpParameters, appData })
          .then((response) => callback({ id: response.id }))
          .catch((error) => errback(error as Error));
      });
    }
    return transport;
  }

  /**
   * Produces one local track on the send transport with encoder settings
   * matching its source. No-op when that source is already produced.
   * @param {ProducerSource} source - What the track is (mic/webcam/screen).
   * @param {MediaStreamTrack} track - The track to send.
   * @returns {Promise<void>} Resolves when the producer is live.
   */
  async produceTrack(source: ProducerSource, track: MediaStreamTrack): Promise<void> {
    if (!this.sendTransport) {
      throw new Error('Send transport is not ready');
    }
    if (this.producers.has(source)) {
      return;
    }
    const options = this.produceOptions(source);
    const producer = await this.sendTransport.produce({
      track,
      encodings: options.encodings,
      codecOptions: options.codecOptions,
      codec: options.codec,
      appData: { source }
    });
    this.producers.set(source, producer);
  }

  /**
   * Returns the encoder settings for a producer source: Opus DTX/FEC capped
   * at 24 kbps for the microphone; VP9 K-SVC (one stream carrying three
   * quality layers) for the webcam when the router and browser support VP9,
   * with VP8 simulcast as the fallback; a single sharp layer for screens.
   * @param {ProducerSource} source - The producer source.
   * @returns {ProduceOptions} Encodings, codec options and codec choice.
   */
  private produceOptions(source: ProducerSource): ProduceOptions {
    if (source === 'mic') {
      return { codecOptions: { opusDtx: true, opusFec: true, opusMaxAverageBitrate: 24000 } };
    }
    if (source === 'screen') {
      return { encodings: SCREEN_ENCODINGS, codecOptions: { videoGoogleStartBitrate: 800 } };
    }
    const vp9 = this.device.recvRtpCapabilities.codecs?.find(
      (codec) => codec.mimeType.toLowerCase() === 'video/vp9'
    );
    if (vp9) {
      return { encodings: VP9_SVC_ENCODINGS, codecOptions: { videoGoogleStartBitrate: 400 }, codec: vp9 };
    }
    return { encodings: VIDEO_ENCODINGS, codecOptions: { videoGoogleStartBitrate: 400 } };
  }

  /**
   * Whether a producer for the given source is active.
   * @param {ProducerSource} source - The producer source.
   * @returns {boolean} True when producing.
   */
  hasProducer(source: ProducerSource): boolean {
    return this.producers.has(source);
  }

  /**
   * Swaps the track of an active producer, e.g. when the microphone device
   * changes after plugging in a headset. Seamless for viewers.
   * @param {ProducerSource} source - The producer to update.
   * @param {MediaStreamTrack} track - The replacement track.
   * @returns {Promise<void>} Resolves when the track is replaced.
   */
  async replaceTrack(source: ProducerSource, track: MediaStreamTrack): Promise<void> {
    const producer = this.producers.get(source);
    if (!producer) {
      return;
    }
    await producer.replaceTrack({ track });
  }

  /**
   * Closes a producer locally and on the server (e.g. stopping a screen
   * share). Viewers' consumers close automatically.
   * @param {ProducerSource} source - The producer to close.
   * @returns {Promise<void>} Resolves when closed on the server.
   */
  async closeProducer(source: ProducerSource): Promise<void> {
    const producer = this.producers.get(source);
    if (!producer) {
      return;
    }
    producer.close();
    this.producers.delete(source);
    await this.request('closeProducer', { producerId: producer.id });
  }

  /**
   * Pauses or resumes one of the local producers (mute / camera off) both
   * locally and on the server.
   * @param {ProducerSource} source - Which producer to toggle.
   * @param {boolean} paused - True to pause, false to resume.
   * @returns {Promise<void>} Resolves when the state is applied.
   */
  async setProducerPaused(source: ProducerSource, paused: boolean): Promise<void> {
    const producer = this.producers.get(source);
    if (!producer) {
      return;
    }
    if (paused) {
      producer.pause();
    } else {
      producer.resume();
    }
    await this.request('toggleProducer', { producerId: producer.id, paused });
  }

  /**
   * Consumes one remote producer: asks the server for a paused consumer,
   * attaches its track to the owning tile and resumes it.
   * @param {RemoteProducerInfo} producerInfo - The remote producer to consume.
   * @returns {Promise<void>} Resolves when the consumer is live.
   */
  private async consumeProducer(producerInfo: RemoteProducerInfo): Promise<void> {
    const { producerId, peerId, peerName, kind, source } = producerInfo;
    if (!this.recvTransport || this.closed) {
      return;
    }
    this.peerNames.set(peerId, peerName);
    const data = await this.request('consume', {
      transportId: this.recvTransport.id,
      producerId,
      rtpCapabilities: this.device.recvRtpCapabilities
    });
    const consumer = await this.recvTransport.consume({
      id: data.id,
      producerId: data.producerId,
      kind: data.kind ?? kind,
      rtpParameters: data.rtpParameters
    });
    const tileKey = source === 'screen' ? `${peerId}:screen` : `${peerId}:cam`;
    this.consumers.set(consumer.id, { consumer, peerId, tileKey });
    this.addTrackToTile(tileKey, peerId, consumer.track);
    if (source !== 'screen' && producerInfo.paused) {
      this.updatePeerState(peerId, consumer.kind, true);
    }
    await this.request('resumeConsumer', { consumerId: consumer.id });
    this.syncConsumerLayers(consumer.id);
  }

  /**
   * Records how each tile is currently rendered (stage / grid / thumbnail)
   * and requests matching quality layers for every affected video consumer.
   * Called by the UI whenever the layout changes.
   * @param {Map<string, TileRole>} roles - Tile roles keyed by tile key.
   * @returns {void}
   */
  applyTileRoles(roles: Map<string, TileRole>): void {
    roles.forEach((role, tileKey) => this.tileRoles.set(tileKey, role));
    this.consumers.forEach((_entry, consumerId) => this.syncConsumerLayers(consumerId));
  }

  /**
   * Sends the preferred layers for one video consumer based on its tile's
   * role, skipping requests that would repeat the last applied value.
   * @param {string} consumerId - The consumer to update.
   * @returns {void}
   */
  private syncConsumerLayers(consumerId: string): void {
    const entry = this.consumers.get(consumerId);
    if (!entry || entry.consumer.kind !== 'video') {
      return;
    }
    const role = this.tileRoles.get(entry.tileKey) || 'grid';
    const layers = LAYERS_BY_ROLE[role];
    const signature = `${layers.spatialLayer}:${layers.temporalLayer}`;
    if (this.sentLayers.get(consumerId) === signature) {
      return;
    }
    this.sentLayers.set(consumerId, signature);
    this.request('setConsumerLayers', { consumerId, ...layers }).catch(() => {
      this.sentLayers.delete(consumerId);
    });
  }

  /**
   * Pauses or resumes every video consumer, e.g. while the viewer's tab is
   * hidden, so no video data is downloaded for an invisible page. Audio
   * consumers keep flowing.
   * @param {boolean} paused - True to pause, false to resume.
   * @returns {void}
   */
  setVideoConsumersPaused(paused: boolean): void {
    this.consumers.forEach((entry) => {
      if (entry.consumer.kind !== 'video' || entry.consumer.closed) {
        return;
      }
      if (paused) {
        entry.consumer.pause();
      } else {
        entry.consumer.resume();
      }
      this.request(paused ? 'pauseConsumer' : 'resumeConsumer', { consumerId: entry.consumer.id }).catch(() => {});
    });
  }

  /**
   * Adds a track to a tile's MediaStream and notifies the UI. A new
   * MediaStream instance is built each time so the video element re-attaches
   * srcObject — browsers do not reliably start playing a track that is added
   * to a stream which is already attached and playing.
   * @param {string} tileKey - The tile to update.
   * @param {string} peerId - The owning peer's id.
   * @param {MediaStreamTrack} track - The consumed track.
   * @returns {void}
   */
  private addTrackToTile(tileKey: string, peerId: string, track: MediaStreamTrack): void {
    const existingStream = this.tileStreams.get(tileKey);
    const tracks = existingStream ? [...existingStream.getTracks(), track] : [track];
    const stream = new MediaStream(tracks);
    this.tileStreams.set(tileKey, stream);
    this.emitTile(tileKey, peerId, stream);
  }

  /**
   * Sends the current state of a tile to the UI.
   * @param {string} tileKey - The tile key.
   * @param {string} peerId - The owning peer's id.
   * @param {MediaStream} stream - The tile's stream.
   * @returns {void}
   */
  private emitTile(tileKey: string, peerId: string, stream: MediaStream): void {
    const name = this.peerNames.get(peerId) || 'Guest';
    this.callbacks.onTileUpdated({
      tileKey,
      peerId,
      name,
      stream,
      isScreen: tileKey.endsWith(':screen')
    });
  }

  /**
   * Registers listeners for server-pushed room events (new producers, peers
   * joining/leaving, consumers closed by the server).
   * @returns {void}
   */
  private registerSocketEvents(): void {
    this.socket.on('newProducer', (producerInfo: RemoteProducerInfo) => {
      if (!this.ready) {
        this.pendingProducers.push(producerInfo);
        return;
      }
      this.consumeProducer(producerInfo).catch((error: Error) => {
        this.callbacks.onError(`Failed to consume producer: ${error.message}`);
      });
    });
    this.socket.on('peerJoined', (data: { peerId: string; name: string }) => {
      this.peerNames.set(data.peerId, data.name);
    });
    this.socket.on('peerLeft', (data: { peerId: string }) => {
      this.removePeer(data.peerId);
    });
    this.socket.on('consumerClosed', (data: { consumerId: string }) => {
      this.removeConsumer(data.consumerId);
    });
    this.socket.on('producerToggled', (data: { peerId: string; kind: types.MediaKind; paused: boolean }) => {
      this.updatePeerState(data.peerId, data.kind, data.paused);
    });
  }

  /**
   * Records that a peer muted/unmuted their mic or camera and notifies the
   * UI so their tile can show an avatar or muted-mic badge.
   * @param {string} peerId - The peer whose state changed.
   * @param {types.MediaKind} kind - Which producer was toggled.
   * @param {boolean} paused - True when muted / camera off.
   * @returns {void}
   */
  private updatePeerState(peerId: string, kind: types.MediaKind, paused: boolean): void {
    const state = this.peerStates.get(peerId) || { micMuted: false, camOff: false };
    const nextState: PeerAVState = {
      micMuted: kind === 'audio' ? paused : state.micMuted,
      camOff: kind === 'video' ? paused : state.camOff
    };
    this.peerStates.set(peerId, nextState);
    this.callbacks.onPeerStateChanged(peerId, nextState);
  }

  /**
   * Cleans up all state for a peer that left and removes its tiles.
   * @param {string} peerId - The peer that left.
   * @returns {void}
   */
  private removePeer(peerId: string): void {
    this.consumers.forEach((entry, consumerId) => {
      if (entry.peerId === peerId) {
        entry.consumer.close();
        this.consumers.delete(consumerId);
      }
    });
    this.tileStreams.forEach((_stream, tileKey) => {
      if (tileKey.startsWith(`${peerId}:`)) {
        this.tileStreams.delete(tileKey);
        this.callbacks.onTileRemoved(tileKey);
      }
    });
    this.peerNames.delete(peerId);
    this.peerStates.delete(peerId);
  }

  /**
   * Closes a single consumer (its producer closed server-side), removes its
   * track from the tile and removes the tile entirely when it has no tracks
   * left (e.g. a stopped screen share).
   * @param {string} consumerId - The closed consumer's id.
   * @returns {void}
   */
  private removeConsumer(consumerId: string): void {
    const entry = this.consumers.get(consumerId);
    if (!entry) {
      return;
    }
    entry.consumer.close();
    this.consumers.delete(consumerId);
    this.sentLayers.delete(consumerId);
    const stream = this.tileStreams.get(entry.tileKey);
    if (!stream) {
      return;
    }
    const remaining = stream.getTracks().filter((track) => track !== entry.consumer.track);
    if (remaining.length === 0) {
      this.tileStreams.delete(entry.tileKey);
      this.callbacks.onTileRemoved(entry.tileKey);
      return;
    }
    const nextStream = new MediaStream(remaining);
    this.tileStreams.set(entry.tileKey, nextStream);
    this.emitTile(entry.tileKey, entry.peerId, nextStream);
  }

  /**
   * Leaves the call: closes transports, removes socket listeners and
   * disconnects. The server cleans up on disconnect.
   * @returns {void}
   */
  leave(): void {
    this.closed = true;
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.producers.clear();
    this.consumers.clear();
    this.tileStreams.clear();
    this.tileRoles.clear();
    this.sentLayers.clear();
    ['newProducer', 'peerJoined', 'peerLeft', 'consumerClosed', 'producerToggled'].forEach((event) => {
      this.socket.off(event);
    });
    this.socket.disconnect();
  }
}
