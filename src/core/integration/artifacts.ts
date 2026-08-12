import fs from 'fs';
import path from 'path';
import type { IntegrationRunResult } from './schema.js';
import { redactSecrets } from './security-policy.js';

export function renderIntegrationReportMarkdown(result: IntegrationRunResult): string {
  const statusIcon = result.ok ? '✅ PASSED' : '❌ FAILED';
  const lines: string[] = [
    `# 🧪 BÁO CÁO INTEGRATION TEST HARNESS — ${statusIcon}`,
    '',
    `- **Run ID**: \`${result.runId}\``,
    `- **Trạng thái**: ${statusIcon}`,
    `- **Thời gian chạy**: \`${(result.durationMs / 1000).toFixed(2)}s\``,
    `- **Tổng số test**: \`${result.totalTests}\` (Pass: \`${result.passedTests}\`, Fail: \`${result.failedTests}\`)`,
    '',
    '---',
    '',
    '## 🔄 Tiến trình thực thi 10 Bước Sandbox (10-Step Lifecycle)',
    '',
    '| Bước | Tên tác vụ | Trạng thái | Thời gian | Chi tiết |',
    '| --- | --- | --- | --- | --- |',
  ];

  for (const step of result.steps) {
    const icon = step.ok ? '✅ OK' : '❌ FAIL';
    const detail = step.error ? `ERR: ${step.error}` : step.detail || 'Thành công';
    lines.push(
      `| Step ${step.stepIndex} | ${step.name} | ${icon} | ${step.durationMs}ms | ${redactSecrets(detail)} |`,
    );
  }

  if (result.failedTestNames.length > 0) {
    lines.push('', '---', '', '## ❌ Danh sách Test Case bị thất bại', '');
    for (const name of result.failedTestNames) {
      lines.push(`- **${name}**`);
    }
  }

  lines.push('', '---', '', '*Báo cáo được tự động khởi tạo bởi Playwright-AI-TestKit Integration Sandbox Harness.*');
  return lines.join('\n');
}

export function saveIntegrationArtifacts(
  result: IntegrationRunResult,
  outputDir = 'artifacts',
): void {
  fs.mkdirSync(path.join(outputDir, 'reports'), { recursive: true });

  const mdReport = renderIntegrationReportMarkdown(result);
  const mdPath = path.join(outputDir, 'reports', `integration-${result.runId}.md`);
  fs.writeFileSync(mdPath, mdReport);
  fs.writeFileSync(path.join(outputDir, 'reports', 'integration-latest.md'), mdReport);

  const jsonPath = path.join(outputDir, 'test-results-integration.json');
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));

  console.log(`\n📄 Đã lưu báo cáo Integration tại: ${mdPath}`);
}
