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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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

  return false;
});
