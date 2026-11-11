package com.keelson.mobilevault

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

internal class VaultStore(
    context: Context,
    private val alias: String = "keelson.mobile-vault.v1",
    filename: String = "keelson-mobile-vault.bin"
) {
    private val file = AtomicFile(File(context.noBackupFilesDir, filename))
    private fun keystore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun key(create: Boolean): SecretKey {
        val existing = keystore().getKey(alias, null)
        if (existing != null) return existing as SecretKey
        check(create) { "Missing vault key" }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build())
        }.generateKey()
    }

    @Synchronized fun save(host: String, token: String) {
        require(host.isNotBlank() && host.length <= 4096 && token.isNotBlank() && token.length <= 4096)
        val plain = JSONObject().put("host", host).put("token", token).toString().toByteArray(Charsets.UTF_8)
        val encrypted = try { VaultCipher { key(true) }.encrypt(plain) } finally { plain.fill(0) }
        val stream = file.startWrite()
        try {
            stream.write(encrypted)
            stream.fd.sync()
            file.finishWrite(stream)
            check(file.openRead().use { it.readBytes().contentEquals(encrypted) })
        } catch (error: Exception) {
            file.failWrite(stream)
            throw error
        }
    }

    @Synchronized fun load(): JSONObject? {
        // AtomicFile.openRead recovers a backup left by an interrupted write.
        val encrypted = try {
            file.openRead().use { stream ->
                val data = ByteArray(32769)
                var size = 0
                while (size < data.size) {
                    val count = stream.read(data, size, data.size - size)
                    if (count == -1) break
                    size += count
                }
                data.copyOf(size)
            }
        } catch (missing: java.io.FileNotFoundException) {
            if (!file.baseFile.exists()) return null
            throw missing
        }
        try {
            require(encrypted.size <= 32768)
            val plain = VaultCipher { key(false) }.decrypt(encrypted)
            try {
                val payload = JSONObject(String(plain, Charsets.UTF_8))
                require(payload.get("host") is String && payload.get("token") is String)
                require(payload.getString("host").isNotBlank() && payload.getString("token").isNotBlank())
                return payload
            } finally { plain.fill(0) }
        } catch (error: Exception) {
            // Invalidated key, modified file, or stale format must never silently restore.
            delete()
            throw IllegalStateException("Saved pairing is unavailable")
        }
    }

    @Synchronized fun delete() {
        file.delete()
        check(!file.baseFile.exists() && !File(file.baseFile.path + ".bak").exists() && !File(file.baseFile.path + ".new").exists())
        keystore().deleteEntry(alias)
    }
}
