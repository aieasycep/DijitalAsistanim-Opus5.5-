package expo.modules.dawidgets

import android.content.Context
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.updateAll
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** Declared in the app manifest by the `da-widgets` config plugin (`@xml/da_next_widget_info`). */
class DaNextWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = DaNextWidget()
}

/** Declared in the app manifest by the `da-widgets` config plugin (`@xml/da_today_widget_info`). */
class DaTodayWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = DaTodayWidget()
}

/**
 * Redraws both widgets from the stored snapshot and schedules the next boundary (§11.4): a
 * WorkManager one-time job at the next meeting start/end or staleness mark re-renders without the
 * app and without a network call.
 */
object DaWidgetUpdater {
    private const val WORK = "da.widgets.boundary"

    suspend fun updateAll(context: Context) {
        DaNextWidget().updateAll(context)
        DaTodayWidget().updateAll(context)
        scheduleBoundary(context)
    }

    fun scheduleBoundary(context: Context) {
        val now = System.currentTimeMillis()
        val next = SnapshotStore.load(context)?.boundaries()?.filter { it > now }?.minOrNull()
        val work = WorkManager.getInstance(context.applicationContext)
        if (next == null) {
            work.cancelUniqueWork(WORK)
            return
        }
        val request = OneTimeWorkRequestBuilder<BoundaryWorker>()
            .setInitialDelay(next - now + 1_000, TimeUnit.MILLISECONDS)
            .build()
        work.enqueueUniqueWork(WORK, ExistingWorkPolicy.REPLACE, request)
    }
}

class BoundaryWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        DaWidgetUpdater.updateAll(applicationContext)
        return Result.success()
    }
}
