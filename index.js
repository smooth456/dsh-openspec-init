/**
 * Host half of `dsh-openspec-init`.
 *
 * One human command, `/openspec-init`, owns the complete flow the composer
 * button triggers:
 *
 * 1. probe the `openspec` CLI on PATH,
 * 2. inspect the calling session's workspace for an existing OpenSpec project,
 * 3. run `openspec init --tools dsh` in that workspace when it is still needed.
 *
 * The Client half (`client.js`) only renders the button and executes this same
 * command through the Host command registry, so the two entry points never hold
 * separate operation logic.
 *
 * @module dsh-openspec-init
 */

import { join } from 'node:path'

/** Loader entry name; unused by the loader itself but keeps the module self-describing. */
export const name = 'openspec-init'

/** Commands, process spawning, and the composed filesystem are all required. */
export const inject = ['commands', 'subprocess', 'fs']

/** Command name without the leading slash. */
const COMMAND = 'openspec-init'

/** The AI tool target this plugin initializes. */
const TOOLS = 'dsh'

/** Marker written by current OpenSpec releases. */
const CONFIG_FILE = 'openspec/config.yaml'

/** Marker kept by the legacy layout `openspec init` migrates from. */
const LEGACY_PROJECT_FILE = 'openspec/project.md'

/** Skills folder OpenSpec writes for the `dsh` tool target. */
const DSH_SKILLS_DIR = '.dsh/skills'

/** Bytes retained per stream for the report. */
const COLLECT_BYTES = 64 * 1024

/** Characters of trailing output kept in the command result. */
const OUTPUT_TAIL = 1200

/** Time the subprocess service allows between terminate and kill. */
const GRACE_MS = 5000

/** Resolve the workspace the calling session was started in. */
function workspaceOf(agent) {
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd()
}

/** Platform-appropriate installation command, quoted for a paste into a shell. */
function installHint() {
  if (process.platform === 'win32') {
    return 'install: irm https://openspec.dev/cli/install.ps1 | iex  (npm alternative: npm install -g @fission-ai/openspec@latest)'
  }
  return 'install: curl -fsSL https://openspec.dev/cli/install.sh | sh  (npm alternative: npm install -g @fission-ai/openspec@latest)'
}

/** Whether one path exists, optionally as a given kind. Probe failures read as absence. */
async function present(ctx, path, type) {
  try {
    const info = await ctx.fs.lstat(path)
    return info !== undefined && (type === undefined || info.type === type)
  } catch {
    return false
  }
}

/** Read the three markers that describe a workspace's OpenSpec state. */
async function describeProject(ctx, workspace) {
  const config = await present(ctx, join(workspace, CONFIG_FILE), 'file')
  const legacy = config ? false : await present(ctx, join(workspace, LEGACY_PROJECT_FILE), 'file')
  const skills = await present(ctx, join(workspace, DSH_SKILLS_DIR), 'directory')
  return { initialized: config || legacy, config, legacy, skills }
}

/** Human-readable one-line state of a workspace. */
function projectSummary(state) {
  if (!state.initialized) return 'not initialized (no openspec/config.yaml)'
  const markers = []
  if (state.config) markers.push(CONFIG_FILE)
  if (state.legacy) markers.push(`${LEGACY_PROJECT_FILE} (legacy)`)
  if (state.skills) markers.push(DSH_SKILLS_DIR)
  else markers.push(`no ${DSH_SKILLS_DIR} for the ${TOOLS} target`)
  return `initialized (${markers.join(', ')})`
}

/**
 * Build the argv for one CLI call.
 *
 * A Windows `.cmd`/`.bat` shim cannot be spawned as a file (Node refuses with
 * EINVAL) and the subprocess spec has no `windowsVerbatimArguments`, so route it
 * through `cmd.exe` with every argument in its own argv slot: `cmd /d /c <exe>
 * <args…>` forwards them unchanged, including an executable path with spaces.
 */
function argvFor(executable, args) {
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable)) {
    return [process.env.ComSpec || 'cmd.exe', '/d', '/c', executable, ...args]
  }
  return [executable, ...args]
}

/** Read one collected stream into text, tolerating truncation and absent readers. */
function readStream(reader) {
  if (reader === undefined) return { text: '', lossy: false }
  try {
    const read = reader.readFrom(0)
    return { text: read.text, lossy: read.lossy }
  } catch {
    return { text: '', lossy: false }
  }
}

