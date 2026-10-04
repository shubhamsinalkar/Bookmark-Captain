/** Small helpers for walking arbitrary JSON from any site. */

export type JsonPath = readonly (string | number)[];
export type Json = Record<string, unknown>;

export const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function getPath(value: unknown, path: JsonPath): unknown {
  let current = value;
  for (const key of path) {
    if (Array.isArray(current) && typeof key === 'number') current = current[key];
    else if (isRecord(current) && typeof key === 'string') current = current[key];
    else return undefined;
  }
  return current;
}

export interface Leaf {
  path: (string | number)[];
  value: string | number;
}

/**
 * The scalar values inside one item, with their paths. Arrays are followed at index 0 only,
 * so paths stay general ("images.0.url" rather than one path per image).
 */
export function leaves(value: unknown, maxDepth = 7): Leaf[] {
  const out: Leaf[] = [];
  const visit = (node: unknown, path: (string | number)[]) => {
    if (out.length > 400) return;
    if (typeof node === 'string' || typeof node === 'number') {
      out.push({ path, value: node });
    } else if (path.length < maxDepth) {
      if (Array.isArray(node)) {
        if (node.length > 0) visit(node[0], [...path, 0]);
      } else if (isRecord(node)) {
        for (const [key, child] of Object.entries(node)) visit(child, [...path, key]);
      }
    }
  };
  visit(value, []);
  return out;
}

export interface FoundArray {
  path: (string | number)[];
  array: unknown[];
}

/** Every array of objects in a JSON tree (depth- and count-limited). */
export function arraysIn(value: unknown, maxDepth = 40, maxArrays = 2_000): FoundArray[] {
  const out: FoundArray[] = [];
  const visit = (node: unknown, path: (string | number)[]) => {
    if (out.length >= maxArrays || path.length > maxDepth) return;
    if (Array.isArray(node)) {
      if (node.some(isRecord)) out.push({ path, array: node });
      node.forEach((child, index) => visit(child, [...path, index]));
    } else if (isRecord(node)) {
      for (const [key, child] of Object.entries(node)) visit(child, [...path, key]);
    }
  };
  visit(value, []);
  return out;
}

export const pathText = (path: JsonPath) => (path.length > 0 ? path.join('.') : '(root)');

/** Strips the anti-hijacking prefixes some sites put before JSON (e.g. `for (;;);`). */
export function parseJsonText(text: string): unknown {
  return JSON.parse(text.replace(/^\s*(?:for\s*\(;;\);|while\s*\(1\);|\)\]\}',?)/, ''));
}
