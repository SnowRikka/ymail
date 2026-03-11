import { NextRequest, NextResponse } from 'next/server';

import { toSafeSessionSummary } from '@/lib/auth/store';

import { createRealtimeRouteDescriptor, resolveRealtimeSession } from './shared';

export async function GET(request: NextRequest) {
  const realtimeSession = await resolveRealtimeSession(request);

  if (!realtimeSession.ok) {
    return realtimeSession.response;
  }

  const websocketCapability = realtimeSession.jmapSession.capabilities.websocket;

  return NextResponse.json({
    authenticated: true,
    realtime: createRealtimeRouteDescriptor(websocketCapability),
    session: toSafeSessionSummary(realtimeSession.session),
  });
}
