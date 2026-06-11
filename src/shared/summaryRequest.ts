export type SummaryRequestBody = {
  model: string;
  messages: Array<{
    role: 'system' | 'user';
    content: string;
  }>;
  stream: true;
};

type SummaryRequestParams = {
  modelName: string;
  prompt: string;
  markdown: string;
};

type SummaryRequestDispatchParams = {
  debugMode: boolean;
  debugRequestDispatchEnabled: boolean;
};

export function buildSummaryRequestBody(params: SummaryRequestParams): SummaryRequestBody {
  return {
    model: params.modelName,
    messages: [
      { role: 'system', content: params.prompt },
      { role: 'user', content: params.markdown }
    ],
    stream: true
  };
}

export function isSummaryRequestBody(value: unknown): value is SummaryRequestBody {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const body = value as Partial<SummaryRequestBody>;
  return (
    typeof body.model === 'string' &&
    body.model.length > 0 &&
    body.stream === true &&
    Array.isArray(body.messages) &&
    body.messages.length > 0 &&
    body.messages.every(message => (
      !!message &&
      (message.role === 'system' || message.role === 'user') &&
      typeof message.content === 'string'
    ))
  );
}

export function shouldDispatchSummaryRequest(params: SummaryRequestDispatchParams): boolean {
  if (!params.debugMode) {
    return true;
  }
  return params.debugRequestDispatchEnabled;
}
