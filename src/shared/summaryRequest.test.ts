import { describe, expect, test } from 'bun:test';
import { DEFAULT_SETTINGS } from './settings';
import {
  buildSummaryRequestBody,
  isSummaryRequestBody,
  shouldDispatchSummaryRequest
} from './summaryRequest';

describe('buildSummaryRequestBody', () => {
  test('构造最终发送给 OpenAI 兼容接口的请求体', () => {
    const body = buildSummaryRequestBody({
      modelName: 'gpt-test',
      prompt: '请总结页面',
      markdown: '# 标题\n正文'
    });

    expect(body).toEqual({
      model: 'gpt-test',
      messages: [
        { role: 'system', content: '请总结页面' },
        { role: 'user', content: '# 标题\n正文' }
      ],
      stream: true
    });
  });

  test('请求体不包含 API Key 或 Authorization 信息', () => {
    const body = buildSummaryRequestBody({
      modelName: 'gpt-test',
      prompt: 'system',
      markdown: 'content'
    });
    const serialized = JSON.stringify(body);

    expect(serialized).not.toContain('apiKey');
    expect(serialized).not.toContain('Authorization');
    expect(serialized).not.toContain('Bearer');
  });

  test('只接受可直接发送的请求体结构', () => {
    expect(isSummaryRequestBody({
      model: 'gpt-test',
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'content' }
      ],
      stream: true
    })).toBe(true);
    expect(isSummaryRequestBody({
      model: 'gpt-test',
      messages: [{ role: 'assistant', content: 'unexpected' }],
      stream: true
    })).toBe(false);
    expect(isSummaryRequestBody({
      model: 'gpt-test',
      messages: [],
      stream: false
    })).toBe(false);
  });

  test('调试模式下可以只预览请求体而不发送', () => {
    expect(shouldDispatchSummaryRequest({
      debugMode: false,
      debugRequestDispatchEnabled: false
    })).toBe(true);
    expect(shouldDispatchSummaryRequest({
      debugMode: true,
      debugRequestDispatchEnabled: true
    })).toBe(true);
    expect(shouldDispatchSummaryRequest({
      debugMode: true,
      debugRequestDispatchEnabled: false
    })).toBe(false);
  });
});

describe('调试模式默认设置', () => {
  test('默认关闭，避免在普通使用时展示页面请求内容', () => {
    expect(DEFAULT_SETTINGS.debugMode).toBe(false);
  });

  test('默认允许真实发送请求，除非用户显式关闭', () => {
    expect(DEFAULT_SETTINGS.debugRequestDispatchEnabled).toBe(true);
  });
});
