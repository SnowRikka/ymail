export const JMAP_CAPABILITY_URNS = {
  blob: 'urn:ietf:params:jmap:blob',
  core: 'urn:ietf:params:jmap:core',
  mail: 'urn:ietf:params:jmap:mail',
  quota: 'urn:ietf:params:jmap:quota',
  sieve: 'urn:ietf:params:jmap:sieve',
  submission: 'urn:ietf:params:jmap:submission',
  websocket: 'urn:ietf:params:jmap:websocket',
} as const;

export type JmapSessionCapabilityKey = keyof typeof JMAP_CAPABILITY_URNS;
export type JmapAccountCapabilityKey = Exclude<JmapSessionCapabilityKey, 'core' | 'websocket'>;
export type JmapCapabilityUrn = (typeof JMAP_CAPABILITY_URNS)[JmapSessionCapabilityKey];

export type JmapJsonPrimitive = boolean | number | string | null;
export type JmapJsonValue = JmapJsonPrimitive | readonly JmapJsonValue[] | JmapJsonObject;
export interface JmapJsonObject {
  readonly [key: string]: JmapJsonValue | undefined;
}

export type JmapMethodName =
  | 'Mailbox/get'
  | 'Mailbox/query'
  | 'Mailbox/changes'
  | 'Thread/get'
  | 'Thread/changes'
  | 'Email/get'
  | 'Email/query'
  | 'Email/queryChanges'
  | 'Email/set'
  | 'Identity/get'
  | 'EmailSubmission/set';

export type JmapMethodCapabilityMap = {
  'Email/get': 'mail';
  'Email/query': 'mail';
  'Email/queryChanges': 'mail';
  'Email/set': 'mail';
  'EmailSubmission/set': 'submission';
  'Identity/get': 'mail';
  'Mailbox/changes': 'mail';
  'Mailbox/get': 'mail';
  'Mailbox/query': 'mail';
  'Thread/changes': 'mail';
  'Thread/get': 'mail';
};

export type JmapMethodCapability<Name extends JmapMethodName> = JmapMethodCapabilityMap[Name];

export interface JmapCoreCapabilities {
  readonly collationAlgorithms: readonly string[];
  readonly maxCallsInRequest: number;
  readonly maxConcurrentRequests: number;
  readonly maxConcurrentUpload: number;
  readonly maxObjectsInGet: number;
  readonly maxObjectsInSet: number;
  readonly maxSizeRequest: number;
  readonly maxSizeUpload: number;
}

export interface JmapMailCapabilities {
  readonly emailQuerySortOptions: readonly string[];
  readonly maxMailboxDepth: number;
  readonly maxMailboxesPerEmail: number | null;
  readonly maxSizeAttachmentsPerEmail: number;
  readonly maxSizeMailboxName: number;
  readonly mayCreateTopLevelMailbox: boolean;
}

export interface JmapSubmissionCapabilities {
  readonly maxDelayedSend: number;
  readonly submissionExtensions: Readonly<Record<string, readonly string[]>>;
}

export interface JmapBlobCapabilities {
  readonly maxDataSources: number;
  readonly maxSizeBlobSet: number;
  readonly supportedDigestAlgorithms: readonly string[];
  readonly supportedTypeNames: readonly string[];
}

export interface JmapWebSocketCapabilities {
  readonly supportsPush: boolean;
  readonly url: string;
}

export interface JmapQuotaCapabilities {
  readonly kind: 'quota';
}

export interface JmapSieveCapabilities {
  readonly implementation: string | null;
}

export interface JmapEmptyCapabilities {
  readonly kind: 'empty';
}

export type JmapCapabilityValueMap = {
  blob: JmapBlobCapabilities;
  core: JmapCoreCapabilities;
  mail: JmapMailCapabilities;
  quota: JmapQuotaCapabilities | JmapEmptyCapabilities;
  sieve: JmapSieveCapabilities | JmapEmptyCapabilities;
  submission: JmapSubmissionCapabilities;
  websocket: JmapWebSocketCapabilities;
};

