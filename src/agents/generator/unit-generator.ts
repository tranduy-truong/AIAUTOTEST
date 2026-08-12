import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as ts from 'typescript';
import { OpenAIAdapter } from '../../adapters/openai.js';
import {
  freshSourceHash,
  freshUnitFileHash,
  loadUnitContext,
  loadUnitSession,
  updateUnitSession,
} from '../../core/unit/artifacts.js';
import type {
  StructuredUnitPlan,
  UnitDependency,
  UnitPlanTarget,
  UnitTarget,
} from '../../core/unit/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unit_target';
}

function withoutSourceExtension(value: string): string {
  return value.replace(/\.(?:tsx?|jsx?|mts|cts|mjs|cjs)$/i, '');
}

function relativeModulePath(fromDirectory: string, absoluteModule: string): string {
  let relative = toPosix(path.relative(fromDirectory, absoluteModule));
  if (!relative.startsWith('.')) relative = `./${relative}`;
  if (/\.(?:ts|tsx|mts|cts)$/i.test(relative)) return withoutSourceExtension(relative);
  return relative;
}

function sourceImportPath(target: UnitTarget, projectRoot: string, outputDirectory: string): string {
  return relativeModulePath(outputDirectory, path.join(projectRoot, target.sourceFile));
}

function dependencyTestImportPath(
  dependency: UnitDependency,
  projectRoot: string,
  outputDirectory: string,
): string {
  if (dependency.external || !dependency.resolvedFile) return dependency.module;
  return relativeModulePath(outputDirectory, path.join(projectRoot, dependency.resolvedFile));
}

function datedUniqueTestPath(
  outputDirectory: string,
  target: UnitTarget,
  extension: '.test.ts' | '.test.js',
  now = new Date(),
): string {
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, '0'))
    .join('_');
  const moduleName = path.basename(withoutSourceExtension(target.sourceFile));
  const base = `${slug(moduleName)}_${slug(target.symbol)}_${date}`;
  let candidate = path.join(outputDirectory, `${base}${extension}`);
  let version = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(outputDirectory, `${base}_${String(version).padStart(2, '0')}${extension}`);
    version++;
  }
  return candidate;
}

