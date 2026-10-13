package expo.modules.recordingnotification

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// expo-location posts the foreground-service notification with fixed text and
// refuses to restart the service from the background, so it cannot show live
// stats. This module posts over that notification on the same channel.
class RecordingNotificationModule : Module() {
  private val context
    get() = requireNotNull(appContext.reactContext)

  private val manager
    get() = context.getSystemService(NotificationManager::class.java)

  // expo-location names its channel "<app scope>:<task name>" and creates it
  // on the first recording.
  private fun channelId(taskName: String) =
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      null
    } else {
      manager.notificationChannels.firstOrNull { it.id.endsWith(":$taskName") }?.id
    }

  private fun posted(channelId: String) =
    manager.activeNotifications.filter { it.notification.channelId == channelId }

  override fun definition() = ModuleDefinition {
    Name("RecordingNotification")

    // `timerStart` is the wall-clock time in ms that the timer counts up from.
    // With a timer, the stats replace the foreground-service notification.
    // Without one, the location service is stopped (a pause), so they go in a
    // notification of their own.
    Function("show") { taskName: String, title: String, text: String, timerStart: Double?, url: String ->
      val channelId = channelId(taskName) ?: return@Function
      val posted = posted(channelId)
      val id = if (timerStart == null) PAUSED_ID else posted.firstOrNull { it.id != PAUSED_ID }?.id
      posted.filter { it.id != id }.forEach { manager.cancel(it.id) }
      // The service posts its notification a moment after it starts.
      if (id == null) return@Function

      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(context.packageName)
      val icon = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
        .takeIf { it != 0 } ?: context.applicationInfo.icon
      val builder = Notification.Builder(context, channelId)
        .setContentTitle(title)
        .setContentText(text)
        .setSmallIcon(icon)
        .setCategory(Notification.CATEGORY_SERVICE)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(
          PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        )
      if (timerStart == null) {
        builder.setShowWhen(false)
      } else {
        builder.setUsesChronometer(true).setWhen(timerStart.toLong())
      }
      manager.notify(id, builder.build())
    }

    // A running service keeps its own notification. This removes the paused
    // one, and any that outlived the service.
    Function("hide") { taskName: String ->
      val channelId = channelId(taskName) ?: return@Function
      posted(channelId).forEach { manager.cancel(it.id) }
    }
  }

  companion object {
    private const val PAUSED_ID = 481700
  }
}
