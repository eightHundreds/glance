export const DEFAULT_DOM_CAPTURE_TIMEOUT_MS = 12000;
export const DEFAULT_PREVIEW_LOAD_TIMEOUT_MS = 2000;

export const DOM_CAPTURE_CHANNEL = 'glance-dom-capture';
export const DOM_CAPTURE_REQUEST = 'request';
export const DOM_CAPTURE_RESPONSE = 'response';

export type DomCaptureRequestMessage = {
  channel: typeof DOM_CAPTURE_CHANNEL;
  type: typeof DOM_CAPTURE_REQUEST;
  requestId: number;
  nonce: string;
};

export type DomCaptureResponseMessage = {
  channel: typeof DOM_CAPTURE_CHANNEL;
  type: typeof DOM_CAPTURE_RESPONSE;
  requestId: number;
  nonce: string;
  ok: boolean;
  html?: string;
  error?: string;
};

export type WaitForStableDomOptions = {
  signal?: AbortSignal;
  quietMs?: number;
  minWaitMs?: number;
  maxWaitMs?: number;
  debugLabel?: string;
};

const DEFAULT_QUIET_MS = 600;
const DEFAULT_MIN_WAIT_MS = 200;
const DEFAULT_MAX_WAIT_MS = 8000;

export function isDomCaptureRequest(data: unknown): data is DomCaptureRequestMessage {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const message = data as Partial<DomCaptureRequestMessage>;
  return message.channel === DOM_CAPTURE_CHANNEL
    && message.type === DOM_CAPTURE_REQUEST
    && typeof message.requestId === 'number'
    && typeof message.nonce === 'string';
}

export function isDomCaptureResponse(data: unknown): data is DomCaptureResponseMessage {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const message = data as Partial<DomCaptureResponseMessage>;
  if (message.channel !== DOM_CAPTURE_CHANNEL || message.type !== DOM_CAPTURE_RESPONSE) {
    return false;
  }
  if (typeof message.requestId !== 'number' || typeof message.nonce !== 'string') {
    return false;
  }
  if (typeof message.ok !== 'boolean') {
    return false;
  }
  if (message.ok) {
    return typeof message.html === 'string';
  }
  return typeof message.error === 'string';
}

export function captureDocumentHtml(): string {
  return document.documentElement.outerHTML;
}

export function isChallengePage(doc: Document): boolean {
  const title = doc.title.toLowerCase();
  const snippet = (doc.body?.innerText ?? '').slice(0, 800).toLowerCase();
  return (
    title.includes('just a moment')
    || snippet.includes('cf-challenge')
    || snippet.includes('challenge-platform')
    || snippet.includes('checking your browser')
  );
}

export async function waitForPreviewLoad(
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PREVIEW_LOAD_TIMEOUT_MS;
  const { signal } = options;

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  if (document.readyState === 'loading') {
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        document.removeEventListener('DOMContentLoaded', onReady);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const onReady = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      document.addEventListener('DOMContentLoaded', onReady, { once: true });
    });
  }

  if (document.readyState === 'complete') {
    return;
  }

  await Promise.race([
    new Promise<void>((resolve) => {
      window.addEventListener('load', () => resolve(), { once: true });
    }),
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, timeoutMs);
    })
  ]);
}

export function waitForStableDom(options: WaitForStableDomOptions = {}): Promise<void> {
  const quietMs = options.quietMs ?? DEFAULT_QUIET_MS;
  const minWaitMs = options.minWaitMs ?? DEFAULT_MIN_WAIT_MS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const debugLabel = options.debugLabel;
  const { signal } = options;

  if (signal?.aborted) {
    console.debug('[Glance][DOM_CAPTURE] wait aborted before start', { debugLabel });
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }

  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let mutationCount = 0;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    let maxTimer: ReturnType<typeof setTimeout> | undefined;
    let minTimer: ReturnType<typeof setTimeout> | undefined;
    let minElapsed = minWaitMs <= 0;
    let quietElapsed = false;
    let observer: MutationObserver | undefined;

    const cleanup = () => {
      observer?.disconnect();
      if (quietTimer !== undefined) {
        clearTimeout(quietTimer);
      }
      if (maxTimer !== undefined) {
        clearTimeout(maxTimer);
      }
      if (minTimer !== undefined) {
        clearTimeout(minTimer);
      }
      signal?.removeEventListener('abort', onAbort);
    };

    const finish = (reason: 'quiet' | 'maxWait') => {
      cleanup();
      console.debug('[Glance][DOM_CAPTURE] DOM stable wait finished', {
        debugLabel,
        reason,
        elapsedMs: Math.round(performance.now() - startedAt),
        mutationCount
      });
      resolve();
    };

    const onAbort = () => {
      cleanup();
      console.debug('[Glance][DOM_CAPTURE] DOM stable wait aborted', {
        debugLabel,
        elapsedMs: Math.round(performance.now() - startedAt),
        mutationCount
      });
      reject(new DOMException('Aborted', 'AbortError'));
    };

    const tryFinish = () => {
      if (minElapsed && quietElapsed) {
        finish('quiet');
      }
    };

    const scheduleQuietCheck = () => {
      quietElapsed = false;
      if (quietTimer !== undefined) {
        clearTimeout(quietTimer);
      }
      quietTimer = setTimeout(() => {
        quietElapsed = true;
        tryFinish();
      }, quietMs);
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    if (minWaitMs <= 0) {
      minElapsed = true;
    } else {
      minTimer = setTimeout(() => {
        minElapsed = true;
        console.debug('[Glance][DOM_CAPTURE] min wait elapsed', {
          debugLabel,
          elapsedMs: Math.round(performance.now() - startedAt),
          mutationCount
        });
        tryFinish();
      }, minWaitMs);
    }

    maxTimer = setTimeout(() => {
      quietElapsed = true;
      minElapsed = true;
      finish('maxWait');
    }, maxWaitMs);

    observer = new MutationObserver(() => {
      mutationCount += 1;
      if (mutationCount === 1 || mutationCount % 50 === 0) {
        console.debug('[Glance][DOM_CAPTURE] observed DOM mutation', {
          debugLabel,
          mutationCount,
          elapsedMs: Math.round(performance.now() - startedAt)
        });
      }
      scheduleQuietCheck();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });

    console.debug('[Glance][DOM_CAPTURE] DOM stable wait started', {
      debugLabel,
      quietMs,
      minWaitMs,
      maxWaitMs
    });
    scheduleQuietCheck();
  });
}
