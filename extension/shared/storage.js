export const LEGACY_ENABLED_HOSTS_KEY = "submitGuardEnabledHosts";
export const SITE_SETTINGS_KEY = "submitGuardSiteSettings";
export const RISKY_PHRASES_KEY = "submitGuardRiskyPhrases";
export const GLOBAL_STATS_KEY = "submitGuardGlobalStats";

export const SITE_MODES = Object.freeze({
  ALWAYS_CONFIRM: "always_confirm",
  RISKY_PHRASES_ONLY: "risky_phrases_only"
});

export const DEFAULT_SITE_MODE = SITE_MODES.ALWAYS_CONFIRM;
export const DEFAULT_RISKY_PHRASES = Object.freeze([
  "attach",
  "attached",
  "attachment",
  "see link",
  "link below",
  "as discussed",
  "urgent",
  "final"
]);

const DEFAULT_SITE_SETTINGS = Object.freeze({
  enabled: false,
  mode: DEFAULT_SITE_MODE,
  clickGuardEnabled: false,
  countConfirmShown: 0
});

const DEFAULT_GLOBAL_STATS = Object.freeze({
  countConfirmShownTotal: 0
});

export function normalizeHostname(hostname) {
  return typeof hostname === "string" ? hostname.trim().toLowerCase() : "";
}

export function sanitizeSiteMode(value) {
  return value === SITE_MODES.RISKY_PHRASES_ONLY ? value : DEFAULT_SITE_MODE;
}

export function sanitizeRiskyPhrases(rawRiskyPhrases) {
  const values = Array.isArray(rawRiskyPhrases) ? rawRiskyPhrases : [];
  const riskyPhrases = [];
  const seen = new Set();

  for (const value of values) {
    const normalizedPhrase = sanitizePhrase(value);
    if (!normalizedPhrase || seen.has(normalizedPhrase)) {
      continue;
    }

    seen.add(normalizedPhrase);
    riskyPhrases.push(normalizedPhrase);
  }

  return riskyPhrases;
}

export function parseRiskyPhrasesInput(value) {
  if (typeof value !== "string") {
    return [];
  }

  return sanitizeRiskyPhrases(value.split(/\r?\n|,/g));
}

export function formatRiskyPhrasesInput(riskyPhrases) {
  return sanitizeRiskyPhrases(riskyPhrases).join("\n");
}

export async function getSettings() {
  const stored = await chrome.storage.local.get([
    SITE_SETTINGS_KEY,
    RISKY_PHRASES_KEY,
    GLOBAL_STATS_KEY,
    LEGACY_ENABLED_HOSTS_KEY
  ]);

  return {
    siteSettings: sanitizeSiteSettings(
      stored[SITE_SETTINGS_KEY],
      stored[LEGACY_ENABLED_HOSTS_KEY]
    ),
    riskyPhrases:
      stored[RISKY_PHRASES_KEY] === undefined
        ? [...DEFAULT_RISKY_PHRASES]
        : sanitizeRiskyPhrases(stored[RISKY_PHRASES_KEY]),
    globalStats: sanitizeGlobalStats(stored[GLOBAL_STATS_KEY])
  };
}

export async function getSiteSettings(hostname) {
  const normalizedHostname = normalizeHostname(hostname);
  if (!normalizedHostname) {
    throw new Error("hostname is required");
  }

  const { siteSettings } = await getSettings();
  return cloneSiteSettings(siteSettings[normalizedHostname]);
}

export async function getSiteRuntimeSettings(hostname) {
  const normalizedHostname = normalizeHostname(hostname);
  if (!normalizedHostname) {
    throw new Error("hostname is required");
  }

  const { siteSettings, riskyPhrases } = await getSettings();
  const currentSettings = cloneSiteSettings(siteSettings[normalizedHostname]);

  return {
    hostname: normalizedHostname,
    enabled: currentSettings.enabled,
    mode: currentSettings.mode,
    clickGuardEnabled: currentSettings.clickGuardEnabled,
    riskyPhrases: [...riskyPhrases]
  };
}

export async function getEnabledHosts() {
  const { siteSettings } = await getSettings();
  const enabledHosts = {};

  for (const [hostname, settings] of Object.entries(siteSettings)) {
    if (settings.enabled) {
      enabledHosts[hostname] = true;
    }
  }

  return enabledHosts;
}

export async function setSiteEnabled(hostname, enabled) {
  return updateSiteSettings(hostname, (currentSettings) => ({
    ...currentSettings,
    enabled: enabled === true
  }));
}

export async function setSiteMode(hostname, mode) {
  return updateSiteSettings(hostname, (currentSettings) => ({
    ...currentSettings,
    mode: sanitizeSiteMode(mode)
  }));
}

export async function setSiteClickGuardEnabled(hostname, clickGuardEnabled) {
  return updateSiteSettings(hostname, (currentSettings) => ({
    ...currentSettings,
    clickGuardEnabled: clickGuardEnabled === true
  }));
}

