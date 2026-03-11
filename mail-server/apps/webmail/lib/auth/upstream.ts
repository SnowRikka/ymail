const DEFAULT_STALWART_BASE_URL = 'http://127.0.0.1:8080';

import { parseJmapSessionResource } from '@/lib/jmap/session';
import type { JmapSessionResource } from '@/lib/jmap/types';

type VerifyCredentialsResult =
  | {
      accountCount: number;
      authorizationHeader: string;
      jmap: JmapSessionResource;
      ok: true;
      username: string;
    }
  | {
      message: string;
      ok: false;
      status: number;
    };

function getStalwartBaseUrl() {
  return process.env.WEBMAIL_STALWART_BASE_URL ?? process.env.STALWART_BASE_URL ?? DEFAULT_STALWART_BASE_URL;
}

function toUpstreamUrl(pathname: string) {
  return new URL(pathname, `${getStalwartBaseUrl().replace(/\/+$/, '')}/`).toString();
}

function buildBasicAuthorization(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

type UpstreamJmapSessionResult =
  | {
      authorizationHeader: string;
      jmap: JmapSessionResource;
      ok: true;
    }
  | {
      message: string;
      ok: false;
      status: number;
      unauthorized: boolean;
    };

export async function fetchUpstreamJmapSession(authorizationHeader: string): Promise<UpstreamJmapSessionResult> {
  let response: Response;

  try {
    response = await fetch(toUpstreamUrl('/jmap/session'), {
      headers: {
        accept: 'application/json',
        authorization: authorizationHeader,
      },
      method: 'GET',
    });
  } catch {
    return {
      message: '暂时无法连接邮箱服务，请稍后重试。',
      ok: false,
      status: 502,
      unauthorized: false,
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      message: '邮箱地址或密码不正确，请重新输入。',
      ok: false,
      status: 401,
      unauthorized: true,
    };
  }

  if (!response.ok) {
    return {
      message: '邮箱服务暂时不可用，请稍后再试。',
      ok: false,
      status: 502,
      unauthorized: false,
    };
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    return {
      message: '邮箱服务返回了无法识别的响应。',
      ok: false,
      status: 502,
      unauthorized: false,
    };
  }

  const jmap = parseJmapSessionResource(payload);

  if (!jmap) {
    return {
      message: '邮箱服务返回了不完整的会话信息。',
      ok: false,
      status: 502,
      unauthorized: false,
    };
  }

  return {
    authorizationHeader,
    jmap,
    ok: true,
  };
}

export async function verifyUpstreamCredentials(username: string, password: string): Promise<VerifyCredentialsResult> {
  const authorizationHeader = buildBasicAuthorization(username, password);

  const sessionResult = await fetchUpstreamJmapSession(authorizationHeader);

  if (!sessionResult.ok) {
    return {
      message: sessionResult.message,
      ok: false,
      status: sessionResult.status,
    };
  }

  return {
    accountCount: Object.keys(sessionResult.jmap.accounts).length,
    authorizationHeader,
    jmap: sessionResult.jmap,
    ok: true,
    username: sessionResult.jmap.username,
  };
}

export function getUpstreamJmapUrl() {
  return toUpstreamUrl('/jmap');
}
