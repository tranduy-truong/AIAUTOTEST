import { describe, expect, it } from 'vitest';
import { renderStructuredPlanMarkdown } from '../../src/agents/planner/markdown-renderer.js';
import { normalizePlannerOutput } from '../../src/agents/planner/normalizer.js';
import {
  plannerPlanToTestCases,
  type ParsedStep,
  type StructuredE2EPlan,
} from '../../src/agents/planner/schema.js';
import { validateStructuredE2EPlan } from '../../src/agents/planner/validator.js';
import { splitE2EScript } from '../../src/agents/planner/run.js';

const compoundLine = "Mở dropdown 'Trụ sở chính', nhập 'Chùa Vĩnh Nghiêm' vào thanh tìm kiếm hiện lên, sau đó chọn 'Chùa Vĩnh Nghiêm'";
const sourceScript = [
  'TC_01: Thêm tổ chức',
  '- Mở URL: https://example.com/to-chuc',
  `- ${compoundLine}`,
  '- Tên quốc tế bỏ trống',
  '- Kiểm tra: Có cả 2 thông báo "A" và "B"',
].join('\n');

function validSteps(): ParsedStep[] {
  return [
    {
      type: 'goto',
      url: 'https://example.com/to-chuc',
      raw: 'Mở URL https://example.com/to-chuc',
      sourceLine: 'Mở URL: https://example.com/to-chuc',
      plannerConfidence: 'high',
    },
    {
      type: 'click',
      target: 'Trụ sở chính',
      raw: "Mở dropdown 'Trụ sở chính'",
      sourceLine: compoundLine,
      plannerConfidence: 'high',
    },
    {
      type: 'fill',
      target: 'thanh tìm kiếm',
      value: 'Chùa Vĩnh Nghiêm',
      context: 'Trụ sở chính',
      raw: "Nhập 'Chùa Vĩnh Nghiêm' vào thanh tìm kiếm",
      sourceLine: compoundLine,
      plannerConfidence: 'high',
    },
    {
      type: 'click',
      target: 'Chùa Vĩnh Nghiêm',
      context: 'Trụ sở chính',
      raw: "Chọn 'Chùa Vĩnh Nghiêm'",
      sourceLine: compoundLine,
      plannerConfidence: 'high',
    },
    {
      type: 'noop',
      target: 'Tên quốc tế',
      raw: 'Tên quốc tế bỏ trống',
      sourceLine: 'Tên quốc tế bỏ trống',
      plannerConfidence: 'high',
    },
    {
      type: 'check',
      assertions: [
        { kind: 'text_visible', value: 'A' },
        { kind: 'text_visible', value: 'B' },
      ],
      raw: 'Kiểm tra hai thông báo A và B',
      sourceLine: 'Kiểm tra: Có cả 2 thông báo "A" và "B"',
      plannerConfidence: 'high',
    },
  ];
}

function validPlan(steps = validSteps()): StructuredE2EPlan {
  return {
    version: 2,
    source: 'ai-planner',
    testCases: [{
      id: 'TC_01',
      name: 'Thêm tổ chức',
      module: 'Tổ chức',
      expectedResults: ['A', 'B'],
      steps,
      unparsedSteps: [],
    }],
    clarifications: [],
  };
}

