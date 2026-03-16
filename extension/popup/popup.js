import {
  getSiteSettings,
  setSiteClickGuardEnabled,
  setSiteEnabled,
  setSiteMode
} from "../shared/storage.js";

const hostnameEl = document.getElementById("hostname");
const toggleEl = document.getElementById("site-toggle");
const modeEl = document.getElementById("mode-select");
const clickGuardEl = document.getElementById("click-guard-toggle");
const statusEl = document.getElementById("status");

let currentTab = null;
let currentHostname = "";

void init();

async function init() {
  toggleEl.disabled = true;
  modeEl.disabled = true;
  clickGuardEl.disabled = true;
  setStatus("Loading...");

  try {
    const tab = await resolveTargetTab();
    if (!tab || typeof tab.id !== "number" || typeof tab.url !== "string") {
      setUnavailableState("No active tab found.");
      return;
    }

    const parsedUrl = parseInjectableUrl(tab.url);
    if (!parsedUrl) {
      setUnavailableState("This page cannot be protected.");
      return;
    }

    currentTab = tab;
    currentHostname = parsedUrl.hostname.toLowerCase();
    hostnameEl.textContent = currentHostname;

    const siteSettings = await getSiteSettings(currentHostname);
    toggleEl.checked = siteSettings.enabled;
    modeEl.value = siteSettings.mode;
    modeEl.dataset.previousMode = siteSettings.mode;
    clickGuardEl.checked = siteSettings.clickGuardEnabled;
    toggleEl.disabled = false;
    modeEl.disabled = false;
    syncClickGuardAvailability();
    setStatus(
      siteSettings.enabled
        ? "Protection enabled for this site."
        : "Protection disabled for this site."
    );

    toggleEl.addEventListener("change", onToggleChanged);
    modeEl.addEventListener("change", onModeChanged);
    clickGuardEl.addEventListener("change", onClickGuardChanged);
  } catch (_error) {
    setUnavailableState("Unable to load popup state.");
  }
}

async function onToggleChanged() {
  if (!currentHostname || !currentTab || typeof currentTab.id !== "number") {
    return;
  }

  const nextEnabled = toggleEl.checked;
  toggleEl.disabled = true;
  modeEl.disabled = true;
  clickGuardEl.disabled = true;
  setStatus("Saving...");

  try {
    await setSiteEnabled(currentHostname, nextEnabled);
  } catch (_error) {
    toggleEl.checked = !nextEnabled;
    setStatus("Unable to save site setting.", true);
    toggleEl.disabled = false;
    modeEl.disabled = false;
    syncClickGuardAvailability();
    return;
  }

  if (nextEnabled) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "INJECT_TAB",
        tabId: currentTab.id,
        tabUrl: currentTab.url
      });

      setStatus(
        response && response.ok
          ? "Protection enabled for this site."
          : "Protection enabled. Reload if the prompt does not appear."
      );
    } catch (_error) {
      setStatus("Protection enabled. Reload if the prompt does not appear.");
    }
  } else {
    setStatus("Protection disabled for this site.");
  }

  toggleEl.disabled = false;
  modeEl.disabled = false;
  syncClickGuardAvailability();
}

async function onModeChanged() {
  if (!currentHostname) {
    return;
  }

  const previousMode = modeEl.dataset.previousMode || "always_confirm";
  const nextMode = modeEl.value;

  toggleEl.disabled = true;
  modeEl.disabled = true;
  clickGuardEl.disabled = true;
  setStatus("Saving mode...");

  try {
    await setSiteMode(currentHostname, nextMode);
    modeEl.dataset.previousMode = nextMode;
    setStatus(
      toggleEl.checked
        ? "Mode saved for this site."
        : "Mode saved. Enable protection to use it."
    );
  } catch (_error) {
    modeEl.value = previousMode;
    setStatus("Unable to save mode.", true);
  }

  toggleEl.disabled = false;
  modeEl.disabled = false;
  syncClickGuardAvailability();
}

async function onClickGuardChanged() {
  if (!currentHostname) {
    return;
  }

  const nextEnabled = clickGuardEl.checked;

  toggleEl.disabled = true;
  modeEl.disabled = true;
  clickGuardEl.disabled = true;
  setStatus("Saving advanced mode...");

  try {
    await setSiteClickGuardEnabled(currentHostname, nextEnabled);
    setStatus(
      nextEnabled
        ? "Advanced click guard enabled for this site."
        : "Advanced click guard disabled for this site."
    );
  } catch (_error) {
    clickGuardEl.checked = !nextEnabled;
    setStatus("Unable to save advanced click guard.", true);
  }

  toggleEl.disabled = false;
  modeEl.disabled = false;
  syncClickGuardAvailability();
}

function setUnavailableState(message) {
  hostnameEl.textContent = "Unavailable";
  toggleEl.checked = false;
  toggleEl.disabled = true;
  modeEl.disabled = true;
  clickGuardEl.checked = false;
  clickGuardEl.disabled = true;
  setStatus(message, true);
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("status-error", isError);
}

function syncClickGuardAvailability() {
  clickGuardEl.disabled = toggleEl.disabled || !toggleEl.checked;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function resolveTargetTab() {
  const params = new URLSearchParams(window.location.search);
  const tabId = Number.parseInt(params.get("tabId") || "", 10);
  const tabUrl = params.get("tabUrl");

  if (Number.isInteger(tabId) && tabId >= 0) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab && typeof tab.id === "number" && typeof tab.url === "string") {
        return tab;
      }
    } catch (_error) {
      // Fall back to the URL override below.
    }
  }

  if (Number.isInteger(tabId) && tabId >= 0 && typeof tabUrl === "string") {
    return {
      id: tabId,
      url: tabUrl
    };
  }

  return getActiveTab();
}

function parseInjectableUrl(value) {
  try {
    const parsedUrl = new URL(value);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }
    return parsedUrl;
  } catch (_error) {
    return null;
  }
}
