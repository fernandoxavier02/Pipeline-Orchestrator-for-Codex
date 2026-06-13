'use strict';
// CLI: node measure-fidelity.cjs <companyId> [> relatorio.md]
const { collectExecutions, assertSafeId } = require('./mirror-fidelity-collector.cjs');
const { scoreTrees } = require('./mirror-fidelity-tree.cjs');
const { buildReport } = require('./mirror-fidelity-report.cjs');

async function runMeasureFidelity({ companyId, transport }) {
  assertSafeId(companyId, 'companyId');
  const execs = await collectExecutions({ companyId, transport });
  const result = scoreTrees(execs);
  return {
    executions: execs,
    report: buildReport(result.trees, { orphanCount: result.orphanCount }),
    result,
  };
}

async function main(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }, transport) {
  const companyId = argv[0];
  if (!companyId || argv.length !== 1) {
    io.stderr.write('uso: node measure-fidelity.cjs <companyId>\n');
    return 2;
  }
  try {
    const output = await runMeasureFidelity({ companyId, transport });
    io.stdout.write(output.report + '\n');
    return 0;
  } catch (e) {
    io.stderr.write(`${e && e.stack ? e.stack : e}\n`);
    return 1;
  }
}

if (require.main === module) {
  main().then((code) => {
    if (code !== 0) process.exit(code);
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { runMeasureFidelity, main };
