#!/usr/bin/env python3
"""Regenerate lib/queries.js from the vsure library's session.py.

Usage (from the app root, after cloning python-verisure into reference/):
    python3 scripts/extract-queries.py

Every Session method that returns {"operationName", "variables", "query"} is captured.
The query strings are copied byte-for-byte so the app sends exactly what upstream sends.
"""
import ast
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'reference' / 'python-verisure' / 'verisure' / 'session.py'
TARGET = ROOT / 'lib' / 'queries.js'

tree = ast.parse(SOURCE.read_text())
queries = {}
for node in ast.walk(tree):
    if not isinstance(node, ast.FunctionDef):
        continue
    for ret in ast.walk(node):
        if isinstance(ret, ast.Return) and isinstance(ret.value, ast.Dict):
            fields = {k.value: v for k, v in zip(ret.value.keys, ret.value.values)
                      if isinstance(k, ast.Constant)}
            if 'query' in fields:
                queries[node.name] = {
                    'operationName': fields['operationName'].value if 'operationName' in fields else None,
                    'query': fields['query'].value,
                }

lines = [
    '/* eslint-disable */',
    "'use strict';",
    '',
    '// GENERATED from reference/python-verisure/verisure/session.py (vsure 2.10.1) — do not edit by hand.',
    "// The query strings are byte-for-byte copies of the library's, which is what Verisure's API is known",
    '// to accept. Regenerate with scripts/extract-queries.py when upstream changes.',
    '//',
    '// python-verisure is Copyright (c) 2015 Per Sandström, MIT License — see THIRD_PARTY_NOTICES.md.',
    '',
    'module.exports = {',
]
for name in sorted(queries):
    lines.append(f'  {name}: {{')
    lines.append(f"    operationName: {json.dumps(queries[name]['operationName'])},")
    lines.append(f"    query: {json.dumps(queries[name]['query'])},")
    lines.append('  },')
lines.append('};')
TARGET.write_text('\n'.join(lines) + '\n')
print(f'Wrote {len(queries)} queries to {TARGET.relative_to(ROOT)}')
