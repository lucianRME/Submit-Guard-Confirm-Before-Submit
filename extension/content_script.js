(() => {
  if (window.__submitGuardInstalled) {
    return;
  }
  window.__submitGuardInstalled = true;

  const BOOTSTRAP_EVENT = "submit-guard-bootstrap-updated";
  const BYPASS_ATTR = "data-submit-guard-bypass";
  const ROOT_ID = "submit-guard-root";
  const TITLE_ID = "submit-guard-title";
  const DESCRIPTION_ID = "submit-guard-description";
  const MATCHES_ID = "submit-guard-matches";
  const DISABLE_ID = "submit-guard-disable";
  const CANCEL_ID = "submit-guard-cancel";
  const CONFIRM_ID = "submit-guard-confirm";
  const SITE_SETTINGS_KEY = "submitGuardSiteSettings";
  const RISKY_PHRASES_KEY = "submitGuardRiskyPhrases";
  const LEGACY_ENABLED_HOSTS_KEY = "submitGuardEnabledHosts";
  const MODE_ALWAYS_CONFIRM = "always_confirm";
  const MODE_RISKY_PHRASES_ONLY = "risky_phrases_only";
  const DEFAULT_RISKY_PHRASES = [
    "attach",
    "attached",
    "attachment",
    "see link",
    "link below",
    "as discussed",
    "urgent",
    "final"
  ];
  const CLICKABLE_SELECTOR =
    "button, input[type='submit'], input[type='button'], a[role='button'], div[role='button']";
  const SUBMIT_WORD_PATTERN =
    /\b(?:submit|send|save|create|publish|post|apply|confirm|continue)\b/i;

  const currentHostname = normalizeHostname(window.location.hostname);
  let activeDialog = null;
  let bypassState = createEmptyBypassState();
  let guardState = readBootstrapState() || {
    hostname: currentHostname,
    enabled: Boolean(currentHostname),
    mode: MODE_ALWAYS_CONFIRM,
    clickGuardEnabled: false,
    riskyPhrases: [...DEFAULT_RISKY_PHRASES]
  };

  document.addEventListener("submit", handleSubmitCapture, true);
  document.addEventListener("click", handleClickCapture, true);
  window.addEventListener(BOOTSTRAP_EVENT, handleBootstrapUpdate);

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(handleStorageChanged);
  }

  void refreshGuardState();

  function handleBootstrapUpdate() {
    const bootstrapState = readBootstrapState();
    if (bootstrapState) {
      guardState = bootstrapState;
    }
  }

  function handleStorageChanged(changes, areaName) {
    if (areaName !== "local") {
      return;
    }

    if (
      changes[SITE_SETTINGS_KEY] ||
      changes[RISKY_PHRASES_KEY] ||
      changes[LEGACY_ENABLED_HOSTS_KEY]
    ) {
      void refreshGuardState();
    }
  }

  async function refreshGuardState() {
    if (!currentHostname || !chrome.storage || !chrome.storage.local) {
      guardState = {
        hostname: currentHostname,
        enabled: false,
        mode: MODE_ALWAYS_CONFIRM,
        clickGuardEnabled: false,
        riskyPhrases: [...DEFAULT_RISKY_PHRASES]
      };
      return;
    }

    try {
      const stored = await chrome.storage.local.get([
        SITE_SETTINGS_KEY,
        RISKY_PHRASES_KEY,
        LEGACY_ENABLED_HOSTS_KEY
      ]);

      guardState = {
        hostname: currentHostname,
        enabled: resolveSiteEnabled(
          currentHostname,
          stored[SITE_SETTINGS_KEY],
          stored[LEGACY_ENABLED_HOSTS_KEY]
        ),
        mode: resolveSiteMode(currentHostname, stored[SITE_SETTINGS_KEY]),
        clickGuardEnabled: resolveSiteClickGuardEnabled(
          currentHostname,
          stored[SITE_SETTINGS_KEY]
        ),
        riskyPhrases:
          stored[RISKY_PHRASES_KEY] === undefined
            ? [...DEFAULT_RISKY_PHRASES]
            : sanitizeRiskyPhrases(stored[RISKY_PHRASES_KEY])
      };
    } catch (_error) {
      // Leave the last known state in place and keep submit fail-open.
    }
  }

  function handleSubmitCapture(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }

    if (shouldBypassSubmit(form, event.submitter)) {
      return;
    }

    const currentState = guardState;
    if (!currentState.enabled) {
      return;
    }

    if (activeDialog) {
      event.preventDefault();
      event.stopImmediatePropagation();
      activeDialog.focus();
      return;
    }

    let confirmContext;
    try {
      confirmContext = buildConfirmContext({
        currentState,
        form,
        triggerElement: event.submitter instanceof HTMLElement ? event.submitter : null
      });
    } catch (_error) {
      return;
    }

    if (!confirmContext.shouldConfirm) {
      return;
    }

    interceptAction({
      event,
      confirmContext,
      hostname: currentState.hostname,
      onConfirm() {
        proceedWithSubmit(form, event.submitter);
      }
    });
  }

  function handleClickCapture(event) {
    const currentState = guardState;
    if (!currentState.enabled || !currentState.clickGuardEnabled) {
      return;
    }

    const submitLike = resolveSubmitLikeClick(event.target);
    if (!submitLike) {
      return;
    }

    if (shouldBypassClick(submitLike.element)) {
      return;
    }

    if (activeDialog) {
      event.preventDefault();
      event.stopImmediatePropagation();
      activeDialog.focus();
      return;
    }

    let confirmContext;
    try {
      confirmContext = buildConfirmContext({
        currentState,
        form: submitLike.form,
        triggerElement: submitLike.element
      });
    } catch (_error) {
      return;
    }

    if (!confirmContext.shouldConfirm) {
      return;
    }

    interceptAction({
      event,
      confirmContext,
      hostname: currentState.hostname,
      onConfirm() {
        proceedWithClickAction(submitLike);
      }
    });
  }

  function interceptAction({ event, confirmContext, hostname, onConfirm }) {
    event.preventDefault();
    event.stopImmediatePropagation();
    void notifyConfirmShown(hostname);

    openConfirmDialog(confirmContext)
      .then((result) => {
        if (result === "confirm") {
          onConfirm();
          return;
        }

        if (result === "disable") {
          void disableCurrentSite(hostname);
        }
      })
      .catch((error) => {
        warnFailOpen("confirm interception", error);
        onConfirm();
      });
  }

  function buildConfirmContext({ currentState, form, triggerElement }) {
    if (currentState.mode === MODE_RISKY_PHRASES_ONLY) {
      const guardText = extractGuardText(form, triggerElement);
      const matches = findMatchingPhrases(guardText, currentState.riskyPhrases);
      if (matches.length === 0) {
        return { shouldConfirm: false };
      }

      return {
        shouldConfirm: true,
        description:
          "This draft looks risky enough to double-check before you send it.",
        matches
      };
    }

    return {
      shouldConfirm: true,
      description: "Are you sure you want to submit this form?",
      matches: []
    };
  }

  function proceedWithSubmit(form, submitter) {
    try {
      armBypass({ form });

      if (typeof form.requestSubmit === "function") {
        if (submitter instanceof HTMLElement && submitter.isConnected) {
          form.requestSubmit(submitter);
        } else {
          form.requestSubmit();
        }
        return;
      }

      HTMLFormElement.prototype.submit.call(form);
    } catch (error) {
      warnFailOpen("native submit", error);

      try {
        HTMLFormElement.prototype.submit.call(form);
      } catch (fallbackError) {
        warnFailOpen("native submit fallback", fallbackError);
      }
    }
  }

  function proceedWithClickAction(submitLike) {
    const { element, form, preferRequestSubmit } = submitLike;

    try {
      armBypass({ element, form });

      if (
        preferRequestSubmit &&
        form instanceof HTMLFormElement &&
        typeof form.requestSubmit === "function"
      ) {
        form.requestSubmit(element);
        return;
      }

      if (element instanceof HTMLElement && typeof element.click === "function") {
        element.click();
        return;
      }

      if (preferRequestSubmit && form instanceof HTMLFormElement) {
        HTMLFormElement.prototype.submit.call(form);
      }
    } catch (error) {
      warnFailOpen("click guard", error);

      try {
        if (element instanceof HTMLElement && typeof element.click === "function") {
          element.click();
          return;
        }

        if (form instanceof HTMLFormElement) {
          HTMLFormElement.prototype.submit.call(form);
        }
      } catch (fallbackError) {
        warnFailOpen("click guard fallback", fallbackError);
      }
    }
  }

  function resolveSubmitLikeClick(target) {
    const baseElement =
      target instanceof Element
        ? target
        : target instanceof Node
          ? target.parentElement
          : null;
    if (!(baseElement instanceof Element)) {
      return null;
    }

    const clickable = baseElement.closest(CLICKABLE_SELECTOR);
    if (!(clickable instanceof HTMLElement) || isDisabledClickable(clickable)) {
      return null;
    }

    const form = resolveEnclosingForm(clickable);
    if (!(form instanceof HTMLFormElement) && !SUBMIT_WORD_PATTERN.test(getClickableLabel(clickable))) {
      return null;
    }

    return {
      element: clickable,
      form,
      preferRequestSubmit: isNativeSubmitControl(clickable) && form instanceof HTMLFormElement
    };
  }

  function resolveEnclosingForm(element) {
    if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) {
      return element.form;
    }

    const nearestForm = element.closest("form");
    return nearestForm instanceof HTMLFormElement ? nearestForm : null;
  }

  function isDisabledClickable(element) {
    if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) {
      return element.disabled;
    }

    return element.getAttribute("aria-disabled") === "true";
  }

  function isNativeSubmitControl(element) {
    if (element instanceof HTMLInputElement) {
      return element.type === "submit";
    }

    if (element instanceof HTMLButtonElement) {
      return !element.type || element.type === "submit";
    }

    return false;
  }

  function getClickableLabel(element) {
    if (!(element instanceof HTMLElement)) {
      return "";
    }

    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim()) {
      return ariaLabel.trim();
    }

    if (element instanceof HTMLInputElement && element.value.trim()) {
      return element.value.trim();
    }

    if (typeof element.innerText === "string" && element.innerText.trim()) {
      return element.innerText.trim();
    }

    return typeof element.textContent === "string" ? element.textContent.trim() : "";
  }

  function shouldBypassSubmit(form, submitter) {
    clearExpiredBypass();

    const matchesBypass =
      form.getAttribute(BYPASS_ATTR) === "1" ||
      (isBypassActive() &&
        (bypassState.form === form ||
          (submitter instanceof HTMLElement && bypassState.element === submitter)));
    if (!matchesBypass) {
      return false;
    }

    form.removeAttribute(BYPASS_ATTR);
    if (bypassState.form === form) {
      bypassState.form = null;
    }
    if (
      submitter instanceof HTMLElement &&
      bypassState.element === submitter
    ) {
      submitter.removeAttribute(BYPASS_ATTR);
      bypassState.element = null;
    } else if (
      bypassState.element instanceof HTMLElement &&
      resolveEnclosingForm(bypassState.element) === form
    ) {
      bypassState.element.removeAttribute(BYPASS_ATTR);
      bypassState.element = null;
    }
    cleanupBypassState();

    return true;
  }

  function shouldBypassClick(element) {
    clearExpiredBypass();

    const matchesBypass =
      element.getAttribute(BYPASS_ATTR) === "1" ||
      (isBypassActive() && bypassState.element === element);
    if (!matchesBypass) {
      return false;
    }

    element.removeAttribute(BYPASS_ATTR);
    if (bypassState.element === element) {
      bypassState.element = null;
    }
    cleanupBypassState();

    return true;
  }

  function armBypass({ element = null, form = null }) {
    clearBypassNow();

    bypassState = {
      element: element instanceof HTMLElement ? element : null,
      form: form instanceof HTMLFormElement ? form : null,
      expiresAt: Date.now() + 1500
    };

    if (bypassState.element) {
      bypassState.element.setAttribute(BYPASS_ATTR, "1");
    }

    if (bypassState.form) {
      bypassState.form.setAttribute(BYPASS_ATTR, "1");
    }

    window.setTimeout(clearExpiredBypass, 1600);
  }

  function createEmptyBypassState() {
    return {
      element: null,
      form: null,
      expiresAt: 0
    };
  }

  function isBypassActive() {
    return bypassState.expiresAt > Date.now();
  }

  function clearExpiredBypass() {
    if (isBypassActive()) {
      return;
    }

    clearBypassNow();
  }

  function clearBypassNow() {
    if (bypassState.element && bypassState.element.isConnected) {
      bypassState.element.removeAttribute(BYPASS_ATTR);
    }

    if (bypassState.form && bypassState.form.isConnected) {
      bypassState.form.removeAttribute(BYPASS_ATTR);
    }

    bypassState = createEmptyBypassState();
  }

  function cleanupBypassState() {
    if (bypassState.element || bypassState.form) {
      return;
    }

    bypassState = createEmptyBypassState();
  }

  function openConfirmDialog(confirmContext) {
    return new Promise((resolve, reject) => {
      const existingRoot = document.getElementById(ROOT_ID);
      if (existingRoot) {
        existingRoot.remove();
      }

      const mountTarget = document.body || document.documentElement;
      if (!mountTarget) {
        reject(new Error("No mount target available"));
        return;
      }

      const host = document.createElement("div");
      host.id = ROOT_ID;

      let shadowRoot;
      try {
        shadowRoot = host.attachShadow({ mode: "open" });
      } catch (error) {
        reject(error);
        return;
      }

      const matchesMarkup =
        confirmContext.matches && confirmContext.matches.length > 0
          ? `
            <p class="matches" id="${MATCHES_ID}">
              Matched phrases: <strong>${escapeHtml(confirmContext.matches.join(", "))}</strong>
            </p>
          `
          : "";
      const describedBy = confirmContext.matches && confirmContext.matches.length > 0
        ? `${DESCRIPTION_ID} ${MATCHES_ID}`
        : DESCRIPTION_ID;

      shadowRoot.innerHTML = `
        <style>
          :host {
            all: initial;
          }

          .overlay {
            position: fixed;
            inset: 0;
            z-index: 2147483647;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px;
            background: rgba(15, 23, 42, 0.5);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }

          .dialog {
            width: min(380px, calc(100vw - 32px));
            box-sizing: border-box;
            border: 1px solid #d0d7de;
            border-radius: 16px;
            padding: 20px;
            background:
              linear-gradient(180deg, rgba(239, 246, 255, 0.92), rgba(255, 255, 255, 1));
            color: #0f172a;
            box-shadow: 0 20px 48px rgba(15, 23, 42, 0.22);
          }

          .dialog:focus-visible,
          button:focus-visible {
            outline: 2px solid #2563eb;
            outline-offset: 2px;
          }

          .eyebrow {
            margin: 0 0 8px;
            color: #2563eb;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.04em;
            text-transform: uppercase;
          }

          h2 {
            margin: 0 0 8px;
            font-size: 20px;
            line-height: 1.2;
          }

          p {
            margin: 0;
            color: #334155;
            font-size: 14px;
            line-height: 1.5;
          }

          .matches {
            margin-top: 12px;
            color: #0f172a;
          }

          .quiet-link {
            margin: 14px 0 0;
            border: none;
            padding: 0;
            background: transparent;
            color: #2563eb;
            font: inherit;
            text-decoration: underline;
            text-underline-offset: 2px;
            cursor: pointer;
          }

          .actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            margin-top: 18px;
          }

          button.action {
            min-width: 92px;
            border: 1px solid #cbd5e1;
            border-radius: 10px;
            padding: 10px 14px;
            background: #ffffff;
            color: #0f172a;
            font: inherit;
            cursor: pointer;
          }

          button.primary {
            border-color: #2563eb;
            background: #2563eb;
            color: #ffffff;
          }
        </style>
        <div class="overlay">
          <section
            class="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="${TITLE_ID}"
            aria-describedby="${describedBy}"
            tabindex="-1"
          >
            <p class="eyebrow">Submit Guard</p>
            <h2 id="${TITLE_ID}">Confirm submission</h2>
            <p id="${DESCRIPTION_ID}">${escapeHtml(confirmContext.description)}</p>
            ${matchesMarkup}
            <button id="${DISABLE_ID}" class="quiet-link" type="button">
              Don't ask again for this site
            </button>
            <div class="actions">
              <button id="${CANCEL_ID}" class="action" type="button">Cancel</button>
              <button id="${CONFIRM_ID}" class="action primary" type="button">Submit</button>
            </div>
          </section>
        </div>
      `;

      const overlay = shadowRoot.querySelector(".overlay");
      const dialog = shadowRoot.querySelector(".dialog");
      const disableButton = shadowRoot.getElementById(DISABLE_ID);
      const cancelButton = shadowRoot.getElementById(CANCEL_ID);
      const confirmButton = shadowRoot.getElementById(CONFIRM_ID);
      const previousFocus =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const focusableElements = [disableButton, cancelButton, confirmButton].filter(Boolean);

      if (!overlay || !dialog || !disableButton || !cancelButton || !confirmButton) {
        reject(new Error("Dialog elements are missing"));
        return;
      }

      let settled = false;

      const cleanup = () => {
        activeDialog = null;
        host.remove();

        if (previousFocus && previousFocus.isConnected) {
          previousFocus.focus({ preventScroll: true });
        }
      };

      const finish = (result) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        resolve(result);
      };

      const onKeydown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          finish("cancel");
          return;
        }

        if (event.key !== "Tab") {
          return;
        }

        event.preventDefault();
        const currentIndex = focusableElements.indexOf(shadowRoot.activeElement);
        const nextIndex = event.shiftKey
          ? (currentIndex >= 0 ? currentIndex : 0) - 1
          : currentIndex + 1;
        const safeIndex = (nextIndex + focusableElements.length) % focusableElements.length;
        focusableElements[safeIndex].focus();
      };

      const onOverlayClick = (event) => {
        if (event.target === overlay) {
          finish("cancel");
        }
      };

      shadowRoot.addEventListener("keydown", onKeydown);
      overlay.addEventListener("click", onOverlayClick);
      cancelButton.addEventListener("click", () => finish("cancel"));
      confirmButton.addEventListener("click", () => finish("confirm"));
      disableButton.addEventListener("click", () => finish("disable"));

      mountTarget.appendChild(host);
      dialog.focus({ preventScroll: true });
      activeDialog = {
        focus() {
          dialog.focus({ preventScroll: true });
        }
      };
    });
  }

  function extractGuardText(form, triggerElement) {
    if (form instanceof HTMLFormElement) {
      return extractTextFromContainer(form);
    }

    const nearestContainer =
      triggerElement instanceof Element
        ? triggerElement.closest("main, section, article, [role='dialog'], [role='form']")
        : null;

    return extractTextFromContainer(nearestContainer || document.body);
  }

  function extractTextFromContainer(container) {
    if (!(container instanceof Element)) {
      return "";
    }

    const chunks = [];
    const seen = new Set();

    if (container instanceof HTMLFormElement) {
      try {
        const formData = new FormData(container);
        for (const value of formData.values()) {
          pushChunk(chunks, seen, value);
        }
      } catch (_error) {
        // Ignore FormData failures and keep collecting visible text input.
      }
    }

    const currentActiveElement = document.activeElement;
    if (
      currentActiveElement instanceof HTMLElement &&
      container.contains(currentActiveElement)
    ) {
      pushChunk(chunks, seen, readEditableValue(currentActiveElement));
    }

    const editableSelector = [
      "textarea",
      "input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([type='button']):not([type='submit']):not([type='password'])",
      "[contenteditable='']",
      "[contenteditable='true']",
      "[role='textbox']"
    ].join(", ");
    const editableElements = container.querySelectorAll(editableSelector);
    for (const element of editableElements) {
      pushChunk(chunks, seen, readEditableValue(element));
      if (chunks.length >= 12) {
        break;
      }
    }

    return chunks.join("\n");
  }

  function readEditableValue(element) {
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      return element.value;
    }

    return element.textContent;
  }

  function pushChunk(chunks, seen, value) {
    const normalizedValue = typeof value === "string" ? value.trim() : "";
    if (!normalizedValue) {
      return;
    }

    const key = normalizedValue.toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    chunks.push(normalizedValue);
  }

  function findMatchingPhrases(text, riskyPhrases) {
    if (!text || !Array.isArray(riskyPhrases) || riskyPhrases.length === 0) {
      return [];
    }

    const matches = [];
    for (const phrase of riskyPhrases) {
      if (matchesPhrase(text, phrase)) {
        matches.push(phrase);
      }
    }

    return matches.slice(0, 4);
  }

  function matchesPhrase(text, phrase) {
    const normalizedPhrase = sanitizePhrase(phrase);
    if (!normalizedPhrase) {
      return false;
    }

    const escapedPhrase = normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const prefix = /^[a-z0-9]/i.test(normalizedPhrase) ? "(^|\\W)" : "";
    const suffix = /[a-z0-9]$/i.test(normalizedPhrase) ? "(?=\\W|$)" : "";

    return new RegExp(`${prefix}${escapedPhrase}${suffix}`, "i").test(text);
  }

  function notifyConfirmShown(hostname) {
    if (!hostname || !chrome.runtime || !chrome.runtime.sendMessage) {
      return Promise.resolve();
    }

    return chrome.runtime.sendMessage({
      type: "INCREMENT_CONFIRM_SHOWN",
      hostname
    });
  }

  function disableCurrentSite(hostname) {
    guardState = {
      ...guardState,
      enabled: false
    };

    if (!hostname || !chrome.runtime || !chrome.runtime.sendMessage) {
      return Promise.resolve();
    }

    return chrome.runtime.sendMessage({
      type: "DISABLE_HOST",
      hostname
    });
  }

  function readBootstrapState() {
    const safeState =
      window.__submitGuardBootstrap && typeof window.__submitGuardBootstrap === "object"
        ? window.__submitGuardBootstrap
        : null;
    if (!safeState) {
      return null;
    }

    const bootstrapHostname = normalizeHostname(safeState.hostname);
    if (bootstrapHostname && currentHostname && bootstrapHostname !== currentHostname) {
      return null;
    }

    return {
      hostname: bootstrapHostname || currentHostname,
      enabled: safeState.enabled === true,
      mode: sanitizeMode(safeState.mode),
      clickGuardEnabled: safeState.clickGuardEnabled === true,
      riskyPhrases: sanitizeRiskyPhrases(safeState.riskyPhrases)
    };
  }

  function resolveSiteEnabled(hostname, rawSiteSettings, rawLegacyEnabledHosts) {
    const normalizedHostname = normalizeHostname(hostname);
    if (!normalizedHostname) {
      return false;
    }

    const currentSettings =
      rawSiteSettings && typeof rawSiteSettings === "object"
        ? rawSiteSettings[normalizedHostname]
        : null;
    if (currentSettings && currentSettings.enabled === true) {
      return true;
    }

    return Boolean(
      rawLegacyEnabledHosts &&
        typeof rawLegacyEnabledHosts === "object" &&
        rawLegacyEnabledHosts[normalizedHostname] === true
    );
  }

  function resolveSiteMode(hostname, rawSiteSettings) {
    const normalizedHostname = normalizeHostname(hostname);
    if (!normalizedHostname || !rawSiteSettings || typeof rawSiteSettings !== "object") {
      return MODE_ALWAYS_CONFIRM;
    }

    const currentSettings = rawSiteSettings[normalizedHostname];
    return sanitizeMode(currentSettings && currentSettings.mode);
  }

  function resolveSiteClickGuardEnabled(hostname, rawSiteSettings) {
    const normalizedHostname = normalizeHostname(hostname);
    if (!normalizedHostname || !rawSiteSettings || typeof rawSiteSettings !== "object") {
      return false;
    }

    const currentSettings = rawSiteSettings[normalizedHostname];
    return Boolean(currentSettings && currentSettings.clickGuardEnabled === true);
  }

  function sanitizeMode(value) {
    return value === MODE_RISKY_PHRASES_ONLY ? value : MODE_ALWAYS_CONFIRM;
  }

  function sanitizeRiskyPhrases(rawRiskyPhrases) {
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

  function sanitizePhrase(value) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
  }

  function normalizeHostname(value) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
  }

  function warnFailOpen(scope, error) {
    console.warn("Submit Guard fail-open:", scope, error);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
})();
