import type { JmapMethodCall, JmapMethodName, JmapMethodRequest, JmapMethodResult } from '@/lib/jmap/types';

export const JMAP_METHOD_NAMES = {
  emailGet: 'Email/get',
  emailQuery: 'Email/query',
  emailQueryChanges: 'Email/queryChanges',
  emailSet: 'Email/set',
  emailSubmissionSet: 'EmailSubmission/set',
  identityGet: 'Identity/get',
  mailboxChanges: 'Mailbox/changes',
  mailboxGet: 'Mailbox/get',
  mailboxQuery: 'Mailbox/query',
  threadChanges: 'Thread/changes',
  threadGet: 'Thread/get',
} as const;

const JMAP_METHOD_NAME_SET = new Set<string>(Object.values(JMAP_METHOD_NAMES));

export function isJmapMethodName(value: string): value is JmapMethodName {
  return JMAP_METHOD_NAME_SET.has(value);
}

export function isJmapMethodResult<Name extends JmapMethodName>(value: JmapMethodResult, name: Name): value is JmapMethodResult<Name> {
  return value.name === name;
}

export function createMethodCall<Name extends JmapMethodName>(
  name: Name,
  request: Omit<JmapMethodRequest<Name>, 'accountId'> & { accountId?: string },
  callId: string,
): JmapMethodCall<Name> {
  return {
    accountId: request.accountId,
    callId,
    name,
    request: request as JmapMethodRequest<Name>,
  };
}