function extractCode(rawOutput: string): string {
  const fenced = rawOutput.match(/```(?:typescript|ts|javascript|js)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] || rawOutput).trim().replace(/^\/\/ FILE:.*\n?/m, '').trim();
}

function findTsConfig(projectRoot: string): string | undefined {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const candidate = path.join(projectRoot, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
  if (!diagnostic.file || diagnostic.start === undefined) return message;
  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return `${position.line + 1}:${position.character + 1} ${message}`;
}

export function typecheckGeneratedUnitFile(projectRoot: string, testFile: string): string[] {
  const configPath = findTsConfig(projectRoot);
  let options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    esModuleInterop: true,
    allowJs: true,
    skipLibCheck: true,
    noEmit: true,
  };
  if (configPath) {
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (!config.error) {
      const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
      options = { ...parsed.options, noEmit: true, incremental: false, composite: false };
    }
  }
  const normalizedTestFile = path.resolve(testFile);
  const program = ts.createProgram({ rootNames: [normalizedTestFile], options });
  return ts.getPreEmitDiagnostics(program)
    .filter(diagnostic => diagnostic.file && path.resolve(diagnostic.file.fileName) === normalizedTestFile)
    .map(formatDiagnostic);
}

export interface UnitGeneratedCodeValidation {
  ok: boolean;
  errors: string[];
}

interface GeneratedMockCall {
  module?: string;
  topLevel: boolean;
  freeFactoryReferences: string[];
}

function collectBindingNames(name: ts.BindingName, output: Set<string>): void {
  if (ts.isIdentifier(name)) {
    output.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) collectBindingNames(element.name, output);
  }
}

function isIdentifierReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === node)
    || (ts.isPropertyAssignment(parent) && parent.name === node)
    || (ts.isMethodDeclaration(parent) && parent.name === node)
    || (ts.isVariableDeclaration(parent) && parent.name === node)
    || (ts.isParameter(parent) && parent.name === node)
    || (ts.isBindingElement(parent) && parent.name === node)
    || ts.isTypeReferenceNode(parent)
    || ts.isTypeQueryNode(parent)
  ) return false;
  return true;
}

function topLevelHoistedNames(source: ts.SourceFile, frameworkApi: 'vi' | 'jest'): Set<string> {
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (
        initializer && ts.isCallExpression(initializer)
        && ts.isPropertyAccessExpression(initializer.expression)
        && ts.isIdentifier(initializer.expression.expression)
        && initializer.expression.expression.text === frameworkApi
        && initializer.expression.name.text === 'hoisted'
      ) collectBindingNames(declaration.name, names);
    }
  }
  return names;
}

function mockFactoryFreeReferences(
  factory: ts.ArrowFunction | ts.FunctionExpression,
  allowedHoisted: Set<string>,
  frameworkApi: 'vi' | 'jest',
): string[] {
  const local = new Set<string>();
  for (const parameter of factory.parameters) collectBindingNames(parameter.name, local);
  const collectDeclarations = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node)) collectBindingNames(node.name, local);
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) local.add(node.name.text);
    ts.forEachChild(node, collectDeclarations);
  };
  collectDeclarations(factory.body);

  const allowedGlobals = new Set([
    frameworkApi, 'undefined', 'Promise', 'Error', 'TypeError', 'Object', 'Array',
    'Map', 'Set', 'Date', 'RegExp', 'JSON', 'Math', 'Number', 'String', 'Boolean',
    'BigInt', 'Symbol', 'console', 'globalThis',
  ]);
  const free = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isIdentifier(node) && isIdentifierReference(node)
      && !local.has(node.text) && !allowedGlobals.has(node.text) && !allowedHoisted.has(node.text)
    ) free.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(factory.body);
  return [...free].sort();
}

function inspectGeneratedMocks(code: string, framework: 'vitest' | 'jest'): {
  calls: GeneratedMockCall[];
  syntaxErrors: string[];
} {
  const source = ts.createSourceFile('generated-unit.test.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const parseDiagnostics = (source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics || [];
  const syntaxErrors = parseDiagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
  const frameworkApi = framework === 'vitest' ? 'vi' : 'jest';
  const hoisted = topLevelHoistedNames(source, frameworkApi);
  const calls: GeneratedMockCall[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === frameworkApi
      && node.expression.name.text === 'mock'
    ) {
      const moduleArgument = node.arguments[0];
      const factory = node.arguments[1];
      calls.push({
        module: moduleArgument && ts.isStringLiteralLike(moduleArgument) ? moduleArgument.text : undefined,
        topLevel: ts.isExpressionStatement(node.parent) && ts.isSourceFile(node.parent.parent),
        freeFactoryReferences: factory && (ts.isArrowFunction(factory) || ts.isFunctionExpression(factory))
          ? mockFactoryFreeReferences(factory, hoisted, frameworkApi)
          : [],
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { calls, syntaxErrors };
}

function targetImportIsPresent(code: string, target: UnitTarget, importPath: string): boolean {
  const escapedPath = importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (target.defaultExport) {
    return new RegExp(`import\\s+[A-Za-z_$][\\w$]*\\s+from\\s+['"]${escapedPath}['"]`).test(code);
  }
  const escapedSymbol = target.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`import\\s*\\{[^}]*\\b${escapedSymbol}\\b[^}]*\\}\\s*from\\s*['"]${escapedPath}['"]`).test(code);
}

