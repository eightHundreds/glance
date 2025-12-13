import Defuddle, { DefuddleOptions } from 'defuddle';
import TurndownService from 'turndown';

const DEFAULT_PARSE_TIMEOUT_MS = 8000;

export type MarkdownExtractorOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  url?: string;
};

export async function extractMarkdownFromHtml(
  html: string,
  url: string,
  options: MarkdownExtractorOptions = {}
): Promise<string> {
  const { signal, timeoutMs = DEFAULT_PARSE_TIMEOUT_MS } = options;

  if (!html?.trim()) {
    throw new Error('EMPTY_DOCUMENT');
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };

    const onAbort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('SUMMARY_PARSE_TIMEOUT'));
    }, timeoutMs);

    queueMicrotask(() => {
      if (signal?.aborted) {
        cleanup();
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const defuddleOptions: DefuddleOptions = {
          markdown: false, // 在浏览器端不生成 markdown，只提取主要内容
          url,
        };

        const defuddle = new Defuddle(doc, defuddleOptions);
        const result = defuddle.parse();
        const htmlContent = (result.content || '').trim();
        
        // 使用 Turndown 将 HTML 转换为 markdown
        const turndownService = new TurndownService({
          headingStyle: 'atx',
          codeBlockStyle: 'fenced',
        });
        const markdown = turndownService.turndown(htmlContent);
        
        cleanup();
        resolve(markdown);
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error('SUMMARY_PARSE_FAILED'));
      }
    });
  });
}
