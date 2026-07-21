import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  MineruEngineStatus,
  MineruInstallProgress,
  MineruInstallStage
} from '../../shared/mineru-types'
import { MINERU_VERSION } from '../../shared/mineru-types'
import { logger } from './logger'
import { readMineruInstallRoot, writeMineruInstallRoot } from './prefs'

const UV_VERSION = '0.11.16'
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

interface MineruInstallManifest {
  version: string
  architecture: 'arm64' | 'x64'
  pythonRelativePath: string
  modelConfigRelativePath: string
  modelRevision: string
  installedAt: number
  diskBytes: number | null
}

interface MineruEngineManagerDeps {
  userDataDir: string
  environment?: NodeJS.ProcessEnv
  architecture?: 'arm64' | 'x64'
  downloadFile: (
    url: string,
    destination: string,
    signal: AbortSignal,
    onProgress: (received: number, total: number | null) => void
  ) => Promise<void>
  trashItem: (path: string) => Promise<void>
}

type ProgressListener = (progress: MineruInstallProgress) => void

function executable(path: string): Promise<boolean> {
  return access(path, constants.X_OK).then(() => true, () => false)
}

function isWithin(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

async function requireSafeManagedPath(root: string, target: string): Promise<void> {
  const resolvedRoot = resolve(root)
  const resolvedTarget = resolve(target)
  if (!isWithin(resolvedRoot, resolvedTarget)) {
    throw new Error('MinerU managed path is outside the install root')
  }
  const segments = relative(resolvedRoot, resolvedTarget).split(sep).filter(Boolean)
  let current = resolvedRoot
  const paths = [current, ...segments.map((segment) => {
    current = join(current, segment)
    return current
  })]
  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index]
    const entry = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (!entry) break
    if (entry.isSymbolicLink()) {
      throw new Error('MinerU managed directories cannot be symbolic links')
    }
    if (index < paths.length - 1 && !entry.isDirectory()) {
      throw new Error('MinerU managed path contains a non-directory entry')
    }
  }
}

function runFile(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; signal: AbortSignal },
  onChild: (child: ChildProcess | null) => void
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    })
    onChild(child)
    let stdout = ''
    let stderr = ''
    const append = (current: string, value: Buffer): string =>
      `${current}${value.toString('utf8')}`.slice(-2_000_000)
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk)
    })
    const abort = (): void => {
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGTERM')
        } catch {
          child.kill('SIGTERM')
        }
      }
    }
    options.signal.addEventListener('abort', abort, { once: true })
    child.once('error', (error) => {
      options.signal.removeEventListener('abort', abort)
      onChild(null)
      reject(error)
    })
    child.once('close', (code, signal) => {
      options.signal.removeEventListener('abort', abort)
      onChild(null)
      if (options.signal.aborted) {
        reject(new Error('MinerU installation was cancelled'))
        return
      }
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `Process exited with ${code ?? signal}`))
        return
      }
      resolvePromise([stdout, stderr].filter(Boolean).join('\n').trim())
    })
  })
}

async function sha256(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', () => resolvePromise(hash.digest('hex')))
  })
}

async function managedPython(root: string): Promise<string | null> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries.sort((left, right) => right.name.localeCompare(left.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    for (const name of ['python3.12', 'python3', 'python']) {
      const candidate = join(root, entry.name, 'bin', name)
      if (await executable(candidate)) return candidate
    }
  }
  return null
}

