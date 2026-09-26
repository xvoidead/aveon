package com.aveon.player

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import android.util.LruCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.Request
import java.util.concurrent.ConcurrentHashMap

/**
 * Картинки для Compose: обложки из сервисов (OkHttp с общим кэшем), свои файлы и обложки из тегов
 * (адреса https://localhost/_media/… — те же, что обслуживает AveonWebViewClient), data:-адреса.
 * Держим в памяти уменьшенные копии; одна и та же картинка грузится один раз.
 */
object Images {
    private val cache = object : LruCache<String, Bitmap>(48 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
    }
    private val locks = ConcurrentHashMap<String, Mutex>()

    fun cached(url: String, size: Int): Bitmap? = cache.get("$size|$url")

    suspend fun load(ctx: Context, url: String, size: Int): Bitmap? {
        if (url.isBlank()) return null
        val key = "$size|$url"
        cache.get(key)?.let { return it }
        val lock = locks.getOrPut(key) { Mutex() }
        return lock.withLock {
            cache.get(key) ?: withContext(Dispatchers.IO) {
                try {
                    bytes(ctx, url)?.let { decode(it, size) }?.also { cache.put(key, it) }
                } catch (e: Exception) {
                    null
                }
            }
        }.also { locks.remove(key) }
    }

    private fun bytes(ctx: Context, url: String): ByteArray? {
        if (url.startsWith("data:")) {
            val comma = url.indexOf(',')
            if (comma < 0) return null
            val meta = url.substring(5, comma)
            val data = url.substring(comma + 1)
            return if (meta.endsWith(";base64")) Base64.decode(data, Base64.DEFAULT) else Uri.decode(data).toByteArray()
        }
        val u = Uri.parse(url)
        if (u.host == "localhost") {
            val path = u.path ?: return null
            return when (path) {
                "/_media/cover" -> LocalMedia.cover(ctx, u.getQueryParameter("p"))?.takeIf { it.isNotEmpty() }
                "/_media/art" -> LocalMedia.art(ctx, u.getQueryParameter("f"))?.readBytes()
                else -> null
            }
        }
        if (u.scheme != "http" && u.scheme != "https") return null
        val req = Request.Builder().url(url).header("User-Agent", Net.UA).build()
        Net.get(ctx).newCall(req).execute().use { r ->
            if (!r.isSuccessful) return null
            return r.body?.bytes()
        }
    }

    private fun decode(b: ByteArray, size: Int): Bitmap? {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(b, 0, b.size, o)
        var sample = 1
        val side = maxOf(o.outWidth, o.outHeight)
        while (side / (sample * 2) >= size) sample *= 2
        return BitmapFactory.decodeByteArray(b, 0, b.size, BitmapFactory.Options().apply { inSampleSize = sample })
    }
}
