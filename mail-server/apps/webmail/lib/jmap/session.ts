import {
  JMAP_CAPABILITY_URNS,
  type JmapBootstrapResult,
  type JmapAccountCapabilityKey,
  type JmapAccountCapabilityRegistry,
  type JmapCapabilityState,
  type JmapCapabilityValue,
  type JmapPrimaryAccountRegistry,
  type JmapSessionAccount,
  type JmapSessionCapabilityKey,
  type JmapSessionCapabilityRegistry,
  type JmapSessionResource,
  type JmapUrlRegistry,
} from '@/lib/jmap/types';
import { createTransportError, isRecord, readErrorMessage } from '@/lib/jmap/errors';

export const JMAP_SESSION_ENDPOINT = '/api/jmap/session';

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function readStringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const items = value.map((entry) => readString(entry)).filter((entry): entry is string => entry !== null);
  return items;
}

function createUnsupportedCapability<Key extends JmapSessionCapabilityKey>(key: Key): JmapCapabilityState<Key> {
  return {
    key,
    supported: false,
    urn: JMAP_CAPABILITY_URNS[key],
    value: null,
  };
}

function createSupportedCapability<Key extends JmapSessionCapabilityKey>(key: Key, value: JmapCapabilityValue<Key>): JmapCapabilityState<Key> {
  return {
    key,
    supported: true,
    urn: JMAP_CAPABILITY_URNS[key],
    value,
  };
}

function parseCoreCapabilities(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const maxCallsInRequest = readNumber(value.maxCallsInRequest);
  const maxConcurrentRequests = readNumber(value.maxConcurrentRequests);
  const maxConcurrentUpload = readNumber(value.maxConcurrentUpload);
  const maxObjectsInGet = readNumber(value.maxObjectsInGet);
  const maxObjectsInSet = readNumber(value.maxObjectsInSet);
  const maxSizeRequest = readNumber(value.maxSizeRequest);
  const maxSizeUpload = readNumber(value.maxSizeUpload);
  const collationAlgorithms = readStringArray(value.collationAlgorithms);

  if (
    maxCallsInRequest === null ||
    maxConcurrentRequests === null ||
    maxConcurrentUpload === null ||
    maxObjectsInGet === null ||
    maxObjectsInSet === null ||
    maxSizeRequest === null ||
    maxSizeUpload === null ||
    collationAlgorithms === null
  ) {
    return null;
  }

  return {
    collationAlgorithms,
    maxCallsInRequest,
    maxConcurrentRequests,
    maxConcurrentUpload,
    maxObjectsInGet,
    maxObjectsInSet,
    maxSizeRequest,
    maxSizeUpload,
  };
}

function parseMailCapabilities(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const emailQuerySortOptions = readStringArray(value.emailQuerySortOptions);
  const maxMailboxDepth = readNumber(value.maxMailboxDepth);
  const maxSizeAttachmentsPerEmail = readNumber(value.maxSizeAttachmentsPerEmail);
  const maxSizeMailboxName = readNumber(value.maxSizeMailboxName);
  const mayCreateTopLevelMailbox = readBoolean(value.mayCreateTopLevelMailbox);
  const maxMailboxesPerEmail = value.maxMailboxesPerEmail === null ? null : readNumber(value.maxMailboxesPerEmail);

  if (
    emailQuerySortOptions === null ||
    maxMailboxDepth === null ||
    maxSizeAttachmentsPerEmail === null ||
    maxSizeMailboxName === null ||
    mayCreateTopLevelMailbox === null ||
    value.maxMailboxesPerEmail === undefined
  ) {
    return null;
  }

  return {
    emailQuerySortOptions,
    maxMailboxDepth,
    maxMailboxesPerEmail,
    maxSizeAttachmentsPerEmail,
    maxSizeMailboxName,
    mayCreateTopLevelMailbox,
  };
}

function parseSubmissionCapabilities(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const maxDelayedSend = readNumber(value.maxDelayedSend);
  const extensionsValue = value.submissionExtensions;

  if (maxDelayedSend === null || !isRecord(extensionsValue)) {
    return null;
  }

  const submissionExtensions = Object.fromEntries(
    Object.entries(extensionsValue)
      .map(([key, entry]) => {
        const items = readStringArray(entry);
        return items === null ? null : [key, items];
      })
      .filter((entry): entry is [string, readonly string[]] => entry !== null),
  );

  return {
    maxDelayedSend,
    submissionExtensions,
  };
}

function parseBlobCapabilities(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const maxDataSources = readNumber(value.maxDataSources);
  const maxSizeBlobSet = readNumber(value.maxSizeBlobSet);
  const supportedDigestAlgorithms = readStringArray(value.supportedDigestAlgorithms);
  const supportedTypeNames = readStringArray(value.supportedTypeNames);

  if (maxDataSources === null || maxSizeBlobSet === null || supportedDigestAlgorithms === null || supportedTypeNames === null) {
    return null;
  }

  return {
    maxDataSources,
    maxSizeBlobSet,
    supportedDigestAlgorithms,
    supportedTypeNames,
  };
}