export type JmapCapabilityValue<Key extends JmapSessionCapabilityKey> = JmapCapabilityValueMap[Key];

export type JmapCapabilityState<Key extends JmapSessionCapabilityKey> =
  | {
      readonly key: Key;
      readonly supported: false;
      readonly urn: (typeof JMAP_CAPABILITY_URNS)[Key];
      readonly value: null;
    }
  | {
      readonly key: Key;
      readonly supported: true;
      readonly urn: (typeof JMAP_CAPABILITY_URNS)[Key];
      readonly value: JmapCapabilityValue<Key>;
    };

export type JmapSessionCapabilityRegistry = Readonly<{
  blob: JmapCapabilityState<'blob'>;
  core: JmapCapabilityState<'core'>;
  mail: JmapCapabilityState<'mail'>;
  quota: JmapCapabilityState<'quota'>;
  sieve: JmapCapabilityState<'sieve'>;
  submission: JmapCapabilityState<'submission'>;
  websocket: JmapCapabilityState<'websocket'>;
}>;

export type JmapAccountCapabilityRegistry = Readonly<{
  blob: JmapCapabilityState<'blob'>;
  mail: JmapCapabilityState<'mail'>;
  quota: JmapCapabilityState<'quota'>;
  sieve: JmapCapabilityState<'sieve'>;
  submission: JmapCapabilityState<'submission'>;
}>;

export type JmapPrimaryAccountRegistry = Readonly<{
  blob: string | null;
  mail: string | null;
  quota: string | null;
  sieve: string | null;
  submission: string | null;
}>;

export interface JmapSessionAccount {
  readonly accountCapabilities: JmapAccountCapabilityRegistry;
  readonly id: string;
  readonly isPersonal: boolean;
  readonly isReadOnly: boolean;
  readonly name: string;
}

export interface JmapUrlRegistryEntry {
  readonly discoveredUrl: string;
  readonly proxyPath: string | null;
  readonly requiresProxy: boolean;
}

export interface JmapUrlRegistry {
  readonly api: JmapUrlRegistryEntry;
  readonly download: JmapUrlRegistryEntry;
  readonly eventSource: JmapUrlRegistryEntry;
  readonly upload: JmapUrlRegistryEntry;
}

export interface JmapSessionResource {
  readonly accounts: Readonly<Record<string, JmapSessionAccount>>;
  readonly apiUrl: string;
  readonly capabilities: JmapSessionCapabilityRegistry;
  readonly downloadUrl: string;
  readonly eventSourceUrl: string;
  readonly primaryAccounts: JmapPrimaryAccountRegistry;
  readonly state: string;
  readonly uploadUrl: string;
  readonly urls: JmapUrlRegistry;
  readonly username: string;
}

export type JmapBootstrapResult =
  | {
      readonly session: null;
      readonly status: 'unauthenticated';
    }
  | {
      readonly session: JmapSessionResource;
      readonly status: 'ready';
    };

export interface JmapBlobUploadAccess {
  readonly capability: JmapCapabilityState<'blob'>;
  readonly kind: 'blob-upload';
  readonly requiresBffProxy: true;
  readonly status: 'available' | 'unsupported';
  readonly upstreamUrl: string | null;
}

export interface JmapBlobDownloadAccess {
  readonly accountId: string;
  readonly blobId: string;
  readonly capability: JmapCapabilityState<'blob'>;
  readonly kind: 'blob-download';
  readonly name: string | null;
  readonly requiresBffProxy: true;
  readonly status: 'available' | 'unsupported';
  readonly type: string | null;
  readonly upstreamUrl: string | null;
}

export interface JmapRealtimeAccess {
  readonly capability: JmapCapabilityState<'websocket'>;
  readonly eventSourceUrl: string;
  readonly kind: 'realtime';
  readonly mode: 'event-source' | 'none' | 'websocket';
  readonly websocketUrl: string | null;
}

export type JmapPropertyName = string;
export type JmapObjectId = string;
export type JmapPatchObject = JmapJsonObject;

