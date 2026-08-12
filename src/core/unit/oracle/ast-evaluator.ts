import * as ts from 'typescript';
import type { UnitDataValue, UnitTarget } from '../schema.js';

export type StaticEvaluationOutcome =
  | { supported: true; kind: 'return'; value: unknown; expression: string }
  | { supported: true; kind: 'throw'; errorClass: string; message: string; expression: string }
  | { supported: false; reason: string };

class UnsupportedStaticEvaluation extends Error {}
class StaticThrownValue {
  constructor(readonly value: unknown, readonly expression: string) {}
}
class StaticReturnValue {
  constructor(readonly value: unknown, readonly expression: string) {}
}

interface StaticCallable {
  __staticCallable: true;
  invoke(args: unknown[]): unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function dataValueToRuntime(value: UnitDataValue): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(dataValueToRuntime);
  if ('$type' in value) {
    const encodedValue = 'value' in value && typeof value.value === 'string' ? value.value : '';
    switch (value.$type) {
      case 'undefined': return undefined;
      case 'nan': return Number.NaN;
      case 'infinity': return Number.POSITIVE_INFINITY;
      case 'negative-infinity': return Number.NEGATIVE_INFINITY;
      case 'bigint': return BigInt(encodedValue || '0');
      case 'date': return new Date(encodedValue);
      case 'regexp': {
        const encoded = encodedValue;
        const lastSlash = encoded.lastIndexOf('/');
        return lastSlash > 0
          ? new RegExp(encoded.slice(0, lastSlash), encoded.slice(lastSlash + 1))
          : new RegExp(encoded);
      }
      case 'map': {
        const entries = Array.isArray(value.entries) ? value.entries as [UnitDataValue, UnitDataValue][] : [];
        return new Map(entries.map(([key, item]) => [dataValueToRuntime(key), dataValueToRuntime(item)]));
      }
      case 'set': {
        const values = Array.isArray(value.values) ? value.values as UnitDataValue[] : [];
        return new Set(values.map(dataValueToRuntime));
      }
    }
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, dataValueToRuntime(item)]));
}

export function runtimeValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  if (left instanceof RegExp && right instanceof RegExp) return left.source === right.source && left.flags === right.flags;
  if (left instanceof Map && right instanceof Map) {
    if (left.size !== right.size) return false;
    const leftEntries = [...left.entries()];
    const rightEntries = [...right.entries()];
    return leftEntries.every(([key, value], index) =>
      runtimeValuesEqual(key, rightEntries[index]?.[0]) && runtimeValuesEqual(value, rightEntries[index]?.[1]));
  }
  if (left instanceof Set && right instanceof Set) {
    const leftValues = [...left.values()];
    const rightValues = [...right.values()];
    return leftValues.length === rightValues.length
      && leftValues.every((value, index) => runtimeValuesEqual(value, rightValues[index]));
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => runtimeValuesEqual(value, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length
      && leftKeys.every(key => Object.prototype.hasOwnProperty.call(right, key)
        && runtimeValuesEqual(left[key], right[key]));
  }
  return false;
}

function propertyName(node: ts.PropertyName, env: Map<string, unknown>): string {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  if (ts.isComputedPropertyName(node)) return String(evaluateExpression(node.expression, env));
  throw new UnsupportedStaticEvaluation('Tên property không được hỗ trợ.');
}

function safeProperty(value: unknown, name: string): unknown {
  if (value === null || value === undefined) throw new TypeError(`Cannot read properties of ${value}`);
  if (name === 'length' && (typeof value === 'string' || Array.isArray(value))) return value.length;
  if (isRecord(value) || Array.isArray(value)) return (value as Record<string, unknown>)[name];
  throw new UnsupportedStaticEvaluation(`Property access .${name} nằm ngoài tập an toàn.`);
}

