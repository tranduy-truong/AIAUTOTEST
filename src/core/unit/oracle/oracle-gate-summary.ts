import type { StructuredUnitPlan, UnitContextBundle } from '../schema.js';
import { migratePlanV1ToV2 } from '../plan-migrator.js';
import { resolveTargetOraclesV2, type UnitOracleGateResolution } from './oracle-resolver.js';

export interface UnitOracleGateCounts {
  specRequirement: number;
  specTesterConfirmed: number;
  characterization: number;
  sourceConflict: number;
  needsOracle: number;
}

export interface UnitOracleGateReport {
  counts: UnitOracleGateCounts;
  total: number;
  canRunInCi: boolean;
  resolutions: Array<{ target: string; testCases: UnitOracleGateResolution[] }>;
  blockingReasons: string[];
}

export function evaluateUnitPlanOracleGates(
  context: UnitContextBundle,
  rawPlan: StructuredUnitPlan,
): UnitOracleGateReport {
  const plan = migratePlanV1ToV2(rawPlan);
  const counts: UnitOracleGateCounts = {
    specRequirement: 0,
    specTesterConfirmed: 0,
    characterization: 0,
    sourceConflict: 0,
    needsOracle: 0,
  };
  const blockingReasons: string[] = [];
  const resolutions = plan.targets.map(planTarget => {
    const label = `${planTarget.sourceFile}#${planTarget.symbol}`;
    const target = context.targets.find(item =>
      item.sourceFile === planTarget.sourceFile && item.symbol === planTarget.symbol,
    );
    if (!target) {
      counts.needsOracle += planTarget.testCases.length || 1;
      blockingReasons.push(`${label}: target không còn tồn tại trong Unit Context.`);
      return { target: label, testCases: [] };
    }
    const testCases = resolveTargetOraclesV2(context, target, planTarget.testCases);
    for (const result of testCases) {
      if (result.gateStatus === 'READY_SPECIFICATION') {
        if (result.oracle.authority === 'TESTER_CONFIRMATION') counts.specTesterConfirmed++;
        else counts.specRequirement++;
      } else if (result.gateStatus === 'READY_CHARACTERIZATION') {
        counts.characterization++;
      } else if (result.gateStatus === 'CONFLICT_WITH_SPEC') {
        counts.sourceConflict++;
        blockingReasons.push(`${label}/${result.testCaseId}: ${result.reason || 'Mâu thuẫn với specification.'}`);
      } else {
        counts.needsOracle++;
        blockingReasons.push(`${label}/${result.testCaseId}: ${result.reason || 'Thiếu Oracle hợp lệ.'}`);
      }
    }
    return { target: label, testCases };
  });

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return {
    counts,
    total,
    canRunInCi: total > 0 && counts.sourceConflict === 0 && counts.needsOracle === 0,
    resolutions,
    blockingReasons,
  };
}
