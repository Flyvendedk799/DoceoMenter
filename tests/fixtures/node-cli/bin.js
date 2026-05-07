#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--help") || args.length === 0) {
  console.log(`doceo-fixture-cli — a tiny CLI used by DoceoMenter integration tests.

USAGE
  doceo-fixture-cli <command>

COMMANDS
  hello   Print a greeting.
  help    Show this help.
`);
  process.exit(0);
}
if (args[0] === "hello") {
  console.log("hello from the cli fixture");
  process.exit(0);
}
console.error(`unknown command: ${args[0]}`);
process.exit(1);
