import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// -- Types --------------------------------------------------------------------

interface Viewport {
  width: number;
  height: number;
}

// Playwright types are not imported to keep the dynamic import pattern.
// We use loose types here since playwright is lazily loaded.
type PlaywrightBrowser = any;
type PlaywrightPage = any;

// -- Module State -------------------------------------------------------------

let browser: PlaywrightBrowser | null = null;
let browserPromise: Promise<PlaywrightBrowser> | null = null;
let playwright: any = null;

// -- Helpers ------------------------------------------------------------------

function isHostAllowed(hostname: string, allowedHosts: string[]): boolean {
  if (allowedHosts.length === 0) return false;
  if (allowedHosts.includes("*")) return true;
  return allowedHosts.some((allowed) => {
    if (allowed.startsWith("*.")) {
      const domain = allowed.slice(2);
      return hostname === domain || hostname.endsWith("." + domain);
    }
    return hostname === allowed;
  });
}

async function getBrowser(headless: boolean): Promise<PlaywrightBrowser> {
  if (browser) return browser;
  if (browserPromise) return browserPromise;

  browserPromise = (async () => {
    if (!playwright) {
      try {
        playwright = await import("playwright");
      } catch {
        throw new Error("Playwright is not installed. Run: bun add playwright");
      }
    }
    const { chromium } = playwright;
    browser = await chromium.launch({ headless });
    return browser;
  })();

  try {
    browser = await browserPromise;
    return browser!;
  } finally {
    browserPromise = null;
  }
}

function getWaitUntil(waitFor: string | undefined): string {
  if (waitFor === "networkidle") return "networkidle";
  if (waitFor === "domcontentloaded") return "domcontentloaded";
  return "load";
}

// -- Actions ------------------------------------------------------------------

async function actionFetch(page: PlaywrightPage): Promise<Record<string, unknown>> {
  const html = await page.content();
  const title = await page.title();
  const url = page.url();
  return { action: "fetch", url, title, html };
}

async function actionScreenshot(
  page: PlaywrightPage,
  fullPage: boolean
): Promise<Record<string, unknown>> {
  const buffer: Buffer = await page.screenshot({ fullPage, type: "png" });
  const viewport = page.viewportSize();
  return {
    action: "screenshot",
    image: buffer.toString("base64"),
    format: "png",
    width: viewport?.width ?? 1280,
    height: viewport?.height ?? 720,
    fullPage,
  };
}

async function actionPdf(page: PlaywrightPage): Promise<Record<string, unknown>> {
  const buffer: Buffer = await page.pdf({ format: "A4", printBackground: true });
  return {
    action: "pdf",
    data: buffer.toString("base64"),
    format: "A4",
    size: buffer.length,
  };
}

async function actionEvaluate(
  page: PlaywrightPage,
  script: string | undefined,
  consoleLogs: string[]
): Promise<Record<string, unknown>> {
  if (!script) {
    return { action: "evaluate", error: "script is required for evaluate action" };
  }
  try {
    const result = await page.evaluate(script);
    return { action: "evaluate", result, logs: consoleLogs };
  } catch (err: any) {
    return { action: "evaluate", error: err.message, logs: consoleLogs };
  }
}

async function actionClick(
  page: PlaywrightPage,
  selector: string | undefined
): Promise<Record<string, unknown>> {
  if (!selector) {
    return { action: "click", error: "selector is required for click action" };
  }
  await page.click(selector);
  return { action: "click", success: true, selector };
}

async function actionFill(
  page: PlaywrightPage,
  selector: string | undefined,
  value: string | undefined
): Promise<Record<string, unknown>> {
  if (!selector) {
    return { action: "fill", error: "selector is required for fill action" };
  }
  if (value === undefined) {
    return { action: "fill", error: "value is required for fill action" };
  }
  await page.fill(selector, value);
  return { action: "fill", success: true, selector, value };
}

async function actionWait(
  page: PlaywrightPage,
  selectorOrCondition: string | undefined,
  timeout: number
): Promise<Record<string, unknown>> {
  if (!selectorOrCondition) {
    return { action: "wait", error: "selector or waitFor is required for wait action" };
  }
  if (selectorOrCondition === "networkidle") {
    await page.waitForLoadState("networkidle", { timeout });
  } else {
    await page.waitForSelector(selectorOrCondition, { timeout });
  }
  return { action: "wait", success: true, waitedFor: selectorOrCondition };
}