function evaluateBinary(node: ts.BinaryExpression, env: Map<string, unknown>): unknown {
  if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    const left = evaluateExpression(node.left, env);
    return left ? evaluateExpression(node.right, env) : left;
  }
  if (node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    const left = evaluateExpression(node.left, env);
    return left ? left : evaluateExpression(node.right, env);
  }
  if (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    const left = evaluateExpression(node.left, env);
    return left === null || left === undefined ? evaluateExpression(node.right, env) : left;
  }
  const left = evaluateExpression(node.left, env) as any;
  const right = evaluateExpression(node.right, env) as any;
  switch (node.operatorToken.kind) {
    case ts.SyntaxKind.PlusToken: return left + right;
    case ts.SyntaxKind.MinusToken: return left - right;
    case ts.SyntaxKind.AsteriskToken: return left * right;
    case ts.SyntaxKind.SlashToken: return left / right;
    case ts.SyntaxKind.PercentToken: return left % right;
    case ts.SyntaxKind.AsteriskAsteriskToken: return left ** right;
    case ts.SyntaxKind.LessThanToken: return left < right;
    case ts.SyntaxKind.LessThanEqualsToken: return left <= right;
    case ts.SyntaxKind.GreaterThanToken: return left > right;
    case ts.SyntaxKind.GreaterThanEqualsToken: return left >= right;
    case ts.SyntaxKind.EqualsEqualsToken: return left == right; // mirrors source semantics
    case ts.SyntaxKind.ExclamationEqualsToken: return left != right;
    case ts.SyntaxKind.EqualsEqualsEqualsToken: return left === right;
    case ts.SyntaxKind.ExclamationEqualsEqualsToken: return left !== right;
    case ts.SyntaxKind.AmpersandToken: return left & right;
    case ts.SyntaxKind.BarToken: return left | right;
    case ts.SyntaxKind.CaretToken: return left ^ right;
    case ts.SyntaxKind.LessThanLessThanToken: return left << right;
    case ts.SyntaxKind.GreaterThanGreaterThanToken: return left >> right;
    case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken: return left >>> right;
    default: throw new UnsupportedStaticEvaluation(`Binary operator ${node.operatorToken.getText()} chưa được hỗ trợ.`);
  }
}

function evaluateSafeCall(node: ts.CallExpression, env: Map<string, unknown>): unknown {
  const args = node.arguments.map(argument => evaluateExpression(argument, env));
  if (ts.isIdentifier(node.expression)) {
    const local = env.get(node.expression.text);
    if (isRecord(local) && local.__staticCallable === true && typeof local.invoke === 'function') {
      return (local as unknown as StaticCallable).invoke(args);
    }
    switch (node.expression.text) {
      case 'Number': return Number(args[0]);
      case 'String': return String(args[0]);
      case 'Boolean': return Boolean(args[0]);
      case 'BigInt': return BigInt(args[0] as string | number);
      case 'parseInt': return Number.parseInt(String(args[0]), args[1] as number | undefined);
      case 'parseFloat': return Number.parseFloat(String(args[0]));
    }
  }
  if (ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === 'Math') {
    const method = node.expression.name.text;
    const allowed = new Set(['abs', 'ceil', 'floor', 'round', 'trunc', 'min', 'max', 'pow', 'sqrt', 'sign']);
    if (allowed.has(method)) return (Math[method as keyof Math] as (...values: number[]) => number)(...args as number[]);
  }
  if (ts.isPropertyAccessExpression(node.expression)) {
    const receiver = evaluateExpression(node.expression.expression, env);
    const method = node.expression.name.text;
    if (typeof receiver === 'string') {
      switch (method) {
        case 'trim': return receiver.trim();
        case 'toLowerCase': return receiver.toLowerCase();
        case 'toUpperCase': return receiver.toUpperCase();
        case 'includes': return receiver.includes(String(args[0]), args[1] as number | undefined);
        case 'startsWith': return receiver.startsWith(String(args[0]), args[1] as number | undefined);
        case 'endsWith': return receiver.endsWith(String(args[0]), args[1] as number | undefined);
        case 'slice': return receiver.slice(args[0] as number | undefined, args[1] as number | undefined);
        case 'substring': return receiver.substring(args[0] === undefined ? 0 : Number(args[0]), args[1] as number | undefined);
      }
    }
    if (Array.isArray(receiver)) {
      switch (method) {
        case 'includes': return receiver.includes(args[0], args[1] as number | undefined);
        case 'slice': return receiver.slice(args[0] as number | undefined, args[1] as number | undefined);
        case 'join': return receiver.join(args[0] === undefined ? ',' : String(args[0]));
        case 'indexOf': return receiver.indexOf(args[0], args[1] as number | undefined);
      }
    }
  }
  throw new UnsupportedStaticEvaluation(`Call ${node.expression.getText()} không nằm trong allow-list pure.`);
}

