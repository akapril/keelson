package com.keelson.mobilevault

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject

@InvokeArg
class SaveArgs {
    lateinit var host: String
    lateinit var token: String
}

@TauriPlugin
class MobileVaultPlugin(activity: Activity) : Plugin(activity) {
    private val vault = VaultStore(activity.applicationContext)

    @Command fun save(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SaveArgs::class.java)
            vault.save(args.host, args.token)
            invoke.resolve(JSObject())
        } catch (_: Exception) { invoke.reject("VAULT_WRITE_FAILED") }
    }

    @Command fun load(invoke: Invoke) {
        try {
            invoke.resolve(JSObject().put("credentials", vault.load() ?: JSONObject.NULL))
        } catch (_: Exception) { invoke.reject("VAULT_READ_FAILED") }
    }

    @Command fun delete(invoke: Invoke) {
        try {
            vault.delete()
            invoke.resolve(JSObject())
        } catch (_: Exception) { invoke.reject("VAULT_DELETE_FAILED") }
    }
}
