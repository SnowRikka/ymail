import { createCapabilityError } from '@/lib/jmap/errors';
import { JMAP_CAPABILITY_URNS, type JmapAccountCapabilityKey, type JmapAccountSelectionResult, type JmapMethodCapability, type JmapMethodName, type JmapSessionAccount, type JmapSessionCapabilityKey, type JmapSessionResource } from '@/lib/jmap/types';

export const JMAP_METHOD_CAPABILITIES = {
  'Email/get': 'mail',
  'Email/query': 'mail',
  'Email/queryChanges': 'mail',
  'Email/set': 'mail',
  'EmailSubmission/set': 'submission',
  'Identity/get': 'mail',
  'Mailbox/changes': 'mail',
  'Mailbox/get': 'mail',
  'Mailbox/query': 'mail',
  'Thread/changes': 'mail',
  'Thread/get': 'mail',
} as const satisfies Record<JmapMethodName, JmapAccountCapabilityKey>;

export function getCapabilityUrn(key: JmapSessionCapabilityKey) {
  return JMAP_CAPABILITY_URNS[key];
}

export function getMethodCapability<Name extends JmapMethodName>(name: Name): JmapMethodCapability<Name> {
  return JMAP_METHOD_CAPABILITIES[name];
}

export function supportsSessionCapability(session: JmapSessionResource, capability: JmapSessionCapabilityKey) {
  return session.capabilities[capability].supported;
}

export function supportsAccountCapability(account: JmapSessionAccount, capability: JmapAccountCapabilityKey) {
  return account.accountCapabilities[capability].supported;
}

export function selectAccountForCapability(
  session: JmapSessionResource,
  capability: JmapAccountCapabilityKey,
  preferredAccountId?: string,
): JmapAccountSelectionResult {
  const accounts = Object.values(session.accounts);

  if (preferredAccountId) {
    const preferred = session.accounts[preferredAccountId];

    if (!preferred) {
      return { error: createCapabilityError(capability, 'account-not-found', preferredAccountId), ok: false };
    }

    if (!supportsAccountCapability(preferred, capability)) {
      return { error: createCapabilityError(capability, 'missing-capability', preferred.id), ok: false };
    }

    return { account: preferred, ok: true };
  }

  const primaryAccountId = session.primaryAccounts[capability];
  const primaryAccount = primaryAccountId ? session.accounts[primaryAccountId] : null;

  if (primaryAccount && supportsAccountCapability(primaryAccount, capability)) {
    return { account: primaryAccount, ok: true };
  }

  const fallback = accounts.find((account) => supportsAccountCapability(account, capability));
  return fallback ? { account: fallback, ok: true } : { error: createCapabilityError(capability, 'missing-capability', null), ok: false };
}
