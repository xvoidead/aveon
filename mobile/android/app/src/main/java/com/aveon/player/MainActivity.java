package com.aveon.player;

import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AveonPlugin.class);
        super.onCreate(savedInstanceState);
        WebView web = bridge.getWebView();
        // Свои файлы, обложки и CORS для медиа — см. AveonWebViewClient
        bridge.setWebViewClient(new AveonWebViewClient(bridge));
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        // Звук и бочка должны работать и со свёрнутым приложением
        if (Build.VERSION.SDK_INT >= 26) web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
    }
}
