import { NextRequest } from 'next/server';

import { deleteAppSession } from '@/lib/auth/store';
import { isPlaywrightTestSession } from '@/lib/jmap/playwright-test-mode';

import { unauthorizedResponse, resolveRealtimeSession } from '../shared';

const SSE_HEADERS = {
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'content-type': 'text/event-stream; charset=utf-8',
} as const;

const SSE_HEARTBEAT_INTERVAL_MS = 15_000;

function createIdleStream(signal: AbortSignal) {
  const encoder = new TextEncoder();
  let intervalId: ReturnType<typeof setInterval> | null = null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (intervalId !== null) {
          clearInterval(intervalId);
          intervalId = null;
        }

        controller.close();
      };

      controller.enqueue(encoder.encode(': connected\n\n'));
      intervalId = setInterval(() => {
        controller.enqueue(encoder.encode(': keep-alive\n\n'));
      }, SSE_HEARTBEAT_INTERVAL_MS);

      signal.addEventListener('abort', close, { once: true });
    },
    cancel() {
      if (intervalId !== null) {
        clearInterval(intervalId);
      }
    },
  });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const realtimeSession = await resolveRealtimeSession(request);

  if (!realtimeSession.ok) {
    return realtimeSession.response;
  }

  if (!realtimeSession.jmapSession.capabilities.websocket.supported) {
    return new Response(null, { status: 204, headers: SSE_HEADERS });
  }

  if (isPlaywrightTestSession(realtimeSession.session)) {
    return new Response(createIdleStream(request.signal), { headers: SSE_HEADERS, status: 200 });
  }

  let upstreamResponse: Response;

  try {
    upstreamResponse = await fetch(realtimeSession.jmapSession.eventSourceUrl, {
      cache: 'no-store',
      headers: {
        accept: 'text/event-stream',
        authorization: realtimeSession.session.authorizationHeader,
      },
      method: 'GET',
      signal: request.signal,
    });
  } catch {
    return new Response('暂时无法连接邮箱实时服务。', { status: 502 });
  }

  if (upstreamResponse.status === 401 || upstreamResponse.status === 403) {
    deleteAppSession(realtimeSession.session.id);
    return unauthorizedResponse(true);
  }

  if (!upstreamResponse.ok || !upstreamResponse.body) {
    return new Response('邮箱实时服务暂时不可用。', { status: 502 });
  }

  return new Response(upstreamResponse.body, {
    headers: SSE_HEADERS,
    status: 200,
  });
}
