package com.aveon.player;

import android.content.Context;
import java.io.File;
import java.util.concurrent.TimeUnit;
import okhttp3.Cache;
import okhttp3.OkHttpClient;

/** Общий HTTP-клиент: запросы src/ (AveonPlugin.fetch), медиа и картинки для WebView, обложки уведомления. */
final class Net {
    private static OkHttpClient client;

    static final String UA =
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

    private Net() {}

    static synchronized OkHttpClient get(Context ctx) {
        if (client == null) {
            client = new OkHttpClient.Builder()
                .cache(new Cache(new File(ctx.getCacheDir(), "http"), 80L * 1024 * 1024))
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .followRedirects(true)
                .followSslRedirects(true)
                .retryOnConnectionFailure(true)
                .build();
        }
        return client;
    }
}
