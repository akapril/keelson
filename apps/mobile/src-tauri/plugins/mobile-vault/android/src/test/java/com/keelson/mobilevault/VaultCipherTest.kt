package com.keelson.mobilevault

import javax.crypto.KeyGenerator

// Runs on the JVM without an Android emulator; real Keystore coverage is androidTest.
fun main() {
    val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    val plain = "{\"host\":\"https://example.com\",\"token\":\"secret\"}".toByteArray()
    val cipher = VaultCipher { key }
    val first = cipher.encrypt(plain)
    val second = cipher.encrypt(plain)
    check(!first.contentEquals(second)) { "Each save must use a fresh GCM IV" }
    check(!String(first).contains("secret")) { "Payload must not be plaintext" }
    check(cipher.decrypt(first).contentEquals(plain))
    val tampered = first.copyOf().apply { this[lastIndex] = (this[lastIndex].toInt() xor 1).toByte() }
    check(runCatching { cipher.decrypt(tampered) }.isFailure)
    check(runCatching { cipher.decrypt(byteArrayOf(1, 2)) }.isFailure)
    val wrongKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    check(runCatching { VaultCipher { wrongKey }.decrypt(first) }.isFailure)
    println("PASS: encrypted roundtrip, random IV, tamper, truncated payload, wrong key")
}
