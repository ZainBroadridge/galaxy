const streamsByEvent = new Map();
const HEARTBEAT_MS = 25_000;

function send(response, event, payload) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function openEventStream(request, response) {
  const eventId = String(request.params.id ?? '');

  response.status(200);
  response.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.flushHeaders?.();
  response.write('retry: 5000\n\n');

  const streams = streamsByEvent.get(eventId) ?? new Set();
  streams.add(response);
  streamsByEvent.set(eventId, streams);

  const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), HEARTBEAT_MS);
  const close = () => {
    clearInterval(heartbeat);
    streams.delete(response);
    if (streams.size === 0) streamsByEvent.delete(eventId);
  };

  request.once('close', close);
  send(response, 'event-progress', { eventId, at: new Date().toISOString() });
}

export function publishEventUpdate(eventId) {
  if (!eventId) return;
  const streams = streamsByEvent.get(String(eventId));
  if (!streams) return;

  const payload = { eventId: String(eventId), at: new Date().toISOString() };
  for (const response of streams) {
    try {
      send(response, 'event-progress', payload);
    } catch {
      response.end();
      streams.delete(response);
    }
  }
  if (streams.size === 0) streamsByEvent.delete(String(eventId));
}

export function closeEventStreams() {
  for (const streams of streamsByEvent.values()) {
    for (const response of streams) response.end();
  }
  streamsByEvent.clear();
}
