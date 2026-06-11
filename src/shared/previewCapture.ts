export const PREVIEW_IFRAME_NAME_PREFIX = 'glance-preview-iframe-';
export const PREVIEW_IFRAME_READY = '__glance__iframe-ready';
export const PREVIEW_CAPTURE_PROBE = 'GLANCE_PREVIEW_CAPTURE_PROBE';
export const PREVIEW_CAPTURE_RESULT = 'GLANCE_PREVIEW_CAPTURE_RESULT';

export type PreviewIframeReadyMessage = {
  type: typeof PREVIEW_IFRAME_READY;
  requestId: number;
};

export type PreviewCaptureProbeMessage = {
  type: typeof PREVIEW_CAPTURE_PROBE;
  frameName: string;
  href: string;
  parsedRequestId: number | null;
};

export type PreviewCaptureResultMessage = {
  type: typeof PREVIEW_CAPTURE_RESULT;
  requestId: number;
  ok: boolean;
  markdown?: string;
  error?: string;
  isChallengePage?: boolean;
};

export function buildPreviewIframeName(requestId: number): string {
  return `${PREVIEW_IFRAME_NAME_PREFIX}${requestId}`;
}

export function parsePreviewFrameRequestId(frameName: string): number | null {
  if (!frameName.startsWith(PREVIEW_IFRAME_NAME_PREFIX)) {
    return null;
  }
  const requestId = Number.parseInt(frameName.slice(PREVIEW_IFRAME_NAME_PREFIX.length), 10);
  return Number.isFinite(requestId) ? requestId : null;
}

export function isPreviewIframeReady(data: unknown): data is PreviewIframeReadyMessage {
  if (!data || typeof data !== 'object') {
    return false;
  }
  const message = data as Partial<PreviewIframeReadyMessage>;
  return message.type === PREVIEW_IFRAME_READY && typeof message.requestId === 'number';
}

export function isPreviewCaptureProbe(data: unknown): data is PreviewCaptureProbeMessage {
  if (!data || typeof data !== 'object') {
    return false;
  }
  const message = data as Partial<PreviewCaptureProbeMessage>;
  return message.type === PREVIEW_CAPTURE_PROBE
    && typeof message.frameName === 'string'
    && typeof message.href === 'string'
    && (typeof message.parsedRequestId === 'number' || message.parsedRequestId === null);
}

export function isPreviewCaptureResult(data: unknown): data is PreviewCaptureResultMessage {
  if (!data || typeof data !== 'object') {
    return false;
  }
  const message = data as Partial<PreviewCaptureResultMessage>;
  if (message.type !== PREVIEW_CAPTURE_RESULT || typeof message.requestId !== 'number') {
    return false;
  }
  if (typeof message.ok !== 'boolean') {
    return false;
  }
  if (message.ok) {
    return typeof message.markdown === 'string';
  }
  return typeof message.error === 'string';
}