function evaluateExpression(node: ts.Expression, env: Map<string, unknown>): unknown {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
    || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) {
    return evaluateExpression(node.expression, env);
  }
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isIdentifier(node)) {
    if (node.text === 'undefined') return undefined;
    if (node.text === 'NaN') return Number.NaN;
    if (node.text === 'Infinity') return Number.POSITIVE_INFINITY;
    if (!env.has(node.text)) throw new UnsupportedStaticEvaluation(`Identifier ${node.text} chưa có giá trị tĩnh.`);
    return env.get(node.text);
  }
  if (ts.isPrefixUnaryExpression(node)) {
    const value = evaluateExpression(node.operand, env) as any;
    switch (node.operator) {
      case ts.SyntaxKind.ExclamationToken: return !value;
      case ts.SyntaxKind.PlusToken: return +value;
      case ts.SyntaxKind.MinusToken: return -value;
      case ts.SyntaxKind.TildeToken: return ~value;
      default: throw new UnsupportedStaticEvaluation('Unary operator chưa được hỗ trợ.');
    }
  }
  if (ts.isTypeOfExpression(node)) return typeof evaluateExpression(node.expression, env);
  if (ts.isVoidExpression(node)) {
    evaluateExpression(node.expression, env);
    return undefined;
  }
  if (ts.isBinaryExpression(node)) return evaluateBinary(node, env);
  if (ts.isConditionalExpression(node)) {
    return evaluateExpression(evaluateExpression(node.condition, env) ? node.whenTrue : node.whenFalse, env);
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map(element => {
      if (ts.isSpreadElement(element)) throw new UnsupportedStaticEvaluation('Array spread chưa được hỗ trợ.');
      return evaluateExpression(element, env);
    });
  }
  if (ts.isObjectLiteralExpression(node)) {
    const result: Record<string, unknown> = {};
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) result[propertyName(property.name, env)] = evaluateExpression(property.initializer, env);
      else if (ts.isShorthandPropertyAssignment(property)) result[property.name.text] = env.get(property.name.text);
      else throw new UnsupportedStaticEvaluation('Object method/spread chưa được hỗ trợ.');
    }
    return result;
  }
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map(span =>
      `${String(evaluateExpression(span.expression, env))}${span.literal.text}`).join('');
  }
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return safeProperty(evaluateExpression(node.expression, env), node.name.text);
  if (ts.isElementAccessExpression(node) && node.argumentExpression) {
    return safeProperty(evaluateExpression(node.expression, env), String(evaluateExpression(node.argumentExpression, env)));
  }
  if (ts.isCallExpression(node)) return evaluateSafeCall(node, env);
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
    const args = (node.arguments || []).map(argument => evaluateExpression(argument, env));
    if (node.expression.text === 'Error') return new Error(String(args[0] ?? ''));
    if (node.expression.text === 'TypeError') return new TypeError(String(args[0] ?? ''));
    if (node.expression.text === 'RangeError') return new RangeError(String(args[0] ?? ''));
    if (node.expression.text === 'SyntaxError') return new SyntaxError(String(args[0] ?? ''));
    if (node.expression.text === 'ReferenceError') return new ReferenceError(String(args[0] ?? ''));
  }
  throw new UnsupportedStaticEvaluation(`Expression ${ts.SyntaxKind[node.kind]} chưa được hỗ trợ an toàn.`);
}

function executeStatement(statement: ts.Statement, env: Map<string, unknown>): void {
  if (ts.isBlock(statement)) {
    for (const child of statement.statements) executeStatement(child, env);
    return;
  }
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) throw new UnsupportedStaticEvaluation('Destructuring chưa được hỗ trợ.');
      env.set(declaration.name.text, declaration.initializer ? evaluateExpression(declaration.initializer, env) : undefined);
    }
    return;
  }
  if (ts.isIfStatement(statement)) {
    const branch = evaluateExpression(statement.expression, env) ? statement.thenStatement : statement.elseStatement;
    if (branch) executeStatement(branch, env);
    return;
  }
  if (ts.isSwitchStatement(statement)) {
    const switchValue = evaluateExpression(statement.expression, env);
    let matched = false;
    for (const clause of statement.caseBlock.clauses) {
      if (ts.isDefaultClause(clause) || runtimeValuesEqual(switchValue, evaluateExpression(clause.expression, env))) {
        matched = true;
      }
      if (!matched) continue;
      for (const child of clause.statements) {
        if (ts.isBreakStatement(child)) return;
        executeStatement(child, env);
      }
    }
    return;
  }
  if (ts.isReturnStatement(statement)) {
    throw new StaticReturnValue(statement.expression ? evaluateExpression(statement.expression, env) : undefined, statement.getText());
  }
  if (ts.isThrowStatement(statement)) {
    throw new StaticThrownValue(evaluateExpression(statement.expression, env), statement.getText());
  }
  if (ts.isExpressionStatement(statement)) {
    if (ts.isBinaryExpression(statement.expression)
      && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(statement.expression.left)) {
      env.set(statement.expression.left.text, evaluateExpression(statement.expression.right, env));
      return;
    }
    throw new UnsupportedStaticEvaluation('Expression statement có side effect không được thực thi tĩnh.');
  }
  if (ts.isEmptyStatement(statement)) return;
  throw new UnsupportedStaticEvaluation(`Statement ${ts.SyntaxKind[statement.kind]} chưa được hỗ trợ an toàn.`);
}