export function createMineruEngineManager(deps: MineruEngineManagerDeps) {
  const architecture = deps.architecture ?? (process.arch === 'x64' ? 'x64' : 'arm64')
  const listeners = new Set<ProgressListener>()
  let progress: MineruInstallProgress | null = null
  let installPromise: Promise<MineruEngineStatus> | null = null
  let installController: AbortController | null = null
  let activeChild: ChildProcess | null = null
  let installStartedAt: number | null = null

  function installRoot(): string {
    return readMineruInstallRoot(deps.userDataDir) || join(deps.userDataDir, 'engines')
  }

  function installPath(): string {
    return join(installRoot(), 'Refora', 'MinerU', MINERU_VERSION, `darwin-${architecture}`)
  }

  function manifestPath(): string {
    return join(installPath(), 'installed-manifest.json')
  }

  function emit(
    installId: string,
    stage: MineruInstallStage,
    message: string,
    percent: number | null,
    extra: Partial<MineruInstallProgress> = {}
  ): void {
    progress = {
      installId,
      startedAt: installStartedAt ?? Date.now(),
      stage,
      currentArtifact: null,
      bytesReceived: 0,
      bytesTotal: null,
      percent,
      cancellable: stage !== 'completed',
      message,
      ...extra
    }
    for (const listener of listeners) listener(progress)
  }

  async function readManifest(): Promise<MineruInstallManifest | null> {
    try {
      const parsed = JSON.parse(await readFile(manifestPath(), 'utf8')) as MineruInstallManifest
      if (
        parsed.version !== MINERU_VERSION ||
        parsed.architecture !== architecture ||
        !parsed.pythonRelativePath ||
        !parsed.modelConfigRelativePath
      ) {
        return null
      }
      return parsed
    } catch {
      return null
    }
  }

  async function getStatus(): Promise<MineruEngineStatus> {
    const root = installRoot()
    const path = installPath()
    if (installPromise && progress) {
      return {
        state: 'installing',
        installRoot: root,
        installPath: path,
        version: MINERU_VERSION,
        architecture,
        pythonPath: null,
        modelConfigPath: null,
        installedAt: null,
        diskBytes: null,
        error: null,
        progress
      }
    }
    try {
      await requireSafeManagedPath(root, path)
    } catch (error) {
      return {
        state: 'invalid',
        installRoot: root,
        installPath: path,
        version: null,
        architecture,
        pythonPath: null,
        modelConfigPath: null,
        installedAt: null,
        diskBytes: null,
        error: error instanceof Error ? error.message : String(error),
        progress: null
      }
    }
    const manifest = await readManifest()
    if (!manifest) {
      const pathExists = await stat(path).then(() => true, () => false)
      return {
        state: pathExists ? 'invalid' : 'notInstalled',
        installRoot: root,
        installPath: pathExists ? path : null,
        version: null,
        architecture,
        pythonPath: null,
        modelConfigPath: null,
        installedAt: null,
        diskBytes: null,
        error: pathExists ? 'MinerU installation is incomplete or invalid' : null,
        progress: null
      }
    }
    const pythonPath = join(path, manifest.pythonRelativePath)
    const modelConfigPath = join(path, manifest.modelConfigRelativePath)
    if (!(await executable(pythonPath)) || !(await stat(modelConfigPath).then((value) => value.isFile(), () => false))) {
      return {
        state: 'invalid',
        installRoot: root,
        installPath: path,
        version: manifest.version,
        architecture,
        pythonPath: null,
        modelConfigPath: null,
        installedAt: manifest.installedAt,
        diskBytes: manifest.diskBytes,
        error: 'MinerU runtime or model configuration is missing',
        progress: null
      }
    }
    return {
      state: 'installed',
      installRoot: root,
      installPath: path,
      version: manifest.version,
      architecture,
      pythonPath,
      modelConfigPath,
      installedAt: manifest.installedAt,
      diskBytes: manifest.diskBytes,
      error: null,
      progress: null
    }
  }

  async function setInstallRoot(folder: string): Promise<MineruEngineStatus> {
    if (installPromise) throw new Error('Cannot change the install path while MinerU is installing')
    if (!folder || !isAbsolute(folder)) throw new Error('MinerU install path must be absolute')
    const resolved = resolve(folder)
    await mkdir(resolved, { recursive: true, mode: 0o700 })
    const entry = await lstat(resolved)
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error('MinerU install path must be a regular directory')
    }
    await access(resolved, constants.W_OK)
    const current = await getStatus()
    if (current.state === 'installed' && current.installRoot !== resolved) {
      throw new Error('Uninstall MinerU before changing its install path')
    }
    writeMineruInstallRoot(deps.userDataDir, resolved)
    return getStatus()
  }

  function installEnvironment(path: string): NodeJS.ProcessEnv {
    const home = join(path, 'home')
    return {
      ...deps.environment,
      PATH: `/usr/bin:/bin`,
      HOME: home,
      UV_CACHE_DIR: join(path, 'cache', 'uv'),
      UV_PYTHON_INSTALL_DIR: join(path, 'runtime', 'python'),
      HF_HOME: join(path, 'models', 'huggingface'),
      MODELSCOPE_CACHE: join(path, 'models', 'modelscope'),
      MINERU_TOOLS_CONFIG_JSON: join(path, 'mineru.json')
    }
  }

  async function install(): Promise<MineruEngineStatus> {
    if (installPromise) return installPromise
    installPromise = (async () => {
      const existing = await getStatus()
      if (existing.state === 'installed') return existing
      const installId = randomUUID()
      const controller = new AbortController()
      installStartedAt = Date.now()
      installController = controller
      const path = installPath()
      const release = UV_RELEASES[architecture]
      const environment = installEnvironment(path)
      const archive = join(path, '.downloads', release.archive)
      const extracted = join(path, '.downloads', 'uv-extracted')
      try {
        emit(installId, 'preparing', 'Preparing the MinerU installation', null)
        await requireSafeManagedPath(installRoot(), path)
        if (await stat(path).then(() => true, () => false)) {
          await deps.trashItem(path)
        }
        await Promise.all([
          mkdir(join(path, '.downloads'), { recursive: true, mode: 0o700 }),
          mkdir(join(path, 'home'), { recursive: true, mode: 0o700 }),
          mkdir(join(path, 'models'), { recursive: true, mode: 0o700 }),
          mkdir(join(path, 'cache'), { recursive: true, mode: 0o700 })
        ])
        emit(installId, 'installingTools', 'Downloading the verified uv runtime', 0, {
          currentArtifact: release.archive
        })
        await deps.downloadFile(
          `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${release.archive}`,
          archive,
          controller.signal,
          (received, total) => {
            const ratio = total ? Math.min(received / total, 1) : null
            emit(installId, 'installingTools', 'Downloading the verified uv runtime', ratio == null ? null : ratio * 100, {
              currentArtifact: release.archive,
              bytesReceived: received,
              bytesTotal: total
            })
          }
        )
        if (await sha256(archive) !== release.sha256) {
          throw new Error('Downloaded uv runtime failed checksum verification')
        }
        await mkdir(extracted, { recursive: true, mode: 0o700 })
        await runFile('/usr/bin/tar', ['-xzf', archive, '--strip-components', '1', '-C', extracted], {
          cwd: path,
          env: { PATH: '/usr/bin:/bin' },
          signal: controller.signal
        }, (child) => { activeChild = child })
        const uvPath = join(path, 'runtime', 'uv')
        await mkdir(join(path, 'runtime'), { recursive: true, mode: 0o700 })
        await chmod(join(extracted, 'uv'), 0o755)
        await rename(join(extracted, 'uv'), uvPath)
        emit(installId, 'installingPython', 'Installing managed Python 3.12', null, {
          currentArtifact: 'Python 3.12'
        })
        await runFile(uvPath, ['python', 'install', '3.12', '--install-dir', join(path, 'runtime', 'python')], {
          cwd: path,
          env: environment,
          signal: controller.signal
        }, (child) => { activeChild = child })
        const python = await managedPython(join(path, 'runtime', 'python'))
        if (!python) throw new Error('Managed Python installation did not produce an executable')
        const venv = join(path, 'runtime', 'venv')
        await runFile(uvPath, ['venv', '--python', python, venv], {
          cwd: path,
          env: environment,
          signal: controller.signal
        }, (child) => { activeChild = child })
        const venvPython = join(venv, 'bin', 'python')
        const mineruExtra = architecture === 'arm64' ? 'all' : 'core'
        emit(installId, 'installingMineru', `Installing MinerU ${MINERU_VERSION}`, null, {
          currentArtifact: `mineru[${mineruExtra}]==${MINERU_VERSION}`
        })
        await runFile(uvPath, [
          'pip',
          'install',
          '--python',
          venvPython,
          '--upgrade',
          `mineru[${mineruExtra}]==${MINERU_VERSION}`
        ], {
          cwd: path,
          env: environment,
          signal: controller.signal
        }, (child) => { activeChild = child })
        emit(installId, 'downloadingModels', 'Downloading MinerU models', null, {
          currentArtifact: 'MinerU models'
        })
        await runFile(join(venv, 'bin', 'mineru-models-download'), ['-s', 'auto', '-m', 'all'], {
          cwd: path,
          env: environment,
          signal: controller.signal
        }, (child) => { activeChild = child })
        emit(installId, 'healthCheck', 'Checking the MinerU runtime', null)
        const output = await runFile(venvPython, [
          '-c',
          'from mineru.version import __version__; print(__version__)'
        ], {
          cwd: path,
          env: environment,
          signal: controller.signal
        }, (child) => { activeChild = child })
        if (!output.split(/\s+/).includes(MINERU_VERSION)) {
          throw new Error(`Installed MinerU reported an unexpected version: ${output}`)
        }
        const configPath = join(path, 'mineru.json')
        if (!(await stat(configPath).then((value) => value.isFile(), () => false))) {
          throw new Error('MinerU model download did not create a model configuration')
        }
        emit(installId, 'finalizing', 'Finalizing the MinerU installation', null)
        const manifest: MineruInstallManifest = {
          version: MINERU_VERSION,
          architecture,
          pythonRelativePath: 'runtime/venv/bin/python',
          modelConfigRelativePath: 'mineru.json',
          modelRevision: `mineru-${MINERU_VERSION}-${mineruExtra}`,
          installedAt: Date.now(),
          diskBytes: null
        }
        const temporaryManifest = `${manifestPath()}.tmp-${randomUUID()}`
        await writeFile(temporaryManifest, JSON.stringify(manifest, null, 2), { mode: 0o600 })
        await rename(temporaryManifest, manifestPath())
        await rm(join(path, '.downloads'), { recursive: true, force: true })
        emit(installId, 'completed', 'MinerU is ready', 100, { cancellable: false })
        progress = null
        return getStatus()
      } catch (error) {
        await requireSafeManagedPath(installRoot(), path)
          .then(() => rm(path, { recursive: true, force: true }))
          .catch(() => undefined)
        throw error
      } finally {
        activeChild = null
        installController = null
      }
    })()
    try {
      return await installPromise
    } catch (error) {
      logger.error(`mineru:install failed: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    } finally {
      installPromise = null
      progress = null
      installStartedAt = null
    }
  }

  async function cancelInstall(): Promise<MineruEngineStatus> {
    if (!installController) return getStatus()
    installController.abort()
    if (activeChild?.pid) {
      try {
        process.kill(-activeChild.pid, 'SIGTERM')
      } catch {
        activeChild.kill('SIGTERM')
      }
    }
    await installPromise?.catch(() => undefined)
    return getStatus()
  }

  async function uninstall(): Promise<MineruEngineStatus> {
    if (installPromise) throw new Error('Cancel the active MinerU installation before uninstalling')
    const path = installPath()
    await requireSafeManagedPath(installRoot(), path)
    if (await stat(path).then(() => true, () => false)) {
      await deps.trashItem(path)
    }
    return getStatus()
  }

  function onProgress(listener: ProgressListener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  async function getRuntime(): Promise<{
    installPath: string
    pythonPath: string
    modelConfigPath: string
    modelRevision: string
    environment: NodeJS.ProcessEnv
  }> {
    const status = await getStatus()
    if (
      status.state !== 'installed' ||
      !status.installPath ||
      !status.pythonPath ||
      !status.modelConfigPath
    ) {
      throw new Error('MinerU is not installed')
    }
    const manifest = await readManifest()
    if (!manifest) throw new Error('MinerU installation manifest is invalid')
    await requireSafeManagedPath(status.installRoot, status.installPath)
    return {
      installPath: status.installPath,
      pythonPath: status.pythonPath,
      modelConfigPath: status.modelConfigPath,
      modelRevision: manifest.modelRevision,
      environment: {
        ...installEnvironment(status.installPath),
        MINERU_MODEL_SOURCE: 'local'
      }
    }
  }

  function destroy(): void {
    installController?.abort()
    if (activeChild?.pid) {
      try {
        process.kill(-activeChild.pid, 'SIGTERM')
      } catch {
        activeChild.kill('SIGTERM')
      }
    }
    activeChild = null
    listeners.clear()
  }

  return {
    getStatus,
    setInstallRoot,
    install,
    cancelInstall,
    uninstall,
    onProgress,
    getRuntime,
    destroy
  }
}

export type MineruEngineManager = ReturnType<typeof createMineruEngineManager>