export interface JmapGetRequest {
  readonly accountId: string;
  readonly ids?: readonly JmapObjectId[] | null;
  readonly properties?: readonly JmapPropertyName[];
}

export interface JmapEmailGetRequest extends JmapGetRequest {
  readonly bodyProperties?: readonly JmapPropertyName[];
  readonly fetchAllBodyValues?: boolean;
  readonly fetchHTMLBodyValues?: boolean;
  readonly fetchTextBodyValues?: boolean;
  readonly maxBodyValueBytes?: number;
}

export interface JmapChangesRequest {
  readonly accountId: string;
  readonly maxChanges?: number;
  readonly sinceState: string;
}

export interface JmapQuerySort {
  readonly isAscending?: boolean;
  readonly property: string;
}

export interface JmapMailboxFilterCondition {
  readonly hasAnyRole?: boolean;
  readonly id?: string;
  readonly isSubscribed?: boolean;
  readonly name?: string;
  readonly operator?: 'AND' | 'NOT' | 'OR';
  readonly parentId?: string | null;
  readonly role?: string;
  readonly conditions?: readonly JmapMailboxFilterCondition[];
}

export interface JmapEmailFilterCondition {
  readonly after?: string;
  readonly before?: string;
  readonly hasAttachment?: boolean;
  readonly id?: string;
  readonly inMailbox?: string;
  readonly keyword?: string;
  readonly notKeyword?: string;
  readonly operator?: 'AND' | 'NOT' | 'OR';
  readonly text?: string;
  readonly threadKeyword?: string;
  readonly from?: string;
  readonly to?: string;
  readonly cc?: string;
  readonly bcc?: string;
  readonly subject?: string;
  readonly body?: string;
  readonly conditions?: readonly JmapEmailFilterCondition[];
}

export interface JmapQueryRequest<Filter> {
  readonly accountId: string;
  readonly calculateTotal?: boolean;
  readonly filter?: Filter;
  readonly limit?: number;
  readonly position?: number;
  readonly sort?: readonly JmapQuerySort[];
}

export interface JmapQueryChangesRequest<Filter> {
  readonly accountId: string;
  readonly filter?: Filter;
  readonly maxChanges?: number;
  readonly sinceQueryState: string;
  readonly sort?: readonly JmapQuerySort[];
  readonly upToId?: string | null;
}

export interface JmapSetRequest<CreateObject extends JmapJsonObject, UpdatePatch extends JmapPatchObject> {
  readonly accountId: string;
  readonly create?: Readonly<Record<string, CreateObject>>;
  readonly destroy?: readonly JmapObjectId[];
  readonly ifInState?: string;
  readonly update?: Readonly<Record<JmapObjectId, UpdatePatch>>;
}

export type JmapEmailAddress = JmapJsonObject & {
  readonly email?: string;
  readonly name?: string;
};

export type JmapEmailBodyPart = JmapJsonObject & {
  readonly blobId?: string;
  readonly cid?: string | null;
  readonly disposition?: string | null;
  readonly language?: readonly string[];
  readonly location?: string | null;
  readonly name?: string;
  readonly partId?: string;
  readonly size?: number;
  readonly subParts?: readonly JmapEmailBodyPart[];
  readonly type?: string;
};

export type JmapEmailBodyValue = JmapJsonObject & {
  readonly isEncodingProblem?: boolean;
  readonly isTruncated?: boolean;
  readonly value?: string;
};

export type JmapMailboxObject = JmapJsonObject & {
  readonly id: string;
  readonly isSubscribed?: boolean;
  readonly myRights?: JmapJsonObject;
  readonly name?: string;
  readonly parentId?: string | null;
  readonly role?: string | null;
  readonly sortOrder?: number;
  readonly totalEmails?: number;
  readonly totalThreads?: number;
  readonly unreadEmails?: number;
  readonly unreadThreads?: number;
};

export type JmapThreadObject = JmapJsonObject & {
  readonly emailIds?: readonly string[];
  readonly id: string;
};