function parseWebSocketCapabilities(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const url = readString(value.url);
  const supportsPush = readBoolean(value.supportsPush);

  if (url === null || supportsPush === null) {
    return null;
  }

  return {
    supportsPush,
    url,
  };
}

function parseSieveCapabilities(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const implementation = value.implementation === undefined ? null : readString(value.implementation);
  return {
    implementation,
  };
}

function parseCapabilityValue<Key extends JmapSessionCapabilityKey>(key: Key, value: unknown): JmapCapabilityState<Key> {
  switch (key) {
    case 'core': {
      const parsed = parseCoreCapabilities(value);
      return parsed === null
        ? createUnsupportedCapability('core') as JmapCapabilityState<Key>
        : createSupportedCapability('core', parsed) as JmapCapabilityState<Key>;
    }
    case 'mail': {
      const parsed = parseMailCapabilities(value);
      return parsed === null
        ? createUnsupportedCapability('mail') as JmapCapabilityState<Key>
        : createSupportedCapability('mail', parsed) as JmapCapabilityState<Key>;
    }
    case 'submission': {
      const parsed = parseSubmissionCapabilities(value);
      return parsed === null
        ? createUnsupportedCapability('submission') as JmapCapabilityState<Key>
        : createSupportedCapability('submission', parsed) as JmapCapabilityState<Key>;
    }
    case 'blob': {
      const parsed = parseBlobCapabilities(value);
      return parsed === null
        ? createUnsupportedCapability('blob') as JmapCapabilityState<Key>
        : createSupportedCapability('blob', parsed) as JmapCapabilityState<Key>;
    }
    case 'websocket': {
      const parsed = parseWebSocketCapabilities(value);
      return parsed === null
        ? createUnsupportedCapability('websocket') as JmapCapabilityState<Key>
        : createSupportedCapability('websocket', parsed) as JmapCapabilityState<Key>;
    }
    case 'quota':
      return isRecord(value)
        ? (createSupportedCapability('quota', { kind: 'quota' }) as JmapCapabilityState<Key>)
        : (createUnsupportedCapability('quota') as JmapCapabilityState<Key>);
    case 'sieve': {
      const parsed = parseSieveCapabilities(value);
      return parsed === null
        ? createUnsupportedCapability('sieve') as JmapCapabilityState<Key>
        : createSupportedCapability('sieve', parsed) as JmapCapabilityState<Key>;
    }
  }
}

function parseCapabilityEntry<Key extends JmapSessionCapabilityKey>(key: Key, value: unknown): JmapCapabilityState<Key> {
  if (!isRecord(value)) {
    return parseCapabilityValue(key, value);
  }

  const normalizedKey = readString(value.key);
  const supported = readBoolean(value.supported);

  if (normalizedKey === key && supported !== null) {
    return supported ? parseCapabilityValue(key, value.value) : createUnsupportedCapability(key);
  }

  return parseCapabilityValue(key, value);
}

function readCapabilitySourceEntry(source: Record<string, unknown>, key: JmapSessionCapabilityKey) {
  return source[key] ?? source[JMAP_CAPABILITY_URNS[key]];
}

function parseSessionCapabilityRegistry(value: unknown): JmapSessionCapabilityRegistry {
  const source = isRecord(value) ? value : {};

  return {
    blob: parseCapabilityEntry('blob', readCapabilitySourceEntry(source, 'blob')),
    core: parseCapabilityEntry('core', readCapabilitySourceEntry(source, 'core')),
    mail: parseCapabilityEntry('mail', readCapabilitySourceEntry(source, 'mail')),
    quota: parseCapabilityEntry('quota', readCapabilitySourceEntry(source, 'quota')),
    sieve: parseCapabilityEntry('sieve', readCapabilitySourceEntry(source, 'sieve')),
    submission: parseCapabilityEntry('submission', readCapabilitySourceEntry(source, 'submission')),
    websocket: parseCapabilityEntry('websocket', readCapabilitySourceEntry(source, 'websocket')),
  };
}

function parseAccountCapabilityRegistry(value: unknown): JmapAccountCapabilityRegistry {
  const source = isRecord(value) ? value : {};

  return {
    blob: parseCapabilityEntry('blob', readCapabilitySourceEntry(source, 'blob')),
    mail: parseCapabilityEntry('mail', readCapabilitySourceEntry(source, 'mail')),
    quota: parseCapabilityEntry('quota', readCapabilitySourceEntry(source, 'quota')),
    sieve: parseCapabilityEntry('sieve', readCapabilitySourceEntry(source, 'sieve')),
    submission: parseCapabilityEntry('submission', readCapabilitySourceEntry(source, 'submission')),
  };
}

