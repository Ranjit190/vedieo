import { io, Socket } from 'socket.io-client';

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:4000';

let socket: Socket | null = null;

/**
 * Returns the shared Socket.IO client instance, creating it on first use.
 * The socket does not auto-connect; callers connect when joining a room.
 * @returns {Socket} The shared socket instance.
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(SERVER_URL, { autoConnect: false });
  }
  return socket;
}
