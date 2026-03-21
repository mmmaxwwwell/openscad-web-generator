package io.github.mmmaxwwwell.openscadweb;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {

    private static final String APP_URL = "https://appassets.androidplatform.net/assets/webapp/index.html";
    private static final String TAG = "OpenSCADWeb";
    private WebView webView;
    private NsdManager nsdManager;
    private WifiManager.MulticastLock multicastLock;
    private final List<NsdServiceInfo> discoveredServices = new ArrayList<>();
    private NsdManager.DiscoveryListener currentDiscoveryListener;
    private int resolveCount = 0;
    private int resolvedCount = 0;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        WebView.setWebContentsDebuggingEnabled(true);

        webView = new WebView(this);
        webView.setFitsSystemWindows(true);
        setContentView(webView);

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSupportZoom(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse response = assetLoader.shouldInterceptRequest(request.getUrl());
                if (response != null) {
                    return response;
                }
                return super.shouldInterceptRequest(view, request);
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                String level;
                switch (consoleMessage.messageLevel()) {
                    case ERROR: level = "E"; break;
                    case WARNING: level = "W"; break;
                    default: level = "D"; break;
                }
                Log.println(
                    level.equals("E") ? Log.ERROR : level.equals("W") ? Log.WARN : Log.DEBUG,
                    "WebConsole",
                    consoleMessage.message() + " [" + consoleMessage.sourceId() + ":" + consoleMessage.lineNumber() + "]"
                );
                return true;
            }
        });
        webView.addJavascriptInterface(new PrinterDiscoveryBridge(), "AndroidPrinterDiscovery");
        webView.addJavascriptInterface(new BackHandlerBridge(), "AndroidBackHandler");

        // Register native slicer bridge if JNI library is available
        try {
            webView.addJavascriptInterface(new SlicerBridge(webView), "NativeSlicer");
            Log.i(TAG, "Native slicer bridge registered");
        } catch (UnsatisfiedLinkError e) {
            Log.i(TAG, "Native slicer not available (JNI library not present), using WASM fallback");
        }

        nsdManager = (NsdManager) getSystemService(Context.NSD_SERVICE);

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(APP_URL);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        // Dispatch a custom event to the React app; if it calls
        // window.AndroidBackHandler.exitApp(), we actually close.
        webView.evaluateJavascript(
            "(function() {" +
            "  var e = new Event('androidBackPressed');" +
            "  var handled = !window.dispatchEvent(e);" +
            "  if (!handled && typeof window.__onAndroidBack === 'function') { handled = window.__onAndroidBack(); }" +
            "  if (!handled) { window.AndroidBackHandler.exitApp(); }" +
            "})();",
            null
        );
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        releaseMulticastLock();
    }

    private void acquireMulticastLock() {
        if (multicastLock == null) {
            WifiManager wifiManager = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            multicastLock = wifiManager.createMulticastLock("openscad-nsd");
            multicastLock.setReferenceCounted(false);
        }
        multicastLock.acquire();
    }

    private void releaseMulticastLock() {
        if (multicastLock != null && multicastLock.isHeld()) {
            multicastLock.release();
        }
    }

    private class PrinterDiscoveryBridge {

        @JavascriptInterface
        public boolean isAvailable() {
            return true;
        }

        @JavascriptInterface
        public boolean allowsCleartextTraffic() {
            return true;
        }

        @JavascriptInterface
        public void discoverPrinters(String callbackName) {
            Log.d(TAG, "Starting mDNS printer discovery");
            discoveredServices.clear();
            resolveCount = 0;
            resolvedCount = 0;

            acquireMulticastLock();

            // Search for Moonraker instances (_moonraker._tcp) and generic HTTP services
            String[] serviceTypes = {"_moonraker._tcp.", "_octoprint._tcp.", "_http._tcp."};
            final int[] completedDiscoveries = {0};
            final int totalDiscoveries = serviceTypes.length;

            for (String serviceType : serviceTypes) {
                startDiscovery(serviceType, callbackName, completedDiscoveries, totalDiscoveries);
            }

            // Timeout after 5 seconds — stop discovery and return results
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                stopAllDiscovery();
                sendResultsToWebView(callbackName);
            }, 5000);
        }

        private void startDiscovery(String serviceType, String callbackName, int[] completedDiscoveries, int totalDiscoveries) {
            NsdManager.DiscoveryListener listener = new NsdManager.DiscoveryListener() {
                @Override
                public void onStartDiscoveryFailed(String serviceType, int errorCode) {
                    Log.e(TAG, "Discovery start failed for " + serviceType + ": " + errorCode);
                }

                @Override
                public void onStopDiscoveryFailed(String serviceType, int errorCode) {
                    Log.e(TAG, "Discovery stop failed for " + serviceType + ": " + errorCode);
                }

                @Override
                public void onDiscoveryStarted(String serviceType) {
                    Log.d(TAG, "Discovery started for " + serviceType);
                }

                @Override
                public void onDiscoveryStopped(String serviceType) {
                    Log.d(TAG, "Discovery stopped for " + serviceType);
                }

                @Override
                public void onServiceFound(NsdServiceInfo serviceInfo) {
                    Log.d(TAG, "Service found: " + serviceInfo.getServiceName() + " type: " + serviceInfo.getServiceType());
                    synchronized (discoveredServices) {
                        resolveCount++;
                        discoveredServices.add(serviceInfo);
                    }
                    // Resolve to get host and port
                    nsdManager.resolveService(serviceInfo, new NsdManager.ResolveListener() {
                        @Override
                        public void onResolveFailed(NsdServiceInfo serviceInfo, int errorCode) {
                            Log.e(TAG, "Resolve failed for " + serviceInfo.getServiceName() + ": " + errorCode);
                            synchronized (discoveredServices) {
                                resolvedCount++;
                            }
                        }

                        @Override
                        public void onServiceResolved(NsdServiceInfo resolvedInfo) {
                            Log.d(TAG, "Resolved: " + resolvedInfo.getServiceName() +
                                    " at " + resolvedInfo.getHost().getHostAddress() +
                                    ":" + resolvedInfo.getPort());
                            synchronized (discoveredServices) {
                                // Replace unresolved with resolved
                                for (int i = 0; i < discoveredServices.size(); i++) {
                                    if (discoveredServices.get(i).getServiceName().equals(resolvedInfo.getServiceName())) {
                                        discoveredServices.set(i, resolvedInfo);
                                        break;
                                    }
                                }
                                resolvedCount++;
                            }
                        }
                    });
                }

                @Override
                public void onServiceLost(NsdServiceInfo serviceInfo) {
                    Log.d(TAG, "Service lost: " + serviceInfo.getServiceName());
                }
            };

            try {
                nsdManager.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, listener);
                synchronized (discoveredServices) {
                    currentDiscoveryListener = listener;
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to start discovery for " + serviceType, e);
            }
        }
    }

    private class BackHandlerBridge {
        @JavascriptInterface
        public void exitApp() {
            new Handler(Looper.getMainLooper()).post(() -> {
                MainActivity.super.onBackPressed();
            });
        }
    }

    private void stopAllDiscovery() {
        // NsdManager only allows one active discovery per listener, but we handle cleanup
        releaseMulticastLock();
    }

    private void sendResultsToWebView(String callbackName) {
        try {
            JSONArray results = new JSONArray();
            synchronized (discoveredServices) {
                for (NsdServiceInfo info : discoveredServices) {
                    if (info.getHost() == null) continue; // Skip unresolved
                    JSONObject obj = new JSONObject();
                    obj.put("name", info.getServiceName());
                    obj.put("host", info.getHost().getHostAddress());
                    obj.put("port", info.getPort());
                    obj.put("type", info.getServiceType());
                    results.put(obj);
                }
            }
            final String js = callbackName + "(" + results.toString() + ");";
            Log.d(TAG, "Sending results to WebView: " + js);
            new Handler(Looper.getMainLooper()).post(() -> {
                webView.evaluateJavascript(js, null);
            });
        } catch (Exception e) {
            Log.e(TAG, "Error sending results", e);
        }
    }
}