function parsePrimaryAccounts(value: unknown): JmapPrimaryAccountRegistry {
  const source = isRecord(value) ? value : {};
  const readAccountId = (key: JmapAccountCapabilityKey) => readString(source[key] ?? source[JMAP_CAPABILITY_URNS[key]]);

  return {
    blob: readAccountId('blob'),
    mail: readAccountId('mail'),
    quota: readAccountId('quota'),
    sieve: readAccountId('sieve'),
    submission: readAccountId('submission'),
  };
}

function parseSessionAccount(accountId: string, value: unknown): JmapSessionAccount | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = readString(value.name);
  const isPersonal = readBoolean(value.isPersonal);
  const isReadOnly = readBoolean(value.isReadOnly);

  if (name === null || isPersonal === null || isReadOnly === null) {
    return null;
  }

  return {
    accountCapabilities: parseAccountCapabilityRegistry(value.accountCapabilities),
    id: accountId,
    isPersonal,
    isReadOnly,
    name,
  };
}

function parseAccounts(value: unknown): Readonly<Record<string, JmapSessionAccount>> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([accountId, entry]) => {
        const parsed = parseSessionAccount(accountId, entry);
        return parsed === null ? null : [accountId, parsed];
      })
      .filter((entry): entry is [string, JmapSessionAccount] => entry !== null),
  );
}

function createUrlRegistry(apiUrl: string, downloadUrl: string, uploadUrl: string, eventSourceUrl: string): JmapUrlRegistry {
  return {
    api: { discoveredUrl: apiUrl, proxyPath: '/api/jmap', requiresProxy: false },
    download: { discoveredUrl: downloadUrl, proxyPath: '/api/jmap/download/{accountId}/{blobId}', requiresProxy: true },
    eventSource: { discoveredUrl: eventSourceUrl, proxyPath: null, requiresProxy: true },
    upload: { discoveredUrl: uploadUrl, proxyPath: null, requiresProxy: true },
  };
}

export function parseJmapSessionResource(value: unknown): JmapSessionResource | null {
  if (!isRecord(value)) {
    return null;
  }

  const username = readString(value.username);
  const apiUrl = readString(value.apiUrl);
  const downloadUrl = readString(value.downloadUrl);
  const uploadUrl = readString(value.uploadUrl);
  const eventSourceUrl = readString(value.eventSourceUrl);
  const state = readString(value.state);

  if (username === null || apiUrl === null || downloadUrl === null || uploadUrl === null || eventSourceUrl === null || state === null) {
    return null;
  }

  return {
    accounts: parseAccounts(value.accounts),
    apiUrl,
    capabilities: parseSessionCapabilityRegistry(value.capabilities),
    downloadUrl,
    eventSourceUrl,
    primaryAccounts: parsePrimaryAccounts(value.primaryAccounts),
    state,
    uploadUrl,
    urls: createUrlRegistry(apiUrl, downloadUrl, uploadUrl, eventSourceUrl),
    username,
  };
}

export async function loadJmapSession(fetchImplementation: typeof fetch = fetch): Promise<JmapBootstrapResult> {
  const response = await fetchImplementation(JMAP_SESSION_ENDPOINT, {
    credentials: 'include',
    headers: { accept: 'application/json' },
    method: 'GET',
  });

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw createTransportError(response.status, 'JMAP Session 返回了无法识别的响应。');
  }

  if (response.status === 401) {
    return { session: null, status: 'unauthenticated' };
  }

  if (!response.ok) {
    throw createTransportError(response.status, readErrorMessage(payload, 'JMAP Session 暂时不可用。'));
  }

  const session = parseJmapSessionResource(payload);

  if (!session) {
    throw createTransportError(502, 'JMAP Session 响应缺少必要字段。');
  }

  if (!session.capabilities.core.supported) {
    throw createTransportError(502, 'JMAP Session 缺少 core capability。');
  }

  return { session, status: 'ready' };
}

function replaceUrlToken(template: string, token: string, value: string) {
  return template.replace(new RegExp(`\\{${token}\\}`, 'g'), encodeURIComponent(value));
}

export function buildBlobDownloadUrl(template: string, accountId: string, blobId: string, options?: { name?: string | null; type?: string | null }) {
  const withAccount = replaceUrlToken(template, 'accountId', accountId);
  const withBlob = replaceUrlToken(withAccount, 'blobId', blobId);
  const withType = replaceUrlToken(withBlob, 'type', options?.type ?? 'application/octet-stream');
  return replaceUrlToken(withType, 'name', options?.name ?? 'blob');
}

export function buildBlobProxyPath(
  accountId: string,
  blobId: string,
  options?: {
    download?: boolean;
    name?: string | null;
    type?: string | null;
  },
) {
  const params = new URLSearchParams();

  if (options?.name) {
    params.set('name', options.name);
  }

  if (options?.type) {
    params.set('type', options.type);
  }

  if (options?.download) {
    params.set('download', '1');
  }

  const query = params.toString();
  const pathname = `/api/jmap/download/${encodeURIComponent(accountId)}/${encodeURIComponent(blobId)}`;
  return query.length > 0 ? `${pathname}?${query}` : pathname;
}
