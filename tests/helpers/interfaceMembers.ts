import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import ts from 'typescript';

/**
 * Reads declared member names off a TypeScript interface.
 *
 * Interfaces are erased at runtime, so a contract table can drift from the
 * type it claims to describe without anything failing. The contribution
 * inventory is checked against the real declarations instead.
 */
export function readInterfaceMembers(relativeFilePath: string, interfaceName: string): string[] {
  const absolutePath = resolve(process.cwd(), relativeFilePath);
  const source = ts.createSourceFile(
    absolutePath,
    readFileSync(absolutePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  let members: string[] | null = null;

  function visit(node: ts.Node): void {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      members = node.members
        .map(member => {
          const name = member.name;
          return name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : null;
        })
        .filter((name): name is string => name !== null);
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(source);

  if (members === null) {
    throw new Error(`Interface "${interfaceName}" was not found in ${relativeFilePath}`);
  }

  return members;
}
