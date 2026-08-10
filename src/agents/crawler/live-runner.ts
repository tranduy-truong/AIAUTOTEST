import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { ParsedTestCase, ParsedStep } from '../../core/step-parser.js';
import { ElementInfo, DomSnapshot } from '../../core/locator-resolver.js';

// Hàm hỗ trợ chụp ảnh DOM
async function captureSnapshot(page: Page, afterStepDescription: string): Promise<DomSnapshot> {
  const elements = await page.evaluate(() => {
    const query = 'input, textarea, select, button, [role="button"], [role="combobox"], a[href], [role="option"], [role="dialog"]';
    const nodes = document.querySelectorAll(query);
    const result: any[] = [];

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i] as HTMLElement;
      
      // Kiểm tra xem phần tử có hiển thị không
      let isVisible = false;
      if (node.offsetParent !== null) {
        isVisible = true;
      } else {
        const rect = node.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          isVisible = true;
        }
      }

      result.push({
        tag: node.tagName.toLowerCase(),
        type: (node as HTMLInputElement).type || undefined,
        role: node.getAttribute('role') || undefined,
        placeholder: node.getAttribute('placeholder') || undefined,
        ariaLabel: node.getAttribute('aria-label') || undefined,
        text: (node.textContent || '').trim().substring(0, 100),
        testId: node.getAttribute('data-testid') || undefined,
        id: node.id || undefined,
        name: (node as HTMLInputElement).name || undefined,
        className: (node.className || '').toString().substring(0, 80),
        isVisible
      });
    }
    return result;
  });

  return {
    url: page.url(),
    elements: elements as ElementInfo[],
    stepDescription: afterStepDescription,
    timestamp: Date.now()
  };
}

export async function runLive(testCases: ParsedTestCase[]): Promise<Map<string, DomSnapshot[]>> {
  const snapshotsMap = new Map<string, DomSnapshot[]>();
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    // Khởi chạy trình duyệt chromium (headless: true)
    browser = await chromium.launch({ headless: true });
    // Tạo một context duy nhất để giữ cookies/session
    context = await browser.newContext();

    for (const testCase of testCases) {
      console.log(`[Live Runner] Dang thuc thi ${testCase.id}...`);
      const snapshots: DomSnapshot[] = [];
      const page = await context.newPage();

      let stepIndex = 1;
      for (const step of testCase.steps) {
        try {
          switch (step.type) {
            case 'goto':
              console.log(`[Live Runner]   Step ${stepIndex}: goto ${step.url}`);
              await page.goto(step.url as string, { timeout: 10000 });
              await page.waitForLoadState('networkidle', { timeout: 10000 });
              const gotoSnap = await captureSnapshot(page, `goto ${step.url}`);
              snapshots.push(gotoSnap);
              console.log(`[Live Runner]   DOM snapshot captured (${gotoSnap.elements.length} elements)`);
              break;
              
            case 'fill':
              console.log(`[Live Runner]   Step ${stepIndex}: fill '${step.target}' = '${step.value}'`);
              // Tìm bằng placeholder trước, nếu không có thì tìm bằng label (text)
              const inputLocator = page.getByPlaceholder(step.target as string).or(page.getByLabel(step.target as string)).first();
              await inputLocator.fill(step.value as string, { timeout: 10000 });
              // Không cần DOM snapshot
              break;

            case 'click':
              console.log(`[Live Runner]   Step ${stepIndex}: click '${step.target}'`);
              const btnLocator = page.getByText(step.target as string).or(page.getByRole('button', { name: step.target as string })).first();
              await btnLocator.click({ timeout: 10000 });
              // Chờ 1s cho các navigation hoặc modal hiển thị
              await page.waitForTimeout(1000);
              const clickSnap = await captureSnapshot(page, `click ${step.target}`);
              snapshots.push(clickSnap);
              console.log(`[Live Runner]   DOM snapshot captured (${clickSnap.elements.length} elements)`);
              break;

            case 'select':
              console.log(`[Live Runner]   Step ${stepIndex}: select '${step.value}' in '${step.target}'`);
              const selectLocator = page.getByText(step.target as string).or(page.getByRole('combobox', { name: step.target as string })).first();
              await selectLocator.click({ timeout: 10000 });
              await page.waitForTimeout(500);
              const optionLocator = page.getByRole('option', { name: step.value as string }).first();
              await optionLocator.click({ timeout: 10000 });
              const selectSnap = await captureSnapshot(page, `select ${step.value}`);
              snapshots.push(selectSnap);
              console.log(`[Live Runner]   DOM snapshot captured (${selectSnap.elements.length} elements)`);
              break;

            case 'check':
              console.log(`[Live Runner]   Step ${stepIndex}: check '${step.assertion}' (skipped)`);
              // Bỏ qua thực thi cho check steps
              break;

            case 'wait':
              console.log(`[Live Runner]   Step ${stepIndex}: wait`);
              await page.waitForLoadState('networkidle', { timeout: 10000 });
              break;
          }
        } catch (error) {
          console.warn(`[Live Runner]   WARNING: Step ${stepIndex} that bai - ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        stepIndex++;
      }

      snapshotsMap.set(testCase.id, snapshots);
      await page.close();
    }
  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
  }

  return snapshotsMap;
}
