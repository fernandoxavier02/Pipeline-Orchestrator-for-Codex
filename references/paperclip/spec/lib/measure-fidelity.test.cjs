'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { runMeasureFidelity, main } = require('./measure-fidelity.cjs');

function fakeTransport() {
  return {
    async listIssues() {
      return [
        { id: 'i1', identifier: 'PIP-1', title: '[FEATURE] raiz', parentId: null },
        { id: 'i2', identifier: 'PIP-2', title: '[FEATURE] filho', parentId: 'i1' },
      ];
    },
    async getComments(id) {
      if (id === 'i1') {
        return [{ body: '### ORCHESTRATOR_DECISION v1\ncomplexity: SIMPLES' }];
      }
      return [{ body: '### PA_DE_CAL v1\nverdict: GO' }];
    },
  };
}

test('runMeasureFidelity agrega execuções e devolve relatório markdown', async () => {
  const output = await runMeasureFidelity({ companyId: 'co', transport: fakeTransport() });
  assert.strictEqual(output.executions.length, 2);
  assert.strictEqual(output.result.orphanCount, 0);
  assert.match(output.report, /Nota média:/);
  assert.match(output.report, /PIP-1/);
});

test('main sem companyId devolve exit code 2 e mensagem de uso', async () => {
  const stdout = [];
  const stderr = [];
  const exitCode = await main([], {
    stdout: { write: (chunk) => stdout.push(chunk) },
    stderr: { write: (chunk) => stderr.push(chunk) },
  });

  assert.strictEqual(exitCode, 2);
  assert.deepStrictEqual(stdout, []);
  assert.match(stderr.join(''), /uso: node measure-fidelity\.cjs <companyId>/);
});

test('main com argumento extra devolve exit code 2 e não executa coleta', async () => {
  const stdout = [];
  const stderr = [];
  let listIssuesCalled = false;
  const exitCode = await main(['co', 'extra'], {
    stdout: { write: (chunk) => stdout.push(chunk) },
    stderr: { write: (chunk) => stderr.push(chunk) },
  }, {
    async listIssues() {
      listIssuesCalled = true;
      return [];
    },
    async getComments() {
      return [];
    },
  });

  assert.strictEqual(exitCode, 2);
  assert.strictEqual(listIssuesCalled, false);
  assert.deepStrictEqual(stdout, []);
  assert.match(stderr.join(''), /uso: node measure-fidelity\.cjs <companyId>/);
});

test('main usa runMeasureFidelity com transport injetado e escreve o relatório', async () => {
  const stdout = [];
  const stderr = [];
  const exitCode = await main(['co'], {
    stdout: { write: (chunk) => stdout.push(chunk) },
    stderr: { write: (chunk) => stderr.push(chunk) },
  }, fakeTransport());

  assert.strictEqual(exitCode, 0);
  assert.strictEqual(stderr.length, 0);
  assert.match(stdout.join(''), /Nota média:/);
});
