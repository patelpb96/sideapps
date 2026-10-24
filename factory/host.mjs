#!/usr/bin/env node
/**
 * Program Factory V1 — supervised host.
 *
 * This is a facilitator, not a sandbox. It:
 *   - keeps an append-only, hash-chained board for a task;
 *   - calls the four model roles with no tools;
 *   - asks Argon for a decision on a packet;
 *   - applies a FILE bundle only when an allow token matches its hash;
 *   - runs the test gate and records the evidence.
 *
 * It does not isolate the workers, intercept the model's own tools, or make
 * Argon's decision a security boundary. Run it supervised.
 *
 * Usage:
 *   node factory/host.mjs init <task> [briefFile]
 *   node factory/host.mjs event <task> <type> <actor> <message> [artifact]
 *   node factory/host.mjs ask <role> <promptFile> <outFile>
 *   node factory/host.mjs gate <task> <kind> <packetFile> <outFile> [--bundle <bundleFile>]
 *   node factory/host.mjs apply <task> <bundleFile>
 *   node factory/host.mjs test <task> <appDir>
 *   node factory/host.mjs verify <task>
 *   node factory/host.mjs status <task>
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LAUNCHER = join(homedir(), '.pi', 'agent', 'bin', 'pi-launcher.js');
const MAX_MODEL_BYTES = 64 * 1024 * 1024;

const ROLES = {
  B1: {
    model: 'deepseek/deepseek-flash',
    flags: ['--thinking', 'max'],
    system: 'You are B1, the backend author. You have no tools. Return only the requested files.',
  },
  B2: {
    model: 'deepseek/deepseek-flash',
    flags: ['--thinking', 'max'],
    system: 'You are B2, the independent backend reviewer. You have no tools. Return findings only.',
  },
  F1: {
    model: 'openai-codex/gpt-6-luna',
    flags: [],
    system: 'You are F1, the frontend author. You have no tools. Return only the requested files.',
  },
  F2: {
    model: 'openai-codex/gpt-6-luna',
    flags: [],
    system: 'You are F2, the independent frontend reviewer. You have no tools. Return findings only.',
  },
  ARGON: {
    model: 'google/gemini-4-argon',
    flags: [],
    system: 'You are Argon, a terse permission gate. Output JSON only.',
  },
};

const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const EVENT_TYPES = new Set([
  'TASK', 'NEED', 'QUESTION', 'PROPOSAL', 'DECISION', 'ACK', 'NACK',
  'OBJECTION', 'CHANGE_REQUEST', 'EVIDENCE', 'READINESS', 'HANDOFF',
  'ESCALATION', 'PLAN', 'REVIEW', 'GATE', 'PATCH', 'APPLY', 'TEST', 'ASK',
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fail(message, code = 1) {
  console.error(`host: ${message}`);
  process.exit(code);
}

function taskDir(task) {
  if (!ID.test(task)) fail(`invalid task id: ${task}`);
  return join(ROOT, 'board', task);
}

function boardFile(task) {
  return join(taskDir(task), 'events.jsonl');
}

function readEvents(task) {
  const file = boardFile(task);
  if (!existsSync(file)) fail(`no board for ${task}; run init first`);
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function appendEvent(task, type, actor, message, artifact = null) {
  if (!EVENT_TYPES.has(type)) fail(`invalid event type: ${type}`);
  if (!actor || /[\r\n]/.test(actor)) fail('actor must be one line');
  if (typeof message !== 'string' || message.length === 0) fail('message is required');

  const dir = taskDir(task);
  mkdirSync(dir, { recursive: true });
  const file = boardFile(task);
  const previous = existsSync(file)
    ? readEvents(task).at(-1)
    : null;
  const seq = previous ? previous.seq + 1 : 1;
  const body = {
    seq,
    at: new Date().toISOString(),
    task,
    actor,
    type,
    message: message.slice(0, 4000),
    artifact: artifact ? String(artifact) : null,
    prev: previous ? previous.hash : 'genesis',
  };
  const event = { ...body, hash: sha256(JSON.stringify(body)) };
  appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8');
  return event;
}

function fileHash(file) {
  return sha256(readFileSync(file));
}

function parseBundle(text) {
  const lines = text.split(/\r?\n/);
  const files = new Map();
  let i = 0;

  while (i < lines.length) {
    if (!lines[i].startsWith('FILE: ')) {
      i += 1;
      continue;
    }

    const path = lines[i].slice(6).trim();
    if (!path || path.startsWith('/') || path.includes('..') || path.includes('\\')) {
      fail(`unsafe bundle path: ${path}`);
    }

    let j = i + 1;
    while (j < lines.length && !lines[j].startsWith('```')) j += 1;
    if (j >= lines.length) fail(`missing code fence for ${path}`);

    const body = [];
    let k = j + 1;
    while (k < lines.length && !lines[k].startsWith('```')) {
      body.push(lines[k]);
      k += 1;
    }
    if (k >= lines.length) fail(`unclosed code fence for ${path}`);

    files.set(path, `${body.join('\n')}\n`);
    i = k + 1;
  }

  if (files.size === 0) fail('bundle contains no FILE blocks');
  return files;
}

function bundleHash(files) {
  const hash = createHash('sha256');
  for (const path of [...files.keys()].sort()) {
    hash.update(path);
    hash.update('\0');
    hash.update(files.get(path));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function modelCall(roleName, promptFile, outFile) {
  const role = ROLES[roleName];
  if (!role) fail(`unknown role: ${roleName}`);
  const prompt = resolve(promptFile);
  if (!existsSync(prompt)) fail(`prompt file not found: ${prompt}`);

  const args = [
    LAUNCHER,
    '-p',
    '--model', role.model,
    ...role.flags,
    '--no-tools',
    '--no-mcp',
    '--no-session',
    '--no-extensions',
    '--no-context-files',
    '--system-prompt', role.system,
    `@${prompt}`,
  ];

  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    maxBuffer: MAX_MODEL_BYTES,
    timeout: 15 * 60 * 1000,
  });

  if (result.error) fail(`model call failed: ${result.error.message}`);
  if (result.status !== 0) {
    process.stderr.write(result.stderr || '');
    fail(`model exited with ${result.status}`);
  }

  const output = result.stdout ?? '';
  writeFileSync(resolve(outFile), output, 'utf8');
  return output;
}

function parseJsonReply(raw) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function cmdInit(task, briefFile) {
  const dir = taskDir(task);
  mkdirSync(dir, { recursive: true });
  if (existsSync(boardFile(task))) {
    fail(`board already exists for ${task}`);
  }
  let message = 'Task initialized.';
  if (briefFile) {
    if (!existsSync(briefFile)) fail(`brief not found: ${briefFile}`);
    message = readFileSync(briefFile, 'utf8').trim().slice(0, 4000);
  }
  const event = appendEvent(task, 'TASK', 'host', message, briefFile ? relative(ROOT, resolve(briefFile)) : null);
  console.log(JSON.stringify(event, null, 2));
}

function cmdEvent(task, type, actor, message, artifact) {
  const event = appendEvent(task, type, actor, message, artifact);
  console.log(JSON.stringify(event, null, 2));
}

function cmdAsk(role, promptFile, outFile) {
  const output = modelCall(role, promptFile, outFile);
  console.log(`wrote ${outFile} (${output.length} bytes)`);
}

function cmdGate(task, kind, packetFile, outFile, bundleFile) {
  if (!existsSync(packetFile)) fail(`packet not found: ${packetFile}`);
  const output = modelCall('ARGON', packetFile, outFile);
  const decision = parseJsonReply(output);

  if (!decision) {
    appendEvent(task, 'GATE', 'argon', `${kind}: unparsable reply; treated as deny`, outFile);
    fail('Argon reply was not valid JSON; failing closed', 2);
  }

  const verdict = String(decision.decision ?? '').toLowerCase();
  const klass = String(decision.class ?? 'ambiguous').toLowerCase();
  const bundle = bundleFile ? bundleHash(parseBundle(readFileSync(bundleFile, 'utf8'))) : null;
  const packetHash = fileHash(packetFile);

  appendEvent(
    task,
    'GATE',
    'argon',
    `${kind}: ${verdict}/${klass} — ${String(decision.reason ?? '').slice(0, 200)}`,
    outFile,
  );

  const gateDir = join(taskDir(task), 'gates');
  mkdirSync(gateDir, { recursive: true });
  const record = {
    at: new Date().toISOString(),
    task,
    kind,
    decision: verdict,
    class: klass,
    reason: decision.reason ?? '',
    blast_radius: decision.blast_radius ?? '',
    conditions: decision.conditions ?? '',
    packet_hash: packetHash,
    bundle_hash: bundle,
  };
  writeFileSync(join(gateDir, `${kind}-${packetHash.slice(0, 12)}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  if (verdict === 'allow' && bundle) {
    const approvalDir = join(taskDir(task), 'approvals');
    mkdirSync(approvalDir, { recursive: true });
    writeFileSync(
      join(approvalDir, `${bundle}.json`),
      `${JSON.stringify({ ...record, approved_at: new Date().toISOString() }, null, 2)}\n`,
      'utf8',
    );
  }

  console.log(JSON.stringify(record, null, 2));
  if (verdict === 'allow') process.exit(0);
  if (verdict === 'deny' && klass === 'critical') process.exit(1);
  process.exit(2);
}

function cmdApply(task, bundleFile) {
  if (!existsSync(bundleFile)) fail(`bundle not found: ${bundleFile}`);
  const text = readFileSync(bundleFile, 'utf8');
  const files = parseBundle(text);
  const hash = bundleHash(files);
  const approval = join(taskDir(task), 'approvals', `${hash}.json`);

  if (!existsSync(approval)) {
    fail(`no allow token for bundle ${hash}; run gate --bundle first`, 1);
  }

  const record = JSON.parse(readFileSync(approval, 'utf8'));
  if (record.decision !== 'allow') fail(`approval is ${record.decision}, not allow`, 1);

  const written = [];
  for (const [path, content] of files) {
    const absolute = resolve(ROOT, path);
    const rel = relative(ROOT, absolute);
    if (rel.startsWith('..') || resolve(ROOT, rel) !== absolute) {
      fail(`path escapes the repo: ${path}`);
    }
    if (!rel.startsWith(`apps${process.platform === 'win32' ? '\\' : '/'}`) && !rel.startsWith('apps/')) {
      fail(`V1 apply only writes under apps/: ${path}`);
    }
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, 'utf8');
    written.push(rel);
  }

  appendEvent(task, 'APPLY', 'host', `applied ${written.length} files; bundle ${hash}`, bundleFile);
  console.log(JSON.stringify({ bundle: hash, written }, null, 2));
}

function cmdTest(task, appDir) {
  const cwd = resolve(ROOT, appDir);
  const result = spawnSync(process.execPath, ['--test'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
  });

  const evidenceDir = join(taskDir(task), 'evidence');
  mkdirSync(evidenceDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const evidence = join(evidenceDir, `test-${stamp}.txt`);
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  writeFileSync(evidence, output, 'utf8');

  const pass = /ℹ pass (\d+)/.exec(output)?.[1] ?? '?';
  const failCount = /ℹ fail (\d+)/.exec(output)?.[1] ?? '?';
  appendEvent(task, 'TEST', 'host', `exit ${result.status}; pass ${pass}; fail ${failCount}`, relative(ROOT, evidence));
  process.stdout.write(output);
  process.exit(result.status ?? 1);
}

function cmdVerify(task) {
  const events = readEvents(task);
  let previous = 'genesis';
  for (const event of events) {
    const { hash, ...body } = event;
    const expected = sha256(JSON.stringify(body));
    if (expected !== hash) fail(`event ${event.seq} hash mismatch`);
    if (event.prev !== previous) fail(`event ${event.seq} prev mismatch`);
    previous = hash;
  }
  console.log(`${task}: ${events.length} events, chain OK`);
}

function cmdStatus(task) {
  const events = readEvents(task);
  console.log(`${task}: ${events.length} events`);
  for (const event of events.slice(-8)) {
    console.log(`${event.seq} ${event.type.padEnd(12)} ${event.actor.padEnd(7)} ${event.message.slice(0, 140)}`);
  }
}

const [command, ...rest] = process.argv.slice(2);

if (command === 'init') {
  cmdInit(rest[0], rest[1]);
} else if (command === 'event') {
  cmdEvent(rest[0], rest[1], rest[2], rest[3], rest[4]);
} else if (command === 'ask') {
  cmdAsk(rest[0], rest[1], rest[2]);
} else if (command === 'gate') {
  const bundleIndex = rest.indexOf('--bundle');
  const bundleFile = bundleIndex >= 0 ? rest[bundleIndex + 1] : null;
  const args = bundleIndex >= 0 ? rest.slice(0, bundleIndex) : rest;
  cmdGate(args[0], args[1], args[2], args[3], bundleFile);
} else if (command === 'apply') {
  cmdApply(rest[0], rest[1]);
} else if (command === 'test') {
  cmdTest(rest[0], rest[1]);
} else if (command === 'verify') {
  cmdVerify(rest[0]);
} else if (command === 'status') {
  cmdStatus(rest[0]);
} else {
  console.error('usage: node factory/host.mjs <init|event|ask|gate|apply|test|status> ...');
  process.exit(2);
}
