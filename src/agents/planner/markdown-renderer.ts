import type { PlannerTestCase, StructuredE2EPlan } from './schema.js';

function cell(value: unknown): string {
  if (Array.isArray(value)) return value.map(item => cell(item)).filter(Boolean).join('<br>');
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>')
    .trim();
}

function stepText(testCase: PlannerTestCase): string {
  return testCase.steps.map((step, index) => {
    const parts = [step.raw || step.sourceLine || step.type];
    if (step.type === 'noop') parts.push('(giữ nguyên/để trống)');
    return `${index + 1}. ${parts.join(' ')}`;
  }).join('<br>');
}

function testData(testCase: PlannerTestCase): string {
  return testCase.steps
    .flatMap(step => {
      if (step.type === 'fill' && step.target) return [`${step.target}: ${step.value ?? ''}`];
      if (step.type === 'select' && step.target) return [`${step.target}: ${step.value ?? ''}`];
      if (step.type === 'noop') return [step.raw || step.sourceLine || 'Để trống'];
      return [];
    })
    .join('<br>');
}

export function renderStructuredPlanMarkdown(plan: StructuredE2EPlan): string {
  const lines = [
    '# E2E Test Plan',
    '',
    '| ID | Module | Test Case Name | Objective | Preconditions | Test Steps | Test Data | Expected Result | Priority | Test Type | Automation Suitability | Notes |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const testCase of plan.testCases) {
    lines.push(`| ${[
      testCase.id,
      testCase.module,
      testCase.name,
      testCase.objective,
      testCase.preconditions,
      stepText(testCase),
      testData(testCase),
      testCase.expectedResults,
      testCase.priority,
      testCase.testType,
      testCase.automationSuitability,
      testCase.notes,
    ].map(cell).join(' | ')} |`);
  }

  lines.push('', '## Clarifications');
  if (plan.clarifications.length === 0) {
    lines.push('', '- Không có.');
  } else {
    for (const clarification of plan.clarifications) {
      lines.push('', `- **${clarification.testCaseId}** — ${clarification.question}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
