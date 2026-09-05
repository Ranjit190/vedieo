import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import config from './config';
import Room from './lib/Room';
import WorkerPool from './lib/WorkerPool';
import { buildRoomsReport } from './lib/debugReport';
import { registerSocketHandlers, ServerContext } from './signaling/socketHandlers';

/**
 * Boots the media server: creates mediasoup workers, the HTTP/Socket.IO
 * server and wires signaling handlers for every connection.
 * @returns {Promise<void>} Resolves when the server is listening.
 */
async function main(): Promise<void> {
  const app = express();
  app.use(cors({ origin: config.clientOrigin }));
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: config.clientOrigin, methods: ['GET', 'POST'] }
  });
  const workerPool = new WorkerPool();
  await workerPool.init();
  const context: ServerContext = {
    io,
    rooms: new Map<string, Room>(),
    workerPool
  };
  app.get('/debug/rooms', async (_req, res) => {
    res.json(await buildRoomsReport(context.rooms));
  });
  io.on('connection', (socket) => {
    console.log(`Socket connected [${socket.id}]`);
    registerSocketHandlers(context, socket);
  });
  httpServer.listen(config.listenPort, () => {
    console.log(`Media server listening on http://localhost:${config.listenPort}`);
  });
}

main().catch((error) => {
  console.error(`Failed to start server: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
