package com.aveon.player;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.net.Uri;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * Что в Electron делают протокол media:// и allowCors() в main.js:
 *  - /_media/local?p=content://…  — свой файл с перемоткой (Range);
 *  - /_media/cover?p=…, /_media/art?f=… — обложка из тегов и своя обложка;
 *  - /_media/cache?f=… — трек из кэша (src/cache.js);
 *  - картинки, аудио и HLS-сегменты с чужих сайтов качаются здесь и получают
 *    Access-Control-Allow-Origin — без него Web Audio (бочка, эквалайзер, спектр) слышит тишину,
 *    а палитра не может прочитать обложку.
 */
public class AveonWebViewClient extends BridgeWebViewClient {
    private static final Pattern RANGE = Pattern.compile("bytes=(\\d*)-(\\d*)");
    private final Context ctx;

    public AveonWebViewClient(Bridge bridge) {
        super(bridge);
        this.ctx = bridge.getContext().getApplicationContext();
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        String scheme = url.getScheme();
        String host = url.getHost();
        if ("localhost".equals(host)) {
            String path = url.getPath();
            if (path != null && path.startsWith("/_media/")) {
                try {
                    return media(path.substring(8), url, request);
                } catch (Exception e) {
                    return status(500, "Internal Server Error");
                }
            }
            return super.shouldInterceptRequest(view, request);
        }
        if (("https".equals(scheme) || "http".equals(scheme)) && "GET".equals(request.getMethod()) && !request.isForMainFrame()) {
            try {
                return proxy(request);
            } catch (Exception e) {
                return null; // пусть WebView попробует сам
            }
        }
        return super.shouldInterceptRequest(view, request);
    }

    // ---- свои файлы ----

    private WebResourceResponse media(String kind, Uri url, WebResourceRequest req) throws IOException {
        switch (kind) {
            case "local": {
                String p = url.getQueryParameter("p");
                if (!LocalMedia.allowed(p)) return status(403, "Forbidden");
                return file(Uri.parse(p), header(req, "Range"));
            }
            case "cache": {
                File f = AveonPlugin.cacheFile(ctx, url.getQueryParameter("f"));
                if (f == null || !f.isFile() || f.getName().endsWith(".part")) return status(404, "Not Found");
                return file(Uri.fromFile(f), header(req, "Range"));
            }
            case "cover": {
                byte[] b = LocalMedia.cover(ctx, url.getQueryParameter("p"));
                if (b == null) return status(404, "Not Found");
                return bytes(b, LocalMedia.mime(b), "max-age=86400");
            }
            case "art": {
                String name = url.getQueryParameter("f");
                File f = LocalMedia.art(ctx, name);
                if (f == null) return status(404, "Not Found");
                Map<String, String> h = cors();
                h.put("Cache-Control", "max-age=31536000");
                h.put("Content-Length", String.valueOf(f.length()));
                return new WebResourceResponse(LocalMedia.mimeOfName(name), null, 200, "OK", h, new FileInputStream(f));
            }
            default:
                return status(404, "Not Found");
        }
    }