export type JmapEmailObject = JmapJsonObject & {
  readonly attachments?: readonly JmapEmailBodyPart[];
  readonly blobId?: string;
  readonly bcc?: readonly JmapEmailAddress[];
  readonly bodyValues?: Readonly<Record<string, JmapEmailBodyValue>>;
  readonly cc?: readonly JmapEmailAddress[];
  readonly from?: readonly JmapEmailAddress[];
  readonly hasAttachment?: boolean;
  readonly htmlBody?: readonly JmapEmailBodyPart[];
  readonly id: string;
  readonly keywords?: Readonly<Record<string, boolean>>;
  readonly mailboxIds?: Readonly<Record<string, boolean>>;
  readonly preview?: string;
  readonly receivedAt?: string;
  readonly replyTo?: readonly JmapEmailAddress[];
  readonly sender?: readonly JmapEmailAddress[];
  readonly sentAt?: string;
  readonly subject?: string;
  readonly textBody?: readonly JmapEmailBodyPart[];
  readonly threadId?: string;
  readonly to?: readonly JmapEmailAddress[];
};

export type JmapEmailCreateObject = JmapJsonObject & {
  readonly attachments?: readonly JmapEmailBodyPart[];
  readonly bcc?: readonly JmapEmailAddress[];
  readonly bodyValues?: Readonly<Record<string, JmapEmailBodyValue>>;
  readonly cc?: readonly JmapEmailAddress[];
  readonly from?: readonly JmapEmailAddress[];
  readonly htmlBody?: readonly JmapEmailBodyPart[];
  readonly keywords?: Readonly<Record<string, boolean>>;
  readonly mailboxIds?: Readonly<Record<string, boolean>>;
  readonly receivedAt?: string;
  readonly replyTo?: readonly JmapEmailAddress[];
  readonly sender?: readonly JmapEmailAddress[];
  readonly sentAt?: string;
  readonly subject?: string;
  readonly textBody?: readonly JmapEmailBodyPart[];
  readonly to?: readonly JmapEmailAddress[];
};

export type JmapIdentityObject = JmapJsonObject & {
  readonly bcc?: readonly JmapEmailAddress[];
  readonly email?: string;
  readonly htmlSignature?: string;
  readonly id: string;
  readonly name?: string;
  readonly replyTo?: readonly JmapEmailAddress[];
  readonly textSignature?: string;
};

export type JmapEmailSubmissionObject = JmapJsonObject & {
  readonly emailId?: string;
  readonly id?: string;
  readonly identityId?: string;
  readonly undoStatus?: string;
};

export interface JmapGetResponse<ObjectType extends JmapJsonObject> {
  readonly accountId: string;
  readonly list: readonly ObjectType[];
  readonly notFound?: readonly string[];
  readonly state: string;
}

export interface JmapChangesResponse {
  readonly accountId: string;
  readonly created?: readonly string[];
  readonly destroyed?: readonly string[];
  readonly hasMoreChanges: boolean;
  readonly newState: string;
  readonly oldState: string;
  readonly updated?: readonly string[];
}

export interface JmapQueryResponse {
  readonly accountId: string;
  readonly canCalculateChanges: boolean;
  readonly ids: readonly string[];
  readonly position: number;
  readonly queryState: string;
  readonly total?: number;
}

export interface JmapQueryChangesAddedItem {
  readonly id: string;
  readonly index: number;
}

export interface JmapQueryChangesResponse {
  readonly accountId: string;
  readonly added: readonly JmapQueryChangesAddedItem[];
  readonly newQueryState: string;
  readonly oldQueryState: string;
  readonly removed: readonly string[];
  readonly total: number;
}

export interface JmapSetInvocationError extends JmapJsonObject {
  readonly description?: string;
  readonly type?: string;
}

