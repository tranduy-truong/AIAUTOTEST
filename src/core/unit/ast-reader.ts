import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';
import type {
  UnitBranch,
  UnitCodeIndex,
  UnitDependency,
  UnitExecutionMode,
  UnitParameter,
  UnitProjectManifest,
  UnitTarget,
} from './schema.js';

function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === kind));
}

function isExported(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.ExportKeyword) || hasModifier(node, ts.SyntaxKind.DefaultKeyword);
}

function collectNamedExports(source: ts.SourceFile): { named: Set<string>; defaultName?: string } {
  const named = new Set<string>();
  let defaultName: string | undefined;
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        named.add(element.propertyName?.text || element.name.text);
      }
    }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals && ts.isIdentifier(statement.expression)) {
      defaultName = statement.expression.text;
      named.add(defaultName);
    }
  }
  return { named, defaultName };
}

function redactPotentialSecrets(rawCode: string): string {
  return rawCode.replace(
    /(\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password)\b\s*(?::|=(?!=))\s*)(['"`])(?:\\.|(?!\2)[\s\S])*?\2/gi,
    "$1'<REDACTED>'",
  );
}

function resolveInternalModule(root: string, sourceFile: string, moduleName: string): string | undefined {
  if (!moduleName.startsWith('.')) return undefined;
  const base = path.resolve(root, path.dirname(sourceFile), moduleName);
  const candidates = [
    base,
    ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'].map(ext => `${base}${ext}`),
    ...['.ts', '.tsx', '.js', '.jsx'].map(ext => path.join(base, `index${ext}`)),
  ];
  const found = candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  return found ? toPosix(path.relative(root, found)) : undefined;
}

function classifyBoundary(moduleName: string): UnitDependency['boundary'] {
  const normalized = moduleName.toLowerCase();
  if (/(repository|database|\bdb\b|prisma|sequelize|typeorm|mongoose|redis)/.test(normalized)) return 'database';
  if (/(axios|fetch|http|api|graphql|email|mailer|sms|queue|playwright|puppeteer|selenium|openai|groq|anthropic|gemini)/.test(normalized)) return 'network';
  if (/^(?:node:)?fs(?:\/|\s|$)|filesystem/.test(normalized)) return 'filesystem';
  if (/(date|clock|time|random|uuid|nanoid)/.test(normalized)) return 'time-random';
  if (/(react|vue|angular|next|nuxt|nestjs|express|fastify)/.test(normalized)) return 'framework';
  return 'internal';
}

interface ImportInfo {
  module: string;
  importedNames: string[];
  external: boolean;
  boundary: UnitDependency['boundary'];
  resolvedFile?: string;
}

function importsForFile(source: ts.SourceFile, root: string, relativeFile: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const moduleName = statement.moduleSpecifier.text;
    const importedNames: string[] = [];
    const clause = statement.importClause;
    if (clause?.name) importedNames.push(clause.name.text);
    if (clause?.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) importedNames.push(clause.namedBindings.name.text);
      else importedNames.push(...clause.namedBindings.elements.map(element => element.name.text));
    }
    imports.push({
      module: moduleName,
      importedNames,
      external: !moduleName.startsWith('.'),
      boundary: classifyBoundary(`${moduleName} ${importedNames.join(' ')}`),
      resolvedFile: resolveInternalModule(root, relativeFile, moduleName),
    });
  }
  return imports;
}

function dependenciesForTarget(rawCode: string, imports: ImportInfo[]): UnitDependency[] {
  return imports
    // Retain safety boundaries even when a same-file helper uses them
    // transitively. Filtering only by rawCode allowed real browser/filesystem
    // work to escape the unit-test mock contract.
    .filter(item => {
      const boundaryNeedsIsolation = ['database', 'network', 'filesystem', 'time-random'].includes(item.boundary);
      return boundaryNeedsIsolation
        || item.importedNames.length === 0
        || item.importedNames.some(name => new RegExp(`\\b${name}\\b`).test(rawCode));
    })
    .map(item => {
      const needsNativeEnvironment = item.boundary === 'framework';
      const needsMock = item.boundary !== 'internal' && !needsNativeEnvironment;
      return {
        ...item,
        strategy: needsNativeEnvironment ? 'native-environment' : needsMock ? 'mock' : 'real',
      };
    });
}

