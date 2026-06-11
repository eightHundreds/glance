import { describe, expect, test } from 'bun:test';
import { createCspBypassRuleManager } from './cspBypassRules';

function createDnr(existingRules: chrome.declarativeNetRequest.Rule[] = []) {
  const rules = [...existingRules];
  const updates: chrome.declarativeNetRequest.UpdateRuleOptions[] = [];

  return {
    api: {
      async getSessionRules() {
        return [...rules];
      },
      async updateSessionRules(options: chrome.declarativeNetRequest.UpdateRuleOptions) {
        updates.push(options);
        const removeRuleIds = new Set(options.removeRuleIds ?? []);
        for (let index = rules.length - 1; index >= 0; index -= 1) {
          if (removeRuleIds.has(rules[index].id)) {
            rules.splice(index, 1);
          }
        }
        if (options.addRules) {
          rules.push(...options.addRules);
        }
      }
    },
    rules,
    updates
  };
}

function existingRule(id: number, urlFilter = 'https://example.com/*'): chrome.declarativeNetRequest.Rule {
  return {
    id,
    priority: 1,
    action: {
      type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType
    },
    condition: {
      urlFilter
    }
  };
}

describe('createCspBypassRuleManager', () => {
  test('已有 session 规则时使用下一个可用 ID', async () => {
    const dnr = createDnr([existingRule(1000, 'https://old.example/*')]);
    const manager = createCspBypassRuleManager(dnr.api);

    const ruleId = await manager.add('https://new.example/page');

    expect(ruleId).toBe(1001);
    expect(dnr.updates[0].addRules?.[0].id).toBe(1001);
  });

  test('清理时移除内存状态丢失后遗留的 CSP bypass 规则', async () => {
    const dnr = createDnr([existingRule(1000), existingRule(1001)]);
    const manager = createCspBypassRuleManager(dnr.api);

    await manager.clear();

    expect(dnr.updates[0].removeRuleIds).toEqual([1000, 1001]);
    expect(dnr.rules).toEqual([]);
  });
});
