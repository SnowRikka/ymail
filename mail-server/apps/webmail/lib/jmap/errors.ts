import type { JmapAccountCapabilityKey, JmapCapabilityError, JmapExecutionError, JmapTransportError, JmapUnauthenticatedError } from '@/lib/jmap/types';

type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readErrorMessage(payload: unknown, fallback: string): string {
  return isRecord(payload) && typeof payload.message === 'string' ? payload.message : fallback;
}

export function createUnauthenticatedError(): JmapUnauthenticatedError {
  return {
    kind: 'unauthenticated',
    message: '登录状态已失效，请重新登录。',
  };
}

export function createTransportError(status: number, message: string): JmapTransportError {
  return {
    kind: 'transport',
    message,
    status,
  };
}

export function createCapabilityError(
  capability: JmapAccountCapabilityKey,
  reason: 'account-not-found' | 'missing-capability',
  accountId: string | null,
): JmapCapabilityError {
  return {
    accountId,
    capability,
    kind: 'capability',
    message: reason === 'account-not-found' ? '未找到可用账号。' : '当前会话不支持所需能力。',
    reason,
  };
}

export function normalizeExecutionError(error: unknown, fallbackMessage: string, fallbackStatus = 502): JmapExecutionError {
  if (isRecord(error) && error.kind === 'transport' && typeof error.message === 'string' && typeof error.status === 'number') {
    return {
      kind: 'transport',
      message: error.message,
      status: error.status,
    };
  }

  return createTransportError(fallbackStatus, fallbackMessage);
}