    private WebResourceResponse file(Uri uri, String range) throws IOException {
        String type = "file".equals(uri.getScheme()) ? byExt(uri.getPath()) : ctx.getContentResolver().getType(uri);
        if (type == null || !type.startsWith("audio")) {
            String ext = MimeTypeMap.getFileExtensionFromUrl(uri.toString());
            String guess = ext == null ? null : MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.toLowerCase(Locale.ROOT));
            type = guess != null ? guess : "audio/mpeg";
        }
        AssetFileDescriptor fd = ctx.getContentResolver().openAssetFileDescriptor(uri, "r");
        if (fd == null) return status(404, "Not Found");
        long size = fd.getLength();
        InputStream in = fd.createInputStream();
        if (size < 0) size = in.available();
        Map<String, String> h = cors();
        h.put("Accept-Ranges", "bytes");
        Matcher m = range == null ? null : RANGE.matcher(range);
        if (m != null && m.find() && (!m.group(1).isEmpty() || !m.group(2).isEmpty())) {
            long start = m.group(1).isEmpty() ? size - Long.parseLong(m.group(2)) : Long.parseLong(m.group(1));
            long end = !m.group(1).isEmpty() && !m.group(2).isEmpty() ? Long.parseLong(m.group(2)) : size - 1;
            start = Math.max(0, start);
            end = Math.min(end, size - 1);
            if (start > end) {
                in.close();
                h.put("Content-Range", "bytes */" + size);
                return new WebResourceResponse(type, null, 416, "Range Not Satisfiable", h, new ByteArrayInputStream(new byte[0]));
            }
            long skipped = 0;
            while (skipped < start) {
                long s = in.skip(start - skipped);
                if (s <= 0) break;
                skipped += s;
            }
            long len = end - start + 1;
            h.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
            h.put("Content-Length", String.valueOf(len));
            return new WebResourceResponse(type, null, 206, "Partial Content", h, new Limited(in, len));
        }
        h.put("Content-Length", String.valueOf(size));
        return new WebResourceResponse(type, null, 200, "OK", h, in);
    }

    // Файлы кэша: тип по расширению — таблица Android путает m4a и aac
    private static String byExt(String path) {
        if (path == null) return null;
        if (path.endsWith(".mp3")) return "audio/mpeg";
        if (path.endsWith(".m4a")) return "audio/mp4";
        if (path.endsWith(".aac")) return "audio/aac";
        if (path.endsWith(".ogg")) return "audio/ogg";
        if (path.endsWith(".webm")) return "audio/webm";
        if (path.endsWith(".flac")) return "audio/flac";
        return null;
    }

    // ---- чужие сайты: с CORS ----

    private WebResourceResponse proxy(WebResourceRequest req) throws IOException {
        Request.Builder b = new Request.Builder().url(req.getUrl().toString());
        for (Map.Entry<String, String> e : req.getRequestHeaders().entrySet()) {
            String k = e.getKey().toLowerCase(Locale.ROOT);
            if (k.equals("origin") || k.equals("referer") || k.startsWith("sec-") || k.equals("accept-encoding") || k.startsWith("if-")) continue;
            b.header(e.getKey(), e.getValue());
        }
        if (header(req, "User-Agent") == null) b.header("User-Agent", Net.UA);
        Response res = Net.get(ctx).newCall(b.build()).execute();
        ResponseBody body = res.body();
        Map<String, String> h = new HashMap<>();
        for (String name : res.headers().names()) {
            String k = name.toLowerCase(Locale.ROOT);
            if (k.startsWith("access-control-") || k.equals("content-encoding") || k.equals("transfer-encoding") || k.equals("set-cookie")) continue;
            h.put(name, res.header(name));
        }
        h.putAll(cors());
        String ct = res.header("Content-Type", "application/octet-stream");
        String mime = ct.split(";")[0].trim();
        String charset = null;
        int ci = ct.toLowerCase(Locale.ROOT).indexOf("charset=");
        if (ci >= 0) charset = ct.substring(ci + 8).trim();
        int code = res.code();
        String reason = res.message().isEmpty() ? reasonOf(code) : res.message();
        InputStream in = body == null ? new ByteArrayInputStream(new byte[0]) : body.byteStream();
        return new WebResourceResponse(mime, charset, code, reason, h, in);
    }

    // ---- мелочи ----

    private static String header(WebResourceRequest req, String name) {
        for (Map.Entry<String, String> e : req.getRequestHeaders().entrySet()) {
            if (e.getKey().equalsIgnoreCase(name)) return e.getValue();
        }
        return null;
    }

    private static Map<String, String> cors() {
        Map<String, String> h = new HashMap<>();
        h.put("Access-Control-Allow-Origin", "*");
        return h;
    }

    private static WebResourceResponse bytes(byte[] b, String type, String cache) {
        Map<String, String> h = cors();
        h.put("Cache-Control", cache);
        h.put("Content-Length", String.valueOf(b.length));
        return new WebResourceResponse(type, null, 200, "OK", h, new ByteArrayInputStream(b));
    }

    private static WebResourceResponse status(int code, String reason) {
        return new WebResourceResponse("text/plain", "utf-8", code, reason, cors(), new ByteArrayInputStream(new byte[0]));
    }

    private static String reasonOf(int code) {
        if (code == 200) return "OK";
        if (code == 206) return "Partial Content";
        if (code == 304) return "Not Modified";
        if (code == 404) return "Not Found";
        return code < 400 ? "OK" : "Error";
    }

    /** Поток, который отдаёт не больше len байт — хвост диапазона Range. */
    private static final class Limited extends FilterInputStream {
        private long left;

        Limited(InputStream in, long len) {
            super(in);
            left = len;
        }

        @Override
        public int read() throws IOException {
            if (left <= 0) return -1;
            int r = super.read();
            if (r >= 0) left--;
            return r;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            if (left <= 0) return -1;
            int r = super.read(b, off, (int) Math.min(len, left));
            if (r > 0) left -= r;
            return r;
        }
    }
}