function nodeLine(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function compactText(node: ts.Node, source: ts.SourceFile, max = 180): string {
  const value = node.getText(source).replace(/\s+/g, ' ').trim();
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function branchesForNode(target: ts.Node, source: ts.SourceFile): UnitBranch[] {
  const branches: UnitBranch[] = [];
  let counter = 1;
  const addPair = (kind: UnitBranch['kind'], condition: ts.Node, lineNode: ts.Node, trueOutcome: string, falseOutcome: string) => {
    const base = `B${String(counter++).padStart(3, '0')}`;
    const text = compactText(condition, source);
    const line = nodeLine(source, lineNode);
    branches.push({ id: `${base}_TRUE`, kind, condition: text, outcome: trueOutcome, line });
    branches.push({ id: `${base}_FALSE`, kind, condition: text, outcome: falseOutcome, line });
  };

  const visit = (node: ts.Node) => {
    if (node !== target && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))) {
      return;
    }
    if (ts.isIfStatement(node)) {
      addPair('if', node.expression, node, 'condition true', node.elseStatement ? 'condition false / else' : 'condition false / continue');
    } else if (ts.isConditionalExpression(node)) {
      addPair('ternary', node.condition, node, 'whenTrue', 'whenFalse');
    } else if (ts.isSwitchStatement(node)) {
      for (const clause of node.caseBlock.clauses) {
        const id = `B${String(counter++).padStart(3, '0')}_CASE`;
        branches.push({
          id,
          kind: 'switch',
          condition: ts.isDefaultClause(clause) ? 'default' : compactText(clause.expression, source),
          outcome: ts.isDefaultClause(clause) ? 'default clause' : 'matching case',
          line: nodeLine(source, clause),
        });
      }
    } else if (ts.isCatchClause(node)) {
      branches.push({
        id: `B${String(counter++).padStart(3, '0')}_CATCH`,
        kind: 'catch',
        condition: 'exception thrown in try block',
        outcome: 'catch handler',
        line: nodeLine(source, node),
      });
    } else if (
      ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) || ts.isDoStatement(node)
    ) {
      const condition = ts.isForStatement(node) ? node.condition : ts.isWhileStatement(node) || ts.isDoStatement(node) ? node.expression : node.expression;
      if (condition) addPair('loop', condition, node, 'loop executes', 'zero iterations / loop ends');
    }
    ts.forEachChild(node, visit);
  };
  visit(target);
  if (branches.length === 0) {
    branches.push({
      id: 'B001_PATH',
      kind: 'if',
      condition: 'default execution path',
      outcome: 'function/class behavior completes',
      line: nodeLine(source, target),
    });
  }
  return branches;
}

function parametersOf(node: ts.FunctionLikeDeclarationBase, source: ts.SourceFile): UnitParameter[] {
  return node.parameters.map(parameter => ({
    name: parameter.name.getText(source),
    type: parameter.type?.getText(source) || 'unknown',
    optional: Boolean(parameter.questionToken || parameter.initializer),
  }));
}

function classifyExecution(
  relativeFile: string,
  exported: boolean,
  kind: UnitTarget['kind'],
  dependencies: UnitDependency[],
  rawCode: string,
): { mode: UnitExecutionMode; reasons: string[] } {
  const reasons: string[] = [];
  if (!exported) return { mode: 'UNSUPPORTED', reasons: ['Target không được export nên test bền vững không thể import source thật.'] };
  if (/\.tsx$|\.jsx$/i.test(relativeFile)) reasons.push('File giao diện cần runtime/framework thật.');
  if (kind === 'class' && /(^|\n)\s*@\w+/.test(rawCode)) reasons.push('Class có decorator cần runtime/framework thật.');
  if (dependencies.some(dependency => dependency.strategy === 'native-environment')) reasons.push('Có dependency framework cần môi trường dự án thật.');
  if (reasons.length > 0) return { mode: 'NATIVE_REQUIRED', reasons };
  if (dependencies.some(dependency => dependency.strategy === 'mock')) return { mode: 'NATIVE_WITH_MOCKS', reasons: [] };
  return { mode: 'NATIVE_DIRECT', reasons: [] };
}

function targetId(relativeFile: string, symbol: string): string {
  return `${relativeFile}#${symbol}`;
}

