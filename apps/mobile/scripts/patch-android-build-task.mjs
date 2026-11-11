import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const task = resolve(mobileRoot, 'src-tauri/gen/android/buildSrc/src/main/kotlin/BuildTask.kt')
const entry = resolve(mobileRoot, '../../node_modules/@tauri-apps/cli/tauri.js')
const source = readFileSync(task, 'utf8')
const expectedBinary = 'val executable = """node"""'
const expectedArgs = 'val args = listOf("tauri", "android", "android-studio-script")'
if (source.split(expectedBinary).length !== 2 || source.split(expectedArgs).length !== 2) {
  throw new Error('Unexpected Tauri Android Gradle callback template; inspect before changing it')
}
const patched = source.replace(expectedArgs, `val args = listOf(${JSON.stringify(entry)}, "android", "android-studio-script")`)
writeFileSync(task, patched)
console.log(`Gradle callback: node ${entry} android android-studio-script`)
