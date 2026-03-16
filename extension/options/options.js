import {
  formatRiskyPhrasesInput,
  getSettings,
  listKnownSites,
  parseRiskyPhrasesInput,
  resetRiskyPhrases,
  setRiskyPhrases,
  setSiteEnabled,
  setSiteMode
} from "../shared/storage.js";

const globalCountEl = document.getElementById("global-count");
const enabledCountEl = document.getElementById("enabled-count");
const knownCountEl = document.getElementById("known-count");
const riskyPhrasesEl = document.getElementById("risky-phrases");
const savePhrasesButton = document.getElementById("save-phrases");
const resetPhrasesButton = document.getElementById("reset-phrases");
const phrasesStatusEl = document.getElementById("phrases-status");
const siteCountEl = document.getElementById("site-count");
const sitesStatusEl = document.getElementById("sites-status");
const siteListEl = document.getElementById("site-list");

void init();

async function init() {
  savePhrasesButton.addEventListener("click", onSavePhrases);
  resetPhrasesButton.addEventListener("click", onResetPhrases);
  siteListEl.addEventListener("change", onSiteListChanged);

  try {
    await refreshAll();
  } catch (_error) {
    setPhrasesStatus("Unable to load options.", true);
    setSitesStatus("Unable to load site settings.", true);
  }
}

async function onSavePhrases() {
  savePhrasesButton.disabled = true;
  resetPhrasesButton.disabled = true;
  riskyPhrasesEl.disabled = true;
  setPhrasesStatus("Saving phrases...");

  try {
    const riskyPhrases = parseRiskyPhrasesInput(riskyPhrasesEl.value);
    await setRiskyPhrases(riskyPhrases);
    riskyPhrasesEl.value = formatRiskyPhrasesInput(riskyPhrases);
    setPhrasesStatus("Risky phrases saved.");
  } catch (_error) {
    setPhrasesStatus("Unable to save risky phrases.", true);
  }

  savePhrasesButton.disabled = false;
  resetPhrasesButton.disabled = false;
  riskyPhrasesEl.disabled = false;
}

async function onResetPhrases() {
  savePhrasesButton.disabled = true;
  resetPhrasesButton.disabled = true;
  riskyPhrasesEl.disabled = true;
  setPhrasesStatus("Restoring defaults...");

  try {
    const nextRiskyPhrases = await resetRiskyPhrases();
    riskyPhrasesEl.value = formatRiskyPhrasesInput(nextRiskyPhrases);
    setPhrasesStatus("Default risky phrases restored.");
  } catch (_error) {
    setPhrasesStatus("Unable to restore defaults.", true);
  }

  savePhrasesButton.disabled = false;
  resetPhrasesButton.disabled = false;
  riskyPhrasesEl.disabled = false;
}

async function onSiteListChanged(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
    return;
  }

  const hostname = target.dataset.hostname || "";
  const action = target.dataset.action || "";
  if (!hostname || !action) {
    return;
  }

  setSiteControlsDisabled(hostname, true);
  setSitesStatus("Saving site settings...");

  try {
    if (action === "enabled" && target instanceof HTMLInputElement) {
      await setSiteEnabled(hostname, target.checked);
    } else if (action === "mode" && target instanceof HTMLSelectElement) {
      await setSiteMode(hostname, target.value);
    }

    await refreshSitesAndStats();
    setSitesStatus("Site settings saved.");
  } catch (_error) {
    setSitesStatus("Unable to save site settings.", true);
    await refreshSitesAndStats();
  }
}

async function refreshAll() {
  const settings = await getSettings();
  renderStats(settings);
  renderPhrases(settings.riskyPhrases);
  renderSites(settings.siteSettings);
}

async function refreshSitesAndStats() {
  const settings = await getSettings();
  renderStats(settings);
  renderSites(settings.siteSettings);
}

function renderStats(settings) {
  const knownSites = listKnownSites(settings.siteSettings);
  const enabledCount = knownSites.filter((site) => site.enabled).length;

  globalCountEl.textContent = String(settings.globalStats.countConfirmShownTotal);
  enabledCountEl.textContent = String(enabledCount);
  knownCountEl.textContent = String(knownSites.length);
}

function renderPhrases(riskyPhrases) {
  riskyPhrasesEl.value = formatRiskyPhrasesInput(riskyPhrases);
}

function renderSites(siteSettings) {
  const knownSites = listKnownSites(siteSettings);
  const enabledCount = knownSites.filter((site) => site.enabled).length;

  siteCountEl.textContent =
    knownSites.length === 0
      ? "No sites saved yet."
      : `${knownSites.length} site${knownSites.length === 1 ? "" : "s"} saved, ${enabledCount} enabled.`;

  if (knownSites.length === 0) {
    siteListEl.innerHTML = `
      <p class="empty-state">
        Enable a site from the popup to start keeping local counters and per-site mode settings.
      </p>
    `;
    return;
  }

  siteListEl.innerHTML = knownSites
    .map(
      (site) => `
        <article class="site-card" data-hostname="${escapeHtml(site.hostname)}">
          <div class="site-header">
            <div>
              <h3>${escapeHtml(site.hostname)}</h3>
              <p class="site-meta">Dialogs shown locally: ${site.countConfirmShown}</p>
            </div>
            <label class="site-toggle">
              <input
                type="checkbox"
                data-action="enabled"
                data-hostname="${escapeHtml(site.hostname)}"
                ${site.enabled ? "checked" : ""}
              />
              <span>Enabled</span>
            </label>
          </div>

          <div class="site-controls">
            <label class="field">
              <span class="field-label">Mode</span>
              <select data-action="mode" data-hostname="${escapeHtml(site.hostname)}">
                <option value="always_confirm" ${
                  site.mode === "always_confirm" ? "selected" : ""
                }>
                  Always confirm
                </option>
                <option value="risky_phrases_only" ${
                  site.mode === "risky_phrases_only" ? "selected" : ""
                }>
                  Risky phrases only
                </option>
              </select>
            </label>
          </div>
        </article>
      `
    )
    .join("");
}

function setPhrasesStatus(message, isError = false) {
  phrasesStatusEl.textContent = message;
  phrasesStatusEl.classList.toggle("status-error", isError);
}

function setSitesStatus(message, isError = false) {
  sitesStatusEl.textContent = message;
  sitesStatusEl.classList.toggle("status-error", isError);
}

function setSiteControlsDisabled(hostname, disabled) {
  const controls = siteListEl.querySelectorAll(`[data-hostname="${CSS.escape(hostname)}"]`);
  for (const control of controls) {
    if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
      control.disabled = disabled;
    }
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
