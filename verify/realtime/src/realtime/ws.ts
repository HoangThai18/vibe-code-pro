// apps/api/src/realtime/ws.ts — WebSocket only when clients send many messages; same auth and tenant rules
import { STATUS_CODES, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { isMember, type SseOptions } from './sse';

export function attachWebSocket(server: Server, o: Pick<SseOptions, 'pool' | 'hub' | 'authenticate'> & { origins: string[] }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const reject = (socket: Duplex, status: number) => {
    socket.write(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  server.on('upgrade', async (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    try {
      // CORS does not apply to WebSocket: without this check any website can connect with the user's cookie
      if (!o.origins.includes(req.headers.origin ?? '')) return reject(socket, 403);
      const tenantId = /^\/v1\/t\/([^/]+)\/ws$/.exec(new URL(req.url ?? '/', 'http://x').pathname)?.[1];
      const user = await o.authenticate(req);
      if (!user) return reject(socket, 401);
      if (!tenantId || !(await isMember(o.pool, tenantId, user.userId))) return reject(socket, 404);

      wss.handleUpgrade(req, socket, head, (ws) => {
        const remove = o.hub.add({
          tenantId, userId: user.userId,
          send: (event, data) => ws.send(JSON.stringify({ event, ...data })),
          close: () => ws.close(4000, 'reauthorize'),
        });
        ws.on('error', () => ws.terminate());
        ws.on('close', remove);
        // ws.on('message', ...): validate each message, check the permission for that action, write through the normal service code
      });
    } catch {
      reject(socket, 500);
    }
  });
}
