import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const generated = resolve(mobileRoot, 'src-tauri/gen/android/buildSrc')
const tasks = []
function locate(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, item.name)
    if (item.isDirectory()) locate(path)
    else if (item.isFile() && item.name === 'BuildTask.kt') tasks.push(path)
  }
}
locate(generated)
if (tasks.length !== 1) throw new Error(`Expected one generated BuildTask.kt, found ${tasks.length}`)
const task = tasks[0]
const entry = resolve(mobileRoot, '../../node_modules/@tauri-apps/cli/tauri.js')
const source = readFileSync(task, 'utf8')
const expectedBinary = 'val executable = """node"""'
const expectedArgs = 'val args = listOf("tauri", "android", "android-studio-script")'
if (source.split(expectedBinary).length !== 2 || source.split(expectedArgs).length !== 2) {
  throw new Error('Unexpected Tauri Android Gradle callback template; inspect before changing it')
}
const patched = source.replace(expectedArgs, `val args = listOf(${JSON.stringify(entry)}, "android", "android-studio-script")`)
writeFileSync(task, patched)

// Only the Android debug source set permits direct LAN pairing. Release remains HTTPS-only.
const debugSource = resolve(mobileRoot, 'src-tauri/gen/android/app/src/debug')
mkdirSync(debugSource, { recursive: true })
writeFileSync(resolve(debugSource, 'AndroidManifest.xml'), `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application android:usesCleartextTraffic="true" />
</manifest>
`)
console.log(`Gradle callback: node ${entry} android android-studio-script; debug LAN HTTP enabled`)
