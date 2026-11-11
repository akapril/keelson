package com.keelson.mobilevault

import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal class VaultCipher(private val key: () -> SecretKey) {
    private val aad = "keelson.mobile-vault.v1".toByteArray(Charsets.UTF_8)

    fun encrypt(plaintext: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        // Keystore supplies the random IV; never provide an IV on encryption.
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD(aad)
        check(cipher.iv.size == 12)
        return byteArrayOf(1) + cipher.iv + cipher.doFinal(plaintext)
    }

    fun decrypt(envelope: ByteArray): ByteArray {
        require(envelope.size >= 29 && envelope[0] == 1.toByte())
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, envelope.copyOfRange(1, 13)))
        cipher.updateAAD(aad)
        return cipher.doFinal(envelope.copyOfRange(13, envelope.size))
    }
}
