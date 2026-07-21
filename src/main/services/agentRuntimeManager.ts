import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { constants, createReadStream } from 'node:fs'
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import type { AgentSandboxPaths, AgentSandboxService } from './agentSandbox'

const NODE_VERSION = '24.18.0'
const PNPM_VERSION = '11.9.0'
const UV_VERSION = '0.11.16'
const NODE_RELEASES = {
  arm64: {
    archive: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
    sha256: 'e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1'
  },
  x64: {
    archive: `node-v${NODE_VERSION}-darwin-x64.tar.gz`,
    sha256: 'dfd0dbd3e721503434df7b7205e719f61b3a3a31b2bcf9729b8b91fea240f080'
  }
} as const
const UV_RELEASES = {
  arm64: {
    archive: 'uv-aarch64-apple-darwin.tar.gz',
    sha256: '2b25be1af546be330b340b0a76b99f989daa6d92678fdffb87438e661e9d88fb'
  },
  x64: {
    archive: 'uv-x86_64-apple-darwin.tar.gz',
    sha256: '6b91ae3de155f51bd1f5b74814821c79f016a176561f252cd9ddfb976939af2e'
  }
} as const

export type AgentRuntimeKind = 'python' | 'node'

interface AgentRuntimeManagerDeps {
  sandboxService: AgentSandboxService
  environment?: NodeJS.ProcessEnv
  confirmInstall?: (message: string) => Promise<boolean>
  downloadFile?: (url: string, destination: string) => Promise<void>
  architecture?: 'arm64' | 'x64'
}

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function firstExecutable(paths: string[]): Promise<string | null> {
  for (const path of paths) {
    if (await executable(path)) return path
  }
  return null
}

export interface AgentRuntimeEnvironment {
  pythonPath: string | null
  nodePath: string | null
  uvPath: string | null
  pnpmPath: string | null
  path: string
}

export interface AgentPackageRequest {
  name: string
  version?: string
}

function runFile(executablePath: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(executablePath, args, {
      cwd: options.cwd,
      env: options.env,
      timeout: 10 * 60 * 1000,
      maxBuffer: 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || stdout.trim() || error.message))
        return
      }
      resolve([stdout, stderr].filter(Boolean).join('\n').trim())
    })
  })
}

function packageSpec(request: AgentPackageRequest, kind: AgentRuntimeKind): string {
  const namePattern = kind === 'python'
    ? /^[a-z0-9][a-z0-9._-]*$/i
    : /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/i
  const versionPattern = /^[a-z0-9][a-z0-9._+*-]*$/i
  if (!namePattern.test(request.name)) throw new Error(`Invalid ${kind} package name: ${request.name}`)
  if (request.version && !versionPattern.test(request.version)) {
    throw new Error(`Invalid ${kind} package version: ${request.version}`)
  }
  if (!request.version) return request.name
  return kind === 'python' ? `${request.name}==${request.version}` : `${request.name}@${request.version}`
}

function fileSha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', () => resolve(hash.digest('hex')))
  })
}

async function managedPythonCandidates(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .sort((left, right) => right.name.localeCompare(left.name))
    .flatMap((entry) => [
      join(root, entry.name, 'bin', 'python3.12'),
      join(root, entry.name, 'bin', 'python3'),
      join(root, entry.name, 'bin', 'python')
    ])
}

