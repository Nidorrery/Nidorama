package app.nidorama.controller;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/** Posts the "Update available" notification. Tapping it (or its Install button) opens the app and starts the install. */
public final class UpdateNotifier {
    public static final String ACTION_EXTRA = "nidorama_action";
    public static final String INSTALL = "install_update";
    private static final String CHANNEL = "updates";
    private static final int ID = 4201;

    private UpdateNotifier() {}

    public static void show(Context ctx, String version) {
        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        if (!nm.areNotificationsEnabled()) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "App updates", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Tells you when a new version of Nidorama can be installed");
            ctx.getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
        Intent open = new Intent(ctx, MainActivity.class)
            .putExtra(ACTION_EXTRA, INSTALL)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_nidorama)
            .setContentTitle("Update available")
            .setContentText("Nidorama " + version + " is ready. Would you like to install?")
            .setContentIntent(pi)
            .setAutoCancel(true)
            .addAction(0, "Install", pi);
        try {
            nm.notify(ID, b.build());
        } catch (SecurityException ignored) {
            // notification permission was withdrawn between the check and the post
        }
    }

    public static void cancel(Context ctx) {
        NotificationManagerCompat.from(ctx).cancel(ID);
    }
}