function findBody(target: UnitTarget): { body: ts.ConciseBody; parameters: readonly ts.ParameterDeclaration[] } | undefined {
  const sourceText = target.kind === 'class-method'
    ? `class __OracleTarget { ${target.rawCode} }`
    : target.rawCode;
  const source = ts.createSourceFile('oracle-target.ts', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found: { body: ts.ConciseBody; parameters: readonly ts.ParameterDeclaration[] } | undefined;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (target.kind === 'class-method' && ts.isMethodDeclaration(node) && node.body) {
      found = { body: node.body, parameters: node.parameters };
      return;
    }
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) && node.body) {
      found = { body: node.body, parameters: node.parameters };
      return;
    }
    if (ts.isVariableDeclaration(node) && node.initializer
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      found = { body: node.initializer.body, parameters: node.initializer.parameters };
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function callableFromCode(code: string, parentEnv: Map<string, unknown>): StaticCallable | undefined {
  const source = ts.createSourceFile('oracle-helper.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let callable: { body: ts.ConciseBody; parameters: readonly ts.ParameterDeclaration[] } | undefined;
  const visit = (node: ts.Node) => {
    if (callable) return;
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) && node.body) {
      callable = { body: node.body, parameters: node.parameters };
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!callable) return undefined;
  const resolved = callable;
  return {
    __staticCallable: true,
    invoke(args: unknown[]): unknown {
      const env = new Map(parentEnv);
      resolved.parameters.forEach((parameter, index) => {
        if (!ts.isIdentifier(parameter.name)) throw new UnsupportedStaticEvaluation('Helper destructuring chưa được hỗ trợ.');
        if (index < args.length) env.set(parameter.name.text, args[index]);
        else if (parameter.initializer) env.set(parameter.name.text, evaluateExpression(parameter.initializer, env));
        else env.set(parameter.name.text, undefined);
      });
      try {
        if (ts.isBlock(resolved.body)) {
          for (const statement of resolved.body.statements) executeStatement(statement, env);
          return undefined;
        }
        return evaluateExpression(resolved.body, env);
      } catch (error) {
        if (error instanceof StaticReturnValue) return error.value;
        if (error instanceof StaticThrownValue) throw error;
        throw error;
      }
    },
  };
}

export function evaluateTargetStatically(
  target: UnitTarget,
  inputs: Record<string, UnitDataValue>,
): StaticEvaluationOutcome {
  if (target.dependencies.some(dependency => dependency.strategy === 'mock')) {
    return { supported: false, reason: 'Target có dependency mock; static evaluator không mô phỏng side effect.' };
  }
  const callable = findBody(target);
  if (!callable) return { supported: false, reason: 'Không tìm thấy function/method body.' };
  const env = new Map<string, unknown>();
  for (const definition of target.supportingContext.constantDefinitions) {
    const source = ts.createSourceFile('oracle-constant.ts', definition.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const declaration = source.statements.flatMap(statement =>
      ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [])
      .find(item => ts.isIdentifier(item.name) && item.name.text === definition.symbol && item.initializer);
    if (declaration?.initializer) {
      try { env.set(definition.symbol, evaluateExpression(declaration.initializer, env)); } catch {}
    }
  }
  // Register first, then replace with closures sharing the same environment so
  // pure helpers may call another helper without executing project code.
  for (const definition of target.supportingContext.helperDefinitions) env.set(definition.symbol, undefined);
  for (const definition of target.supportingContext.helperDefinitions) {
    const callable = callableFromCode(definition.code, env);
    if (callable) env.set(definition.symbol, callable);
  }
  for (const parameter of callable.parameters) {
    if (!ts.isIdentifier(parameter.name)) return { supported: false, reason: 'Destructured parameter chưa được hỗ trợ.' };
    if (Object.prototype.hasOwnProperty.call(inputs, parameter.name.text)) {
      env.set(parameter.name.text, dataValueToRuntime(inputs[parameter.name.text]));
    } else if (parameter.initializer) {
      try { env.set(parameter.name.text, evaluateExpression(parameter.initializer, env)); }
      catch (error) { return { supported: false, reason: error instanceof Error ? error.message : String(error) }; }
    } else env.set(parameter.name.text, undefined);
  }
  try {
    if (ts.isBlock(callable.body)) {
      for (const statement of callable.body.statements) executeStatement(statement, env);
      return { supported: true, kind: 'return', value: undefined, expression: 'implicit return undefined' };
    }
    return { supported: true, kind: 'return', value: evaluateExpression(callable.body, env), expression: callable.body.getText() };
  } catch (error) {
    if (error instanceof StaticReturnValue) return { supported: true, kind: 'return', value: error.value, expression: error.expression };
    if (error instanceof StaticThrownValue) {
      const value = error.value;
      return {
        supported: true,
        kind: 'throw',
        errorClass: value instanceof Error ? value.constructor.name : 'Error',
        message: value instanceof Error ? value.message : String(value),
        expression: error.expression,
      };
    }
    return { supported: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
