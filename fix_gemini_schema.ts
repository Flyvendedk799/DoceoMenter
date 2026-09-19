const fs = require('fs');
let content = fs.readFileSync('packages/claude/src/transport.ts', 'utf8');

const replacement = `function sanitizeGeminiSchema(schema: any): any {
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
    return sanitized;
  }
  return schema;
}

function toGeminiFunctionDeclaration(tool: Tool) {
  return { name: tool.name, description: tool.description, parameters: sanitizeGeminiSchema(tool.input_schema) };
}`;

content = content.replace(/function toGeminiFunctionDeclaration\(tool: Tool\) \{[\s\S]*?\}/, replacement);
fs.writeFileSync('packages/claude/src/transport.ts', content);
