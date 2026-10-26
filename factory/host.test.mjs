import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = join(ROOT, 'factory', 'host.mjs');
const MISTRAL = 'mistral/zai-glm-5-3-flash';
const DEEPSEEK = 'deepseek/deepseek-flash';

function runAsk(role, model) {
  const fakeHome = mkdtempSync(join(tmpdir(), 'program-factory-host-test-'));
  const launcherDir = join(fakeHome, '.pi', 'agent', 'bin');
  mkdirSync(launcherDir, { recursive: true });
  writeFileSync(join(launcherDir, 'pi-launcher.js'),
    'process.stdout.write(JSON.stringify(process.argv.slice(2)));', 'utf8');
  const prompt = join(fakeHome, 'prompt.md');
  const output = join(fakeHome, 'output.json');
  writeFileSync(prompt, 'test prompt', 'utf8');
  const args = [HOST, 'ask', role, prompt, output];
  if (model !== undefined) args.push('--model', model);
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome },
  });
  return { result, output };
}

function passedModel(outputPath) {
  const args = JSON.parse(readFileSync(outputPath, 'utf8'));
  return args[args.indexOf('--model') + 1];
}

for (const role of ['B1', 'B2']) {
  test(role + ' keeps DeepSeek by default and accepts the Mistral option', () => {
    const defaultRun = runAsk(role);
    assert.equal(defaultRun.result.status, 0, defaultRun.result.stderr);
    assert.equal(passedModel(defaultRun.output), DEEPSEEK);
    const selectedRun = runAsk(role, MISTRAL);
    assert.equal(selectedRun.result.status, 0, selectedRun.result.stderr);
    assert.equal(passedModel(selectedRun.output), MISTRAL);
  });
}

test('role config lists the default and Mistral option for B1 and B2', () => {
  const roles = JSON.parse(readFileSync(join(ROOT, 'config', 'roles.json'), 'utf8')).team.members;
  for (const roleId of ['B1', 'B2']) {
    const role = roles.find((candidate) => candidate.id === roleId);
    assert.equal(role.model, DEEPSEEK);
    assert.deepEqual(role.model_options, [DEEPSEEK, MISTRAL]);
  }
});

test('rejects Mistral for a role that does not list it before calling Pi', () => {
  const { result, output } = runAsk('F1', MISTRAL);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /model override not allowed for F1/);
  assert.equal(existsSync(output), false);
});
