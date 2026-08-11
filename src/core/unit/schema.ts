export type UnitTestFramework = 'vitest' | 'jest' | 'unknown';
export type UnitLanguage = 'typescript' | 'javascript' | 'mixed' | 'unknown';
export type UnitTargetKind = 'function' | 'class';
export type UnitExecutionMode =
  | 'NATIVE_DIRECT'
  | 'NATIVE_WITH_MOCKS'
  | 'NATIVE_REQUIRED'
  | 'UNSUPPORTED';

export interface UnitProjectManifest {
  version: 1;
  projectName: string;
  projectRoot: string;
  packageType: 'module' | 'commonjs' | 'unknown';
  language: UnitLanguage;
  testFramework: UnitTestFramework;
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'unknown';
  sourceFiles: string[];
  configFiles: string[];
  scannedAt: string;
}

export interface UnitDependency {
  module: string;
  importedNames: string[];
  external: boolean;
  boundary:
    | 'database'
    | 'network'
    | 'filesystem'
    | 'time-random'
    | 'framework'
    | 'internal';
  strategy: 'real' | 'mock' | 'native-environment';
  resolvedFile?: string;
}

export interface UnitBranch {
  id: string;
  kind: 'if' | 'switch' | 'ternary' | 'catch' | 'loop';
  condition: string;
  outcome: string;
  line: number;
}

export interface UnitParameter {
  name: string;
  type: string;
  optional: boolean;
}

export interface UnitTarget {
  id: string;
  sourceFile: string;
  sourceHash: string;
  symbol: string;
  kind: UnitTargetKind;
  exported: boolean;
  defaultExport: boolean;
  async: boolean;
  parameters: UnitParameter[];
  returnType: string;
  startLine: number;
  endLine: number;
  rawCode: string;
  dependencies: UnitDependency[];
  branches: UnitBranch[];
  executionMode: UnitExecutionMode;
  unsupportedReasons: string[];
}

export interface UnitCodeIndex {
  version: 1;
  projectRoot: string;
  targets: UnitTarget[];
  skippedFiles: Array<{ file: string; reason: string }>;
}

export interface UnitContextBundle {
  version: 1;
  project: UnitProjectManifest;
  targets: UnitTarget[];
  requirements?: string;
}

export type UnitOracleSource =
  | 'requirement'
  | 'type-contract'
  | 'existing-test'
  | 'implementation';

export type UnitDataValue =
  | null
  | boolean
  | number
  | string
  | UnitDataValue[]
  | { [key: string]: UnitDataValue }
  | {
      $type: 'undefined' | 'nan' | 'infinity' | 'negative-infinity' | 'bigint' | 'date' | 'regexp';
      value?: string;
    }
  | {
      $type: 'map';
      entries: [UnitDataValue, UnitDataValue][];
    }
  | {
      $type: 'set';
      values: UnitDataValue[];
    };

export interface UnitExpectedResult {
  kind: 'return' | 'throw' | 'resolve' | 'reject' | 'side-effect';
  value?: UnitDataValue;
  message?: string;
  calls?: Array<{
    dependency: string;
    method?: string;
    arguments?: UnitDataValue[];
    times?: number;
  }>;
}

export interface UnitMockPlan {
  module: string;
  symbol?: string;
  behavior: string;
}

export interface UnitPlannedTestCase {
  id: string;
  name: string;
  branchIds: string[];
  inputs: Record<string, UnitDataValue>;
  expected: UnitExpectedResult;
  oracleSource: UnitOracleSource;
  mocks: UnitMockPlan[];
  notes?: string[];
}

export interface UnitPlanTarget {
  sourceFile: string;
  symbol: string;
  sourceHash: string;
  executionMode: UnitExecutionMode;
  testCases: UnitPlannedTestCase[];
}

export interface StructuredUnitPlan {
  version: 1;
  source: 'ai-planner';
  project: {
    name: string;
    root: string;
    testFramework: UnitTestFramework;
  };
  targets: UnitPlanTarget[];
  clarifications: string[];
}

export interface UnitSession {
  version: 1;
  runId: string;
  createdAt: string;
  projectRoot: string;
  projectName: string;
  testFramework: UnitTestFramework;
  runDirectory: string;
  contextPath: string;
  planPath: string;
  generatedFiles: string[];
}
