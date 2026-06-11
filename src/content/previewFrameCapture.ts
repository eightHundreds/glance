import { extractMarkdownFromDocument } from './markdownExtractor';
import { isChallengePage, waitForPreviewLoad } from './domCapture';
import {
  parsePreviewFrameRequestId,
  PREVIEW_CAPTURE_PROBE,
  PREVIEW_CAPTURE_RESULT,
  PREVIEW_IFRAME_READY,
  type PreviewCaptureResultMessage
} from '../shared/previewCapture';

const LOG_PREFIX = '[Glance][PREVIEW_CAPTURE]';

function sendCaptureResult(result: PreviewCaptureResultMessage): void {
  chrome.runtime.sendMessage(result).catch(() => {
    // 父页可能已关闭
  });
}

async function runPreviewCapture(requestId: number): Promise<void> {
  console.debug(`${LOG_PREFIX} child frame started`, { requestId, href: window.location.href });

  window.parent.postMessage({ type: PREVIEW_IFRAME_READY, requestId }, '*');
  console.debug(`${LOG_PREFIX} child posted iframe-ready`, { requestId });

  try {
    await waitForPreviewLoad();
    console.debug(`${LOG_PREFIX} child preview load settled`, {
      requestId,
      readyState: document.readyState
    });

    if (isChallengePage(document)) {
      console.debug(`${LOG_PREFIX} child detected challenge page`, { requestId });
      sendCaptureResult({
        type: PREVIEW_CAPTURE_RESULT,
        requestId,
        ok: false,
        error: 'CHALLENGE_PAGE',
        isChallengePage: true
      });
      return;
    }

    const markdown = extractMarkdownFromDocument(document, window.location.href).trim();
    if (!markdown) {
      sendCaptureResult({
        type: PREVIEW_CAPTURE_RESULT,
        requestId,
        ok: false,
        error: 'EMPTY_CONTENT'
      });
      return;
    }

    console.debug(`${LOG_PREFIX} child capture success`, { requestId, length: markdown.length });
    sendCaptureResult({
      type: PREVIEW_CAPTURE_RESULT,
      requestId,
      ok: true,
      markdown
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PREVIEW_CAPTURE_FAILED';
    console.debug(`${LOG_PREFIX} child capture failed`, { requestId, message });
    sendCaptureResult({
      type: PREVIEW_CAPTURE_RESULT,
      requestId,
      ok: false,
      error: message
    });
  }
}

export function initPreviewFrameCapture(): void {
  if (window.parent === window) {
    return;
  }

  const requestId = parsePreviewFrameRequestId(window.name);
  if (requestId === null) {
    return;
  }

  chrome.runtime.sendMessage({
    type: PREVIEW_CAPTURE_PROBE,
    frameName: window.name,
    href: window.location.href,
    parsedRequestId: requestId
  }).catch(() => {
    // 父页可能已关闭
  });
  console.debug(`${LOG_PREFIX} child probe`, {
    frameName: window.name,
    href: window.location.href,
    parsedRequestId: requestId
  });

  void runPreviewCapture(requestId);
}

initPreviewFrameCapture();
