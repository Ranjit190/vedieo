import Peer from './Peer';
import Room from './Room';

/**
 * Builds a diagnostic snapshot of one peer: its producers and consumers
 * with paused state, quality scores and RTP stats (byte/packet counts and
 * bitrate show whether media is actually flowing).
 * @param {Peer} peer - The peer to report on.
 * @returns {Promise<object>} The peer's diagnostic snapshot.
 */
async function buildPeerReport(peer: Peer): Promise<object> {
  const producers = [];
  for (const producer of peer.getProducers()) {
    producers.push({
      id: producer.id,
      kind: producer.kind,
      paused: producer.paused,
      score: producer.score,
      stats: await producer.getStats()
    });
  }
  const consumers = [];
  for (const consumer of peer.getConsumers()) {
    consumers.push({
      id: consumer.id,
      kind: consumer.kind,
      paused: consumer.paused,
      producerPaused: consumer.producerPaused,
      score: consumer.score
    });
  }
  return { peerId: peer.id, name: peer.name, producers, consumers };
}

/**
 * Builds a diagnostic snapshot of every room, its peers and their media
 * state, served by the /debug/rooms endpoint.
 * @param {Map<string, Room>} rooms - All active rooms keyed by group id.
 * @returns {Promise<object[]>} The full diagnostic report.
 */
export async function buildRoomsReport(rooms: Map<string, Room>): Promise<object[]> {
  const report = [];
  for (const [groupId, room] of rooms) {
    const peers = [];
    for (const peer of room.getPeers()) {
      peers.push(await buildPeerReport(peer));
    }
    report.push({ groupId, peers });
  }
  return report;
}
