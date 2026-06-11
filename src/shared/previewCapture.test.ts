import { describe, expect, test } from 'bun:test';
import {
  buildPreviewIframeName,
  isPreviewCaptureProbe,
  isPreviewCaptureResult,
  isPreviewIframeReady,
  PREVIEW_CAPTURE_PROBE,
  parsePreviewFrameRequestId,
  PREVIEW_CAPTURE_RESULT,
  PREVIEW_IFRAME_READY
} from './previewCapture';

describe('previewCapture protocol', () => {
  test('构建并解析预览 iframe 名称', () => {
    expect(buildPreviewIframeName(42)).toBe('glance-preview-iframe-42');
    expect(parsePreviewFrameRequestId('glance-preview-iframe-42')).toBe(42);
    expect(parsePreviewFrameRequestId('other-frame')).toBeNull();
  });

  test('识别 iframe ready 消息', () => {
    expect(isPreviewIframeReady({
      type: PREVIEW_IFRAME_READY,
      requestId: 1
    })).toBe(true);
    expect(isPreviewIframeReady({ type: 'other' })).toBe(false);
  });

  test('识别采集探针消息', () => {
    expect(isPreviewCaptureProbe({
      type: PREVIEW_CAPTURE_PROBE,
      frameName: 'glance-preview-iframe-1',
      href: 'https://example.com',
      parsedRequestId: 1
    })).toBe(true);
    expect(isPreviewCaptureProbe({
      type: PREVIEW_CAPTURE_PROBE,
      frameName: '',
      href: 'about:blank',
      parsedRequestId: null
    })).toBe(true);
  });

  test('识别采集结果消息', () => {
    expect(isPreviewCaptureResult({
      type: PREVIEW_CAPTURE_RESULT,
      requestId: 1,
      ok: true,
      markdown: '# title'
    })).toBe(true);
    expect(isPreviewCaptureResult({
      type: PREVIEW_CAPTURE_RESULT,
      requestId: 1,
      ok: false,
      error: 'CHALLENGE_PAGE',
      isChallengePage: true
    })).toBe(true);
  });
});
