export type PlannerStepType = 'goto' | 'fill' | 'click' | 'select' | 'check' | 'wait' | 'noop';

export type ParsedAssertion =
  | { kind: 'text_visible'; value: string }
  | { kind: 'url_contains'; value: string }
  | { kind: 'url_not_contains'; value: string }
  | { kind: 'attribute'; target: 'password'; name: 'type'; value: 'password' | 'text' }
  | { kind: 'unknown'; value: string };

export interface ParsedStep {
  type: PlannerStepType;
  target?: string;
  value?: string;
  url?: string;
  context?: string;
  assertion?: string;
  assertions?: ParsedAssertion[];
  raw: string;
  sourceLine?: string;
  plannerConfidence?: 'high' | 'medium' | 'low';
  needsClarification?: boolean;
  clarificationQuestion?: string;
}

export interface ParsedTestCase {
  id: string;
  name: string;
  url?: string;
  steps: ParsedStep[];
  unparsedSteps: string[];
}

export interface PlannerTestCase extends ParsedTestCase {
  module?: string;
  objective?: string;
  preconditions?: string[];
  expectedResults?: string[];
  priority?: 'Critical' | 'High' | 'Medium' | 'Low';
  testType?: string[];
  automationSuitability?: 'Yes' | 'No' | 'Partial';
  notes?: string[];
}

export interface PlannerClarification {
  testCaseId: string;
  sourceLine: string;
  question: string;
  missingFields: string[];
}

export interface StructuredE2EPlan {
  version: 2;
  source: 'ai-planner';
  testCases: PlannerTestCase[];
  clarifications: PlannerClarification[];
}

export function plannerPlanToTestCases(plan: StructuredE2EPlan): ParsedTestCase[] {
  return plan.testCases.map(testCase => ({
    id: testCase.id,
    name: testCase.name,
    url: testCase.url,
    steps: testCase.steps,
    unparsedSteps: testCase.unparsedSteps || [],
  }));
}
