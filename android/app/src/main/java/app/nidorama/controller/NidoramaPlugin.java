package app.nidorama.controller;

import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.provider.Settings;
import android.view.WindowManager;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.annotation.ActivityCallback;
import android.os.Build;
import androidx.core.content.FileProvider;
import android.Manifest;
import android.content.Context;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import java.util.concurrent.TimeUnit;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Handler;
import android.os.Looper;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Native bits the web app needs: open the Home Assistant app, launcher mode, keep-awake. */
@CapacitorPlugin(name = "Nidorama")
public class NidoramaPlugin extends Plugin {
    private static final String[] HA_PACKAGES = {
        "io.homeassistant.companion.android",
        "io.homeassistant.companion.android.minimal",
    };

    private ComponentName launcherAlias() {
        return new ComponentName(getContext(), getContext().getPackageName() + ".HomeLauncher");
    }

    // ---------- finding Home Assistant on this network (#134) ----------
    // Home Assistant announces itself on the local network (DNS-SD, "_home-assistant._tcp"). Android's own
    // NsdManager listens for a few seconds, then each one found is resolved to its address. Nothing leaves
    // the local network. Resolves { found: [{ name, host, port, url, location_name, uuid, version }] }.
    private static final String HA_SERVICE = "_home-assistant._tcp";

    @PluginMethod
    public void discoverHomeAssistant(PluginCall call) {
        final NsdManager nsd = (NsdManager) getContext().getSystemService(Context.NSD_SERVICE);
        if (nsd == null) { call.resolve(found(new JSArray())); return; }
        final long listenMs = Math.max(1000, Math.min(10000, call.getInt("ms", 3500)));
        final List<NsdServiceInfo> seen = Collections.synchronizedList(new ArrayList<>());
        final JSArray out = new JSArray();
        final AtomicBoolean done = new AtomicBoolean(false);
        final Handler main = new Handler(Looper.getMainLooper());
        final NsdManager.DiscoveryListener listener = new NsdManager.DiscoveryListener() {
            @Override public void onStartDiscoveryFailed(String type, int code) { finish(call, out, done); }
            @Override public void onStopDiscoveryFailed(String type, int code) {}
            @Override public void onDiscoveryStarted(String type) {}
            @Override public void onDiscoveryStopped(String type) {}
            @Override public void onServiceFound(NsdServiceInfo info) { seen.add(info); }
            @Override public void onServiceLost(NsdServiceInfo info) {}
        };
        try {
            nsd.discoverServices(HA_SERVICE, NsdManager.PROTOCOL_DNS_SD, listener);
        } catch (Exception e) {
            call.resolve(found(out));
            return;
        }
        main.postDelayed(() -> {
            try { nsd.stopServiceDiscovery(listener); } catch (Exception ignored) {}
            if (done.get()) return;
            resolveNext(nsd, new ArrayList<>(seen), 0, out, new HashSet<>(), call, done);
        }, listenMs);
        // Whatever happens, answer within a few seconds of listening.
        main.postDelayed(() -> finish(call, out, done), listenMs + 6000);
    }

    private static JSObject found(JSArray list) {
        JSObject r = new JSObject();
        r.put("found", list);
        return r;
    }

    private static void finish(PluginCall call, JSArray out, AtomicBoolean done) {
        if (done.compareAndSet(false, true)) call.resolve(found(out));
    }