export interface JmapSetResponse<ObjectType extends JmapJsonObject> {
  readonly accountId: string;
  readonly created?: Readonly<Record<string, ObjectType>>;
  readonly destroyed?: readonly string[];
  readonly newState: string;
  readonly notCreated?: Readonly<Record<string, JmapSetInvocationError>>;
  readonly notDestroyed?: Readonly<Record<string, JmapSetInvocationError>>;
  readonly notUpdated?: Readonly<Record<string, JmapSetInvocationError>>;
  readonly oldState?: string;
  readonly updated?: Readonly<Record<string, ObjectType | null>>;
}

export interface JmapEmailSubmissionSetRequest extends JmapSetRequest<JmapEmailSubmissionObject, JmapPatchObject> {
  readonly onSuccessDestroyEmail?: readonly string[];
  readonly onSuccessUpdateEmail?: Readonly<Record<string, JmapPatchObject>>;
}

export interface JmapMethodContractMap {
  'Email/get': {
    readonly request: JmapEmailGetRequest;
    readonly response: JmapGetResponse<JmapEmailObject>;
  };
  'Email/query': {
    readonly request: JmapQueryRequest<JmapEmailFilterCondition>;
    readonly response: JmapQueryResponse;
  };
  'Email/queryChanges': {
    readonly request: JmapQueryChangesRequest<JmapEmailFilterCondition>;
    readonly response: JmapQueryChangesResponse;
  };
  'Email/set': {
    readonly request: JmapSetRequest<JmapEmailCreateObject, JmapPatchObject>;
    readonly response: JmapSetResponse<JmapEmailObject>;
  };
  'EmailSubmission/set': {
    readonly request: JmapEmailSubmissionSetRequest;
    readonly response: JmapSetResponse<JmapEmailSubmissionObject>;
  };
  'Identity/get': {
    readonly request: JmapGetRequest;
    readonly response: JmapGetResponse<JmapIdentityObject>;
  };
  'Mailbox/changes': {
    readonly request: JmapChangesRequest;
    readonly response: JmapChangesResponse;
  };
  'Mailbox/get': {
    readonly request: JmapGetRequest;
    readonly response: JmapGetResponse<JmapMailboxObject>;
  };
  'Mailbox/query': {
    readonly request: JmapQueryRequest<JmapMailboxFilterCondition>;
    readonly response: JmapQueryResponse;
  };
  'Thread/changes': {
    readonly request: JmapChangesRequest;
    readonly response: JmapChangesResponse;
  };
  'Thread/get': {
    readonly request: JmapGetRequest;
    readonly response: JmapGetResponse<JmapThreadObject>;
  };
}

export type JmapMethodRequest<Name extends JmapMethodName> = JmapMethodContractMap[Name]['request'];
export type JmapMethodResponse<Name extends JmapMethodName> = JmapMethodContractMap[Name]['response'];

export interface JmapMethodCall<Name extends JmapMethodName = JmapMethodName> {
  readonly accountId?: string;
  readonly callId: string;
  readonly name: Name;
  readonly request: JmapMethodRequest<Name>;
}

export interface JmapMethodError extends JmapJsonObject {
  readonly description?: string;
  readonly type?: string;
}

export interface JmapMethodSuccess<Name extends JmapMethodName = JmapMethodName> {
  readonly accountId: string;
  readonly callId: string;
  readonly kind: 'success';
  readonly name: Name;
  readonly response: JmapMethodResponse<Name>;
}

export interface JmapMethodFailure<Name extends JmapMethodName = JmapMethodName> {
  readonly accountId: string;
  readonly callId: string;
  readonly error: JmapMethodError;
  readonly kind: 'method-error';
  readonly name: Name;
}

export type JmapMethodResult<Name extends JmapMethodName = JmapMethodName> = JmapMethodFailure<Name> | JmapMethodSuccess<Name>;

export interface JmapTransportError extends JmapJsonObject {
  readonly kind: 'transport';
  readonly message: string;
  readonly status: number;
}

export interface JmapUnauthenticatedError {
  readonly kind: 'unauthenticated';
  readonly message: string;
}

