import { GENERATE_SUMMARY, SUMMARY_CHUNK, SUMMARY_DONE, SUMMARY_ERROR } from '../shared/messages';

// 存储当前活动的预览 URL 规则 ID
let activeRuleIds: number[] = [];
let ruleIdCounter = 1000;

// 移除 CSP 限制的规则
async function addCspBypassRule(url: string): Promise<number> {
  const ruleId = ruleIdCounter++;
  const urlPattern = new URL(url).origin + '/*';

  const rule: chrome.declarativeNetRequest.Rule = {
    id: ruleId,
    priority: 1,
    action: {
      type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
      responseHeaders: [
        {
          operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE,
          header: 'Content-Security-Policy'
        },
        {
          operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE,
          header: 'Content-Security-Policy-Report-Only'
        },
        {
          operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE,
          header: 'X-Frame-Options'
        }
      ]
    },
    condition: {
      urlFilter: urlPattern,
      resourceTypes: [
        chrome.declarativeNetRequest.ResourceType.MAIN_FRAME,
        chrome.declarativeNetRequest.ResourceType.SUB_FRAME
      ]
    }
  };

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [rule]
    });
    activeRuleIds.push(ruleId);
    return ruleId;
  } catch (error) {
    console.error('[Glance] Failed to add CSP bypass rule:', error);
    throw error;
  }
}

// 清理所有活动规则
async function clearCspBypassRules() {
  if (activeRuleIds.length === 0) return;

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: activeRuleIds
    });
    activeRuleIds = [];
  } catch (error) {
    console.error('[Glance] Failed to clear CSP bypass rules:', error);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FETCH_DOCUMENT') {
    const { url } = message;
    if (typeof url !== 'string') {
      sendResponse({ ok: false, error: 'INVALID_URL' });
      return false;
    }

    (async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          credentials: 'include',
          redirect: 'follow'
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const body = await response.text();
        sendResponse({ ok: true, body, finalUrl: response.url });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();

    return true;
  }

  if (message.type === 'ADD_CSP_BYPASS') {
    const { url } = message;
    if (typeof url !== 'string') {
      sendResponse({ ok: false, error: 'INVALID_URL' });
      return false;
    }

    (async () => {
      try {
        const ruleId = await addCspBypassRule(url);
        sendResponse({ ok: true, ruleId });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();

    return true;
  }

  if (message.type === 'CLEAR_CSP_BYPASS') {
    (async () => {
      try {
        await clearCspBypassRules();
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();

    return true;
  }

  if (message.type === GENERATE_SUMMARY) {
    const { markdown, prompt, modelConfig, apiKey } = message;
    if (typeof markdown !== 'string' || typeof prompt !== 'string' || !modelConfig || typeof apiKey !== 'string') {
      sendResponse({ ok: false, error: 'INVALID_PARAMS' });
      return false;
    }

    const tabId = sender.tab?.id;
    if (typeof tabId !== 'number') {
      sendResponse({ ok: false, error: 'INVALID_TAB' });
      return false;
    }

    // 发送初始响应，表示请求已接收
    sendResponse({ ok: true });

    (async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60秒超时

      const sendToTab = (msg: unknown) => {
        if (typeof tabId === 'number') {
          chrome.tabs.sendMessage(tabId, msg).catch(() => {
            // 忽略发送失败，可能 tab 已关闭或 content script 已卸载
          });
        }
      };

      try {
        const baseUrl = modelConfig.apiBaseUrl || '';
        const modelName = modelConfig.modelName || 'gpt-4o-mini';
        const endpoint = `${baseUrl}/chat/completions`;

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: modelName,
            messages: [
              { role: 'system', content: prompt },
              { role: 'user', content: markdown }
            ],
            stream: true
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          let errorMessage = `HTTP ${response.status}`;
          try {
            const body = await response.json();
            const detail =
              typeof body?.error?.message === 'string'
                ? body.error.message
                : typeof body?.message === 'string'
                  ? body.message
                  : null;
            if (detail) {
              errorMessage = `${errorMessage} · ${detail}`;
            }
          } catch {
            try {
              const text = await response.text();
              if (text) {
                errorMessage = `${errorMessage} · ${text.slice(0, 160)}`;
              }
            } catch {
              // ignore
            }
          }
          sendToTab({
            type: SUMMARY_ERROR,
            error: errorMessage
          });
          return;
        }

        // 处理流式响应
        const reader = response.body?.getReader();
        if (!reader) {
          sendToTab({
            type: SUMMARY_ERROR,
            error: '无法读取响应流'
          });
          return;
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // 保留最后一个不完整的行

          for (const line of lines) {
            if (controller.signal.aborted) {
              reader.cancel();
              return;
            }

            const trimmed = line.trim();
            if (!trimmed || trimmed === 'data: [DONE]') {
              if (trimmed === 'data: [DONE]') {
                sendToTab({ type: SUMMARY_DONE });
              }
              continue;
            }

            if (trimmed.startsWith('data: ')) {
              try {
                const json = JSON.parse(trimmed.slice(6));
                const content = json.choices?.[0]?.delta?.content;
                if (typeof content === 'string' && content) {
                  sendToTab({
                    type: SUMMARY_CHUNK,
                    chunk: content
                  });
                }
              } catch {
                // 忽略 JSON 解析错误
              }
            }
          }
        }

        // 处理剩余的 buffer
        if (buffer.trim() && buffer.trim() !== 'data: [DONE]') {
          if (buffer.trim().startsWith('data: ')) {
            try {
              const json = JSON.parse(buffer.trim().slice(6));
              const content = json.choices?.[0]?.delta?.content;
              if (typeof content === 'string' && content) {
                sendToTab({
                  type: SUMMARY_CHUNK,
                  chunk: content
                });
              }
            } catch {
              // ignore
            }
          }
        }

        sendToTab({ type: SUMMARY_DONE });
      } catch (error) {
        clearTimeout(timeoutId);
        if (controller.signal.aborted) {
          sendToTab({
            type: SUMMARY_ERROR,
            error: '请求已取消'
          });
        } else {
          const errorMessage = error instanceof Error ? error.message : String(error);
          sendToTab({
            type: SUMMARY_ERROR,
            error: `网络请求失败：${errorMessage}`
          });
        }
      }
    })();

    return true;
  }

  return false;
});
