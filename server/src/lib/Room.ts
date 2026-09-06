import { types } from 'mediasoup';
import Peer from './Peer';

/**
 * Summary of a producer another peer can consume.
 */
export interface ProducerInfo {
  producerId: string;
  peerId: string;
  peerName: string;
  kind: types.MediaKind;
  source: string;
  paused: boolean;
}

/**
 * A group call. Maps one group id to one mediasoup router and holds the
 * peers currently joined to that group.
 */
export default class Room {
  public readonly id: string;
  public readonly router: types.Router;
  private readonly peers = new Map<string, Peer>();

  /**
   * Creates a room.
   * @param {string} id - The group id entered by users.
   * @param {types.Router} router - The mediasoup router backing this room.
   */
  constructor(id: string, router: types.Router) {
    this.id = id;
    this.router = router;
  }

  /**
   * Adds a peer to the room.
   * @param {Peer} peer - The peer to add.
   * @returns {void}
   */
  addPeer(peer: Peer): void {
    this.peers.set(peer.id, peer);
  }

  /**
   * Looks up a peer by id.
   * @param {string} peerId - The peer id.
   * @returns {Peer | undefined} The peer, if present.
   */
  getPeer(peerId: string): Peer | undefined {
    return this.peers.get(peerId);
  }

  /**
   * Removes a peer from the room and closes its media resources.
   * @param {string} peerId - The peer id.
   * @returns {Peer | undefined} The removed peer, if it was present.
   */
  removePeer(peerId: string): Peer | undefined {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.close();
      this.peers.delete(peerId);
    }
    return peer;
  }

  /**
   * Lists all peers currently in the room.
   * @returns {Peer[]} The peers.
   */
  getPeers(): Peer[] {
    return Array.from(this.peers.values());
  }

  /**
   * Lists every producer in the room that a given peer should consume,
   * excluding the peer's own producers.
   * @param {string} excludePeerId - Peer id whose producers are skipped.
   * @returns {ProducerInfo[]} Consumable producers with their owner info.
   */
  getProducerList(excludePeerId: string): ProducerInfo[] {
    const producerList: ProducerInfo[] = [];
    this.peers.forEach((peer) => {
      if (peer.id === excludePeerId) {
        return;
      }
      peer.getProducers().forEach((producer) => {
        producerList.push({
          producerId: producer.id,
          peerId: peer.id,
          peerName: peer.name,
          kind: producer.kind,
          source: (producer.appData.source as string) || 'webcam',
          paused: producer.paused
        });
      });
    });
    return producerList;
  }

  /**
   * Whether the room has no peers left.
   * @returns {boolean} True when empty.
   */
  isEmpty(): boolean {
    return this.peers.size === 0;
  }

  /**
   * Closes the room's router, releasing all media resources.
   * @returns {void}
   */
  close(): void {
    this.router.close();
  }
}
