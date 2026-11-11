$ErrorActionPreference = 'Stop'
$cache = Join-Path $env:USERPROFILE '.gradle/caches/modules-2/files-2.1'
$groups = @('org.jetbrains.kotlin', 'org.jetbrains.kotlinx', 'org.jetbrains.intellij.deps', 'org.jetbrains')
$jars = @($groups | ForEach-Object { Get-ChildItem (Join-Path $cache $_) -Recurse -Filter '*.jar' -ErrorAction SilentlyContinue } | Where-Object { $_.Name -notmatch 'sources|javadoc|gradle-plugin' -and $_.FullName -notmatch '\\2\.2\.0\\' })
$classpath = ($jars.FullName -join [IO.Path]::PathSeparator)
$out = Join-Path $PSScriptRoot 'target/cipher-test'
New-Item -ItemType Directory -Force $out | Out-Null
$sources = @(Get-ChildItem "$PSScriptRoot/android/src/main/java/com/keelson/mobilevault/VaultCipher.kt" -ErrorAction SilentlyContinue) + @(Get-Item "$PSScriptRoot/android/src/test/java/com/keelson/mobilevault/VaultCipherTest.kt")
& java -cp $classpath org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -classpath $classpath -d $out @($sources.FullName)
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& java -cp ($out + [IO.Path]::PathSeparator + $classpath) com.keelson.mobilevault.VaultCipherTestKt
exit $LASTEXITCODE
