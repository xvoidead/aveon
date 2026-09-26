package com.aveon.player;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import okhttp3.Request;
import okhttp3.Response;

/**
 * Уведомление «сейчас играет» с кнопками и экран блокировки (MediaSession). Пока музыка играет,
 * сервис держит приложение на переднем плане — иначе Android остановит WebView со звуком в фоне.
 * Кнопка «в бочку» включает эффект вручную: звук чужого звонка Android приложениям не отдаёт.
 */
public class MediaService extends Service {
    static final String CHANNEL = "playback";
    static final int ID = 1;
    static final String ACTION = "com.aveon.player.MEDIA";

    /** Последнее состояние из окна: title, artist, album, cover, playing, pos, duration, barrel. */
    static volatile State state = new State();
    private static MediaService instance;

    private MediaSessionCompat session;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private String coverKey = null;
    private Bitmap coverBmp = null;
    private boolean foreground = false;
    private boolean everForeground = false;

    static final class State {
        boolean hasTrack, playing, barrel;
        String title = "", artist = "", album = "", cover = "";
        double pos, duration;
        long at = System.currentTimeMillis();
    }

    static void update(Context ctx, State s) {
        state = s;
        if (!s.hasTrack) {
            if (instance != null) instance.shutdown();
            return;
        }
        if (instance != null) {
            instance.refresh();
            return;
        }
        if (!s.playing) return; // не будим сервис ради трека на паузе
        Intent i = new Intent(ctx, MediaService.class);
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
        else ctx.startService(i);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Сейчас играет", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        session = new MediaSessionCompat(this, "aveon");
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { AveonPlugin.media("play", 0); }
            @Override public void onPause() { AveonPlugin.media("pause", 0); }
            @Override public void onSkipToNext() { AveonPlugin.media("next", 0); }
            @Override public void onSkipToPrevious() { AveonPlugin.media("prev", 0); }
            @Override public void onSeekTo(long ms) { AveonPlugin.media("seek", ms / 1000.0); }
            @Override public void onCustomAction(String action, android.os.Bundle extras) {
                if ("barrel".equals(action)) AveonPlugin.media("barrel", 0);
            }
        });
        session.setSessionActivity(openApp());
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent == null ? null : intent.getStringExtra("a");
        if (a != null) AveonPlugin.media(a, 0);
        refresh();
        return START_NOT_STICKY;
    }

    private PendingIntent openApp() {
        Intent i = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private PendingIntent action(String a, int code) {
        Intent i = new Intent(this, MediaService.class).putExtra("a", a);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    void refresh() {
        main.post(this::apply);
    }

    private void apply() {
        State s = state;
        if (!s.hasTrack) {
            shutdown();
            return;
        }
        loadCover(s.cover);

        MediaMetadataCompat.Builder md = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, s.title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, s.artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, s.album)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, (long) (s.duration * 1000));
        if (coverBmp != null) md.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, coverBmp);
        session.setMetadata(md.build());

        PlaybackStateCompat.Builder pb = new PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE | PlaybackStateCompat.ACTION_PLAY_PAUSE |
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS | PlaybackStateCompat.ACTION_SEEK_TO
            )
            .setState(
                s.playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                (long) (s.pos * 1000),
                s.playing ? 1f : 0f,
                android.os.SystemClock.elapsedRealtime() - (System.currentTimeMillis() - s.at)
            )
            .addCustomAction(new PlaybackStateCompat.CustomAction.Builder(
                "barrel", s.barrel ? "Из бочки" : "В бочку", s.barrel ? R.drawable.ic_barrel_on : R.drawable.ic_barrel).build());
        session.setPlaybackState(pb.build());

        NotificationCompat.Builder nb = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_aveon)
            .setContentTitle(s.title)
            .setContentText(s.artist)
            .setSubText(s.barrel ? "в бочке" : null)
            .setLargeIcon(coverBmp)
            .setContentIntent(openApp())
            .setDeleteIntent(action("pause", 9))
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setOngoing(s.playing)
            .addAction(R.drawable.ic_prev, "Назад", action("prev", 1))
            .addAction(s.playing ? R.drawable.ic_pause : R.drawable.ic_play, s.playing ? "Пауза" : "Играть", action(s.playing ? "pause" : "play", 2))
            .addAction(R.drawable.ic_next, "Дальше", action("next", 3))
            .addAction(s.barrel ? R.drawable.ic_barrel_on : R.drawable.ic_barrel, s.barrel ? "Из бочки" : "В бочку", action("barrel", 4))
            .setStyle(new MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        Notification n = nb.build();

        // startForegroundService обязывает показать уведомление сразу, даже если уже поставили на паузу
        if (s.playing || !everForeground) {
            everForeground = true;
            int type = Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0;
            try {
                ServiceCompat.startForeground(this, ID, n, type);
                foreground = true;
            } catch (Exception e) {
                getSystemService(NotificationManager.class).notify(ID, n);
            }
        }
        if (!s.playing) {
            if (foreground) {
                ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH);
                foreground = false;
            }
            getSystemService(NotificationManager.class).notify(ID, n);
        }
    }

    // Обложка: свой файл (/_media/…) читаем сами, ссылку из интернета — через общий HTTP-клиент
    private void loadCover(String url) {
        String key = url == null ? "" : url;
        if (key.equals(coverKey)) return;
        coverKey = key;
        coverBmp = null;
        if (key.isEmpty()) return;
        io.execute(() -> {
            Bitmap b = null;
            try {
                Uri u = Uri.parse(key);
                byte[] data = null;
                if ("localhost".equals(u.getHost()) && u.getPath() != null && u.getPath().startsWith("/_media/cover")) {
                    data = LocalMedia.cover(this, u.getQueryParameter("p"));
                } else if ("localhost".equals(u.getHost()) && u.getPath() != null && u.getPath().startsWith("/_media/art")) {
                    File f = LocalMedia.art(this, u.getQueryParameter("f"));
                    if (f != null) data = java.nio.file.Files.readAllBytes(f.toPath());
                } else if (key.startsWith("http")) {
                    try (Response r = Net.get(this).newCall(new Request.Builder().url(key).header("User-Agent", Net.UA).build()).execute()) {
                        if (r.isSuccessful() && r.body() != null) data = r.body().bytes();
                    }
                }
                if (data != null) {
                    b = BitmapFactory.decodeByteArray(data, 0, data.length);
                    if (b != null && b.getWidth() > 512) b = Bitmap.createScaledBitmap(b, 512, 512 * b.getHeight() / b.getWidth(), true);
                }
            } catch (Exception ignored) {}
            Bitmap done = b;
            main.post(() -> {
                if (!key.equals(coverKey)) return;
                coverBmp = done;
                apply();
            });
        });
    }

    void shutdown() {
        main.post(() -> {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
            foreground = false;
            getSystemService(NotificationManager.class).cancel(ID);
            stopSelf();
        });
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Смахнули приложение из недавних — уведомление больше не управляет ничем
        shutdown();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        instance = null;
        session.setActive(false);
        session.release();
        io.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