describe('AI Planner structured contract', () => {
  it('re-anchors quote-only formatting changes to the exact user line', () => {
    const script = [
      'TC_01: Thêm tổ chức',
      '- Bấm nút có chữ "Thêm"',
    ].join('\n');
    const plan: StructuredE2EPlan = {
      version: 2,
      source: 'ai-planner',
      testCases: [{
        id: 'TC_01',
        name: 'Thêm tổ chức',
        steps: [{
          type: 'click',
          target: 'Thêm',
          raw: 'Bấm nút Thêm',
          sourceLine: "Bấm nút có chữ 'Thêm'",
          plannerConfidence: 'high',
        }],
        unparsedSteps: [],
      }],
      clarifications: [],
    };

    expect(validateStructuredE2EPlan(plan, script)).toEqual({ valid: true, issues: [] });
    expect(plan.testCases[0].steps[0].sourceLine).toBe('Bấm nút có chữ "Thêm"');
  });

  it('still rejects a source line that drops meaningful words', () => {
    const plan = validPlan();
    plan.testCases[0].steps[1].sourceLine = "Mở 'Trụ sở chính'";

    const result = validateStructuredE2EPlan(plan, sourceScript);

    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'UNGROUNDED_STEP' }));
  });

  it('accepts a non-contiguous row context derived from the same Vietnamese source line', () => {
    const line = "Tại dòng dữ liệu mã tổ chức là ' TC010', bấm nút chỉnh sửa có biểu tượng cây bút dưới cột 'Thao tác'";
    const script = ['TC_03: Chỉnh sửa thông tin tổ chức', `- ${line}`].join('\n');
    const plan: StructuredE2EPlan = {
      version: 2,
      source: 'ai-planner',
      testCases: [{
        id: 'TC_03',
        name: 'Chỉnh sửa thông tin tổ chức',
        steps: [{
          type: 'click',
          target: 'nút chỉnh sửa biểu tượng cây bút',
          context: 'dòng có mã tổ chức TC010',
          raw: 'Bấm nút chỉnh sửa ở dòng TC010',
          sourceLine: line,
          plannerConfidence: 'high',
        }],
        unparsedSteps: [],
      }],
      clarifications: [],
    };

    expect(validateStructuredE2EPlan(plan, script)).toEqual({ valid: true, issues: [] });
  });

  it('rejects an invented row identifier even when the UI context words are plausible', () => {
    const line = "Tại dòng dữ liệu mã tổ chức là 'TC010', bấm nút chỉnh sửa";
    const script = ['TC_03: Chỉnh sửa', `- ${line}`].join('\n');
    const plan: StructuredE2EPlan = {
      version: 2,
      source: 'ai-planner',
      testCases: [{
        id: 'TC_03',
        name: 'Chỉnh sửa',
        steps: [{
          type: 'click',
          target: 'nút chỉnh sửa',
          context: 'hàng có mã tổ chức TC999',
          raw: 'Bấm chỉnh sửa ở TC999',
          sourceLine: line,
          plannerConfidence: 'high',
        }],
        unparsedSteps: [],
      }],
      clarifications: [],
    };

    expect(validateStructuredE2EPlan(plan, script).issues).toContainEqual(
      expect.objectContaining({ code: 'UNGROUNDED_VALUE' }),
    );
  });

  it('accepts one Vietnamese compound line split into ordered atomic actions', () => {
    const result = validateStructuredE2EPlan(validPlan(), sourceScript);

    expect(result).toEqual({ valid: true, issues: [] });
    expect(validSteps().filter(step => step.sourceLine === compoundLine)).toHaveLength(3);
  });

  it('rejects values that the Planner invented outside the source script', () => {
    const plan = validPlan();
    plan.testCases[0].steps[2].value = 'Giá trị AI tự đoán';

    const result = validateStructuredE2EPlan(plan, sourceScript);

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'UNGROUNDED_VALUE' }));
  });

  it('rejects locator data instead of letting Planner bypass the Crawler', () => {
    const raw = JSON.stringify({
      ...validPlan(),
      testCases: [{
        ...validPlan().testCases[0],
        steps: [{ ...validSteps()[0], selector: '#invented' }],
      }],
    });

    expect(normalizePlannerOutput(raw)).toBeNull();
  });

  it('rejects a source line that was silently dropped', () => {
    const plan = validPlan(validSteps().filter(step => step.type !== 'noop'));
    const result = validateStructuredE2EPlan(plan, sourceScript);

    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'SOURCE_LINE_DROPPED',
      sourceLine: 'Tên quốc tế bỏ trống',
    }));
  });

  it('parses fenced JSON, preserves context and converts it for Live Crawler', () => {
    const normalized = normalizePlannerOutput(`\`\`\`json\n${JSON.stringify(validPlan())}\n\`\`\``);
    expect(normalized).not.toBeNull();

    const testCases = plannerPlanToTestCases(normalized!);
    expect(testCases[0].steps[2]).toMatchObject({
      type: 'fill',
      context: 'Trụ sở chính',
      value: 'Chùa Vĩnh Nghiêm',
    });
    expect(testCases[0].steps.some(step => step.type === 'noop')).toBe(true);
  });

  it('renders Markdown deterministically from the canonical JSON plan', () => {
    const markdown = renderStructuredPlanMarkdown(validPlan());

    expect(markdown).toContain('# E2E Test Plan');
    expect(markdown).toContain('TC_01');
    expect(markdown).toContain('Chùa Vĩnh Nghiêm');
    expect(markdown).toContain('(giữ nguyên/để trống)');
  });

  it('splits a large suite only on test-case boundaries', () => {
    const script = [
      'URL: https://example.com',
      'TC_01: Một',
      '- Mở URL: https://example.com/one',
      '- Bấm nút Một',
      'TC_02: Hai',
      '- Mở URL: https://example.com/two',
      '- Bấm nút Hai',
    ].join('\n');

    const chunks = splitE2EScript(script, 110);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain('TC_01: Một');
    expect(chunks[0]).not.toContain('TC_02: Hai');
    expect(chunks[1]).toContain('URL: https://example.com');
    expect(chunks[1]).toContain('TC_02: Hai');
  });
});
