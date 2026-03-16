import {
  getSiteRuntimeSettings,
  incrementConfirmShown,
  setSiteEnabled
} from "./shared/storage.js";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const lastKnownUrlsByTabId = new Map();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (message.type === "INJECT_TAB") {
    const tabId = typeof message.tabId === "number" ? message.tabId : null;
    const tabUrl = typeof message.tabUrl === "string" ? message.tabUrl : "";

    if (tabId === null || !tabUrl) {
      sendResponse({ ok: false });
      return false;
    }

    void injectIfEnabled(tabId, tabUrl)
      .then((injected) => sendResponse({ ok: injected }))
      .catch(() => sendResponse({ ok: false }));

    return true;
  }

  if (message.type === "DISABLE_HOST") {
    const hostname = typeof message.hostname === "string" ? message.hostname : "";
    if (!hostname) {
      sendResponse({ ok: false });
      return false;
    }

    void setSiteEnabled(hostname, false)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));

    return true;
  }

  if (message.type === "INCREMENT_CONFIRM_SHOWN") {
    const hostname = typeof message.hostname === "string" ? message.hostname : "";
    if (!hostname) {
      sendResponse({ ok: false });
      return false;
    }

    void incrementConfirmShown(hostname)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));

    return true;
  }

  return false;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (typeof changeInfo.url === "string") {
    lastKnownUrlsByTabId.set(tabId, changeInfo.url);
  } else if (typeof tab.url === "string") {
    lastKnownUrlsByTabId.set(tabId, tab.url);
  }

  if (changeInfo.status !== "complete") {
    return;
  }

  const candidateUrl =
    typeof tab.url === "string" ? tab.url : lastKnownUrlsByTabId.get(tabId);
  if (!candidateUrl) {
    return;
  }

  void injectIfEnabled(tabId, candidateUrl).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  lastKnownUrlsByTabId.delete(tabId);
});

async function injectIfEnabled(tabId, tabUrl) {
  const parsedUrl = parseUrl(tabUrl);
  if (!parsedUrl) {
    return false;
  }

  lastKnownUrlsByTabId.set(tabId, parsedUrl.href);

  const runtimeSettings = await getSiteRuntimeSettings(parsedUrl.hostname);
  if (!runtimeSettings.enabled) {
    return false;
  }

  try {
    await seedTabState(tabId, runtimeSettings);
  } catch (_error) {
    // If the bootstrap update fails, the content script still refreshes from storage.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content_script.js"]
    });
    return true;
  } catch (_error) {
    return false;
  }
}

async function seedTabState(tabId, runtimeSettings) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: applyBootstrapState,
    args: [runtimeSettings]
  });
}

function parseUrl(value) {
  try {
    const parsedUrl = new URL(value);
    if (!ALLOWED_PROTOCOLS.has(parsedUrl.protocol)) {
      return null;
    }
    return parsedUrl;
  } catch (_error) {
    return null;
  }
}

function applyBootstrapState(nextState) {
  window.__submitGuardBootstrap = nextState;
  window.dispatchEvent(new CustomEvent("submit-guard-bootstrap-updated"));
}
