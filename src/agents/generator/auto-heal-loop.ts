import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { runGenerator } from './run.js';
import { classifyFailure, HealerDiagnosis } from '../healer/run.js';
import { loadStructuredE2EPlan } from '../planner/run.js';
import { plannerPlanToTestCases } from '../planner/schema.js';
import { buildCompactDomReport, runLive } from '../crawler/live-runner.js';
import { buildActionPlan } from '../../core/action-plan.js';
import { createNoAuthSession, loadAuthSession } from '../../core/auth/auth-session.js';
import { artifact, detail, section, success, warning, error as uiError } from '../../core/cli-ui.js';

import { runHealer } from '../healer/run.js';

export interface AutoHealLoopResult {
  success: boolean;
  attempts: number;
  reason?: string;
  reportPath?: string;
}

export async function runAutoHealGeneratorLoop(
  level: 'e2e' | 'integration' | 'unit',
  options: { maxAttempts?: number; targetFile?: string } = {},
): Promise<AutoHealLoopResult> {
  const maxAttempts = options.maxAttempts ?? 3;
  let attempt = 1;
  let activeSpecFilePath: string | undefined;

  section('02', 'Generator & Auto-Heal Loop', `Tự động sinh code, chạy kiểm thử & chữa lành tự động (Tối đa ${maxAttempts} vòng)`);

  while (attempt <= maxAttempts) {
    console.log(`\n========================================================================`);
    console.log(`   🚀 VÒNG KIỂM THỬ & CHỮA LÀNH ${attempt}/${maxAttempts} (${level.toUpperCase()})`);
    console.log(`========================================================================`);

    // Bước 1: Sinh code (ở lần 1) nếu chưa có activeSpecFilePath
    if (!activeSpecFilePath) {
      console.log(`\n   [1/2] Đang sinh code kiểm thử (${level})...`);
      const genResult = await runGenerator(level, options.targetFile, {
        exactFilePath: activeSpecFilePath,
      });

      if (!genResult) {
        uiError(`   ❌ Generator không thể sinh code.`);
        return { success: false, attempts: attempt, reason: 'GENERATOR_FAILED' };
      }

      if (typeof genResult === 'string') {
        activeSpecFilePath = genResult;
      }
    }

    // Bước 2: Tự động khởi chạy kiểm thử thực tế đối với file spec vừa sinh
    console.log(`   [2/2] Đang chạy kiểm thử tự động với Playwright...`);
    let testOutput = '';
    let testPassed = false;

    try {
      const relPath = activeSpecFilePath
        ? path.relative(process.cwd(), activeSpecFilePath).replace(/\\/g, '/')
        : '';
      const targetCmd = relPath ? `"${relPath}"` : '';
      const cmd = level === 'e2e'
        ? `npx playwright test ${targetCmd}`.trim()
        : level === 'unit'
          ? `npm run test:unit ${targetCmd}`.trim()
          : `npm run test:integration ${targetCmd}`.trim();

      testOutput = execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
      testPassed = true;
    } catch (err: any) {
      testOutput = (err.stdout || '') + '\n' + (err.stderr || '');
      testPassed = false;
    }

    // Bước 3: Nếu test PASS 100% -> Kết thúc thành công & tạo report thành công!
    if (testPassed) {
      success(`   🎉 Tất cả test cases đã PASSED hoàn toàn ở vòng ${attempt}/${maxAttempts}!`);

      const passReport = `
# BÁO CÁO KẾT QUẢ KIỂM THỬ - ${new Date().toLocaleString('vi-VN')}

- **Tầng kiểm thử**: ${level.toUpperCase()}
- **Trạng thái**: ✅ PASSED (100% Thành công)
- **Số vòng chữa lành**: ${attempt}/${maxAttempts}
- **File Test Spec**: \`${activeSpecFilePath ?? 'N/A'}\`

---

## 📋 Chi tiết kết quả:
\`\`\`
${testOutput.trim()}
\`\`\`
`.trim();

      if (!fs.existsSync('artifacts')) fs.mkdirSync('artifacts', { recursive: true });
      fs.writeFileSync('artifacts/report.md', passReport, 'utf-8');
      artifact('Báo cáo kiểm thử', 'artifacts/report.md');

      return { success: true, attempts: attempt, reportPath: 'artifacts/report.md' };
    }

    // Bước 4: Test chưa PASS -> Kích hoạt Healer Agent để tự động phân tích và chữa lành
    console.log(`   ⚠️ Phát hiện lỗi trong quá trình chạy test (Vòng ${attempt}/${maxAttempts}).`);
    const healed = await runHealer(level, testOutput, activeSpecFilePath);

    const diagnosis: HealerDiagnosis = classifyFailure(testOutput);

    if (healed && attempt < maxAttempts) {
      success(`   ✨ Healer đã tự động sửa đổi file spec! Chuẩn bị chạy lại vòng ${attempt + 1}...`);
      attempt++;
      continue;
    }

    // Nếu không thể chữa lành hoặc đã hết số lượt thử
    const reportContent = `
# BÁO CÁO PHÂN TÍCH LỖI KIỂM THỬ - ${new Date().toLocaleString('vi-VN')}

- **Tầng kiểm thử**: ${level.toUpperCase()}
- **Trạng thái**: ⚠️ FAILED / CẦN XEM XÉT
- **Số vòng thử nghiệm**: ${attempt}/${maxAttempts}
- **File Test Spec**: \`${activeSpecFilePath ?? 'N/A'}\`
- **Loại lỗi**: ${diagnosis.category}
- **Mã chẩn đoán**: \`${diagnosis.reasonCode}\`
${diagnosis.failedLine ? `- **Dòng code gây lỗi**: \`${diagnosis.failedLine}\`` : ''}

---

## ❌ Log lỗi chi tiết từ Playwright:

\`\`\`text
${testOutput.trim()}
\`\`\`

---

## 💡 Đề xuất & Khuyến nghị xử lý:
1. **Kiểm tra File Spec**: Mở file \`${activeSpecFilePath ?? 'tests/e2e/...'}\` để xem chi tiết các bước kiểm thử vừa sinh.
2. **Kiểm tra Selector / Trạng thái trang**: Nếu lỗi do \`${diagnosis.reasonCode}\`, hãy kiểm tra xem phần tử giao diện có bị thay đổi tên hoặc cần thêm bước chờ (\`waitFor\`) không.
3. **Chạy lại trực tiếp**: Bạn có thể chạy lại riêng file test này bằng lệnh:
   \`\`\`bash
   npx playwright test "${activeSpecFilePath ? path.relative(process.cwd(), activeSpecFilePath).replace(/\\/g, '/') : ''}" --headed
   \`\`\`
`.trim();

    if (!fs.existsSync('artifacts')) fs.mkdirSync('artifacts', { recursive: true });
    fs.writeFileSync('artifacts/report.md', reportContent, 'utf-8');
    artifact('Báo cáo phân tích lỗi', 'artifacts/report.md');
    warning(`   📄 Đã xuất báo cáo chi tiết tại: artifacts/report.md`);

    return {
      success: false,
      attempts: attempt,
      reason: diagnosis.reasonCode,
      reportPath: 'artifacts/report.md',
    };
  }

  return { success: false, attempts: maxAttempts, reason: 'FINISHED' };
}
