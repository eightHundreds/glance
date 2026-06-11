import { describe, expect, test } from 'bun:test';
import { isChallengePage, isDomCaptureRequest, isDomCaptureResponse } from './domCapture';

describe('domCapture message guards', () => {
  test('识别合法的 DOM 采集请求', () => {
    expect(isDomCaptureRequest({
      channel: 'glance-dom-capture',
      type: 'request',
      requestId: 1,
      nonce: 'abc'
    })).toBe(true);
    expect(isDomCaptureRequest({ type: 'request' })).toBe(false);
  });

  test('识别合法的 DOM 采集响应', () => {
    expect(isDomCaptureResponse({
      channel: 'glance-dom-capture',
      type: 'response',
      requestId: 1,
      nonce: 'abc',
      ok: true,
      html: '<html></html>'
    })).toBe(true);
    expect(isDomCaptureResponse({
      channel: 'glance-dom-capture',
      type: 'response',
      requestId: 1,
      nonce: 'abc',
      ok: false,
      error: 'failed'
    })).toBe(true);
    expect(isDomCaptureResponse({ ok: true })).toBe(false);
  });

  test('识别 Cloudflare 挑战页', () => {
    const doc = {
      title: 'Just a moment...',
      body: { innerText: 'Checking your browser before accessing' }
    } as Document;
    expect(isChallengePage(doc)).toBe(true);
  });
});
