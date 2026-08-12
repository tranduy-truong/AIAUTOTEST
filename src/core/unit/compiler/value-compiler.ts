import * as ts from 'typescript';
import type { UnitDataValue } from '../schema.js';

const f = ts.factory;

function propertyName(value: string): ts.PropertyName {
  return /^[A-Za-z_$][\w$]*$/.test(value) ? f.createIdentifier(value) : f.createStringLiteral(value);
}

export function compileDataValue(value: UnitDataValue): ts.Expression {
  if (value === null) return f.createNull();
  if (typeof value === 'string') return f.createStringLiteral(value);
  if (typeof value === 'number') return f.createNumericLiteral(value);
  if (typeof value === 'boolean') return value ? f.createTrue() : f.createFalse();
  if (Array.isArray(value)) return f.createArrayLiteralExpression(value.map(compileDataValue), false);

  if ('$type' in value) {
    const tagged = value as {
      $type: string;
      value?: string;
      entries?: [UnitDataValue, UnitDataValue][];
      values?: UnitDataValue[];
    };
    switch (tagged.$type) {
      case 'undefined': return f.createIdentifier('undefined');
      case 'nan': return f.createPropertyAccessExpression(f.createIdentifier('Number'), 'NaN');
      case 'infinity': return f.createPropertyAccessExpression(f.createIdentifier('Number'), 'POSITIVE_INFINITY');
      case 'negative-infinity': return f.createPropertyAccessExpression(f.createIdentifier('Number'), 'NEGATIVE_INFINITY');
      case 'bigint': return f.createBigIntLiteral(`${tagged.value || '0'}n`);
      case 'date': return f.createNewExpression(f.createIdentifier('Date'), undefined, [f.createStringLiteral(tagged.value || '')]);
      case 'regexp': {
        const encoded = tagged.value || '';
        const match = encoded.match(/^([\s\S]*?)\/([dgimsuvy]*)$/);
        const pattern = match ? match[1] : encoded;
        const flags = match?.[2];
        return f.createNewExpression(f.createIdentifier('RegExp'), undefined, [
          f.createStringLiteral(pattern),
          ...(flags ? [f.createStringLiteral(flags)] : []),
        ]);
      }
      case 'map':
        return f.createNewExpression(f.createIdentifier('Map'), undefined, [
          f.createArrayLiteralExpression((tagged.entries || []).map(([key, item]) =>
            f.createArrayLiteralExpression([compileDataValue(key), compileDataValue(item)])), true),
        ]);
      case 'set':
        return f.createNewExpression(f.createIdentifier('Set'), undefined, [
          f.createArrayLiteralExpression((tagged.values || []).map(compileDataValue), true),
        ]);
    }
  }

  return f.createObjectLiteralExpression(
    Object.entries(value as Record<string, UnitDataValue>)
      .map(([key, item]) => f.createPropertyAssignment(propertyName(key), compileDataValue(item))),
    true,
  );
}

export function objectPropertyName(value: string): ts.PropertyName {
  return propertyName(value);
}
