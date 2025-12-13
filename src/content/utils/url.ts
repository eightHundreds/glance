export function normalizeUrl(candidate: string | null | undefined): string | null {
  if (!candidate || typeof candidate !== 'string') {
    return null;
  }

  const trimmed = candidate.trim();
  if (!trimmed) {
    return null;
  }

  const attempts = [trimmed];
  if (!/^https?:\/\//i.test(trimmed)) {
    attempts.push(`https://${trimmed}`);
  }

  for (const attempt of attempts) {
    try {
      const parsed = new URL(attempt);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.toString();
      }
    } catch {
      // ignore invalid urls
    }
  }

  return null;
}

export function extractDragUrl(event: DragEvent): string | null {
  const transfer = event.dataTransfer;
  if (!transfer) {
    return null;
  }

  const uriList = transfer.getData('text/uri-list');
  if (uriList) {
    const [firstLine] = uriList.split('\n');
    const url = normalizeUrl(firstLine);
    if (url) {
      return url;
    }
  }

  const plainText = transfer.getData('text/plain');
  if (plainText) {
    const url = normalizeUrl(plainText);
    if (url) {
      return url;
    }
  }

  const anchor = (event.target as HTMLElement | null)?.closest('a');
  if (anchor?.href) {
    const url = normalizeUrl(anchor.href);
    if (url) {
      return url;
    }
  }

  return null;
}
