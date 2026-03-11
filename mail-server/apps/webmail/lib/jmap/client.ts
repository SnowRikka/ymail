'use client';

import { getCapabilityUrn, getMethodCapability, selectAccountForCapability } from '@/lib/jmap/capabilities';
import { createTransportError, createUnauthenticatedError, isRecord, normalizeExecutionError, readErrorMessage } from '@/lib/jmap/errors';
import { createMethodCall as createTypedMethodCall, isJmapMethodName, isJmapMethodResult } from '@/lib/jmap/methods';
import { buildBlobDownloadUrl, loadJmapSession } from '@/lib/jmap/session';
import { JMAP_CAPABILITY_URNS, type JmapAccountCapabilityKey, type JmapAccountSelectionResult, type JmapBatchResult, type JmapBlobDownloadAccess, type JmapBlobUploadAccess, type JmapBootstrapResult, type JmapClient, type JmapExecutionError, type JmapJsonObject, type JmapMethodCall, type JmapMethodFailure, type JmapMethodName, type JmapMethodResponse, type JmapMethodResult, type JmapMethodSuccess, type JmapRealtimeAccess, type JmapSessionResource, type JmapSingleMethodResult } from '@/lib/jmap/types';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function parseJsonObject(value: unknown): JmapJsonObject {
  if (!isRecord(value)) {
    return {};
  }

  const entries: [string, JmapJsonObject[keyof JmapJsonObject]][] = [];

  const parseJsonValue = (entry: unknown): JmapJsonObject[keyof JmapJsonObject] | undefined => {
    if (entry === null || typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
      return entry;
    }

    if (Array.isArray(entry)) {
      const items = entry
        .map((item) => parseJsonValue(item))
        .filter((item): item is NonNullable<typeof item> => item !== undefined);

      return items;
    }

    if (isRecord(entry)) {
      return parseJsonObject(entry);
    }

    return undefined;
  };

  for (const [key, entry] of Object.entries(value)) {
    const parsed = parseJsonValue(entry);

    if (parsed !== undefined) {
      entries.push([key, parsed]);
    }
  }

  return Object.fromEntries(entries);
}

function parseMethodTuple(
  tuple: unknown,
  callContext: Readonly<Record<string, { accountId: string; name: JmapMethodName }>>,
): JmapMethodResult | null {
  if (!Array.isArray(tuple) || tuple.length !== 3) {
    return null;
  }

  const [name, payload, callId] = tuple;

  if (typeof callId !== 'string') {
    return null;
  }

  const context = callContext[callId];

  if (!context) {
    return null;
  }

  if (name === 'error') {
    const failure: JmapMethodFailure = {
      accountId: context.accountId,
      callId,
      error: parseJsonObject(payload),
      kind: 'method-error',
      name: context.name,
    };

    return failure;
  }

  if (typeof name !== 'string' || !isJmapMethodName(name)) {
    return null;
  }

  const response = parseJsonObject(payload);
  const success: JmapMethodSuccess = {
    accountId: context.accountId,
    callId,
    kind: 'success',
    name,
    response: toMethodResponse(name, response),
  };

  return success;
}

function toMethodResponse<Name extends JmapMethodName>(name: Name, response: JmapJsonObject): JmapMethodResponse<Name> {
  switch (name) {
    case 'Mailbox/get':
    case 'Mailbox/query':
    case 'Mailbox/changes':
    case 'Thread/get':
    case 'Thread/changes':
    case 'Email/get':
    case 'Email/query':
    case 'Email/queryChanges':
    case 'Email/set':
    case 'Identity/get':
    case 'EmailSubmission/set':
      return response as unknown as JmapMethodResponse<Name>;
  }
}

