export interface SanitizeHtmlOptions {
  readonly allowRemoteImages?: boolean;
  readonly cidMap?: Readonly<Record<string, string>>;
}

export interface SanitizedHtmlResult {
  readonly blockedRemoteImages: number;
  readonly html: string;
}

const BLOCKED_IMAGE_LABEL = '[已拦截远程图片]';
const DISALLOWED_TAGS = new Set(['applet', 'audio', 'base', 'button', 'embed', 'fieldset', 'form', 'frame', 'frameset', 'iframe', 'input', 'link', 'meta', 'object', 'script', 'select', 'style', 'textarea', 'video']);
const URL_ATTRIBUTES = new Set(['action', 'formaction', 'href', 'poster', 'src', 'xlink:href']);
const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=';

function normalizeCid(value: string) {
  return value.replace(/^cid:/i, '').replace(/^<|>$/g, '').trim();
}

function isSafeAnchorProtocol(url: URL) {
  return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol);
}

function isSafeImageProtocol(url: URL) {
  return ['data:', 'http:', 'https:'].includes(url.protocol);
}

function isPotentiallyRemoteImage(rawValue: string) {
  return /^https?:/i.test(rawValue) || rawValue.startsWith('//');
}

function toAbsoluteUrl(rawValue: string) {
  return new URL(rawValue, 'https://sanitizer.local');
}

export function sanitizeHtml(input: string, options: SanitizeHtmlOptions = {}): SanitizedHtmlResult {
  const parser = new DOMParser();
  const document = parser.parseFromString(input, 'text/html');
  let blockedRemoteImages = 0;

  const visit = (node: Element) => {
    const tagName = node.tagName.toLowerCase();

    if (DISALLOWED_TAGS.has(tagName)) {
      node.remove();
      return;
    }

    for (const attribute of [...node.attributes]) {
      const attributeName = attribute.name.toLowerCase();
      const rawValue = attribute.value.trim();

      if (attributeName.startsWith('on') || attributeName === 'style' || attributeName === 'srcset') {
        node.removeAttribute(attribute.name);
        continue;
      }

      if (!URL_ATTRIBUTES.has(attributeName)) {
        continue;
      }

      if (tagName === 'img' && attributeName === 'src' && rawValue.toLowerCase().startsWith('cid:')) {
        const cidUrl = options.cidMap?.[normalizeCid(rawValue)];

        if (cidUrl) {
          node.setAttribute('src', cidUrl);
        } else {
          node.removeAttribute('src');
        }

        continue;
      }

      let parsedUrl: URL;

      try {
        parsedUrl = toAbsoluteUrl(rawValue);
      } catch {
        node.removeAttribute(attribute.name);
        continue;
      }

      if (tagName === 'img' && attributeName === 'src') {
        if (!isSafeImageProtocol(parsedUrl)) {
          node.removeAttribute(attribute.name);
          continue;
        }

        if (!options.allowRemoteImages && isPotentiallyRemoteImage(rawValue)) {
          blockedRemoteImages += 1;
          node.setAttribute('alt', node.getAttribute('alt') || BLOCKED_IMAGE_LABEL);
          node.setAttribute('data-remote-image-blocked', 'true');
          node.setAttribute('data-remote-image-src', rawValue);
          node.setAttribute('src', TRANSPARENT_PIXEL);
        }

        continue;
      }

      if (!isSafeAnchorProtocol(parsedUrl)) {
        node.removeAttribute(attribute.name);
        continue;
      }

      if (tagName === 'a' && attributeName === 'href') {
        node.setAttribute('rel', 'noopener noreferrer nofollow');
      }
    }

    for (const child of [...node.children]) {
      visit(child);
    }
  };

  for (const child of [...document.body.children]) {
    visit(child);
  }

  return {
    blockedRemoteImages,
    html: document.body.innerHTML,
  };
}
