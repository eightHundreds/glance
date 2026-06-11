const CSP_BYPASS_RULE_ID_START = 1000;
const CSP_BYPASS_RULE_ID_END = 1999;

type DnrApi = Pick<typeof chrome.declarativeNetRequest, 'getSessionRules' | 'updateSessionRules'>;

const modifyHeadersAction = 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType;
const removeHeaderOperation = 'remove' as chrome.declarativeNetRequest.HeaderOperation;
const subFrameResource = 'sub_frame' as chrome.declarativeNetRequest.ResourceType;
const xmlHttpRequestResource = 'xmlhttprequest' as chrome.declarativeNetRequest.ResourceType;

export type CspBypassOptions = {
  tabId?: number;
  initiatorHostname?: string;
};

function isManagedRuleId(ruleId: number): boolean {
  return ruleId >= CSP_BYPASS_RULE_ID_START && ruleId <= CSP_BYPASS_RULE_ID_END;
}

function getManagedRuleIds(rules: chrome.declarativeNetRequest.Rule[]): number[] {
  return rules.map(rule => rule.id).filter(isManagedRuleId);
}

function getNextRuleId(rules: chrome.declarativeNetRequest.Rule[]): number {
  const usedRuleIds = new Set(getManagedRuleIds(rules));

  for (let ruleId = CSP_BYPASS_RULE_ID_START; ruleId <= CSP_BYPASS_RULE_ID_END; ruleId += 1) {
    if (!usedRuleIds.has(ruleId)) {
      return ruleId;
    }
  }

  throw new Error('No available CSP bypass rule IDs');
}

function toUrlPattern(url: string): string {
  return `${new URL(url).origin}/*`;
}

function createRule(
  ruleId: number,
  urlPattern: string,
  options: CspBypassOptions = {}
): chrome.declarativeNetRequest.Rule {
  const condition: chrome.declarativeNetRequest.RuleCondition = {
    urlFilter: urlPattern,
    resourceTypes: [subFrameResource, xmlHttpRequestResource],
    requestMethods: ['get']
  };

  if (options.tabId !== undefined) {
    condition.tabIds = [options.tabId, -1];
  }
  if (options.initiatorHostname) {
    condition.initiatorDomains = [options.initiatorHostname];
  }

  return {
    id: ruleId,
    priority: 1,
    action: {
      type: modifyHeadersAction,
      responseHeaders: [
        {
          operation: removeHeaderOperation,
          header: 'Content-Security-Policy'
        },
        {
          operation: removeHeaderOperation,
          header: 'Content-Security-Policy-Report-Only'
        },
        {
          operation: removeHeaderOperation,
          header: 'X-Frame-Options'
        },
        {
          operation: removeHeaderOperation,
          header: 'Frame-Options'
        }
      ]
    },
    condition
  };
}

export function createCspBypassRuleManager(dnrApi: DnrApi) {
  const activeRuleIds = new Set<number>();

  return {
    async add(url: string, options: CspBypassOptions = {}): Promise<number> {
      const urlPattern = toUrlPattern(url);
      const sessionRules = await dnrApi.getSessionRules();
      const existingRule = sessionRules.find(rule => {
        return isManagedRuleId(rule.id) && rule.condition.urlFilter === urlPattern;
      });

      if (existingRule) {
        activeRuleIds.add(existingRule.id);
        return existingRule.id;
      }

      const ruleId = getNextRuleId(sessionRules);
      await dnrApi.updateSessionRules({
        addRules: [createRule(ruleId, urlPattern, options)]
      });
      activeRuleIds.add(ruleId);
      return ruleId;
    },

    async clear(): Promise<void> {
      const sessionRules = await dnrApi.getSessionRules();
      const ruleIds = new Set([...activeRuleIds, ...getManagedRuleIds(sessionRules)]);

      if (ruleIds.size === 0) {
        return;
      }

      await dnrApi.updateSessionRules({
        removeRuleIds: [...ruleIds]
      });
      activeRuleIds.clear();
    }
  };
}
