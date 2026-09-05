import { Device, types } from 'mediasoup-client';
import { Socket } from 'socket.io-client';

/**
 * A remote producer announced by the server.
 */
export interface RemoteProducerInfo {
  producerId: string;
  peerId: string;
  peerName: string;
  kind: types.MediaKind;
}

/**
 * Callbacks the UI layer provides to react to room events.
 */
export interface RoomClientCallbacks {
  onRemoteStream: (peerId: string, name: string, stream: MediaStream) => void;
  onPeerLeft: (peerId: string) => void;
  onError: (message: string) => void;
}

interface ConsumerEntry {
  consumer: types.Consumer;
  peerId: string;
}

/**
 * Encapsulates all mediasoup-client logic for one call: device loading,
 * transport creation, producing local tracks and consuming remote ones.
 * The React layer only calls join/leave/toggle and receives streams via
 * the provided callbacks.
 */
export default class RoomClient {
  private readonly socket: Socket;
  private readonly callbacks: RoomClientCallbacks;
  private readonly device = new Device();
  private sendTransport: types.Transport | null = null;
  private recvTransport: types.Transport | null = null;
  private readonly producers = new Map<types.MediaKind, types.Producer>();
  private readonly consumers = new Map<string, ConsumerEntry>();
  private readonly remoteStreams = new Map<string, MediaStream>();
  private readonly peerNames = new Map<string, string>();
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
   * Joins a group: loads the device, creates both transports, produces the
   * local tracks and consumes every producer already in the room.
   * @param {string} groupId - The group id to join.
   * @param {string} name - The user's display name.
   * @param {MediaStream} localStream - The user's camera/microphone stream.
   * @returns {Promise<void>} Resolves when fully joined.
   */
  async join(groupId: string, name: string, localStream: MediaStream): Promise<void> {
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
    await this.produceLocalTracks(localStream);
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
        const { kind, rtpParameters } = payload;
        this.request('produce', { transportId: transport.id, kind, rtpParameters })
          .then((response) => callback({ id: response.id }))
          .catch((error) => errback(error as Error));
      });
    }
    return transport;
  }

  /**
   * Produces the audio and video tracks of the local stream on the send
   * transport.
   * @param {MediaStream} localStream - The user's camera/microphone stream.
   * @returns {Promise<void>} Resolves when all tracks are produced.
   */
  private async produceLocalTracks(localStream: MediaStream): Promise<void> {
    if (!this.sendTransport) {
      throw new Error('Send transport is not ready');
    }
    const audioTrack = localStream.getAudioTracks()[0];
    const videoTrack = localStream.getVideoTracks()[0];
    if (audioTrack) {
      const audioProducer = await this.sendTransport.produce({ track: audioTrack });
      this.producers.set('audio', audioProducer);
    }
    if (videoTrack) {
      const videoProducer = await this.sendTransport.produce({ track: videoTrack });
      this.producers.set('video', videoProducer);
    }
  }

  /**
   * Consumes one remote producer: asks the server for a paused consumer,
   * attaches its track to the owning peer's stream and resumes it.
   * @param {RemoteProducerInfo} producerInfo - The remote producer to consume.
   * @returns {Promise<void>} Resolves when the consumer is live.
   */
  private async consumeProducer(producerInfo: RemoteProducerInfo): Promise<void> {
    const { producerId, peerId, peerName, kind } = producerInfo;
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
    this.consumers.set(consumer.id, { consumer, peerId });
    this.addTrackToPeer(peerId, consumer.track);
    await this.request('resumeConsumer', { consumerId: consumer.id });
  }

  /**
   * Adds a track to the MediaStream of a peer and notifies the UI. A new
   * MediaStream instance is built each time so the video element re-attaches
   * srcObject — browsers do not reliably start playing a track that is added
   * to a stream which is already attached and playing.
   * @param {string} peerId - The owning peer's id.
   * @param {MediaStreamTrack} track - The consumed track.
   * @returns {void}
   */
  private addTrackToPeer(peerId: string, track: MediaStreamTrack): void {
    const existingStream = this.remoteStreams.get(peerId);
    const tracks = existingStream ? [...existingStream.getTracks(), track] : [track];
    const stream = new MediaStream(tracks);
    this.remoteStreams.set(peerId, stream);
    const name = this.peerNames.get(peerId) || 'Guest';
    this.callbacks.onRemoteStream(peerId, name, stream);
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
  }

  /**
   * Cleans up all state for a peer that left and notifies the UI.
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
    this.remoteStreams.delete(peerId);
    this.peerNames.delete(peerId);
    this.callbacks.onPeerLeft(peerId);
  }

  /**
   * Closes a single consumer (its producer closed server-side) and removes
   * its track from the owning peer's stream.
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
    const stream = this.remoteStreams.get(entry.peerId);
    if (stream) {
      stream.removeTrack(entry.consumer.track);
    }
  }

  /**
   * Pauses or resumes one of the local producers (microphone or camera)
   * both locally and on the server.
   * @param {types.MediaKind} kind - Which producer to toggle ('audio' | 'video').
   * @param {boolean} paused - True to pause, false to resume.
   * @returns {Promise<void>} Resolves when the state is applied.
   */
  async setProducerPaused(kind: types.MediaKind, paused: boolean): Promise<void> {
    const producer = this.producers.get(kind);
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
    this.remoteStreams.clear();
    ['newProducer', 'peerJoined', 'peerLeft', 'consumerClosed'].forEach((event) => {
      this.socket.off(event);
    });
    this.socket.disconnect();
  }
}