export function buildUnitCodeIndex(manifest: UnitProjectManifest): UnitCodeIndex {
  const targets: UnitTarget[] = [];
  const skippedFiles: UnitCodeIndex['skippedFiles'] = [];

  for (const relativeFile of manifest.sourceFiles) {
    const absoluteFile = path.join(manifest.projectRoot, relativeFile);
    let sourceText: string;
    try {
      sourceText = fs.readFileSync(absoluteFile, 'utf-8');
    } catch (error) {
      skippedFiles.push({ file: relativeFile, reason: error instanceof Error ? error.message : 'Không đọc được file.' });
      continue;
    }
    const scriptKind = /\.(?:tsx|jsx)$/.test(relativeFile) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const source = ts.createSourceFile(relativeFile, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
    const fileHash = hash(sourceText);
    const imports = importsForFile(source, manifest.projectRoot, relativeFile);
    const exportInfo = collectNamedExports(source);

    for (const statement of source.statements) {
      if (ts.isFunctionDeclaration(statement) && (statement.name || hasModifier(statement, ts.SyntaxKind.DefaultKeyword))) {
        const symbol = statement.name?.text || 'default';
        const originalRawCode = statement.getText(source);
        const rawCode = redactPotentialSecrets(originalRawCode);
        const exported = isExported(statement) || exportInfo.named.has(symbol);
        const defaultExport = hasModifier(statement, ts.SyntaxKind.DefaultKeyword) || exportInfo.defaultName === symbol;
        const dependencies = dependenciesForTarget(rawCode, imports);
        const classification = classifyExecution(relativeFile, exported, 'function', dependencies, rawCode);
        targets.push({
          id: targetId(relativeFile, symbol), sourceFile: relativeFile, sourceHash: fileHash,
          symbol, kind: 'function', exported,
          defaultExport,
          async: hasModifier(statement, ts.SyntaxKind.AsyncKeyword),
          parameters: parametersOf(statement, source), returnType: statement.type?.getText(source) || 'inferred',
          startLine: nodeLine(source, statement), endLine: source.getLineAndCharacterOfPosition(statement.end).line + 1,
          rawCode, dependencies, branches: branchesForNode(statement, source),
          executionMode: classification.mode, unsupportedReasons: classification.reasons,
        });
      }

      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
          if (!ts.isArrowFunction(declaration.initializer) && !ts.isFunctionExpression(declaration.initializer)) continue;
          const originalRawCode = statement.getText(source);
          const rawCode = redactPotentialSecrets(originalRawCode);
          const exported = isExported(statement) || exportInfo.named.has(declaration.name.text);
          const defaultExport = exportInfo.defaultName === declaration.name.text;
          const dependencies = dependenciesForTarget(rawCode, imports);
          const classification = classifyExecution(relativeFile, exported, 'function', dependencies, rawCode);
          targets.push({
            id: targetId(relativeFile, declaration.name.text), sourceFile: relativeFile, sourceHash: fileHash,
            symbol: declaration.name.text, kind: 'function', exported,
            defaultExport, async: hasModifier(declaration.initializer, ts.SyntaxKind.AsyncKeyword),
            parameters: parametersOf(declaration.initializer, source), returnType: declaration.type?.getText(source) || declaration.initializer.type?.getText(source) || 'inferred',
            startLine: nodeLine(source, statement), endLine: source.getLineAndCharacterOfPosition(statement.end).line + 1,
            rawCode, dependencies, branches: branchesForNode(declaration.initializer, source),
            executionMode: classification.mode, unsupportedReasons: classification.reasons,
          });
        }
      }

      if (ts.isClassDeclaration(statement) && (statement.name || hasModifier(statement, ts.SyntaxKind.DefaultKeyword))) {
        const symbol = statement.name?.text || 'default';
        const originalRawCode = statement.getText(source);
        const rawCode = redactPotentialSecrets(originalRawCode);
        const exported = isExported(statement) || exportInfo.named.has(symbol);
        const defaultExport = hasModifier(statement, ts.SyntaxKind.DefaultKeyword) || exportInfo.defaultName === symbol;
        const dependencies = dependenciesForTarget(rawCode, imports);
        const classification = classifyExecution(relativeFile, exported, 'class', dependencies, rawCode);
        targets.push({
          id: targetId(relativeFile, symbol), sourceFile: relativeFile, sourceHash: fileHash,
          symbol, kind: 'class', exported,
          defaultExport, async: false,
          parameters: [], returnType: symbol,
          startLine: nodeLine(source, statement), endLine: source.getLineAndCharacterOfPosition(statement.end).line + 1,
          rawCode, dependencies, branches: branchesForNode(statement, source),
          executionMode: classification.mode, unsupportedReasons: classification.reasons,
        });
      }
    }
  }

  return { version: 1, projectRoot: manifest.projectRoot, targets, skippedFiles };
}
