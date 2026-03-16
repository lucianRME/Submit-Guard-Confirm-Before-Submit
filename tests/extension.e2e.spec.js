const fs = require("fs/promises");
const http = require("http");
const os = require("os");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { chromium } = require("playwright");
const AxeBuilder = require("@axe-core/playwright").default;

const EXTENSION_PATH = path.resolve(__dirname, "..", "extension");
const FIXTURES_PATH = path.resolve(__dirname, "fixtures");

let fixtureServer;

test.beforeAll(async () => {
  fixtureServer = await startFixtureServer();
});

test.afterAll(async () => {
  if (fixtureServer) {
    await fixtureServer.close();
  }
});

test("shows the modal, passes axe, closes on Escape, cancels, and confirms once @a11y", async () => {
  const extension = await launchExtensionContext();

  try {
    const page = await extension.context.newPage();
    await page.goto(fixtureServer.url("/form.html"));

    await configureSiteWithPopup(extension, page, { enabled: true });
    await page.reload();

    await page.click("#submit-button");
    const dialog = page.getByRole("dialog", { name: "Confirm submission" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeFocused();

    const axeResults = await new AxeBuilder({ page }).include("#submit-guard-root").analyze();
    const severeViolations = axeResults.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact)
    );
    expect(severeViolations).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.locator("#status")).toHaveText("submitted=false native=0 js=0");

    await page.click("#submit-button");
    await expect(dialog).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("#status")).toHaveText("submitted=false native=0 js=0");

    await page.click("#submit-button");
    await expect(dialog).toBeVisible();
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("#status")).toHaveText("submitted=true native=1 js=0");
  } finally {
    await closeExtensionContext(extension);
  }
});

test("click guard intercepts submit-like JS buttons", async () => {
  const extension = await launchExtensionContext();

  try {
    const page = await extension.context.newPage();
    await page.goto(fixtureServer.url("/form.html"));

    await configureSiteWithPopup(extension, page, {
      enabled: true,
      clickGuardEnabled: true
    });
    await page.reload();

    await page.click("#js-submit-button");
    const dialog = page.getByRole("dialog", { name: "Confirm submission" });
    await expect(dialog).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator("#status")).toHaveText("submitted=false native=0 js=0");

    await page.click("#js-submit-button");
    await expect(dialog).toBeVisible();
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("#status")).toHaveText("submitted=true native=0 js=1");
  } finally {
    await closeExtensionContext(extension);
  }
});

test("click guard cooperates with native submit buttons", async () => {
  const extension = await launchExtensionContext();

  try {
    const page = await extension.context.newPage();
    await page.goto(fixtureServer.url("/form.html"));

    await configureSiteWithPopup(extension, page, {
      enabled: true,
      clickGuardEnabled: true
    });
    await page.reload();

    await page.click("#submit-button");
    const dialog = page.getByRole("dialog", { name: "Confirm submission" });
    await expect(dialog).toBeVisible();
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("#status")).toHaveText("submitted=true native=1 js=0");
  } finally {
    await closeExtensionContext(extension);
  }
});

test("risky phrases only prompts selectively", async () => {
  const extension = await launchExtensionContext();

  try {
    const page = await extension.context.newPage();
    await page.goto(fixtureServer.url("/form.html"));

    await configureSiteWithPopup(extension, page, {
      mode: "risky_phrases_only",
      enabled: true
    });
    await page.reload();

    await page.fill("#message", "Quick note with no trigger phrases.");
    await page.click("#submit-button");
    await expect(page.locator("#status")).toHaveText("submitted=true native=1 js=0");
    await expect(page.getByRole("dialog", { name: "Confirm submission" })).toHaveCount(0);

    await page.evaluate(() => window.__resetSubmitState());
    await page.fill("#message", "Attached is the final draft. See link below before sending.");
    await page.click("#submit-button");

    const dialog = page.getByRole("dialog", { name: "Confirm submission" });
    await expect(dialog).toBeVisible();
    await expect(page.getByText(/Matched phrases:/)).toBeVisible();
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.locator("#status")).toHaveText("submitted=true native=1 js=0");
  } finally {
    await closeExtensionContext(extension);
  }
});