export async function setRiskyPhrases(riskyPhrases) {
  const nextRiskyPhrases = sanitizeRiskyPhrases(riskyPhrases);
  await chrome.storage.local.set({ [RISKY_PHRASES_KEY]: nextRiskyPhrases });
  return nextRiskyPhrases;
}

export async function resetRiskyPhrases() {
  return setRiskyPhrases(DEFAULT_RISKY_PHRASES);
}

export async function incrementConfirmShown(hostname) {
  const normalizedHostname = normalizeHostname(hostname);
  if (!normalizedHostname) {
    throw new Error("hostname is required");
  }

  const { siteSettings, globalStats } = await getSettings();
  const nextSiteSettings = { ...siteSettings };
  const currentSettings = cloneSiteSettings(nextSiteSettings[normalizedHostname]);
  const nextGlobalStats = {
    countConfirmShownTotal: globalStats.countConfirmShownTotal + 1
  };

  nextSiteSettings[normalizedHostname] = {
    ...currentSettings,
    countConfirmShown: currentSettings.countConfirmShown + 1
  };

  await chrome.storage.local.set({
    [SITE_SETTINGS_KEY]: nextSiteSettings,
    [GLOBAL_STATS_KEY]: nextGlobalStats
  });
  await removeLegacyEnabledHosts();

  return {
    siteSettings: nextSiteSettings,
    globalStats: nextGlobalStats
  };
}

export function listKnownSites(siteSettings) {
  return Object.entries(siteSettings)
    .map(([hostname, settings]) => ({
      hostname,
      ...cloneSiteSettings(settings)
    }))
    .sort((left, right) => {
      if (left.enabled !== right.enabled) {
        return left.enabled ? -1 : 1;
      }

      if (right.countConfirmShown !== left.countConfirmShown) {
        return right.countConfirmShown - left.countConfirmShown;
      }

      return left.hostname.localeCompare(right.hostname);
    });
}

function sanitizeSiteSettings(rawSiteSettings, rawLegacyEnabledHosts) {
  const siteSettings = {};

  if (rawSiteSettings && typeof rawSiteSettings === "object") {
    for (const [hostname, rawSettings] of Object.entries(rawSiteSettings)) {
      const normalizedHostname = normalizeHostname(hostname);
      if (!normalizedHostname) {
        continue;
      }

      siteSettings[normalizedHostname] = cloneSiteSettings(rawSettings);
    }
  }

  const legacyEnabledHosts = sanitizeLegacyEnabledHosts(rawLegacyEnabledHosts);
  for (const hostname of Object.keys(legacyEnabledHosts)) {
    siteSettings[hostname] = {
      ...cloneSiteSettings(siteSettings[hostname]),
      enabled: true
    };
  }

  return siteSettings;
}

function sanitizeGlobalStats(rawGlobalStats) {
  const safeGlobalStats =
    rawGlobalStats && typeof rawGlobalStats === "object" ? rawGlobalStats : {};

  return {
    countConfirmShownTotal: sanitizeCount(safeGlobalStats.countConfirmShownTotal)
  };
}

function sanitizeLegacyEnabledHosts(rawEnabledHosts) {
  if (!rawEnabledHosts || typeof rawEnabledHosts !== "object") {
    return {};
  }

  const enabledHosts = {};
  for (const [hostname, enabled] of Object.entries(rawEnabledHosts)) {
    const normalizedHostname = normalizeHostname(hostname);
    if (normalizedHostname && enabled === true) {
      enabledHosts[normalizedHostname] = true;
    }
  }

  return enabledHosts;
}

function cloneSiteSettings(rawSettings) {
  const safeSettings = rawSettings && typeof rawSettings === "object" ? rawSettings : {};

  return {
    enabled: safeSettings.enabled === true,
    mode: sanitizeSiteMode(safeSettings.mode),
    clickGuardEnabled: safeSettings.clickGuardEnabled === true,
    countConfirmShown: sanitizeCount(safeSettings.countConfirmShown)
  };
}

async function updateSiteSettings(hostname, update) {
  const normalizedHostname = normalizeHostname(hostname);
  if (!normalizedHostname) {
    throw new Error("hostname is required");
  }

  const { siteSettings } = await getSettings();
  const nextSiteSettings = { ...siteSettings };
  const currentSettings = cloneSiteSettings(nextSiteSettings[normalizedHostname]);

  nextSiteSettings[normalizedHostname] = cloneSiteSettings(update(currentSettings));

  await chrome.storage.local.set({ [SITE_SETTINGS_KEY]: nextSiteSettings });
  await removeLegacyEnabledHosts();

  return nextSiteSettings;
}

async function removeLegacyEnabledHosts() {
  await chrome.storage.local.remove(LEGACY_ENABLED_HOSTS_KEY);
}

function sanitizePhrase(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function sanitizeCount(value) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}
