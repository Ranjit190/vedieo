import { types } from 'mediasoup';

/**
 * Represents a single connected user inside a room. Owns the user's WebRTC
 * transports, producers (outgoing media) and consumers (incoming media).
 */
export default class Peer {
  public readonly id: string;
  public readonly name: string;
  private readonly transports = new Map<string, types.WebRtcTransport>();
  private readonly producers = new Map<string, types.Producer>();
  private readonly consumers = new Map<string, types.Consumer>();

  /**
   * Creates a peer.
   * @param {string} id - Unique peer id (the socket id).
   * @param {string} name - Display name entered by the user.
   */
  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }

  /**
   * Registers a WebRTC transport owned by this peer.
   * @param {types.WebRtcTransport} transport - The transport to register.
   * @returns {void}
   */
  addTransport(transport: types.WebRtcTransport): void {
    this.transports.set(transport.id, transport);
  }

  /**
   * Looks up one of this peer's transports by id.
   * @param {string} transportId - The transport id.
   * @returns {types.WebRtcTransport | undefined} The transport, if owned by this peer.
   */
  getTransport(transportId: string): types.WebRtcTransport | undefined {
    return this.transports.get(transportId);
  }

  /**
   * Registers a producer and removes it from the map when it closes.
   * @param {types.Producer} producer - The producer to register.
   * @returns {void}
   */
  addProducer(producer: types.Producer): void {
    this.producers.set(producer.id, producer);
    producer.on('transportclose', () => this.producers.delete(producer.id));
  }

  /**
   * Looks up one of this peer's producers by id.
   * @param {string} producerId - The producer id.
   * @returns {types.Producer | undefined} The producer, if owned by this peer.
   */
  getProducer(producerId: string): types.Producer | undefined {
    return this.producers.get(producerId);
  }

  /**
   * Returns all active producers of this peer.
   * @returns {types.Producer[]} The peer's producers.
   */
  getProducers(): types.Producer[] {
    return Array.from(this.producers.values());
  }

  /**
   * Registers a consumer and removes it from the map when it closes.
   * @param {types.Consumer} consumer - The consumer to register.
   * @returns {void}
   */
  addConsumer(consumer: types.Consumer): void {
    this.consumers.set(consumer.id, consumer);
    consumer.on('transportclose', () => this.consumers.delete(consumer.id));
    consumer.on('producerclose', () => this.consumers.delete(consumer.id));
  }

  /**
   * Looks up one of this peer's consumers by id.
   * @param {string} consumerId - The consumer id.
   * @returns {types.Consumer | undefined} The consumer, if owned by this peer.
   */
  getConsumer(consumerId: string): types.Consumer | undefined {
    return this.consumers.get(consumerId);
  }

  /**
   * Returns all active consumers of this peer.
   * @returns {types.Consumer[]} The peer's consumers.
   */
  getConsumers(): types.Consumer[] {
    return Array.from(this.consumers.values());
  }

  /**
   * Closes all transports, which cascades and closes every producer and
   * consumer owned by this peer.
   * @returns {void}
   */
  close(): void {
    this.transports.forEach((transport) => transport.close());
    this.transports.clear();
    this.producers.clear();
    this.consumers.clear();
  }
}
