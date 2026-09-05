import { Server, Socket } from 'socket.io';
import { types } from 'mediasoup';
import config from '../config';
import Peer from '../lib/Peer';
import Room from '../lib/Room';
import WorkerPool from '../lib/WorkerPool';

/**
 * Shared server context handed to every socket connection.
 */
export interface ServerContext {
  io: Server;
  rooms: Map<string, Room>;
  workerPool: WorkerPool;
}

type Callback = (response: Record<string, unknown>) => void;

/**
 * Wraps an async socket handler so any thrown error is returned to the
 * client through the acknowledgement callback instead of crashing the server.
 * @param {string} event - Event name, used for logging.
 * @param {Function} handler - The async handler to protect.
 * @returns {Function} A safe handler usable with socket.on.
 */
function safeHandler(event: string, handler: (data: any, callback: Callback) => Promise<void>) {
  return async (data: any, callback: Callback) => {
    try {
      await handler(data, callback);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Error in "${event}": ${message}`);
      if (typeof callback === 'function') {
        callback({ error: message });
      }
    }
  };
}

/**
 * Returns the existing room for a group id or creates a new one with a
 * fresh router taken from the worker pool.
 * @param {ServerContext} context - Shared server context.
 * @param {string} groupId - The group id entered by the user.
 * @returns {Promise<Room>} The room for the group.
 */
async function getOrCreateRoom(context: ServerContext, groupId: string): Promise<Room> {
  const existingRoom = context.rooms.get(groupId);
  if (existingRoom) {
    return existingRoom;
  }
  const worker = context.workerPool.getWorker();
  const router = await worker.createRouter({ mediaCodecs: config.router.mediaCodecs });
  const room = new Room(groupId, router);
  context.rooms.set(groupId, room);
  console.log(`Created room for group "${groupId}"`);
  return room;
}

/**
 * Returns the room and peer bound to a socket, throwing if the socket has
 * not joined a room yet.
 * @param {ServerContext} context - Shared server context.
 * @param {Socket} socket - The requesting socket.
 * @returns {{ room: Room, peer: Peer }} The socket's room and peer.
 */
function getRoomAndPeer(context: ServerContext, socket: Socket): { room: Room; peer: Peer } {
  const groupId = socket.data.groupId as string | undefined;
  const room = groupId ? context.rooms.get(groupId) : undefined;
  const peer = room?.getPeer(socket.id);
  if (!room || !peer) {
    throw new Error('Peer has not joined a room');
  }
  return { room, peer };
}

/**
 * Handles a user joining a group: creates/fetches the room, registers the
 * peer and returns router capabilities plus the existing producers to consume.
 * @param {ServerContext} context - Shared server context.
 * @param {Socket} socket - The joining socket.
 * @param {{ groupId: string, name: string }} data - Join payload.
 * @param {Callback} callback - Acknowledgement callback.
 * @returns {Promise<void>} Resolves when the join is complete.
 */
async function handleJoinRoom(context: ServerContext, socket: Socket, data: { groupId: string; name: string }, callback: Callback): Promise<void> {
  const { groupId, name } = data;
  if (!groupId || !name) {
    throw new Error('groupId and name are required');
  }
  const room = await getOrCreateRoom(context, groupId);
  const peer = new Peer(socket.id, name);
  room.addPeer(peer);
  socket.data.groupId = groupId;
  socket.join(groupId);
  socket.to(groupId).emit('peerJoined', { peerId: peer.id, name: peer.name });
  const peers = room
    .getPeers()
    .filter((roomPeer) => roomPeer.id !== socket.id)
    .map((roomPeer) => ({ peerId: roomPeer.id, name: roomPeer.name }));
  callback({
    rtpCapabilities: room.router.rtpCapabilities,
    producers: room.getProducerList(socket.id),
    peers
  });
  console.log(`Peer "${name}" [${socket.id}] joined group "${groupId}"`);
}

/**
 * Creates a WebRTC transport for the requesting peer and returns the
 * parameters the client needs to mirror it.
 * @param {ServerContext} context - Shared server context.
 * @param {Socket} socket - The requesting socket.
 * @param {Callback} callback - Acknowledgement callback.
 * @returns {Promise<void>} Resolves when the transport is created.
 */
async function handleCreateTransport(context: ServerContext, socket: Socket, callback: Callback): Promise<void> {
  const { room, peer } = getRoomAndPeer(context, socket);
  const transport = await room.router.createWebRtcTransport(config.webRtcTransport);
  peer.addTransport(transport);
  callback({
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters
  });
}

/**
 * Completes the DTLS handshake for a previously created transport.
 * @param {ServerContext} context - Shared server context.
 * @param {Socket} socket - The requesting socket.
 * @param {{ transportId: string, dtlsParameters: types.DtlsParameters }} data - Connect payload.
 * @param {Callback} callback - Acknowledgement callback.
 * @returns {Promise<void>} Resolves when the transport is connected.
 */
async function handleConnectTransport(context: ServerContext, socket: Socket, data: { transportId: string; dtlsParameters: types.DtlsParameters }, callback: Callback): Promise<void> {
  const { transportId, dtlsParameters } = data;
  const { peer } = getRoomAndPeer(context, socket);
  const transport = peer.getTransport(transportId);
  if (!transport) {
    throw new Error(`Transport not found: ${transportId}`);
  }
  await transport.connect({ dtlsParameters });
  callback({ connected: true });
}

/**
 * Creates a producer for the peer's outgoing track and announces it to the
 * rest of the group so they can consume it.
 * @param {ServerContext} context - Shared server context.
 * @param {Socket} socket - The requesting socket.
 * @param {{ transportId: string, kind: types.MediaKind, rtpParameters: types.RtpParameters }} data - Produce payload.
 * @param {Callback} callback - Acknowledgement callback.
 * @returns {Promise<void>} Resolves when the producer is created.
 */
async function handleProduce(context: ServerContext, socket: Socket, data: { transportId: string; kind: types.MediaKind; rtpParameters: types.RtpParameters }, callback: Callback): Promise<void> {
  const { transportId, kind, rtpParameters } = data;
  const { room, peer } = getRoomAndPeer(context, socket);
  const transport = peer.getTransport(transportId);
  if (!transport) {
    throw new Error(`Transport not found: ${transportId}`);
  }
  const producer = await transport.produce({ kind, rtpParameters });
  peer.addProducer(producer);
  socket.to(room.id).emit('newProducer', {
    producerId: producer.id,
    peerId: peer.id,
    peerName: peer.name,
    kind: producer.kind
  });
  callback({ id: producer.id });
}

/**
 * Creates a paused consumer on the peer's receive transport for another
 * peer's producer and returns the parameters the client needs.
 * @param {ServerContext} context - Shared server context.
 * @param {Socket} socket - The requesting socket.
 * @param {{ transportId: string, producerId: string, rtpCapabilities: types.RtpCapabilities }} data - Consume payload.
 * @param {Callback} callback - Acknowledgement callback.
 * @returns {Promise<void>} Resolves when the consumer is created.
 */
async function handleConsume(context: ServerContext, socket: Socket, data: { transportId: string; producerId: string; rtpCapabilities: types.RtpCapabilities }, callback: Callback): Promise<void> {
  const { transportId, producerId, rtpCapabilities } = data;
  const { room, peer } = getRoomAndPeer(context, socket);
  if (!room.router.canConsume({ producerId, rtpCapabilities })) {
    throw new Error(`Cannot consume producer: ${producerId}`);
  }
  const transport = peer.getTransport(transportId);
  if (!transport) {
    throw new Error(`Transport not found: ${transportId}`);
  }
  const consumer = await transport.consume({ producerId, rtpCapabilities, paused: true });
  peer.addConsumer(consumer);
  consumer.on('producerclose', () => {
    socket.emit('consumerClosed', { consumerId: consumer.id });
  });
  callback({
    id: consumer.id,
    producerId,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters
  });
}

/**
 * Resumes a consumer after the client has attached its track.
 * @param {ServerContext} context - Shared server context.
 * @param {Socket} socket - The requesting socket.
 * @param {{ consumerId: string }} data - Resume payload.
 * @param {Callback} callback - Acknowledgement callback.
 * @returns {Promise<void>} Resolves when the consumer is resumed.
 */
async function handleResumeConsumer(context: ServerContext, socket: Socket, data: { consumerId: string }, callback: Callback): Promise<void> {
  const { consumerId } = data;
  const { peer } = getRoomAndPeer(context, socket);
  const consumer = peer.getConsumer(consumerId);
  if (!consumer) {
    throw new Error(`Consumer not found: ${consumerId}`);
  }
  await consumer.resume();
  callback({ resumed: true });
}

/**
 * Pauses or resumes one of the peer's own producers (mute / camera off) and
 * notifies the rest of the group so they can update their UI.
 * @param {ServerContext} context - Shared server context.
 * @param {Socket} socket - The requesting socket.
 * @param {{ producerId: string, paused: boolean }} data - Toggle payload.
 * @param {Callback} callback - Acknowledgement callback.
 * @returns {Promise<void>} Resolves when the producer state is updated.
 */
async function handleToggleProducer(context: ServerContext, socket: Socket, data: { producerId: string; paused: boolean }, callback: Callback): Promise<void> {
  const { producerId, paused } = data;
  const { room, peer } = getRoomAndPeer(context, socket);
  const producer = peer.getProducer(producerId);
  if (!producer) {
    throw new Error(`Producer not found: ${producerId}`);
  }
  if (paused) {
    await producer.pause();
  } else {
    await producer.resume();
  }
  socket.to(room.id).emit('producerToggled', { peerId: peer.id, kind: producer.kind, paused });
  callback({ paused });
}

/**
 * Removes a disconnected peer from its room, notifies the group and closes
 * the room when it becomes empty.
 * @param {ServerContext} context - Shared server context.
 * @param {Socket} socket - The disconnected socket.
 * @returns {void}
 */
function handleDisconnect(context: ServerContext, socket: Socket): void {
  const groupId = socket.data.groupId as string | undefined;
  const room = groupId ? context.rooms.get(groupId) : undefined;
  if (!room || !groupId) {
    return;
  }
  const peer = room.removePeer(socket.id);
  if (peer) {
    socket.to(groupId).emit('peerLeft', { peerId: peer.id });
    console.log(`Peer "${peer.name}" [${socket.id}] left group "${groupId}"`);
  }
  if (room.isEmpty()) {
    room.close();
    context.rooms.delete(groupId);
    console.log(`Closed empty room for group "${groupId}"`);
  }
}

/**
 * Wires every signaling event for a newly connected socket.
 * @param {ServerContext} context - Shared server context.
 * @param {Socket} socket - The connected socket.
 * @returns {void}
 */
export function registerSocketHandlers(context: ServerContext, socket: Socket): void {
  socket.on('joinRoom', safeHandler('joinRoom', (data, callback) => handleJoinRoom(context, socket, data, callback)));
  socket.on('createTransport', safeHandler('createTransport', (_data, callback) => handleCreateTransport(context, socket, callback)));
  socket.on('connectTransport', safeHandler('connectTransport', (data, callback) => handleConnectTransport(context, socket, data, callback)));
  socket.on('produce', safeHandler('produce', (data, callback) => handleProduce(context, socket, data, callback)));
  socket.on('consume', safeHandler('consume', (data, callback) => handleConsume(context, socket, data, callback)));
  socket.on('resumeConsumer', safeHandler('resumeConsumer', (data, callback) => handleResumeConsumer(context, socket, data, callback)));
  socket.on('toggleProducer', safeHandler('toggleProducer', (data, callback) => handleToggleProducer(context, socket, data, callback)));
  socket.on('disconnect', () => handleDisconnect(context, socket));
}