// -- Execute ------------------------------------------------------------------

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const url = args.url as string | undefined;
  const action = (args.action as string) ?? "fetch";
  const waitFor = args.waitFor as string | undefined;
  const timeout = args.timeout as number | undefined;
  const script = args.script as string | undefined;
  const selector = args.selector as string | undefined;
  const value = args.value as string | undefined;
  const fullPage = (args.fullPage as boolean) ?? false;
  const viewport = args.viewport as Viewport | undefined;
  const userAgent = args.userAgent as string | undefined;
  const extraHeaders = args.extraHeaders as Record<string, string> | undefined;

  const allowedHosts = (ctx.config.httpAllowedHosts as string[]) ?? [];
  const defaultTimeout = (ctx.config.browserTimeout as number) ?? 30_000;
  const headless = (ctx.config.browserHeadless as boolean) ?? true;
  const defaultViewport: Viewport = (ctx.config.browserViewport as Viewport) ?? {
    width: 1280,
    height: 720,
  };

  if (!url) return formatError("url is required");

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return formatError(`Invalid URL: ${url}`);
  }

  if (!isHostAllowed(parsedUrl.hostname, allowedHosts)) {
    return formatError(
      `Host not allowed: ${parsedUrl.hostname}. Configure allowedHosts to enable access.`
    );
  }

  const pageTimeout = timeout ?? defaultTimeout;

  try {
    const bro = await getBrowser(headless);
    const context = await bro.newContext({
      viewport: viewport ?? defaultViewport,
      userAgent,
      extraHTTPHeaders: extraHeaders,
    });

    const page = await context.newPage();
    page.setDefaultTimeout(pageTimeout);

    // Collect console messages for evaluate action
    const consoleLogs: string[] = [];
    if (action === "evaluate") {
      page.on("console", (msg: any) => {
        consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
      });
    }

    try {
      // Navigate to URL
      const waitUntil = getWaitUntil(waitFor);
      await page.goto(url, { waitUntil, timeout: pageTimeout });

      // Wait for selector if specified
      if (waitFor && !["load", "domcontentloaded", "networkidle"].includes(waitFor)) {
        await page.waitForSelector(waitFor, { timeout: pageTimeout });
      }

      // Execute action
      let result: Record<string, unknown>;
      switch (action) {
        case "fetch":
          result = await actionFetch(page);
          break;
        case "screenshot":
          result = await actionScreenshot(page, fullPage);
          break;
        case "pdf":
          result = await actionPdf(page);
          break;
        case "evaluate":
          result = await actionEvaluate(page, script, consoleLogs);
          break;
        case "click":
          result = await actionClick(page, selector);
          break;
        case "fill":
          result = await actionFill(page, selector, value);
          break;
        case "wait":
          result = await actionWait(page, selector ?? waitFor, pageTimeout);
          break;
        default:
          return formatError(
            `Invalid action: ${action}. Use 'fetch', 'screenshot', 'pdf', 'evaluate', 'click', 'fill', or 'wait'.`
          );
      }

      return formatResponse(result);
    } finally {
      await context.close();
    }
  } catch (err: any) {
    if (err.message.includes("Playwright is not installed")) {
      return formatError(err.message);
    }
    return formatError(`Browser error: ${err.message}`);
  }
}

// -- Tool Definition ----------------------------------------------------------

const browserRequestTool: Tool = {
  name: "browser_request",
  description:
    "Navigate to URLs with a headless Chromium browser. Supports fetching rendered HTML, screenshots, PDFs, JavaScript evaluation, and page interactions (click, fill).",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        format: "uri",
        description: "URL to navigate to",
      },
      action: {
        type: "string",
        enum: ["fetch", "screenshot", "pdf", "evaluate", "click", "fill", "wait"],
        default: "fetch",
        description: "Action to perform after navigation",
      },
      waitFor: {
        type: "string",
        description:
          'CSS selector to wait for, or "networkidle", "load", "domcontentloaded"',
      },
      timeout: {
        type: "integer",
        minimum: 1000,
        maximum: 120000,
        default: 30000,
        description: "Page timeout in milliseconds",
      },
      script: {
        type: "string",
        description: "JavaScript code to execute in page context (for evaluate action)",
      },
      selector: {
        type: "string",
        description: "CSS selector for element (for click, fill, wait actions)",
      },
      value: {
        type: "string",
        description: "Value to fill (for fill action)",
      },
      fullPage: {
        type: "boolean",
        default: false,
        description: "Capture full page screenshot (for screenshot action)",
      },
      viewport: {
        type: "object",
        properties: {
          width: {
            type: "integer",
            minimum: 320,
            maximum: 3840,
            default: 1280,
          },
          height: {
            type: "integer",
            minimum: 240,
            maximum: 2160,
            default: 720,
          },
        },
        description: "Browser viewport size",
      },
      userAgent: {
        type: "string",
        description: "Custom User-Agent string",
      },
      extraHeaders: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "Extra HTTP headers to send with requests",
      },
    },
    required: ["url"],
  },
  execute,
};

export default browserRequestTool;
