import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { app } from 'electron'

const userDataDir = process.env.REFORA_E2E_USER_DATA_DIR
if (!userDataDir) throw new Error('REFORA_E2E_USER_DATA_DIR is required')

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const mainScript = path.resolve(currentDirectory, '..', '..', 'out', 'main', 'index.js')
app.setPath('userData', userDataDir)
await import(pathToFileURL(mainScript).href)