export function validateGeneratedUnitCode(options: {
  code: string;
  target: UnitTarget;
  planTarget: UnitPlanTarget;
  importPath: string;
  framework: 'vitest' | 'jest';
  dependencyPaths: Map<string, string>;
}): UnitGeneratedCodeValidation {
  const { code, target, planTarget, importPath, framework, dependencyPaths } = options;
  const errors: string[] = [];
  if (!targetImportIsPresent(code, target, importPath)) {
    errors.push(`Test không import đúng target từ source thật: ${target.symbol} tại ${importPath}`);
  }
  if (framework === 'vitest' && !/from\s+['"]vitest['"]/.test(code)) errors.push('Thiếu import Vitest.');
  if (framework === 'jest' && !/(?:from\s+['"]@jest\/globals['"]|\bdescribe\s*\()/.test(code)) errors.push('Thiếu Jest test API.');
  if (/\.(?:skip|only)\s*\(|\b(?:it|test)\.todo\s*\(/.test(code)) errors.push('Cấm skip/only/todo trong test được sinh.');
  if (/(?:\/\/|\/\*)\s*(?:TODO|\.\.\.)|^\s*\.\.\.\s*;?\s*$/m.test(code)) {
    errors.push('Test chứa TODO hoặc placeholder rút gọn.');
  }

  const inspectedMocks = inspectGeneratedMocks(code, framework);
  for (const syntaxError of inspectedMocks.syntaxErrors) errors.push(`File test sai cú pháp: ${syntaxError}`);
  const allowedMockPaths = new Set(
    target.dependencies
      .filter(dependency => dependency.strategy === 'mock')
      .map(dependency => dependencyPaths.get(dependency.module))
      .filter((value): value is string => Boolean(value)),
  );
  const mockCounts = new Map<string, number>();
  for (const mockCall of inspectedMocks.calls) {
    if (!mockCall.module) {
      errors.push('vi.mock/jest.mock phải dùng module path dạng chuỗi tĩnh.');
      continue;
    }
    mockCounts.set(mockCall.module, (mockCounts.get(mockCall.module) || 0) + 1);
    if (!mockCall.topLevel) errors.push(`Mock ${mockCall.module} phải nằm ở top-level, ngoài describe/it/hook.`);
    if (!allowedMockPaths.has(mockCall.module)) errors.push(`Generator mock dependency không có strategy=mock: ${mockCall.module}`);
    if (mockCall.freeFactoryReferences.length > 0) {
      errors.push(
        `Factory mock ${mockCall.module} tham chiếu biến chưa vi.hoisted/jest-safe: ${mockCall.freeFactoryReferences.join(', ')}`,
      );
    }
  }
  for (const mockPath of allowedMockPaths) {
    const count = mockCounts.get(mockPath) || 0;
    if (count === 0) errors.push(`Thiếu top-level mock bắt buộc cho dependency: ${mockPath}`);
    if (count > 1) errors.push(`Dependency ${mockPath} chỉ được mock một lần (hiện tại: ${count}).`);
  }

  const escaped = target.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\bfunction\\s+${escaped}\\s*\\(`).test(code)) errors.push('Generator đã copy hàm vào test thay vì import source thật.');
  if (new RegExp(`\\bclass\\s+${escaped}\\b`).test(code)) errors.push('Generator đã copy class vào test thay vì import source thật.');
  if (new RegExp(`\\b(?:const|let|var)\\s+${escaped}\\s*=`).test(code)) errors.push('Generator đã khai báo lại target trong test.');

  for (const testCase of planTarget.testCases) {
    const count = [...code.matchAll(new RegExp(`\\b${testCase.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'))].length;
    if (count !== 1) errors.push(`${testCase.id} phải xuất hiện đúng một lần trong file test (hiện tại: ${count}).`);
    for (const mock of testCase.mocks || []) {
      const mapped = dependencyPaths.get(mock.module);
      if (!mapped) errors.push(`${testCase.id} tham chiếu mock chưa được Dependency Resolver xác minh: ${mock.module}`);
      else if (!code.includes(mapped)) errors.push(`${testCase.id} chưa mock dependency theo đường dẫn đã xác minh: ${mapped}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function buildPrompt(options: {
  systemPrompt: string;
  target: UnitTarget;
  planTarget: UnitPlanTarget;
  framework: 'vitest' | 'jest';
  importPath: string;
  dependencyPaths: Map<string, string>;
  requirements?: string;
  outputLanguage: 'TypeScript' | 'JavaScript';
}): string {
  const dependencies = options.target.dependencies.map(dependency => ({
    ...dependency,
    testImportPath: options.dependencyPaths.get(dependency.module),
  }));
  const importAlias = options.target.symbol === 'default'
    ? `${slug(path.basename(withoutSourceExtension(options.target.sourceFile))).replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())}Target`
    : options.target.symbol;
  const requiredTargetImport = options.target.defaultExport
    ? `import ${importAlias} from '${options.importPath}';`
    : `import { ${options.target.symbol} } from '${options.importPath}';`;
  return `${options.systemPrompt}\n\n[FRAMEWORK]\n${options.framework}\n\n[NGÔN NGỮ FILE TEST]\n${options.outputLanguage}\n\n[IMPORT TARGET BẮT BUỘC]\n${requiredTargetImport}\n\n[TARGET ĐÃ XÁC MINH]\n${JSON.stringify({
    sourceFile: options.target.sourceFile,
    symbol: options.target.symbol,
    kind: options.target.kind,
    defaultExport: options.target.defaultExport,
    async: options.target.async,
    parameters: options.target.parameters,
    returnType: options.target.returnType,
    sourceHash: options.target.sourceHash,
    executionMode: options.target.executionMode,
    sourceImportPath: options.importPath,
    dependencies,
    rawCode: options.target.rawCode,
  })}\n\n[SUPPORTING CONTEXT REACHABLE ĐÃ XÁC MINH]\n${JSON.stringify(options.target.supportingContext)}\n\n[TEST PLAN ĐÃ XÁC MINH]\n${JSON.stringify(options.planTarget)}\n\n[REQUIREMENTS]\n${options.requirements || 'Không có; mọi expected suy ra từ implementation phải được giữ đúng như Planner đã đánh dấu.'}\n\nChỉ xuất một file ${options.outputLanguage} hoàn chỉnh trong code fence. Không giải thích.`;
}

function writeGenerationManifest(sessionDirectory: string, generatedFiles: string[], failures: unknown[]): void {
  fs.writeFileSync(
    path.join(sessionDirectory, 'generation-manifest.json'),
    `${JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      generatedFiles,
      failures,
    }, null, 2)}\n`,
  );
}

export async function runUnitGenerator(): Promise<boolean> {
  const session = loadUnitSession();
  const context = loadUnitContext(session);
  if (context.project.testFramework === 'unknown') {
    console.error('❌ Dự án chưa có Vitest/Jest. Generator dừng để không tạo test không chạy được.');
    console.error('   Hãy cấu hình test runner trong dự án đích rồi quét lại.');
    return false;
  }
  const framework = context.project.testFramework;
  const plan = JSON.parse(fs.readFileSync(session.planPath, 'utf-8')) as StructuredUnitPlan;
  const systemPrompt = fs.readFileSync(path.join(__dirname, 'prompt-unit.md'), 'utf-8');
  const outputDirectory = path.join(context.project.projectRoot, 'tests', 'unit', 'ai-generated');
  fs.mkdirSync(outputDirectory, { recursive: true });

  const generatedFiles: string[] = [];
  const failures: Array<{ target: string; errors: string[] }> = [];
  for (const planTarget of plan.targets) {
    const target = context.targets.find(
      item => item.sourceFile === planTarget.sourceFile && item.symbol === planTarget.symbol,
    );
    const label = `${planTarget.sourceFile}#${planTarget.symbol}`;
    if (!target) {
      failures.push({ target: label, errors: ['Unit Context không chứa target của Planner.'] });
      continue;
    }
    const currentHash = freshSourceHash(target, context.project.projectRoot);
    if (currentHash !== target.sourceHash || planTarget.sourceHash !== target.sourceHash) {
      failures.push({ target: label, errors: ['Source đã thay đổi sau khi Planner lập kế hoạch. Hãy chạy Planner lại.'] });
      continue;
    }
    const supportingDefinitions = [
      ...target.supportingContext.helperDefinitions,
      ...target.supportingContext.typeDefinitions,
      ...target.supportingContext.constantDefinitions,
    ];
    const staleSupportingFile = supportingDefinitions.find(definition =>
      freshUnitFileHash(definition.sourceFile, context.project.projectRoot) !== definition.sourceHash,
    );
    if (staleSupportingFile) {
      failures.push({
        target: label,
        errors: [`Supporting source đã thay đổi sau Planner: ${staleSupportingFile.sourceFile}. Hãy quét và lập kế hoạch lại.`],
      });
      continue;
    }
    const importPath = sourceImportPath(target, context.project.projectRoot, outputDirectory);
    const dependencyPaths = new Map(
      target.dependencies.map(dependency => [
        dependency.module,
        dependencyTestImportPath(dependency, context.project.projectRoot, outputDirectory),
      ]),
    );
    const prompt = buildPrompt({
      systemPrompt,
      target,
      planTarget,
      framework,
      importPath,
      dependencyPaths,
      requirements: context.requirements,
      outputLanguage: /\.(?:js|jsx|mjs|cjs)$/i.test(target.sourceFile) ? 'JavaScript' : 'TypeScript',
    });
    console.log(`   Sinh test ${label} (${prompt.length.toLocaleString('vi-VN')} ký tự)...`);
    const workDir = path.join(process.cwd(), '.testkit', 'runs', `unit_gen_${Date.now()}_${slug(target.symbol)}`);
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, 'task.md'), prompt);
    const adapter = new OpenAIAdapter('llama-3.3-70b-versatile');
    let result = await adapter.run({ promptDir: workDir, workDir, timeoutMs: 120000, maxTokens: 3500 });
    if (!result.ok) {
      failures.push({ target: label, errors: [result.rawOutput] });
      continue;
    }
    let code = extractCode(result.rawOutput);
    let validation = validateGeneratedUnitCode({ code, target, planTarget, importPath, framework, dependencyPaths });
    if (!validation.ok) {
      console.warn(`   Generator output chưa đạt hợp đồng (${validation.errors.length} lỗi), đang tự sửa một lần...`);
      fs.writeFileSync(path.join(session.runDirectory, `${slug(target.symbol)}.invalid-attempt-1.txt`), `${result.rawOutput}\n`);
      const repairDirectory = path.join(process.cwd(), '.testkit', 'runs', `unit_gen_repair_${Date.now()}_${slug(target.symbol)}`);
      fs.mkdirSync(repairDirectory, { recursive: true });
      const repairPrompt = `${prompt}\n\n[LỖI STATIC CONTRACT CẦN SỬA]\n${JSON.stringify(validation.errors)}\n\nSinh lại TOÀN BỘ file test. Không giải thích, không bỏ test case.`;
      fs.writeFileSync(path.join(repairDirectory, 'task.md'), repairPrompt);
      const repaired = await adapter.run({
        promptDir: repairDirectory,
        workDir: repairDirectory,
        timeoutMs: 120000,
        maxTokens: 3500,
      });
      if (repaired.ok) {
        result = repaired;
        code = extractCode(result.rawOutput);
        validation = validateGeneratedUnitCode({ code, target, planTarget, importPath, framework, dependencyPaths });
      } else {
        validation = { ok: false, errors: [...validation.errors, repaired.rawOutput] };
      }
    }
    if (!validation.ok) {
      failures.push({ target: label, errors: validation.errors });
      fs.writeFileSync(path.join(session.runDirectory, `${slug(target.symbol)}.invalid.txt`), `${result.rawOutput}\n`);
      continue;
    }
    const testPath = datedUniqueTestPath(
      outputDirectory,
      target,
      /\.(?:js|jsx|mjs|cjs)$/i.test(target.sourceFile) ? '.test.js' : '.test.ts',
    );
    fs.writeFileSync(testPath, `${code}\n`);
    const typeErrors = typecheckGeneratedUnitFile(context.project.projectRoot, testPath);
    if (typeErrors.length > 0) {
      fs.rmSync(testPath, { force: true });
      failures.push({
        target: label,
        errors: typeErrors.map(error => `TypeScript preflight: ${error}`),
      });
      fs.writeFileSync(path.join(session.runDirectory, `${slug(target.symbol)}.typecheck-errors.json`), `${JSON.stringify(typeErrors, null, 2)}\n`);
      continue;
    }
    generatedFiles.push(testPath);
    console.log(`   ✅ Đã tạo: ${testPath}`);
  }

  // A run must be reproducible from its own generation manifest. Replacing
  // instead of accumulating prevents a repaired generation from re-running an
  // older invalid file produced earlier in the same session.
  updateUnitSession({ generatedFiles: [...new Set(generatedFiles)] }, session);
  writeGenerationManifest(session.runDirectory, generatedFiles, failures);
  if (failures.length > 0) {
    console.error(`❌ ${failures.length} target bị chặn bởi Generator contract. Chi tiết: ${path.join(session.runDirectory, 'generation-manifest.json')}`);
    return false;
  }
  console.log(`✅ Đã sinh ${generatedFiles.length} file Unit Test import source thật tại: ${outputDirectory}`);
  return generatedFiles.length > 0;
}
