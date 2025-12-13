declare const browser:
  | (typeof chrome & {
      storage: typeof chrome.storage;
      runtime: typeof chrome.runtime;
    })
  | undefined;
