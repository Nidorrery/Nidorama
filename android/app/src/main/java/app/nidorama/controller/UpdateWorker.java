package app.nidorama.controller;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Background check (about twice a day) for a newer release; notifies once per new build. */
public class UpdateWorker extends Worker {
    public static final String PREFS = "nidorama_updates";
    private static final Pattern BUILD = Pattern.compile("build\\.(\\d+)$");
    private static final Pattern CHANNEL = Pattern.compile("nidorama:channel=(\\w+)");

    public UpdateWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        HttpURLConnection conn = null;
        try {
            long mine = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).versionCode;
            String repo = getApplicationContext().getString(R.string.nidorama_repo); // set at build time
            if (repo.isEmpty()) return Result.success();
            conn = (HttpURLConnection) new URL("https://api.github.com/repos/" + repo + "/releases?per_page=30").openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(20000);
            conn.setRequestProperty("Accept", "application/vnd.github+json");
            String token = prefs.getString("token", "");
            if (!token.isEmpty()) conn.setRequestProperty("Authorization", "Bearer " + token);
            if (conn.getResponseCode() != 200) return Result.success();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (InputStream in = conn.getInputStream()) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            JSONArray releases = new JSONArray(out.toString("UTF-8"));
            long best = 0;
            String bestName = "";
            for (int i = 0; i < releases.length(); i++) {
                JSONObject r = releases.getJSONObject(i);
                if (r.optBoolean("draft")) continue;
                Matcher m = BUILD.matcher(r.optString("tag_name"));
                if (!m.find()) continue;
                long build = Long.parseLong(m.group(1));
                boolean hasApk = false;
                JSONArray assets = r.optJSONArray("assets");
                for (int k = 0; assets != null && k < assets.length(); k++) {
                    if (assets.getJSONObject(k).optString("name").endsWith(".apk")) hasApk = true;
                }
                // Only builds in the channel this device follows (see updates.js). Builds from before channels count as private.
                Matcher ch = CHANNEL.matcher(r.optString("body"));
                String channel = ch.find() ? ch.group(1) : "private";
                String wanted = prefs.getString("channels", "");
                if (!wanted.isEmpty() && !java.util.Arrays.asList(wanted.split(",")).contains(channel)) continue;
                if (hasApk && build > best) {
                    best = build;
                    bestName = r.optString("tag_name").replaceFirst("^v", "").replace("-build.", "+");
                }
            }
            if (best > mine && best > prefs.getLong("notified", 0)) {
                prefs.edit().putLong("notified", best).apply();
                UpdateNotifier.show(ctx, bestName);
            }
        } catch (Exception ignored) {
            // offline or GitHub unreachable: try again at the next run
        } finally {
            if (conn != null) conn.disconnect();
        }
        return Result.success();
    }
}