export function createAgentRuntimeManager(deps: AgentRuntimeManagerDeps) {
  const environment = deps.environment ?? process.env
  const architecture = deps.architecture ?? (process.arch === 'x64' ? 'x64' : 'arm64')
  const versionCache = new Map<string, boolean>()
  let installQueue: Promise<unknown> = Promise.resolve()

  async function firstCompatibleRuntime(
    candidates: string[],
    kind: AgentRuntimeKind,
    cwd: string
  ): Promise<string | null> {
    for (const candidate of candidates) {
      if (!(await executable(candidate))) continue
      const cacheKey = `${kind}:${candidate}`
      let compatible = versionCache.get(cacheKey)
      if (compatible === undefined) {
        try {
          const version = await runFile(candidate, ['--version'], {
            cwd,
            env: { PATH: '/usr/bin:/bin' }
          })
          compatible = kind === 'python' ? /^Python 3\.12\./.test(version) : /^v24\./.test(version)
        } catch {
          compatible = false
        }
        versionCache.set(cacheKey, compatible)
      }
      if (compatible) return candidate
    }
    return null
  }

  async function ensureProjectFiles(paths: AgentSandboxPaths): Promise<void> {
    await mkdir(paths.environmentRoot, { recursive: true, mode: 0o700 })
    await Promise.all([
      writeFile(join(paths.sandboxRoot, 'pyproject.toml'), '[project]\nname = "refora-agent-workspace"\nversion = "0.0.0"\nrequires-python = ">=3.12,<3.13"\ndependencies = []\n', { flag: 'wx', mode: 0o600 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
      }),
      writeFile(join(paths.sandboxRoot, 'package.json'), '{\n  "name": "refora-agent-workspace",\n  "private": true,\n  "version": "0.0.0"\n}\n', { flag: 'wx', mode: 0o600 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
      })
    ])
  }

  async function resolve(workspaceId?: string | null): Promise<AgentRuntimeEnvironment> {
    const paths = await deps.sandboxService.ensure(workspaceId)
    await ensureProjectFiles(paths)
    const pathEntries = (environment.PATH ?? '').split(delimiter).filter(Boolean)
    const pythonPath = await firstCompatibleRuntime([
      join(paths.environmentRoot, 'python', 'bin', 'python'),
      environment.REFORA_AGENT_PYTHON ?? '',
      ...(await managedPythonCandidates(join(paths.runtimeRoot, 'python'))),
      ...pathEntries.map((entry) => join(entry, 'python3'))
    ].filter(Boolean), 'python', paths.sharedRoot)
    const nodePath = await firstCompatibleRuntime([
      environment.REFORA_AGENT_NODE ?? '',
      join(paths.runtimeRoot, 'node', 'current', 'bin', 'node'),
      ...pathEntries.map((entry) => join(entry, 'node'))
    ].filter(Boolean), 'node', paths.sharedRoot)
    const uvPath = await firstExecutable([
      environment.REFORA_AGENT_UV ?? '',
      join(paths.runtimeRoot, 'tools', 'uv'),
      ...pathEntries.map((entry) => join(entry, 'uv'))
    ].filter(Boolean))
    const pnpmPath = await firstExecutable([
      environment.REFORA_AGENT_PNPM ?? '',
      join(paths.runtimeRoot, 'tools', 'pnpm', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
      ...pathEntries.map((entry) => join(entry, 'pnpm'))
    ].filter(Boolean))
    const binaries = [
      join(paths.environmentRoot, 'python', 'bin'),
      join(paths.sandboxRoot, 'node_modules', '.bin'),
      pythonPath ? join(pythonPath, '..') : null,
      nodePath ? join(nodePath, '..') : null,
      uvPath ? join(uvPath, '..') : null,
      pnpmPath ? join(pnpmPath, '..') : null,
      '/usr/bin',
      '/bin'
    ].filter((value): value is string => !!value)
    return { pythonPath, nodePath, uvPath, pnpmPath, path: [...new Set(binaries)].join(delimiter) }
  }

  async function downloadVerified(url: string, destination: string, expectedSha256: string): Promise<void> {
    if (!deps.downloadFile) throw new Error('Runtime download is unavailable')
    await deps.downloadFile(url, destination)
    const actual = await fileSha256(destination)
    if (actual !== expectedSha256) throw new Error(`Runtime checksum mismatch for ${url}`)
  }

  async function extractArchive(archive: string, destination: string): Promise<void> {
    await mkdir(destination, { recursive: true, mode: 0o700 })
    await runFile('/usr/bin/tar', ['-xzf', archive, '--strip-components', '1', '-C', destination], {
      cwd: destination,
      env: { PATH: '/usr/bin:/bin' }
    })
  }

  async function ensureUv(paths: AgentSandboxPaths): Promise<string> {
    const existing = await firstExecutable([
      environment.REFORA_AGENT_UV ?? '',
      join(paths.runtimeRoot, 'tools', 'uv'),
      ...(environment.PATH ?? '').split(delimiter).filter(Boolean).map((entry) => join(entry, 'uv'))
    ].filter(Boolean))
    if (existing) return existing
    const release = UV_RELEASES[architecture]
    const temporary = await mkdtemp(join(paths.runtimeRoot, '.uv-install-'))
    try {
      const archive = join(temporary, release.archive)
      const extracted = join(temporary, 'extracted')
      await downloadVerified(
        `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${release.archive}`,
        archive,
        release.sha256
      )
      await extractArchive(archive, extracted)
      const source = join(extracted, 'uv')
      const destination = join(paths.runtimeRoot, 'tools', 'uv')
      await chmod(source, 0o755)
      await rm(destination, { force: true })
      await rename(source, destination)
      return destination
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }

  async function installManagedNode(paths: AgentSandboxPaths): Promise<string> {
    const destination = join(paths.runtimeRoot, 'node', `v${NODE_VERSION}`)
    const existing = join(destination, 'bin', 'node')
    if (!(await executable(existing))) {
      const release = NODE_RELEASES[architecture]
      const temporary = await mkdtemp(join(paths.runtimeRoot, '.node-install-'))
      try {
        const archive = join(temporary, release.archive)
        const extracted = join(temporary, 'extracted')
        await downloadVerified(
          `https://nodejs.org/download/release/v${NODE_VERSION}/${release.archive}`,
          archive,
          release.sha256
        )
        await extractArchive(archive, extracted)
        await rm(destination, { recursive: true, force: true })
        await rename(extracted, destination)
      } finally {
        await rm(temporary, { recursive: true, force: true })
      }
    }
    const current = join(paths.runtimeRoot, 'node', 'current')
    await rm(current, { force: true })
    await symlink(`v${NODE_VERSION}`, current, 'dir')
    return join(current, 'bin', 'node')
  }

  async function ensurePython(paths: AgentSandboxPaths, current: AgentRuntimeEnvironment): Promise<string> {
    if (current.pythonPath) return current.pythonPath
    const uvPath = current.uvPath ?? await ensureUv(paths)
    await runFile(uvPath, ['python', 'install', '3.12', '--install-dir', join(paths.runtimeRoot, 'python')], {
      cwd: paths.sharedRoot,
      env: {
        PATH: '/usr/bin:/bin',
        HOME: paths.sharedRoot,
        UV_CACHE_DIR: paths.uvStore,
        UV_PYTHON_INSTALL_DIR: join(paths.runtimeRoot, 'python')
      }
    })
    const installed = await firstExecutable(await managedPythonCandidates(join(paths.runtimeRoot, 'python')))
    if (!installed) throw new Error('Managed Python 3.12 installation did not produce an executable')
    return installed
  }

  async function ensureNode(paths: AgentSandboxPaths, current: AgentRuntimeEnvironment): Promise<string> {
    return current.nodePath ?? installManagedNode(paths)
  }

  async function ensurePnpm(paths: AgentSandboxPaths, current: AgentRuntimeEnvironment): Promise<string> {
    if (current.pnpmPath) return current.pnpmPath
    let nodePath = current.nodePath
    let npmPath = nodePath ? join(dirname(nodePath), 'npm') : ''
    if (!nodePath || !(await executable(npmPath))) {
      nodePath = await installManagedNode(paths)
      npmPath = join(dirname(nodePath), 'npm')
    }
    const destination = join(paths.runtimeRoot, 'tools', 'pnpm')
    await runFile(npmPath, [
      'install',
      '--prefix',
      destination,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--save-exact',
      `pnpm@${PNPM_VERSION}`
    ], {
      cwd: paths.sharedRoot,
      env: {
        PATH: `${join(nodePath, '..')}${delimiter}/usr/bin:/bin`,
        HOME: paths.sharedRoot,
        npm_config_cache: join(paths.pnpmStore, 'npm-cache')
      }
    })
    const installed = join(destination, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
    if (!(await executable(installed))) await chmod(installed, 0o755)
    return installed
  }

  function serializeInstall<T>(operation: () => Promise<T>): Promise<T> {
    const result = installQueue.catch(() => undefined).then(operation)
    installQueue = result.then(() => undefined, () => undefined)
    return result
  }

  async function installPackages(
    workspaceId: string | null | undefined,
    python: AgentPackageRequest[],
    node: AgentPackageRequest[],
    runtimes: AgentRuntimeKind[] = []
  ): Promise<{ runtimes: AgentRuntimeKind[]; python: string[]; node: string[]; output: string[] }> {
    const requestedRuntimes = [...new Set(runtimes)]
    if (requestedRuntimes.some((runtime) => runtime !== 'python' && runtime !== 'node')) {
      throw new Error('Unsupported runtime was requested')
    }
    if (python.length + node.length === 0 && requestedRuntimes.length === 0) {
      throw new Error('No runtimes or packages were requested')
    }
    if (python.length + node.length > 20) throw new Error('A maximum of 20 packages can be installed at once')
    const pythonSpecs = python.map((request) => packageSpec(request, 'python'))
    const nodeSpecs = node.map((request) => packageSpec(request, 'node'))
    const approved = await deps.confirmInstall?.(
      `Install runtimes or packages in the ${workspaceId ? 'current Workspace' : 'default'} agent environment?\n\n${[
        requestedRuntimes.length ? `Runtimes: ${requestedRuntimes.join(', ')}` : '',
        pythonSpecs.length ? `Python: ${pythonSpecs.join(', ')}` : '',
        nodeSpecs.length ? `Node: ${nodeSpecs.join(', ')}` : ''
      ].filter(Boolean).join('\n')}`
    )
    if (!approved) throw new Error('Runtime or package installation was not approved')
    return serializeInstall(async () => {
      const paths = await deps.sandboxService.ensure(workspaceId)
      let runtime = await resolve(workspaceId)
      const output: string[] = []
      if (requestedRuntimes.includes('python') || pythonSpecs.length > 0) {
        await ensurePython(paths, runtime)
      }
      if (requestedRuntimes.includes('node') || nodeSpecs.length > 0) {
        await ensureNode(paths, runtime)
      }
      if (pythonSpecs.length > 0 && !runtime.uvPath) await ensureUv(paths)
      if (nodeSpecs.length > 0 && !runtime.pnpmPath) await ensurePnpm(paths, runtime)
      runtime = await resolve(workspaceId)
      if (pythonSpecs.length > 0) {
        if (!runtime.uvPath || !runtime.pythonPath) throw new Error('Managed Python and uv are required to install Python packages')
        output.push(await runFile(runtime.uvPath, [
          'add',
          '--no-build',
          '--python',
          runtime.pythonPath,
          ...pythonSpecs
        ], {
          cwd: paths.sandboxRoot,
          env: {
            PATH: runtime.path,
            HOME: paths.workRoot,
            UV_CACHE_DIR: paths.uvStore,
            UV_PYTHON_INSTALL_DIR: join(paths.runtimeRoot, 'python'),
            UV_PROJECT_ENVIRONMENT: join(paths.environmentRoot, 'python')
          }
        }))
      }
      if (nodeSpecs.length > 0) {
        if (!runtime.pnpmPath || !runtime.nodePath) throw new Error('Managed Node.js and pnpm are required to install Node packages')
        output.push(await runFile(runtime.pnpmPath, [
          'add',
          '--save-exact',
          '--ignore-scripts',
          '--store-dir',
          paths.pnpmStore,
          ...nodeSpecs
        ], {
          cwd: paths.sandboxRoot,
          env: {
            PATH: runtime.path,
            HOME: paths.workRoot,
            PNPM_HOME: join(paths.runtimeRoot, 'tools')
          }
        }))
      }
      return { runtimes: requestedRuntimes, python: pythonSpecs, node: nodeSpecs, output }
    })
  }

  return { resolve, ensureProjectFiles, installPackages }
}

export type AgentRuntimeManager = ReturnType<typeof createAgentRuntimeManager>