/** Run one CLI call with the workspace as its cwd and collect its output. */
async function run(ctx, executable, args, workspace, signal) {
  const handle = ctx.subprocess.spawn({
    argv: argvFor(executable, args),
    cwd: workspace,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: COLLECT_BYTES },
      stderr: { maxBytes: COLLECT_BYTES },
    },
    graceMs: GRACE_MS,
    signal,
  })
  const outcome = await handle.done
  const stdout = readStream(handle.collected.stdout)
  const stderr = readStream(handle.collected.stderr)
  return {
    exitCode: outcome.exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
    lossy: stdout.lossy || stderr.lossy,
  }
}

/** Keep the last {@link OUTPUT_TAIL} characters of captured output as report lines. */
function tailLines(text, lossy) {
  const trimmed = text.trim()
  if (trimmed === '') return []
  const lines = trimmed.split(/\r?\n/)
  const kept = []
  let size = 0
  for (let index = lines.length - 1; index >= 0 && size < OUTPUT_TAIL; index -= 1) {
    kept.unshift(lines[index])
    size += lines[index].length + 1
  }
  const truncated = kept.length < lines.length || lossy
  return [truncated ? 'output (tail):' : 'output:', ...kept]
}

/** First non-empty line of a stream, for a version banner. */
function firstLine(text) {
  const line = text.split(/\r?\n/).find((candidate) => candidate.trim() !== '')
  return line === undefined ? 'unknown version' : line.trim()
}

/** Message of an unknown thrown value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The whole flow: probe, inspect, then initialize only when something is missing.
 * @param ctx - context carrying `commands`, `subprocess`, and `fs`.
 * @param invocation - the resolved command invocation.
 * @returns the human-facing outcome; a failure carries its reason.
 */
async function execute(ctx, invocation) {
  const workspace = workspaceOf(invocation.agent)
  const force = /(?:^|\s)--?force(?:\s|$)/i.test(invocation.rawInput)
  const report = [`workspace: ${workspace}`]

  // 1. Is the CLI installed and runnable?
  let executable
  try {
    executable = await ctx.subprocess.resolveExecutable('openspec')
  } catch {
    executable = undefined
  }
  if (executable === undefined) {
    return { kind: 'error', text: [...report, 'openspec: not found on PATH', installHint()].join('\n') }
  }

  let version
  try {
    const probe = await run(ctx, executable, ['--version'], workspace, invocation.signal)
    if (probe.exitCode !== 0) {
      return {
        kind: 'error',
        text: [
          ...report,
          `openspec: ${executable}`,
          `version probe failed (exit ${probe.exitCode ?? 'terminated'})`,
          ...tailLines(probe.stderr || probe.stdout, probe.lossy),
        ].join('\n'),
      }
    }
    version = firstLine(probe.stdout || probe.stderr)
  } catch (error) {
    return {
      kind: 'error',
      text: [...report, `openspec: ${executable}`, `version probe failed: ${messageOf(error)}`].join('\n'),
    }
  }
  report.push(`openspec: ${version} (${executable})`)

  // 2. Is this workspace already initialized for the dsh target?
  const before = await describeProject(ctx, workspace)
  report.push(`project: ${projectSummary(before)}`)

  if (before.initialized && before.skills && !force) {
    return {
      kind: 'success',
      text: [
        ...report,
        'nothing to do: this workspace is already initialized for the dsh target',
        `run /${COMMAND} --force to re-run \`openspec init --tools ${TOOLS}\``,
      ].join('\n'),
    }
  }

  if (invocation.signal.aborted) {
    return { kind: 'error', text: [...report, 'cancelled before running init'].join('\n') }
  }

  // 3. Initialize in the workspace.
  let result
  try {
    result = await run(ctx, executable, ['init', '--tools', TOOLS], workspace, invocation.signal)
  } catch (error) {
    return {
      kind: 'error',
      text: [
        ...report,
        `openspec init --tools ${TOOLS}: could not run: ${messageOf(error)}`,
        ...(invocation.signal.aborted ? ['the run was cancelled'] : []),
      ].join('\n'),
    }
  }

  const after = await describeProject(ctx, workspace)
  const ok = result.exitCode === 0
  return {
    kind: ok ? 'success' : 'error',
    text: [
      ...report,
      `run: openspec init --tools ${TOOLS}`,
      `exit: ${result.exitCode ?? 'terminated'}`,
      `project: ${projectSummary(after)}`,
      ...tailLines(result.stdout || result.stderr, result.lossy),
    ].join('\n'),
  }
}

/**
 * Register `/openspec-init` for every composed human-command adapter.
 * @param ctx - plugin context.
 */
export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.commands.register({
        name: COMMAND,
        description: `Check openspec and this workspace, then run \`openspec init --tools ${TOOLS}\``,
        input: { hint: '[--force]' },
        handler: (invocation) => execute(ctx, invocation),
      }),
    'dsh-openspec-init: command',
  )
}
