import { DEFAULT_LOAD_TIMEOUT_MS } from './constants';

let requestSeq = 0;

export function loadDocumentHtml(url: string, signal: AbortSignal): Promise<string> {
  if (chrome.runtime?.id) {
    return fetchViaBackground(url, signal);
  }
  return fetchDirectly(url, signal);
}

function fetchViaBackground(url: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const requestId = ++requestSeq;

    const onAbort = () => {
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal.addEventListener('abort', onAbort, { once: true });

    chrome.runtime.sendMessage({ type: 'FETCH_DOCUMENT', url, requestId }, response => {
      signal.removeEventListener('abort', onAbort);

      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response || !response.ok) {
        reject(new Error(response?.error || 'FETCH_FAILED'));
        return;
      }

      resolve(rewriteHtml(response.body, response.finalUrl || url));
    });
  });
}

async function fetchDirectly(url: string, signal: AbortSignal): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_LOAD_TIMEOUT_MS);
  const combinedSignal = mergeAbortSignals(signal, controller.signal);

  try {
    const response = await fetch(url, {
      signal: combinedSignal,
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    return rewriteHtml(html, url);
  } finally {
    clearTimeout(timeoutId);
  }
}

function rewriteHtml(html: string, url: string) {
  const baseHref = computeBaseHref(url);
  const baseTag = `<base href="${escapeAttribute(baseHref)}">`;

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, match => `${match}\n${baseTag}`);
  }

  return `${baseTag}\n${html}`;
}

function computeBaseHref(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname.replace(/[^/]+$/, '')}`;
  } catch {
    return url;
  }
}

function escapeAttribute(value: string) {
  return value.replace(/"/g, '&quot;');
}

function mergeAbortSignals(...signals: AbortSignal[]) {
  if (signals.length === 1) {
    return signals[0];
  }

  const controller = new AbortController();

  const onAbort = () => {
    controller.abort();
    cleanup();
  };

  const cleanup = () => {
    signals.forEach(signal => signal.removeEventListener('abort', onAbort));
  };

  signals.forEach(signal => {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', onAbort);
    }
  });

  return controller.signal;
}