    @SuppressWarnings("deprecation")
    private void resolveNext(NsdManager nsd, List<NsdServiceInfo> list, int i, JSArray out, Set<String> ids, PluginCall call, AtomicBoolean done) {
        if (done.get()) return;
        if (i >= list.size() || i >= 10) { finish(call, out, done); return; }
        try {
            nsd.resolveService(list.get(i), new NsdManager.ResolveListener() {
                @Override public void onResolveFailed(NsdServiceInfo info, int code) {
                    resolveNext(nsd, list, i + 1, out, ids, call, done);
                }
                @Override public void onServiceResolved(NsdServiceInfo info) {
                    try {
                        JSObject o = new JSObject();
                        InetAddress addr = info.getHost();
                        String host = addr == null ? "" : addr.getHostAddress();
                        if (addr instanceof Inet6Address) host = "[" + host.replaceAll("%.*$", "") + "]";
                        int port = info.getPort() > 0 ? info.getPort() : 8123;
                        o.put("name", info.getServiceName());
                        o.put("host", host);
                        o.put("port", port);
                        Map<String, byte[]> attrs = info.getAttributes();
                        String id = info.getServiceName();
                        if (attrs != null) {
                            for (String k : new String[] { "location_name", "uuid", "version", "internal_url", "base_url" }) {
                                byte[] v = attrs.get(k);
                                if (v != null) o.put(k, new String(v, StandardCharsets.UTF_8));
                            }
                            if (attrs.get("uuid") != null) id = new String(attrs.get("uuid"), StandardCharsets.UTF_8);
                        }
                        o.put("url", host.isEmpty() ? "" : "http://" + host + ":" + port);
                        if (ids.add(id) && !host.isEmpty()) out.put(o);
                    } catch (Exception ignored) {}
                    resolveNext(nsd, list, i + 1, out, ids, call, done);
                }
            });
        } catch (Exception e) {
            resolveNext(nsd, list, i + 1, out, ids, call, done);
        }
    }