export interface JmapCapabilityError {
  readonly accountId: string | null;
  readonly capability: JmapAccountCapabilityKey;
  readonly kind: 'capability';
  readonly message: string;
  readonly reason: 'account-not-found' | 'missing-capability';
}

export type JmapExecutionError = JmapCapabilityError | JmapTransportError | JmapUnauthenticatedError;

export type JmapBatchResult =
  | {
      readonly createdIds: Readonly<Record<string, string>>;
      readonly ok: true;
      readonly responses: readonly JmapMethodResult[];
      readonly session: JmapSessionResource;
      readonly sessionState: string;
    }
  | {
      readonly error: JmapExecutionError;
      readonly ok: false;
    };

export type JmapSingleMethodResult<Name extends JmapMethodName> =
  | {
      readonly ok: true;
      readonly result: JmapMethodResult<Name>;
      readonly session: JmapSessionResource;
    }
  | {
      readonly error: JmapExecutionError;
      readonly ok: false;
    };

export type JmapAccountSelectionResult =
  | {
      readonly account: JmapSessionAccount;
      readonly ok: true;
    }
  | {
      readonly error: JmapCapabilityError;
      readonly ok: false;
    };

export interface JmapClient {
  readonly blob: {
    downloadAccess: (input: { accountId?: string; blobId: string; name?: string | null; type?: string | null }) => Promise<JmapBlobDownloadAccess | JmapExecutionError>;
    uploadAccess: (preferredAccountId?: string) => Promise<JmapBlobUploadAccess | JmapExecutionError>;
  };
  readonly bootstrap: () => Promise<JmapBootstrapResult>;
  readonly call: (calls: readonly JmapMethodCall[]) => Promise<JmapBatchResult>;
  readonly email: {
    get: (request: Omit<JmapEmailGetRequest, 'accountId'> & { accountId?: string }) => Promise<JmapSingleMethodResult<'Email/get'>>;
    query: (request: Omit<JmapQueryRequest<JmapEmailFilterCondition>, 'accountId'> & { accountId?: string }) => Promise<JmapSingleMethodResult<'Email/query'>>;
    queryChanges: (request: Omit<JmapQueryChangesRequest<JmapEmailFilterCondition>, 'accountId'> & { accountId?: string }) => Promise<JmapSingleMethodResult<'Email/queryChanges'>>;
    set: (request: Omit<JmapSetRequest<JmapEmailCreateObject, JmapPatchObject>, 'accountId'> & { accountId?: string }) => Promise<JmapSingleMethodResult<'Email/set'>>;
  };
  readonly identity: {
    get: (request?: Omit<JmapGetRequest, 'accountId'> & { accountId?: string }) => Promise<JmapSingleMethodResult<'Identity/get'>>;
  };
  readonly mailbox: {
    changes: (request: Omit<JmapChangesRequest, 'accountId'> & { accountId?: string }) => Promise<JmapSingleMethodResult<'Mailbox/changes'>>;
    get: (request?: Omit<JmapGetRequest, 'accountId'> & { accountId?: string }) => Promise<JmapSingleMethodResult<'Mailbox/get'>>;
    query: (request?: Omit<JmapQueryRequest<JmapMailboxFilterCondition>, 'accountId'> & { accountId?: string }) => Promise<JmapSingleMethodResult<'Mailbox/query'>>;
  };
  readonly reset: () => void;
  readonly selectAccount: (capability: JmapAccountCapabilityKey, preferredAccountId?: string) => Promise<JmapAccountSelectionResult | JmapExecutionError>;
  readonly submission: {
    set: (request: Omit<JmapEmailSubmissionSetRequest, 'accountId'> & { accountId?: string }) => Promise<JmapSingleMethodResult<'EmailSubmission/set'>>;
  };
  readonly thread: {
    changes: (request: Omit<JmapChangesRequest, 'accountId'> & { accountId?: string }) => Promise<JmapSingleMethodResult<'Thread/changes'>>;
    get: (request?: Omit<JmapGetRequest, 'accountId'> & { accountId?: string }) => Promise<JmapSingleMethodResult<'Thread/get'>>;
  };
}
