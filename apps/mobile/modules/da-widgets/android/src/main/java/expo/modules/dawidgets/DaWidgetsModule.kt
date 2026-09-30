package expo.modules.dawidgets

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * `DaWidgets` (T-8.25, SCREEN_AND_FLOW_MAP §11.1): stores the zod-validated `WidgetSnapshotV1`
 * JSON in SharedPreferences `da_widget` / `snapshot_v1` and redraws the Glance widgets
 * (`updateAll`). Widgets are read-only; nothing flows back from them.
 */
class DaWidgetsModule : Module() {
    private val context: Context
        get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

    override fun definition() = ModuleDefinition {
        Name("DaWidgets")

        AsyncFunction("setSnapshot") Coroutine { json: String, scheme: String ->
            SnapshotStore.write(context, json, scheme)
            DaWidgetUpdater.updateAll(context)
        }

        AsyncFunction("getSnapshot") {
            SnapshotStore.read(context)
        }

        AsyncFunction("reload") Coroutine { ->
            DaWidgetUpdater.updateAll(context)
        }

        /** `widget_inventory`: bit 1 = 2×2 "Sıradaki", bit 2 = 4×2 "Bugün". */
        AsyncFunction("getInventory") {
            val manager = AppWidgetManager.getInstance(context)
            fun installed(receiver: Class<*>) =
                manager.getAppWidgetIds(ComponentName(context, receiver)).isNotEmpty()
            var kinds = 0
            if (installed(DaNextWidgetReceiver::class.java)) kinds = kinds or 1
            if (installed(DaTodayWidgetReceiver::class.java)) kinds = kinds or 2
            mapOf("ios_families" to 0, "android_kinds" to kinds)
        }
    }
}
