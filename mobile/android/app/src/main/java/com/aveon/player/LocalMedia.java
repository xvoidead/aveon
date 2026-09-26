package com.aveon.player;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.util.LruCache;
import android.util.Size;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.util.regex.Pattern;

/** Свои файлы: обложки из тегов, свои обложки из редактора тегов, теги отдельного файла. */
final class LocalMedia {
    private static final Pattern ART_NAME = Pattern.compile("^[a-f0-9]{40}-\\d+\\.(jpg|png|webp)$");
    private static final byte[] NONE = new byte[0];
    private static final LruCache<String, byte[]> covers = new LruCache<String, byte[]>(24 * 1024 * 1024) {
        @Override
        protected int sizeOf(String key, byte[] value) {
            return Math.max(1, value.length);
        }
    };

    private LocalMedia() {}

    static boolean allowed(String uri) {
        return uri != null && uri.startsWith("content://");
    }

    /** Картинка из тегов файла, иначе миниатюра альбома от системы; null — обложки нет. */
    static byte[] cover(Context ctx, String uri) {
        if (!allowed(uri)) return null;
        byte[] hit = covers.get(uri);
        if (hit != null) return hit.length == 0 ? null : hit;
        byte[] out = null;
        MediaMetadataRetriever r = new MediaMetadataRetriever();
        try {
            r.setDataSource(ctx, Uri.parse(uri));
            out = r.getEmbeddedPicture();
        } catch (Exception ignored) {
        } finally {
            try { r.release(); } catch (Exception ignored) {}
        }
        if (out == null && Build.VERSION.SDK_INT >= 29) {
            try {
                Bitmap b = ctx.getContentResolver().loadThumbnail(Uri.parse(uri), new Size(512, 512), null);
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                b.compress(Bitmap.CompressFormat.JPEG, 88, bos);
                out = bos.toByteArray();
            } catch (Exception ignored) {}
        }
        covers.put(uri, out == null ? NONE : out);
        return out;
    }

    static File art(Context ctx, String name) {
        if (name == null || !ART_NAME.matcher(name).matches()) return null;
        File f = new File(new File(new File(ctx.getFilesDir(), "aveon"), "covers"), name);
        return f.isFile() ? f : null;
    }

    static String mime(byte[] b) {
        if (b.length > 3 && (b[0] & 0xff) == 0x89 && b[1] == 'P') return "image/png";
        if (b.length > 11 && b[8] == 'W' && b[9] == 'E' && b[10] == 'B') return "image/webp";
        return "image/jpeg";
    }

    static String mimeOfName(String name) {
        if (name.endsWith(".png")) return "image/png";
        if (name.endsWith(".webp")) return "image/webp";
        return "image/jpeg";
    }

    /** Теги файла, выбранного вручную (MediaStore о нём может не знать). */
    static com.getcapacitor.JSObject info(Context ctx, Uri uri) {
        com.getcapacitor.JSObject o = new com.getcapacitor.JSObject();
        o.put("uri", uri.toString());
        ContentResolver cr = ctx.getContentResolver();
        try (Cursor c = cr.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) o.put("name", c.getString(0));
        } catch (Exception ignored) {}
        MediaMetadataRetriever r = new MediaMetadataRetriever();
        try {
            r.setDataSource(ctx, uri);
            o.put("title", nz(r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE)));
            String artist = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST);
            if (artist == null) artist = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST);
            o.put("artist", nz(artist));
            o.put("album", nz(r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM)));
            String d = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            o.put("duration", d == null ? 0 : Long.parseLong(d));
            o.put("hasArt", r.getEmbeddedPicture() != null);
        } catch (Exception ignored) {
        } finally {
            try { r.release(); } catch (Exception ignored) {}
        }
        return o;
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }
}
