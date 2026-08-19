/**
 * Universal JUnit XML Reporter for API Contract Testing
 *
 * Xuất file XML chuẩn JUnit (artifacts/api-test-report.xml)
 * tương thích với các công cụ kiểm thử, IDE và trình đọc báo cáo chuẩn quốc tế.
 */

import fs from 'fs';
import path from 'path';
import type { ApiTestRunResult, ApiTestResult } from './schema.js';

export function renderJunitXmlReport(result: ApiTestRunResult): string {
  const durationSec = (result.durationMs / 1000).toFixed(3);
  const timestamp = new Date(result.startedAt).toISOString();

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<testsuites name="API Integration Test Suite" tests="${result.totalTests}" failures="${result.failedTests}" errors="0" time="${durationSec}" timestamp="${timestamp}">\n`;
  xml += `  <testsuite name="API Contract Tests" tests="${result.totalTests}" failures="${result.failedTests}" errors="0" time="${durationSec}" timestamp="${timestamp}" hostname="localhost">\n`;

  for (const test of result.tests) {
    const testDuration = (test.durationMs / 1000).toFixed(3);
    const className = escapeXml(test.request.method + ' ' + (test.request.url || test.name));
    const testName = escapeXml(test.id);

    xml += `    <testcase classname="${className}" name="${testName}" time="${testDuration}">\n`;

    if (!test.ok) {
      const failedAssertion = test.assertions.find(a => !a.ok);
      const failureMsg = escapeXml(failedAssertion?.message || test.error || 'Test failed');
      const failureDetail = escapeXml(
        `Endpoint: ${test.request.method} ${test.request.url}\n` +
        `HTTP Status: ${test.response?.status ?? 'No response'}\n` +
        `Response Body: ${test.response?.rawBody ?? ''}\n` +
        `Oracle: ${test.oracle?.intentType ?? 'SPECIFICATION'}`
      );
      xml += `      <failure message="${failureMsg}" type="AssertionError">\n`;
      xml += `        ${failureDetail}\n`;
      xml += `      </failure>\n`;
    }

    if (test.name.includes('(SKIPPED)') || test.response?.statusText === 'SKIPPED') {
      xml += `      <skipped message="Skipped by Safe Mode rule" />\n`;
    }

    xml += `    </testcase>\n`;
  }

  xml += `  </testsuite>\n`;
  xml += `</testsuites>\n`;

  return xml;
}

function escapeXml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function writeJunitXmlReport(result: ApiTestRunResult, outputPath = 'artifacts/api-test-report.xml'): string {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const xml = renderJunitXmlReport(result);
  fs.writeFileSync(outputPath, xml, 'utf-8');
  return outputPath;
}
