const clients = new Set();
const heartbeatIntervalMs = 25_000;

function removeClient(response, heartbeat) {
  clearInterval(heartbeat);
  clients.delete(response);
}

export function openCommunicationStream(request, response) {
  response.status(200);
  response.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.flushHeaders();
  response.write('retry: 5000\n\n');
  response.write('event: ready\ndata: {}\n\n');

  clients.add(response);
  const heartbeat = setInterval(() => {
    if (response.destroyed || response.writableEnded) {
      removeClient(response, heartbeat);
      return;
    }
    try {
      response.write(': keep-alive\n\n');
    } catch {
      removeClient(response, heartbeat);
    }
  }, heartbeatIntervalMs);

  const close = () => removeClient(response, heartbeat);
  request.once('close', close);
  response.once('error', close);
}

export function announceCommunication() {
  const payload = `event: refresh\ndata: ${JSON.stringify({ publishedAt: new Date().toISOString() })}\n\n`;
  for (const response of clients) {
    if (response.destroyed || response.writableEnded) {
      clients.delete(response);
      continue;
    }
    try {
      response.write(payload);
    } catch {
      clients.delete(response);
    }
  }
}

export function closeCommunicationStreams() {
  for (const response of clients) response.end();
  clients.clear();
}
