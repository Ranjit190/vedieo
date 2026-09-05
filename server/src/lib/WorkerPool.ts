import * as mediasoup from 'mediasoup';
import { types } from 'mediasoup';
import config from '../config';

/**
 * Manages a pool of mediasoup workers and hands them out round-robin so
 * routers (rooms) are spread across CPU cores.
 */
export default class WorkerPool {
  private workers: types.Worker[] = [];
  private nextIndex = 0;

  /**
   * Creates the configured number of mediasoup workers.
   * Exits the process if a worker dies since media state is unrecoverable.
   * @returns {Promise<void>} Resolves when all workers are created.
   */
  async init(): Promise<void> {
    for (let i = 0; i < config.numWorkers; i += 1) {
      const worker = await mediasoup.createWorker({
        rtcMinPort: config.worker.rtcMinPort,
        rtcMaxPort: config.worker.rtcMaxPort,
        logLevel: config.worker.logLevel,
        logTags: config.worker.logTags
      });
      worker.on('died', () => {
        console.error(`mediasoup worker died [pid:${worker.pid}], exiting in 2s`);
        setTimeout(() => process.exit(1), 2000);
      });
      this.workers.push(worker);
    }
    console.log(`Created ${this.workers.length} mediasoup worker(s)`);
  }

  /**
   * Returns the next worker in round-robin order.
   * @returns {types.Worker} A mediasoup worker.
   */
  getWorker(): types.Worker {
    const worker = this.workers[this.nextIndex];
    this.nextIndex = (this.nextIndex + 1) % this.workers.length;
    return worker;
  }
}
