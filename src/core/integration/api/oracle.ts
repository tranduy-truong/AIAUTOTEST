/**
 * API Oracle — Kiểu dữ liệu Oracle cho Integration/API Test.
 *
 * Tái sử dụng Oracle Taxonomy v2 từ Unit Test thay vì tạo hệ thống riêng.
 * Nguyên tắc: AI không được tự quyết expected value.
 * - SPECIFICATION: Expected value đến từ Requirement hoặc OpenAPI schema.
 * - CHARACTERIZATION: Expected value đến từ implementation hiện tại (cần Tester duyệt).
 */

import type {
  TestIntentType,
  OracleAuthority,
  OracleGateStatus,
} from '../../unit/oracle/oracle-taxonomy.js';

export type { TestIntentType, OracleAuthority, OracleGateStatus };

// ─── Kiểu Oracle dành riêng cho API Test ────────────────────────────────────

export interface ApiOracle {
  /**
   * Phân loại Test Intent:
   * - SPECIFICATION: Expected value có nguồn gốc từ Requirement/OpenAPI — đáng tin cậy.
   * - CHARACTERIZATION: Expected value được suy ra từ implementation hiện tại — cần cẩn trọng.
   */
  intentType: TestIntentType;

  /**
   * Ai xác nhận expected value này:
   * - REQUIREMENT: OpenAPI spec / tài liệu yêu cầu nghiệp vụ.
   * - TESTER_CONFIRMATION: Tester đã xem xét và phê duyệt thủ công.
   * - IMPLEMENTATION: AI đọc source code và suy ra — đây là CHARACTERIZATION.
   * - EXISTING_TEST: Dựa trên test đang chạy xanh trước đó.
   */
  authority: OracleAuthority;

  /**
   * Bằng chứng cụ thể. Ví dụ:
   * - "OpenAPI 3.0 POST /api/cart/apply-discount → 200"
   * - "Requirement §3.2: SALE10 giảm 10% cho cart ≥ 50k"
   * - "Tester review 2026-08-17 by admin@company.vn"
   */
  evidenceSource?: string;

  /** ID tester nếu authority = TESTER_CONFIRMATION. */
  confirmedBy?: string;
}

// ─── Oracle Gate Summary ─────────────────────────────────────────────────────

export interface ApiOracleGateSummary {
  totalTests: number;
  specificationCount: number;
  characterizationCount: number;
  needsOracleCount: number;
  gateStatus: OracleGateStatus;
}

/**
 * Tính toán trạng thái Oracle Gate cho toàn bộ API Test Suite.
 * NEEDS_ORACLE → còn test chưa có oracle → phải xử lý trước khi chạy.
 */
export function computeApiOracleGate(
  tests: Array<{ oracle?: ApiOracle }>,
): ApiOracleGateSummary {
  let specificationCount = 0;
  let characterizationCount = 0;
  let needsOracleCount = 0;

  for (const test of tests) {
    if (!test.oracle) {
      needsOracleCount++;
    } else if (test.oracle.intentType === 'SPECIFICATION') {
      specificationCount++;
    } else {
      characterizationCount++;
    }
  }

  let gateStatus: OracleGateStatus;
  if (needsOracleCount > 0) {
    gateStatus = 'NEEDS_ORACLE';
  } else if (characterizationCount === 0) {
    gateStatus = 'READY_SPECIFICATION';
  } else {
    gateStatus = 'READY_CHARACTERIZATION';
  }

  return {
    totalTests: tests.length,
    specificationCount,
    characterizationCount,
    needsOracleCount,
    gateStatus,
  };
}

// ─── Builder helpers ─────────────────────────────────────────────────────────

/** Tạo ApiOracle chuẩn SPECIFICATION từ OpenAPI schema. */
export function buildSpecificationOracle(evidenceSource: string): ApiOracle {
  return {
    intentType: 'SPECIFICATION',
    authority: 'REQUIREMENT',
    evidenceSource,
  };
}

/**
 * Tạo ApiOracle CHARACTERIZATION khi AI suy ra từ source.
 * ⚠️ Healer không được tự sửa Oracle khi test fail với loại này.
 */
export function buildCharacterizationOracle(evidenceSource: string): ApiOracle {
  return {
    intentType: 'CHARACTERIZATION',
    authority: 'IMPLEMENTATION',
    evidenceSource,
  };
}

/** Tạo ApiOracle đã được Tester phê duyệt thủ công. */
export function buildTesterConfirmedOracle(
  evidenceSource: string,
  confirmedBy?: string,
): ApiOracle {
  return {
    intentType: 'SPECIFICATION',
    authority: 'TESTER_CONFIRMATION',
    evidenceSource,
    confirmedBy,
  };
}
