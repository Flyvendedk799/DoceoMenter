const fs = require('fs');
let content = fs.readFileSync('packages/claude/src/transport.ts', 'utf8');
content = content.replace("};\n}", "}");
fs.writeFileSync('packages/claude/src/transport.ts', content);