test("dont ask again disables the current site", async () => {
  const extension = await launchExtensionContext();

  try {
    const page = await extension.context.newPage();
    await page.goto(fixtureServer.url("/form.html"));

    await configureSiteWithPopup(extension, page, { enabled: true });
    await page.reload();

    await page.click("#submit-button");
    const dialog = page.getByRole("dialog", { name: "Confirm submission" });
    await expect(dialog).toBeVisible();
    await page.getByRole("button", { name: "Don't ask again for this site" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("#status")).toHaveText("submitted=false native=0 js=0");

    const popupPage = await openPopupForTarget(extension, page);
    await expect(popupPage.locator("#site-toggle")).not.toBeChecked();
    await popupPage.close();

    await page.reload();
    await page.click("#submit-button");
    await expect(page.locator("#status")).toHaveText("submitted=true native=1 js=0");
    await expect(page.getByRole("dialog", { name: "Confirm submission" })).toHaveCount(0);
  } finally {
    await closeExtensionContext(extension);
  }
});

test("toggle off disables protection after reload", async () => {
  const extension = await launchExtensionContext();

  try {
    const page = await extension.context.newPage();
    await page.goto(fixtureServer.url("/form.html"));

    await configureSiteWithPopup(extension, page, { enabled: true });
    await configureSiteWithPopup(extension, page, { enabled: false });
    await page.reload();

    await page.click("#submit-button");
    await expect(page.locator("#status")).toHaveText("submitted=true native=1 js=0");
    await expect(page.getByRole("dialog", { name: "Confirm submission" })).toHaveCount(0);
  } finally {
    await closeExtensionContext(extension);
  }
});

async function launchExtensionContext() {
  const extensionPath = await prepareTestExtension();
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "submit-guard-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: !process.env.PW_HEADFUL,
    viewport: { width: 1280, height: 960 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  const serviceWorker =
    context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(serviceWorker.url()).host;

  return {
    context,
    extensionId,
    extensionPath,
    serviceWorker,
    userDataDir
  };
}

async function closeExtensionContext(extension) {
  await extension.context.close();
  await fs.rm(extension.extensionPath, { recursive: true, force: true });
  await fs.rm(extension.userDataDir, { recursive: true, force: true });
}

async function configureSiteWithPopup(extension, targetPage, options) {
  const popupPage = await openPopupForTarget(extension, targetPage);
  const hostname = new URL(targetPage.url()).hostname;

  await expect(popupPage.locator("#hostname")).toHaveText(hostname);

  if (options.mode) {
    const modeSelect = popupPage.locator("#mode-select");
    if ((await modeSelect.inputValue()) !== options.mode) {
      await modeSelect.selectOption(options.mode);
      await expect(popupPage.locator("#status")).toContainText("Mode saved");
    }
  }

  if (typeof options.enabled === "boolean") {
    const toggle = popupPage.locator("#site-toggle");
    if ((await toggle.isChecked()) !== options.enabled) {
      await toggle.click();
      await expect(popupPage.locator("#status")).toContainText(
        options.enabled ? "Protection enabled" : "Protection disabled"
      );
    }
  }

  if (typeof options.clickGuardEnabled === "boolean") {
    const clickGuardToggle = popupPage.locator("#click-guard-toggle");
    await expect(clickGuardToggle).toBeEnabled();

    if ((await clickGuardToggle.isChecked()) !== options.clickGuardEnabled) {
      await clickGuardToggle.click();
      await expect(popupPage.locator("#status")).toContainText("Advanced click guard");
    }
  }

  await popupPage.close();
}

async function openPopupForTarget(extension, targetPage) {
  const tabInfo = await resolveActiveTabInfo(extension.serviceWorker, targetPage);
  const popupPage = await extension.context.newPage();
  const popupUrl = new URL(
    `chrome-extension://${extension.extensionId}/popup/popup.html`
  );

  popupUrl.search = new URLSearchParams({
    tabId: String(tabInfo.id),
    tabUrl: tabInfo.url || targetPage.url()
  }).toString();

  await popupPage.goto(popupUrl.toString());
  return popupPage;
}

async function resolveActiveTabInfo(serviceWorker, targetPage) {
  await targetPage.bringToFront();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const tabInfo = await serviceWorker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return tab && typeof tab.id === "number"
        ? { id: tab.id, url: typeof tab.url === "string" ? tab.url : "" }
        : null;
    });

    if (tabInfo) {
      return tabInfo;
    }

    await targetPage.waitForTimeout(100);
  }

  throw new Error("Unable to resolve the active tab for popup testing.");
}

async function startFixtureServer() {
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    const pathname = requestUrl.pathname === "/" ? "/form.html" : requestUrl.pathname;
    const filePath = path.join(FIXTURES_PATH, pathname.slice(1));

    if (!filePath.startsWith(FIXTURES_PATH)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    try {
      const body = await fs.readFile(filePath);
      response.writeHead(200, { "content-type": getContentType(filePath) });
      response.end(body);
    } catch (_error) {
      response.writeHead(404);
      response.end("Not found");
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    url(pathname) {
      return `${origin}${pathname}`;
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };
}

function getContentType(filePath) {
  if (filePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }

  if (filePath.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }

  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }

  return "text/plain; charset=utf-8";
}

async function prepareTestExtension() {
  const testExtensionPath = await fs.mkdtemp(path.join(os.tmpdir(), "submit-guard-extension-"));
  await fs.cp(EXTENSION_PATH, testExtensionPath, { recursive: true });

  const manifestPath = path.join(testExtensionPath, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const hostPermissions = Array.isArray(manifest.host_permissions)
    ? manifest.host_permissions
    : [];

  manifest.host_permissions = Array.from(
    new Set([...hostPermissions, "http://127.0.0.1/*"])
  );

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return testExtensionPath;
}
