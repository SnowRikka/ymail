import type { JmapRealtimeAccess } from '@/lib/jmap/types';

export type RealtimeCapabilityMode = JmapRealtimeAccess['mode'];
export type RealtimeRuntimeMode = 'event-source' | 'polling' | 'websocket';
export type RealtimeSyncPhase = 'connecting' | 'disabled' | 'error' | 'healthy' | 'reconnecting';
export type RealtimeSyncReason = 'poll' | 'push' | 'reconnect' | 'resume';

export interface RealtimeStatusState {
  readonly capabilityMode: RealtimeCapabilityMode;
  readonly errorMessage: string | null;
  readonly phase: RealtimeSyncPhase;
  readonly runtimeMode: RealtimeRuntimeMode;
  readonly statusLabel: string;
  readonly toastMessage: string | null;
}

function modeLabel(mode: RealtimeRuntimeMode) {
  switch (mode) {
    case 'event-source':
      return '事件流';
    case 'polling':
      return '轮询';
    case 'websocket':
      return 'WebSocket';
  }
}

export function selectRealtimeRuntimeMode(access: JmapRealtimeAccess): RealtimeRuntimeMode {
  return access.mode === 'none' ? 'polling' : access.mode;
}

export function buildRealtimeStatusLabel(phase: RealtimeSyncPhase, runtimeMode: RealtimeRuntimeMode) {
  const label = modeLabel(runtimeMode);

  switch (phase) {
    case 'connecting':
      return `${label}连接中`;
    case 'disabled':
      return '实时同步已停用';
    case 'error':
      return `${label}同步异常`;
    case 'healthy':
      return `${label}同步正常`;
    case 'reconnecting':
      return `${label}重连中`;
  }
}

export function createRealtimeStatusState(input?: Partial<Omit<RealtimeStatusState, 'statusLabel'>>) {
  const capabilityMode = input?.capabilityMode ?? 'none';
  const runtimeMode = input?.runtimeMode ?? 'polling';
  const phase = input?.phase ?? 'disabled';

  return {
    capabilityMode,
    errorMessage: input?.errorMessage ?? null,
    phase,
    runtimeMode,
    statusLabel: buildRealtimeStatusLabel(phase, runtimeMode),
    toastMessage: input?.toastMessage ?? null,
  } satisfies RealtimeStatusState;
}