    @PluginMethod
    public void openHomeAssistant(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        for (String pkg : HA_PACKAGES) {
            Intent launch = pm.getLaunchIntentForPackage(pkg);
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(launch);
                call.resolve();
                return;
            }
        }
        String url = call.getString("fallbackUrl");
        try {
            Intent view = url != null && !url.isEmpty()
                ? new Intent(Intent.ACTION_VIEW, Uri.parse(url))
                : new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + HA_PACKAGES[0]));
            view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(view);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("Home Assistant app not installed");
        }
    }

    /** Open another installed app (an integration's own app), or a web address if it is not installed. */
    @PluginMethod
    public void openApp(PluginCall call) {
        String pkg = call.getString("package", "");
        Intent launch = pkg.isEmpty() ? null : getContext().getPackageManager().getLaunchIntentForPackage(pkg);
        try {
            if (launch == null) {
                String url = call.getString("fallbackUrl", "");
                launch = new Intent(Intent.ACTION_VIEW, Uri.parse(url.isEmpty() ? "market://details?id=" + pkg : url));
            }
            getActivity().startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("Could not open the app");
        }
    }

    @PluginMethod
    public void getLauncherState(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        int state = pm.getComponentEnabledSetting(launcherAlias());
        boolean enabled = state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED;
        Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
        ResolveInfo ri = pm.resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY);
        boolean isDefault = ri != null && ri.activityInfo != null
            && getContext().getPackageName().equals(ri.activityInfo.packageName);
        JSObject ret = new JSObject();
        ret.put("enabled", enabled);
        ret.put("isDefault", isDefault);
        call.resolve(ret);
    }

    @PluginMethod
    public void setLauncherMode(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getContext().getPackageManager().setComponentEnabledSetting(
            launcherAlias(),
            enabled ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            PackageManager.DONT_KILL_APP);
        call.resolve();
    }

    @PluginMethod
    public void openHomeSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_HOME_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(i);
        } catch (ActivityNotFoundException e) {
            getActivity().startActivity(new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
        call.resolve();
    }

    @PluginMethod
    public void setKeepScreenOn(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
        call.resolve();
    }

    /** Kiosk mode: hide the status and navigation bars (a swipe from the very edge still shows them for a moment). */
    @PluginMethod
    public void setFullscreen(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        boolean pin = Boolean.TRUE.equals(call.getBoolean("pin", false));
        getActivity().runOnUiThread(() -> {
            // App pinning: Android itself blocks the notification tray, Home and recent apps until unpinned.
            try {
                android.app.ActivityManager am = (android.app.ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
                boolean pinned = am != null && am.getLockTaskModeState() != android.app.ActivityManager.LOCK_TASK_MODE_NONE;
                if (on && pin && !pinned) getActivity().startLockTask();
                else if (!(on && pin) && pinned) getActivity().stopLockTask();
            } catch (Exception ignored) { }
            android.view.Window window = getActivity().getWindow();
            androidx.core.view.WindowInsetsControllerCompat bars = androidx.core.view.WindowCompat.getInsetsController(window, window.getDecorView());
            if (on) {
                bars.setSystemBarsBehavior(androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                bars.hide(androidx.core.view.WindowInsetsCompat.Type.systemBars());
            } else {
                bars.show(androidx.core.view.WindowInsetsCompat.Type.systemBars());
            }
        });
        call.resolve();
    }

    /** Open Android's "remove this app?" screen (going back to an older build needs the newer one removed first). */
    @PluginMethod
    public void uninstallSelf(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_DELETE, Uri.parse("package:" + getContext().getPackageName()));
        getActivity().startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        call.resolve();
    }

    /** Ask for permission to show notifications (Android 13 and later), when the user makes their first alert. */
    @PluginMethod
    public void askNotifications(PluginCall call) {
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(getActivity(), new String[] { Manifest.permission.POST_NOTIFICATIONS }, 4202);
        }
        call.resolve();
    }

    /** One of the user's own alerts: an ordinary notification on this device. Tapping it opens the app. */
    @PluginMethod
    public void notifyAlert(PluginCall call) {
        Context ctx = getContext();
        androidx.core.app.NotificationManagerCompat nm = androidx.core.app.NotificationManagerCompat.from(ctx);
        if (nm.areNotificationsEnabled()) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                android.app.NotificationChannel ch = new android.app.NotificationChannel("alerts", "Your alerts", android.app.NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("Alerts you made in the app");
                ctx.getSystemService(android.app.NotificationManager.class).createNotificationChannel(ch);
            }
            Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            android.app.PendingIntent pi = android.app.PendingIntent.getActivity(ctx, 1, open, android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
            androidx.core.app.NotificationCompat.Builder b = new androidx.core.app.NotificationCompat.Builder(ctx, "alerts")
                .setSmallIcon(R.drawable.ic_stat_nidorama)
                .setContentTitle(call.getString("title", "Nidorama"))
                .setContentText(call.getString("text", ""))
                .setPriority(androidx.core.app.NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(pi)
                .setAutoCancel(true);
            Integer id = call.getInt("id", 1);
            try {
                nm.notify(50000 + (id == null ? 1 : id), b.build());
            } catch (SecurityException ignored) {
                // permission was withdrawn between the check and the post
            }
        }
        call.resolve();
    }

    /** Kiosk mode: pull down Android's notification tray. */
    @PluginMethod
    public void showNotifications(PluginCall call) {
        try {
            Object service = getContext().getSystemService("statusbar");
            Class.forName("android.app.StatusBarManager").getMethod("expandNotificationsPanel").invoke(service);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open the notification tray", e);
        }
    }

    /** A backup, written straight into the device's Downloads folder, where it survives removing the app. */
    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("unsupported");
            return;
        }
        try {
            android.content.ContentValues values = new android.content.ContentValues();
            values.put(android.provider.MediaStore.Downloads.DISPLAY_NAME, call.getString("name", "nidorama-backup.json"));
            values.put(android.provider.MediaStore.Downloads.MIME_TYPE, "application/json");
            Uri dest = getContext().getContentResolver().insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (dest == null) throw new Exception("could not write to Downloads");
            try (OutputStream out = getContext().getContentResolver().openOutputStream(dest)) {
                out.write(call.getString("text", "").getBytes(StandardCharsets.UTF_8));
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not save the file", e);
        }
    }

    /** Hand a file to another app through Android's own share screen (a storage app, email, a message). */
    @PluginMethod
    public void shareTextFile(PluginCall call) {
        try {
            File dir = new File(getContext().getCacheDir(), "share");
            dir.mkdirs();
            File f = new File(dir, call.getString("name", "nidorama-backup.json"));
            try (OutputStream out = new FileOutputStream(f)) {
                out.write(call.getString("text", "").getBytes(StandardCharsets.UTF_8));
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("application/json");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            send.setClipData(android.content.ClipData.newRawUri("", uri));
            getActivity().startActivity(Intent.createChooser(send, "Keep the backup in"));
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not share the file", e);
        }
    }

    /** Export: let the user pick where to save a home file. */
    @PluginMethod
    public void saveTextFile(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("application/json");
        i.putExtra(Intent.EXTRA_TITLE, call.getString("name", "home.nidorama.json"));
        startActivityForResult(call, i, "saveTextFileResult");
    }

    @ActivityCallback
    private void saveTextFileResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != android.app.Activity.RESULT_OK || data == null || data.getData() == null) {
            call.reject("cancelled");
            return;
        }
        try (OutputStream out = getContext().getContentResolver().openOutputStream(data.getData(), "wt")) {
            out.write(call.getString("text", "").getBytes(StandardCharsets.UTF_8));
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not save the file", e);
        }
    }


    /**
     * In-app update: download the APK from the project's releases and open Android's installer.
     * Android always asks the user to confirm, and refuses an APK signed with a different key.
     */
    @PluginMethod
    public void installUpdate(PluginCall call) {
        String url = call.getString("url", "");
        String repo = getContext().getString(R.string.nidorama_repo); // set at build time
        // Only files from this owner's releases. The repository's own name is not checked: a renamed
        // repository hands out its files under the new name, and that must not stop updates (#102).
        String owner = repo.contains("/") ? repo.substring(0, repo.indexOf('/')).toLowerCase(java.util.Locale.ROOT) : "";
        String lower = url == null ? "" : url.toLowerCase(java.util.Locale.ROOT);
        String prefix = "https://api.github.com/repos/" + owner + "/";
        boolean ours = !owner.isEmpty() && lower.startsWith(prefix) && lower.indexOf("/releases/assets/", prefix.length()) > prefix.length()
            && lower.substring(prefix.length(), lower.indexOf("/releases/assets/", prefix.length())).matches("[a-z0-9_.-]+");
        if (!ours) {
            call.reject("Not a Nidorama release");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            JSObject ret = new JSObject();
            ret.put("status", "needs-permission");
            call.resolve(ret);
            return;
        }
        final String token = call.getString("token", "");
        // save = keep the file in Downloads and do not open the installer (going back to an older build).
        final boolean save = Boolean.TRUE.equals(call.getBoolean("save", false));
        final String saveName = call.getString("name", "Nidorama.apk");
        if (save && Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            JSObject ret = new JSObject();
            ret.put("status", "unsupported");
            call.resolve(ret);
            return;
        }
        new Thread(() -> {
            File apk = new File(getContext().getCacheDir(), "nidorama-update.apk");
            HttpURLConnection conn = null;
            try {
                // Ask GitHub for the file. It answers with a short-lived download address, which must
                // be fetched without the token (so redirects are followed by hand).
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                conn.setRequestProperty("Accept", "application/octet-stream");
                if (token != null && !token.isEmpty()) conn.setRequestProperty("Authorization", "Bearer " + token);
                int code = conn.getResponseCode();
                if (code >= 300 && code < 400) {
                    String location = conn.getHeaderField("Location");
                    conn.disconnect();
                    if (location == null || !location.startsWith("https://")) throw new Exception("bad redirect");
                    conn = (HttpURLConnection) new URL(location).openConnection();
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(30000);
                    code = conn.getResponseCode();
                }
                if (code != 200) throw new Exception("HTTP " + code);
                long total = conn.getContentLengthLong(), done = 0, lastSent = 0;
                try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        done += n;
                        if (total > 0 && done - lastSent > total / 50) {
                            lastSent = done;
                            JSObject ev = new JSObject();
                            ev.put("fraction", (double) done / total);
                            notifyListeners("updateProgress", ev);
                        }
                    }
                }
                if (save) { // copy into the public Downloads folder, where it survives removing the app
                    android.content.ContentValues values = new android.content.ContentValues();
                    values.put(android.provider.MediaStore.Downloads.DISPLAY_NAME, saveName);
                    values.put(android.provider.MediaStore.Downloads.MIME_TYPE, "application/vnd.android.package-archive");
                    Uri dest = getContext().getContentResolver().insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (dest == null) throw new Exception("could not write to Downloads");
                    try (InputStream in = new java.io.FileInputStream(apk); OutputStream out = getContext().getContentResolver().openOutputStream(dest)) {
                        byte[] buf = new byte[65536];
                        int n;
                        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    }
                    JSObject saved = new JSObject();
                    saved.put("status", "saved");
                    call.resolve(saved);
                    return;
                }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent install = new Intent(Intent.ACTION_VIEW);
                install.setDataAndType(uri, "application/vnd.android.package-archive");
                install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(install);
                JSObject ret = new JSObject();
                ret.put("status", "installing");
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Download failed: " + e.getMessage(), e);
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    // ---------- update notifications ----------
    private String pendingAction = null;

    private String sharedPath = null, sharedName = null;

    /** Another app (a 3D scanning app) shared or opened a file with Nidorama: copy it in and tell the web app. */
    private void readSharedFile(Intent intent) {
        String act = intent.getAction();
        Uri uri = Intent.ACTION_SEND.equals(act) ? (Uri) intent.getParcelableExtra(Intent.EXTRA_STREAM)
            : Intent.ACTION_VIEW.equals(act) ? intent.getData() : null;
        if (uri == null || !"content".equals(uri.getScheme())) return;
        String name = "scan.glb";
        try (android.database.Cursor c = getContext().getContentResolver().query(uri, null, null, null, null)) {
            int i = c == null ? -1 : c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
            if (i >= 0 && c.moveToFirst() && c.getString(i) != null) name = c.getString(i);
        } catch (Exception ignored) {}
        File out = new File(getContext().getCacheDir(), "shared-" + System.currentTimeMillis() + ".glb");
        try (InputStream in = getContext().getContentResolver().openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
            byte[] buf = new byte[65536];
            int n;
            long total = 0;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > 300L * 1024 * 1024) throw new Exception("too large");
                os.write(buf, 0, n);
            }
        } catch (Exception e) {
            out.delete();
            return;
        }
        intent.setAction(Intent.ACTION_MAIN); // handle it once
        sharedPath = out.getAbsolutePath();
        sharedName = name;
        JSObject ev = new JSObject();
        ev.put("path", sharedPath);
        ev.put("name", sharedName);
        notifyListeners("sharedFile", ev);
    }

    @PluginMethod
    public void takeSharedFile(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("path", sharedPath);
        ret.put("name", sharedName);
        sharedPath = null;
        sharedName = null;
        call.resolve(ret);
    }

    /** Open the Scaniverse 3D scanning app, or its store page if it is not installed. */
    @PluginMethod
    public void openScanner(PluginCall call) {
        String pkg = "com.nianticlabs.scaniverse";
        Intent launch = getContext().getPackageManager().getLaunchIntentForPackage(pkg);
        try {
            if (launch == null) launch = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + pkg));
            getActivity().startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            call.resolve();
        } catch (ActivityNotFoundException e) {
            try {
                getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + pkg)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                call.resolve();
            } catch (ActivityNotFoundException e2) {
                call.reject("Could not open Scaniverse");
            }
        }
    }

    private void readAction(Intent intent) {
        if (intent == null) return;
        readSharedFile(intent);
        String action = intent.getStringExtra(UpdateNotifier.ACTION_EXTRA);
        if (action == null) return;
        intent.removeExtra(UpdateNotifier.ACTION_EXTRA);
        UpdateNotifier.cancel(getContext());
        pendingAction = action;
        JSObject ev = new JSObject();
        ev.put("action", action);
        notifyListeners("launchAction", ev);
    }

    @Override
    public void load() {
        readAction(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        readAction(intent);
    }

    /** What the app was opened for (the Install button on the update notification), once. */
    @PluginMethod
    public void takeLaunchAction(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("action", pendingAction);
        pendingAction = null;
        call.resolve(ret);
    }

    /** Switch the twice-daily background update check on or off; asks for notification permission once. */
    @PluginMethod
    public void setUpdateNotifications(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        Context ctx = getContext();
        ctx.getSharedPreferences(UpdateWorker.PREFS, Context.MODE_PRIVATE).edit().putString("token", call.getString("token", "")).putString("channels", call.getString("channels", "")).apply();
        WorkManager wm = WorkManager.getInstance(ctx);
        if (enabled) {
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(getActivity(), new String[] { Manifest.permission.POST_NOTIFICATIONS }, 4201);
            }
            PeriodicWorkRequest work = new PeriodicWorkRequest.Builder(UpdateWorker.class, 12, TimeUnit.HOURS)
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build();
            wm.enqueueUniquePeriodicWork("nidorama-update-check", ExistingPeriodicWorkPolicy.UPDATE, work);
        } else {
            wm.cancelUniqueWork("nidorama-update-check");
        }
        call.resolve();
    }

    /** Show the update notification now (the running app found an update). */
    @PluginMethod
    public void notifyUpdate(PluginCall call) {
        Context ctx = getContext();
        Integer build = call.getInt("build", 0);
        ctx.getSharedPreferences(UpdateWorker.PREFS, Context.MODE_PRIVATE).edit().putLong("notified", build == null ? 0 : build).apply();
        UpdateNotifier.show(ctx, call.getString("version", ""));
        call.resolve();
    }
}
