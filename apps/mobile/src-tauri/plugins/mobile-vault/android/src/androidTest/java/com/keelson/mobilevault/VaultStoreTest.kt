package com.keelson.mobilevault

import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class VaultStoreTest {
    @Test fun persistentRoundtripDeleteAndCorruption() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val store = VaultStore(context, "test-mobile-vault", "test-vault.bin")
        try {
            store.delete()
            assertNull(store.load())
            store.save("https://example.com", "sensitive-token")
            val restored = VaultStore(context, "test-mobile-vault", "test-vault.bin").load()!!
            assertEquals("https://example.com", restored.getString("host"))
            assertEquals("sensitive-token", restored.getString("token"))
            val file = File(context.noBackupFilesDir, "test-vault.bin")
            assertFalse(file.readText().contains("sensitive-token"))
            val keys = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            assertNull(keys.getKey("test-mobile-vault", null).encoded)
            keys.deleteEntry("test-mobile-vault")
            assertTrue(runCatching { store.load() }.isFailure)
            assertNull(store.load())
            store.save("https://example.com", "replacement-token")
            file.writeBytes(byteArrayOf(1, 2, 3))
            assertTrue(runCatching { store.load() }.isFailure)
            assertNull(store.load())
            store.save("https://example.com", "new-token")
            store.delete()
            assertNull(store.load())
        } finally { store.delete() }
    }
}
