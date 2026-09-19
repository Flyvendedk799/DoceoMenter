const fs = require('fs');
let content = fs.readFileSync('packages/claude/src/transport.ts', 'utf8');

const newFunc = `function sanitizeGeminiSchema(schema: any): any {
  if (Array.isArray(schema)) {
    return schema.map(sanitizeGeminiSchema);
  }
  if (schema !== null && typeof schema === 'object') {
    const { const: constVal, ...rest } = schema;
    const sanitized: any = {};
    for (const [k, v] of Object.entries(rest)) {
      sanitized[k] = sanitizeGeminiSchema(v);
    }
    if (constVal !== undefined) {
      sanitized.enum = [constVal];
    }
    if (Array.isArray(sanitized.enum) && sanitized.enum.some((e: any) => typeof e !== 'string')) {
      sanitized.description = (sanitized.description ? sanitized.description + " " : "") + "Allowed values: " + sanitized.enum.join(", ");
      delete sanitized.enum;
    }
    return sanitized;
  }
  return schema;
}`;

content = content.replace(/function sanitizeGeminiSchema\([\s\S]*?return schema;\n\}/, newFunc);
fs.writeFileSync('packages/claude/src/transport.ts', content);
