import { DEFAULT_DOM_CAPTURE_TIMEOUT_MS } from './domCapture';
import {
  isPreviewCaptureProbe,
  isPreviewCaptureResult,
  isPreviewIframeReady,
  type PreviewCaptureResultMessage
} from '../shared/previewCapture';

const LOG_PREFIX = '[Glance][PREVIEW_CAPTURE]';

export class PreviewCaptureError extends Error {
  readonly isChallengePage: boolean;

  constructor(message: string, options: { isChallengePage?: boolean } = {}) {
    super(message);
    this.name = 'PreviewCaptureError';
    this.isChallengePage = options.isChallengePage ?? false;
  }
}

export function waitForPreviewCaptureResult(
  requestId: number,
  frame: HTMLIFrameElement,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DOM_CAPTURE_TIMEOUT_MS;
  const contentWindow = frame.contentWindow;

  return new Promise((resolve, reject) => {
    let settled = false;
    let iframeReady = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (settled) {
        return;
      }
      settled = true;
      window.removeEventListener('message', onPostMessage);
      chrome.runtime.onMessage.removeListener(onRuntimeMessage);
      options.signal?.removeEventListener('abort', onAbort);
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    };

    const finishError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const finishSuccess = (markdown: string) => {
      cleanup();
      resolve(markdown);
    };

    const onAbort = () => {
      finishError(new DOMException('Aborted', 'AbortError'));
    };

    const onPostMessage = (event: MessageEvent) => {
      if (event.source !== contentWindow) {
        return;
      }
      if (!isPreviewIframeReady(event.data) || event.data.requestId !== requestId) {
        return;
      }
      iframeReady = true;
      console.debug(`${LOG_PREFIX} parent received iframe-ready`, { requestId });
    };

    const onRuntimeMessage = (message: unknown) => {
      if (isPreviewCaptureProbe(message)) {
        const currentFrameSrc = frame.src;
        if (message.parsedRequestId === requestId || message.href === currentFrameSrc) {
          console.debug(`${LOG_PREFIX} parent received capture probe`, {
            requestId,
            frameName: message.frameName,
            href: message.href,
            parsedRequestId: message.parsedRequestId
          });
        }
        return;
      }

      if (!isPreviewCaptureResult(message) || message.requestId !== requestId) {
        return;
      }
      handleCaptureResult(message);
    };

    const handleCaptureResult = (result: PreviewCaptureResultMessage) => {
      console.debug(`${LOG_PREFIX} parent received capture result`, {
        requestId,
        ok: result.ok,
        error: result.error,
        isChallengePage: result.isChallengePage
      });

      if (result.ok && result.markdown) {
        finishSuccess(result.markdown);
        return;
      }

      if (result.isChallengePage) {
        finishError(new PreviewCaptureError('CHALLENGE_PAGE', { isChallengePage: true }));
        return;
      }

      finishError(new PreviewCaptureError(result.error ?? 'PREVIEW_CAPTURE_FAILED'));
    };

    options.signal?.addEventListener('abort', onAbort, { once: true });
    window.addEventListener('message', onPostMessage);
    chrome.runtime.onMessage.addListener(onRuntimeMessage);

    timeoutId = setTimeout(() => {
      console.debug(`${LOG_PREFIX} parent capture timeout`, { requestId, iframeReady });
      finishError(new PreviewCaptureError('DOM_CAPTURE_TIMEOUT'));
    }, timeoutMs);
  });
}
