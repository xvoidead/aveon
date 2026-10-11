package com.aveon.player;

import android.Manifest;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentUris;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.Window;
import androidx.activity.result.ActivityResult;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * Всё, чего нет у WebView: сеть без CORS (fetch), файлы данных (fs*), звонок Discord (call),
 * уведомление (mediaUpdate), музыка на телефоне (scanAudio, pickFolder, pickAudio), картинки,
 * ссылки, буфер обмена. JS-сторона — mobile/bridge.
 */
@CapacitorPlugin(
    name = "Aveon",
    permissions = {
        @Permission(alias = "audio", strings = { Manifest.permission.READ_MEDIA_AUDIO }),
        @Permission(alias = "storage", strings = { Manifest.permission.READ_EXTERNAL_STORAGE }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
    }
)
public class AveonPlugin extends Plugin {
    private static AveonPlugin instance;
    private final ExecutorService io = Executors.newCachedThreadPool();
    private final Handler main = new Handler(Looper.getMainLooper());
    private boolean inCall = false;
    private boolean barrel = false;

    @Override
    public void load() {
        instance = this;
        main.post(this::pollCall);
    }

    // ---------- события из уведомления ----------

    static void media(String action, double pos) {
        AveonPlugin p = instance;
        if (p == null) return;
        JSObject o = new JSObject();
        o.put("action", action);
        o.put("pos", pos);
        p.notifyListeners("media", o);
    }

    // ---------- звонок ----------

    // Discord в голосовом канале переводит звук в режим связи — это и считаем «в звонке»
    private void pollCall() {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        int mode = am.getMode();
        boolean now = mode == AudioManager.MODE_IN_COMMUNICATION || mode == AudioManager.MODE_IN_CALL;
        if (now != inCall) {
            inCall = now;
            notifyListeners("call", callJson());
        }
        main.postDelayed(this::pollCall, 700);
    }

    private JSObject callJson() {
        JSObject o = new JSObject();
        o.put("call", inCall);
        o.put("discord", discordInstalled());
        return o;
    }

    private boolean discordInstalled() {
        try {
            getContext().getPackageManager().getPackageInfo("com.discord", 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    @PluginMethod
    public void callState(PluginCall call) {
        call.resolve(callJson());
    }

    @PluginMethod
    public void setBarrel(PluginCall call) {
        barrel = call.getBoolean("on", false);
        MediaService.State s = copyState();
        s.barrel = barrel;
        MediaService.update(getContext(), s);
        call.resolve();
    }

    // ---------- уведомление ----------

    @PluginMethod
    public void mediaUpdate(PluginCall call) {
        MediaService.State s = new MediaService.State();
        s.hasTrack = call.getBoolean("hasTrack", false);
        s.playing = call.getBoolean("playing", false);
        s.title = call.getString("title", "");
        s.artist = call.getString("artist", "");
        s.album = call.getString("album", "");
        s.cover = call.getString("cover", "");
        s.pos = call.getDouble("pos", 0.0);
        s.duration = call.getDouble("duration", 0.0);
        s.barrel = barrel;
        MediaService.State prev = MediaService.state;
        if (s.title.isEmpty() && prev.hasTrack) { // из thumbState приходит только «играет/пауза»
            s.title = prev.title; s.artist = prev.artist; s.album = prev.album; s.cover = prev.cover;
            s.duration = prev.duration;
            s.pos = prev.pos + (prev.playing ? (System.currentTimeMillis() - prev.at) / 1000.0 : 0);
        }
        s.at = System.currentTimeMillis();
        MediaService.update(getContext(), s);
        call.resolve();
    }

    private MediaService.State copyState() {
        MediaService.State p = MediaService.state;
        MediaService.State s = new MediaService.State();
        s.hasTrack = p.hasTrack; s.playing = p.playing; s.title = p.title; s.artist = p.artist; s.album = p.album;
        s.cover = p.cover; s.duration = p.duration; s.barrel = p.barrel;
        s.pos = p.pos + (p.playing ? (System.currentTimeMillis() - p.at) / 1000.0 : 0);
        return s;
    }

    // ---------- сеть ----------

    @PluginMethod
    public void fetch(PluginCall call) {
        io.execute(() -> {
            JSObject out = new JSObject();
            try {
                String url = call.getString("url");
                String method = call.getString("method", "GET").toUpperCase(Locale.ROOT);
                JSObject headers = call.getObject("headers", new JSObject());
                String body64 = call.getString("body");
                int timeout = call.getInt("timeout", 30000);
                String ctype = null;
                Request.Builder b = new Request.Builder().url(url);
                Iterator<String> keys = headers.keys();
                boolean ua = false;
                while (keys.hasNext()) {
                    String k = keys.next();
                    String v = headers.getString(k);
                    if (v == null) continue;
                    if (k.equalsIgnoreCase("content-type")) ctype = v;
                    if (k.equalsIgnoreCase("user-agent")) ua = true;
                    b.header(k, v);
                }
                if (!ua) b.header("User-Agent", Net.UA);
                RequestBody rb = null;
                if (body64 != null) rb = RequestBody.create(Base64.decode(body64, Base64.NO_WRAP), ctype == null ? null : MediaType.parse(ctype));
                else if (!method.equals("GET") && !method.equals("HEAD")) rb = RequestBody.create(new byte[0], null);
                b.method(method, rb);
                OkHttpClient client = Net.get(getContext()).newBuilder().callTimeout(timeout, TimeUnit.MILLISECONDS).build();
                try (Response res = client.newCall(b.build()).execute()) {
                    out.put("status", res.code());
                    out.put("statusText", res.message());
                    out.put("url", res.request().url().toString());
                    JSObject h = new JSObject();
                    for (String name : res.headers().names()) h.put(name.toLowerCase(Locale.ROOT), String.join(", ", res.headers(name)));
                    out.put("headers", h);
                    ResponseBody body = res.body();
                    out.put("body", body == null ? "" : Base64.encodeToString(body.bytes(), Base64.NO_WRAP));
                }
            } catch (Exception e) {
                out.put("error", e.getClass().getSimpleName() + ": " + e.getMessage());
            }
            call.resolve(out);
        });
    }

    // ---------- файлы данных: userData Windows-версии ----------

    private File dataDir() {
        File d = new File(getContext().getFilesDir(), "aveon");
        d.mkdirs();
        return d;
    }

    private File dataFile(String name) {
        if (name == null || name.contains("..") || name.startsWith("/")) throw new IllegalArgumentException("bad name");
        return new File(dataDir(), name);
    }

    @PluginMethod
    public void fsLoad(PluginCall call) {
        io.execute(() -> {
            JSObject files = new JSObject();
            File[] list = dataDir().listFiles();
            if (list != null) {
                for (File f : list) {
                    if (!f.isFile() || !f.getName().endsWith(".json")) continue;
                    try {
                        String raw = new String(java.nio.file.Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
                        files.put(f.getName(), Vault.open(raw));
                    } catch (Exception e) {
                        android.util.Log.w("aveon", "fsLoad " + f.getName() + ": " + e.getMessage());
                    }
                }
            }
            JSObject out = new JSObject();
            out.put("files", files);
            call.resolve(out);
        });
    }

    private void writeAtomic(File f, byte[] data) throws Exception {
        f.getParentFile().mkdirs();
        File tmp = new File(f.getPath() + ".tmp");
        try (FileOutputStream os = new FileOutputStream(tmp)) {
            os.write(data);
            os.getFD().sync();
        }
        if (!tmp.renameTo(f)) {
            f.delete();
            if (!tmp.renameTo(f)) throw new Exception("rename failed");
        }
    }

    @PluginMethod
    public void fsWrite(PluginCall call) {
        io.execute(() -> {
            try {
                String text = call.getString("text", "");
                writeAtomic(dataFile(call.getString("name")), Vault.seal(text).getBytes(StandardCharsets.UTF_8));
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    @PluginMethod
    public void fsWriteBinary(PluginCall call) {
        io.execute(() -> {
            try {
                writeAtomic(dataFile(call.getString("name")), Base64.decode(call.getString("data", ""), Base64.NO_WRAP));
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    @PluginMethod
    public void fsDelete(PluginCall call) {
        try {
            dataFile(call.getString("name")).delete();
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    // ---------- кэш треков (src/cache.js) ----------

    static File cacheDir(Context ctx) {
        File d = new File(ctx.getFilesDir(), "cache-audio");
        d.mkdirs();
        return d;
    }

    private static final java.util.regex.Pattern CACHE_NAME = java.util.regex.Pattern.compile("^[a-f0-9]{24}\\.(mp3|m4a|aac|ogg|webm|flac|jpg)(\\.part)?$");

    static File cacheFile(Context ctx, String name) {
        if (name == null || !CACHE_NAME.matcher(name).matches()) return null;
        return new File(cacheDir(ctx), name);
    }

    // Части (одна ссылка или сегменты HLS) пишутся подряд в один файл, готовый — только целиком
    @PluginMethod
    public void cacheDownload(PluginCall call) {
        io.execute(() -> {
            File file = cacheFile(getContext(), call.getString("name"));
            if (file == null) {
                call.reject("bad cache name");
                return;
            }
            File part = new File(file.getPath() + ".part");
            try {
                JSArray urls = call.getArray("urls", new JSArray());
                OkHttpClient client = Net.get(getContext()).newBuilder().callTimeout(10, TimeUnit.MINUTES).build();
                try (FileOutputStream os = new FileOutputStream(part)) {
                    byte[] buf = new byte[65536];
                    for (int i = 0; i < urls.length(); i++) {
                        Request req = new Request.Builder().url(urls.getString(i)).header("User-Agent", Net.UA).build();
                        try (Response res = client.newCall(req).execute()) {
                            if (!res.isSuccessful() || res.body() == null) throw new Exception("HTTP " + res.code());
                            try (InputStream in = res.body().byteStream()) {
                                int n;
                                while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                            }
                        }
                    }
                }
                if (!part.renameTo(file)) throw new Exception("rename failed");
                JSObject out = new JSObject();
                out.put("size", file.length());
                call.resolve(out);
            } catch (Exception e) {
                part.delete();
                call.reject(e.getMessage());
            }
        });
    }

    @PluginMethod
    public void cacheRemove(PluginCall call) {
        File f = cacheFile(getContext(), call.getString("name"));
        if (f != null) f.delete();
        call.resolve();
    }

    @PluginMethod
    public void cacheClear(PluginCall call) {
        io.execute(() -> {
            File[] list = cacheDir(getContext()).listFiles();
            if (list != null) for (File f : list) f.delete();
            call.resolve();
        });
    }

    @PluginMethod
    public void cacheList(PluginCall call) {
        JSArray files = new JSArray();
        File[] list = cacheDir(getContext()).listFiles();
        if (list != null) {
            for (File f : list) {
                JSObject o = new JSObject();
                o.put("name", f.getName());
                o.put("size", f.length());
                files.put(o);
            }
        }
        JSObject out = new JSObject();
        out.put("files", files);
        call.resolve(out);
    }

    // ---------- музыка на телефоне ----------

    private String audioAlias() {
        return Build.VERSION.SDK_INT >= 33 ? "audio" : "storage";
    }

    @PluginMethod
    public void scanAudio(PluginCall call) {
        if (getPermissionState(audioAlias()) != PermissionState.GRANTED) {
            requestPermissionForAlias(audioAlias(), call, "scanAfterPermission");
            return;
        }
        doScan(call);
    }

    @PermissionCallback
    private void scanAfterPermission(PluginCall call) {
        if (getPermissionState(audioAlias()) != PermissionState.GRANTED) {
            call.reject("Нет доступа к музыке на телефоне — разреши его в настройках Android");
            return;
        }
        doScan(call);
    }

    private void doScan(PluginCall call) {
        io.execute(() -> {
            try {
                List<String> folders = new ArrayList<>();
                JSArray arr = call.getArray("folders", new JSArray());
                for (int i = 0; i < arr.length(); i++) folders.add(arr.getString(i));
                boolean rel = Build.VERSION.SDK_INT >= 29;
                String pathCol = rel ? MediaStore.Audio.Media.RELATIVE_PATH : MediaStore.Audio.Media.DATA;
                StringBuilder where = new StringBuilder(MediaStore.Audio.Media.DURATION + " >= 15000");
                List<String> args = new ArrayList<>();
                boolean all = folders.contains("");
                if (!all && !folders.isEmpty()) {
                    where.append(" AND (");
                    for (int i = 0; i < folders.size(); i++) {
                        if (i > 0) where.append(" OR ");
                        where.append(pathCol).append(" LIKE ?");
                        args.add((rel ? "" : "%/") + folders.get(i) + "%");
                    }
                    where.append(")");
                }
                String[] proj = {
                    MediaStore.Audio.Media._ID, MediaStore.Audio.Media.TITLE, MediaStore.Audio.Media.ARTIST,
                    MediaStore.Audio.Media.ALBUM, MediaStore.Audio.Media.DURATION, MediaStore.Audio.Media.DISPLAY_NAME, pathCol,
                };
                Uri base = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
                JSArray items = new JSArray();
                try (Cursor c = getContext().getContentResolver().query(base, proj, where.toString(), args.toArray(new String[0]), null)) {
                    while (c != null && c.moveToNext()) {
                        JSObject o = new JSObject();
                        o.put("uri", ContentUris.withAppendedId(base, c.getLong(0)).toString());
                        o.put("title", c.getString(1));
                        o.put("artist", c.getString(2));
                        o.put("album", c.getString(3));
                        o.put("duration", c.getLong(4));
                        o.put("name", c.getString(5));
                        o.put("folder", c.getString(6));
                        items.put(o);
                    }
                }
                JSObject out = new JSObject();
                out.put("items", items);
                call.resolve(out);
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    // Системный выбор папки → путь внутри памяти («Music/Rock/»), по нему фильтруем MediaStore
    @PluginMethod
    public void pickFolder(PluginCall call) {
        if (getPermissionState(audioAlias()) != PermissionState.GRANTED) {
            requestPermissionForAlias(audioAlias(), call, "pickFolderAfterPermission");
            return;
        }
        startActivityForResult(call, new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), "folderPicked");
    }

    @PermissionCallback
    private void pickFolderAfterPermission(PluginCall call) {
        if (getPermissionState(audioAlias()) != PermissionState.GRANTED) {
            call.reject("Нет доступа к музыке на телефоне — разреши его в настройках Android");
            return;
        }
        startActivityForResult(call, new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), "folderPicked");
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.resolve(new JSObject());
            return;
        }
        String doc = DocumentsContract.getTreeDocumentId(result.getData().getData()); // «primary:Music/Rock»
        String path = doc.contains(":") ? doc.substring(doc.indexOf(':') + 1) : "";
        if (!path.isEmpty() && !path.endsWith("/")) path += "/";
        JSObject out = new JSObject();
        out.put("path", path);
        call.resolve(out);
    }

    @PluginMethod
    public void pickAudio(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("audio/*");
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(call, i, "audioPicked");
    }

    @ActivityCallback
    private void audioPicked(PluginCall call, ActivityResult result) {
        JSArray items = new JSArray();
        Intent data = result.getData();
        if (result.getResultCode() == android.app.Activity.RESULT_OK && data != null) {
            List<Uri> uris = new ArrayList<>();
            if (data.getClipData() != null) {
                ClipData cd = data.getClipData();
                for (int i = 0; i < cd.getItemCount(); i++) uris.add(cd.getItemAt(i).getUri());
            } else if (data.getData() != null) {
                uris.add(data.getData());
            }
            for (Uri u : uris) {
                try {
                    getContext().getContentResolver().takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                } catch (Exception ignored) {}
                items.put(LocalMedia.info(getContext(), u));
            }
        }
        JSObject out = new JSObject();
        out.put("items", items);
        call.resolve(out);
    }

    @PluginMethod
    public void audioInfo(PluginCall call) {
        io.execute(() -> call.resolve(LocalMedia.info(getContext(), Uri.parse(call.getString("uri")))));
    }

    @PluginMethod
    public void pickImage(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "image/jpeg", "image/png", "image/webp" });
        startActivityForResult(call, i, "imagePicked");
    }

    @ActivityCallback
    private void imagePicked(PluginCall call, ActivityResult result) {
        Intent data = result.getData();
        if (result.getResultCode() != android.app.Activity.RESULT_OK || data == null || data.getData() == null) {
            call.resolve(new JSObject());
            return;
        }
        Uri u = data.getData();
        io.execute(() -> {
            try (InputStream in = getContext().getContentResolver().openInputStream(u)) {
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) {
                    bos.write(buf, 0, n);
                    if (bos.size() > 16 * 1024 * 1024) throw new Exception("Картинка больше 15 МБ");
                }
                JSObject out = new JSObject();
                out.put("data", Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP));
                String type = getContext().getContentResolver().getType(u);
                out.put("type", type == null ? "image/jpeg" : type);
                call.resolve(out);
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    // ---------- голос диджея волны (renderer/wave.js): в WebView нет speechSynthesis ----------

    private android.speech.tts.TextToSpeech tts;
    private boolean ttsReady = false;
    private final java.util.Map<String, PluginCall> speaking = new java.util.HashMap<>();

    private void ensureTts(Runnable then) {
        if (tts != null) { if (ttsReady) then.run(); else main.postDelayed(() -> ensureTts(then), 200); return; }
        tts = new android.speech.tts.TextToSpeech(getContext(), (status) -> {
            ttsReady = status == android.speech.tts.TextToSpeech.SUCCESS;
            if (ttsReady) {
                tts.setLanguage(new Locale("ru", "RU"));
                tts.setOnUtteranceProgressListener(new android.speech.tts.UtteranceProgressListener() {
                    @Override public void onStart(String id) {}
                    @Override public void onDone(String id) { finish(id); }
                    @Override public void onError(String id) { finish(id); }
                    private void finish(String id) {
                        PluginCall c;
                        synchronized (speaking) { c = speaking.remove(id); }
                        if (c != null) c.resolve();
                    }
                });
            }
            then.run();
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        float rate = call.getFloat("rate", 1f);
        float pitch = call.getFloat("pitch", 1f);
        ensureTts(() -> {
            if (!ttsReady || text.isEmpty()) { call.resolve(); return; }
            String id = "w" + System.nanoTime();
            synchronized (speaking) { speaking.put(id, call); }
            tts.setSpeechRate(rate);
            tts.setPitch(pitch);
            tts.speak(text, android.speech.tts.TextToSpeech.QUEUE_FLUSH, null, id);
        });
    }

    @PluginMethod
    public void stopSpeak(PluginCall call) {
        if (tts != null) tts.stop();
        synchronized (speaking) {
            for (PluginCall c : speaking.values()) c.resolve();
            speaking.clear();
        }
        call.resolve();
    }

    // ---------- мелочи ----------

    @PluginMethod
    public void openUrl(PluginCall call) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(call.getString("url")));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Не нашлось приложения, чтобы открыть ссылку");
        }
    }

    @PluginMethod
    public void copy(PluginCall call) {
        ClipboardManager cm = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
        cm.setPrimaryClip(ClipData.newPlainText("авеон", call.getString("text", "")));
        call.resolve();
    }

    @PluginMethod
    public void deviceName(PluginCall call) {
        String maker = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER;
        String model = Build.MODEL == null ? "Android" : Build.MODEL;
        String name = model.toLowerCase(Locale.ROOT).startsWith(maker.toLowerCase(Locale.ROOT)) ? model : maker + " " + model;
        JSObject o = new JSObject();
        o.put("name", name.trim());
        call.resolve(o);
    }

    @PluginMethod
    public void setFullscreen(PluginCall call) {
        boolean on = call.getBoolean("on", false);
        getActivity().runOnUiThread(() -> {
            Window w = getActivity().getWindow();
            WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
            c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            if (on) c.hide(WindowInsetsCompat.Type.systemBars());
            else c.show(WindowInsetsCompat.Type.systemBars());
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        main.removeCallbacksAndMessages(null);
        if (tts != null) { tts.shutdown(); tts = null; }
        if (instance == this) instance = null;
        super.handleOnDestroy();
    }
}