export function createJmapClient(fetchImplementation: FetchLike = fetch): JmapClient {
  let bootstrapPromise: Promise<JmapBootstrapResult> | null = null;

  async function bootstrap(): Promise<JmapBootstrapResult> {
    if (!bootstrapPromise) {
      bootstrapPromise = loadJmapSession(fetchImplementation);
    }

    return bootstrapPromise;
  }

  async function getReadySession(): Promise<JmapSessionResource | JmapExecutionError> {
    try {
      const result = await bootstrap();
      return result.status === 'ready' ? result.session : createUnauthenticatedError();
    } catch (error) {
      return normalizeExecutionError(error, 'JMAP Session 暂时不可用。');
    }
  }

  async function selectAccount(capability: JmapAccountCapabilityKey, preferredAccountId?: string): Promise<JmapAccountSelectionResult | JmapExecutionError> {
    const ready = await getReadySession();

    if ('kind' in ready) {
      return ready;
    }

    return selectAccountForCapability(ready, capability, preferredAccountId);
  }

  async function call(calls: readonly JmapMethodCall[]): Promise<JmapBatchResult> {
    const ready = await getReadySession();

    if ('kind' in ready) {
      return { error: ready, ok: false };
    }

    const using = new Set<string>([JMAP_CAPABILITY_URNS.core]);
    const callContext: Record<string, { accountId: string; name: JmapMethodName }> = {};
    const methodCalls: [JmapMethodName, JmapMethodCall['request'], string][] = [];

    for (const callItem of calls) {
      const capability = getMethodCapability(callItem.name);
      using.add(getCapabilityUrn(capability));

      const selection = selectAccountForCapability(ready, capability, callItem.accountId);
      if (!selection.ok) {
        return { error: selection.error, ok: false };
      }

      callContext[callItem.callId] = { accountId: selection.account.id, name: callItem.name };
      methodCalls.push([
        callItem.name,
        {
          ...callItem.request,
          accountId: selection.account.id,
        },
        callItem.callId,
      ]);
    }

    let response: Response;

    try {
      response = await fetchImplementation('/api/jmap', {
        body: JSON.stringify({ methodCalls, using: [...using] }),
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        method: 'POST',
      });
    } catch {
      return { error: createTransportError(502, '邮箱数据服务暂时不可用。'), ok: false };
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch {
      return { error: createTransportError(response.status, 'JMAP 调用返回了无法识别的响应。'), ok: false };
    }

    if (!response.ok) {
      if (response.status === 401) {
        return { error: createUnauthenticatedError(), ok: false };
      }

      return { error: createTransportError(response.status, readErrorMessage(payload, 'JMAP 调用失败。')), ok: false };
    }

    if (!isRecord(payload) || !Array.isArray(payload.methodResponses) || typeof payload.sessionState !== 'string') {
      return { error: createTransportError(502, 'JMAP 响应缺少 methodResponses 或 sessionState。'), ok: false };
    }

    const responses = payload.methodResponses
      .map((entry) => parseMethodTuple(entry, callContext))
      .filter((entry): entry is JmapMethodResult => entry !== null);

    const createdIdsSource = isRecord(payload.createdIds) ? payload.createdIds : {};
    const createdIds = Object.fromEntries(
      Object.entries(createdIdsSource).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );

    return {
      createdIds,
      ok: true,
      responses,
      session: ready,
      sessionState: payload.sessionState,
    };
  }

  async function runSingle<Name extends JmapMethodName>(
    name: Name,
    request: Omit<JmapMethodCall<Name>['request'], 'accountId'> & { accountId?: string },
  ): Promise<JmapSingleMethodResult<Name>> {
    const batch = await call([createTypedMethodCall(name, request, `${name}-0`)]);

    if (!batch.ok) {
      return batch;
    }

    const first = batch.responses[0];

    if (!first || !isJmapMethodResult(first, name)) {
      return {
        error: createTransportError(502, 'JMAP 响应中缺少预期的方法结果。'),
        ok: false,
      };
    }

    return {
      ok: true,
      result: first,
      session: batch.session,
    };
  }

  async function uploadAccess(preferredAccountId?: string): Promise<JmapBlobUploadAccess | JmapExecutionError> {
    const ready = await getReadySession();

    if ('kind' in ready) {
      return ready;
    }

    const selection = selectAccountForCapability(ready, 'blob', preferredAccountId);
    if (!selection.ok) {
      return selection.error;
    }

    return {
      capability: selection.account.accountCapabilities.blob,
      kind: 'blob-upload',
      requiresBffProxy: true,
      status: selection.account.accountCapabilities.blob.supported ? 'available' : 'unsupported',
      upstreamUrl: selection.account.accountCapabilities.blob.supported ? ready.uploadUrl : null,
    };
  }

  async function downloadAccess(input: { accountId?: string; blobId: string; name?: string | null; type?: string | null }): Promise<JmapBlobDownloadAccess | JmapExecutionError> {
    const ready = await getReadySession();

    if ('kind' in ready) {
      return ready;
    }

    const selection = selectAccountForCapability(ready, 'blob', input.accountId);
    if (!selection.ok) {
      return selection.error;
    }

    const supported = selection.account.accountCapabilities.blob.supported;

    return {
      accountId: selection.account.id,
      blobId: input.blobId,
      capability: selection.account.accountCapabilities.blob,
      kind: 'blob-download',
      name: input.name ?? null,
      requiresBffProxy: true,
      status: supported ? 'available' : 'unsupported',
      type: input.type ?? null,
      upstreamUrl: supported ? buildBlobDownloadUrl(ready.downloadUrl, selection.account.id, input.blobId, input) : null,
    };
  }

  function reset() {
    bootstrapPromise = null;
  }

  return {
    blob: {
      downloadAccess,
      uploadAccess,
    },
    bootstrap,
    call,
    email: {
      get: (request = {}) => runSingle('Email/get', request),
      query: (request = {}) => runSingle('Email/query', request),
      queryChanges: (request) => runSingle('Email/queryChanges', request),
      set: (request = {}) => runSingle('Email/set', request),
    },
    identity: {
      get: (request = {}) => runSingle('Identity/get', request),
    },
    mailbox: {
      changes: (request) => runSingle('Mailbox/changes', request),
      get: (request = {}) => runSingle('Mailbox/get', request),
      query: (request = {}) => runSingle('Mailbox/query', request),
    },
    reset,
    selectAccount,
    submission: {
      set: (request = {}) => runSingle('EmailSubmission/set', request),
    },
    thread: {
      changes: (request) => runSingle('Thread/changes', request),
      get: (request = {}) => runSingle('Thread/get', request),
    },
  };
}

export async function getRealtimeAccess(client: JmapClient): Promise<JmapRealtimeAccess | JmapExecutionError> {
  let bootstrap: JmapBootstrapResult;

  try {
    bootstrap = await client.bootstrap();
  } catch (error) {
    return normalizeExecutionError(error, 'JMAP Session 暂时不可用。');
  }

  if (bootstrap.status !== 'ready') {
    return createUnauthenticatedError();
  }

  return {
    capability: bootstrap.session.capabilities.websocket,
    eventSourceUrl: bootstrap.session.eventSourceUrl,
    kind: 'realtime',
    mode: bootstrap.session.capabilities.websocket.supported
      ? bootstrap.session.capabilities.websocket.value.supportsPush
        ? 'websocket'
        : 'event-source'
      : 'none',
    websocketUrl: bootstrap.session.capabilities.websocket.supported ? bootstrap.session.capabilities.websocket.value.url : null,
  };
}
