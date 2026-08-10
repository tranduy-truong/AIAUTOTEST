export interface ParsedStep {
  type: 'goto' | 'fill' | 'click' | 'select' | 'check' | 'wait';
  target?: string;       // Element description, e.g. "Nhập tên đăng nhập"
  value?: string;        // Value to fill/select, e.g. "admin"
  url?: string;          // URL for goto steps
  assertion?: string;    // Assertion description for check steps
  raw: string;           // Original line from script
}

export interface ParsedTestCase {
  id: string;            // e.g. "TC_01"
  name: string;          // e.g. "Đăng nhập thành công"
  url?: string;          // URL extracted from TC header or first goto step
  steps: ParsedStep[];
}

/**
 * Phân tích kịch bản kiểm thử tiếng Việt thành các đối tượng JSON có cấu trúc.
 * 
 * @param scriptText Nội dung kịch bản dạng văn bản thuần túy (plain text)
 * @returns Danh sách các test case đã được phân tích
 */
export function parseScript(scriptText: string): ParsedTestCase[] {
  const lines = scriptText.split('\n').map(line => line.trim());
  const testCases: ParsedTestCase[] = [];
  
  let currentTC: ParsedTestCase | null = null;
  let globalUrl: string | undefined = undefined;

  for (const line of lines) {
    if (!line) continue;

    // 1. Nhận diện Global URL (được khai báo ở đầu kịch bản, trước các Test Case)
    const globalUrlMatch = line.match(/^URL:\s*(http.*)$/i);
    if (!currentTC && globalUrlMatch) {
      globalUrl = globalUrlMatch[1].trim();
      continue;
    }

    // 2. Nhận diện Test Case Header (VD: TC_01: Đăng nhập thành công)
    const tcMatch = line.match(/^(TC_\d+)\s*[:-]\s*(.*)$/i);
    if (tcMatch) {
      if (currentTC) {
        testCases.push(currentTC);
      }
      currentTC = {
        id: tcMatch[1].trim(),
        name: tcMatch[2].trim(),
        url: globalUrl, // Dùng URL toàn cục làm URL mặc định cho TC
        steps: []
      };
      continue;
    }

    if (!currentTC) continue;

    // Loại bỏ dấu "-" hoặc "*" ở đầu các dòng bước (step)
    const rawLine = line.replace(/^[-*]\s*/, '').trim();

    // 3. Bỏ qua các bước yêu cầu để trống ô nhập liệu
    if (/bỏ trống/i.test(rawLine)) {
      continue;
    }

    let step: ParsedStep | null = null;
    let match: RegExpMatchArray | null = null;

    // 4. Nhận diện bước "Mở URL"
    match = rawLine.match(/^Mở URL(?:\s*:\s*(http.*))?$/i);
    if (match) {
      const stepUrl = match[1]?.trim() || currentTC.url || globalUrl;
      if (match[1]?.trim()) {
        currentTC.url = stepUrl; // Cập nhật URL chính của TC nếu có URL mới
      }
      step = { type: 'goto', url: stepUrl, raw: line };
    }

    // 5. Nhận diện bước "Nhập" dữ liệu
    // Mẫu 1: Nhập 'X' vào ô 'Y'
    if (!step) {
      match = rawLine.match(/^Nhập\s+['"]([^'"]+)['"]\s+vào\s+ô\s+['"]([^'"]+)['"]/i);
      if (match) {
        step = { type: 'fill', value: match[1], target: match[2], raw: line };
      }
    }
    // Mẫu 2: Nhập vào ô 'Y' là 'X'
    if (!step) {
      match = rawLine.match(/^Nhập\s+vào\s+ô\s+['"]([^'"]+)['"]\s+là\s+['"]([^'"]+)['"]/i);
      if (match) {
        step = { type: 'fill', target: match[1], value: match[2], raw: line };
      }
    }

    // 6. Nhận diện bước "Click / Bấm"
    // Mẫu 1: Bấm nút 'Z', Click nút 'Z', Bấm vào nút 'Z', Bấm nút có chữ 'Z' (Hỗ trợ nháy kép hoặc đơn)
    if (!step) {
      match = rawLine.match(/^(?:Bấm|Click)(?:\s+vào)?\s+(?:nút|icon)(?:\s+có\s+chữ)?\s+['"]([^'"]+)['"]/i);
      if (match) {
        step = { type: 'click', target: match[1], raw: line };
      }
    }
    // Mẫu 2: Bấm vào icon ... (Không có dấu nháy)
    if (!step) {
      match = rawLine.match(/^(?:Bấm|Click)(?:\s+vào)?\s+icon\s+(.*)$/i);
      if (match) {
        step = { type: 'click', target: match[1].replace(/['"]/g, '').trim(), raw: line };
      }
    }

    // 7. Nhận diện bước "Select" (Dropdown)
    // Mẫu 1: Dropdown 'X' chọn 'Y'
    if (!step) {
      match = rawLine.match(/^Dropdown\s+['"]([^'"]+)['"]\s+chọn\s+['"]([^'"]+)['"]/i);
      if (match) {
        step = { type: 'select', target: match[1], value: match[2], raw: line };
      }
    }
    // Mẫu 2: Chọn 'Y' trong dropdown 'X'
    if (!step) {
      match = rawLine.match(/^Chọn\s+['"]([^'"]+)['"]\s+trong\s+dropdown\s+['"]([^'"]+)['"]/i);
      if (match) {
        step = { type: 'select', value: match[1], target: match[2], raw: line };
      }
    }

    // 8. Nhận diện bước "Check" (Kiểm tra)
    if (!step) {
      match = rawLine.match(/^Kiểm tra:\s*(.*)$/i);
      if (match) {
        step = { type: 'check', assertion: match[1].trim(), raw: line };
      }
    }

    // 9. Nhận diện bước "Wait"
    if (!step) {
      if (/^Chờ trang load xong$/i.test(rawLine)) {
        step = { type: 'wait', raw: line };
      }
    }

    // Thêm bước vào test case hiện tại nếu nhận diện thành công
    if (step) {
      currentTC.steps.push(step);
    }
  }

  // Đẩy test case cuối cùng vào danh sách
  if (currentTC) {
    testCases.push(currentTC);
  }

  return testCases;
}
