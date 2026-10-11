package com.aveon.player

import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.ui.platform.ComposeView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.aveon.player.ui.AveonApp
import com.getcapacitor.BridgeActivity

/**
 * Движок (тот же плеер, что на компьютере) — в WebView Capacitor, интерфейс — Compose поверх него.
 * WebView остаётся «видимым» под экраном: так звук, бочка и таймеры работают как обычно,
 * а касания до него не доходят — всё рисует и ловит Compose.
 */
class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(AveonPlugin::class.java)
        super.onCreate(savedInstanceState)
        val web = bridge.webView
        // Свои файлы, обложки и CORS для медиа — см. AveonWebViewClient
        bridge.setWebViewClient(AveonWebViewClient(bridge))
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.settings.useWideViewPort = true // renderer/native.js раскладывает скрытую разметку на 1280 px
        // Звук и бочка должны работать и со свёрнутым приложением
        if (Build.VERSION.SDK_INT >= 26) web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
        web.setOnTouchListener { _, _ -> true }
        web.isFocusable = false

        WindowCompat.setDecorFitsSystemWindows(window, false)
        @Suppress("DEPRECATION")
        run {
            window.statusBarColor = Color.TRANSPARENT
            window.navigationBarColor = Color.TRANSPARENT
        }
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
        addContentView(
            ComposeView(this).apply { setContent { AveonApp() } },
            ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
        Widgets.fromIntent(intent)
    }

    // JS-мост нужен до загрузки страницы — ставим его, когда разметка уже есть, а мост Capacitor ещё нет
    override fun load() {
        findViewById<WebView>(com.getcapacitor.android.R.id.webview)?.let { Engine.attach(this, it) }
        super.load()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        Widgets.fromIntent(intent)
    }

    override fun onDestroy() {
        Engine.detach()
        super.onDestroy()
    }
}
