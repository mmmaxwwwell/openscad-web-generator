// SPDX-License-Identifier: AGPL-3.0-or-later
package io.github.mmmaxwwwell.openscadweb;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import java.io.File;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * WebView JavaScript interface for native OrcaSlicer slicing on Android.
 * Registered as "NativeSlicer" — JS side checks window.NativeSlicer availability.
 *
 * Calls JNI methods (slicer_jni.cpp) on a background thread and reports
 * progress/results back to JS via evaluateJavascript.
 */
public class SlicerBridge {

    private static final String TAG = "SlicerBridge";

    private final WebView webView;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final ConcurrentHashMap<String, Future<?>> activeTasks = new ConcurrentHashMap<>();

    // Native methods — implemented in jni/slicer_jni.cpp
    private native void nativeCreate();
    private native void nativeLoadSTL(String path);
    private native void nativeLoad3MF(String path);
    private native void nativeSetConfig(String configJson);
    private native void nativeSlice();
    private native void nativeExportGCode(String outputPath);
    private native void nativeDestroy();

    static {
        System.loadLibrary("slicer_jni");
    }

    public SlicerBridge(WebView webView) {
        this.webView = webView;
    }

    /**
     * Check if native slicer is available.
     * JS side uses this to decide between native and WASM backends.
     */
    @JavascriptInterface
    public boolean isAvailable() {
        return true;
    }

    /**
     * Returns the engine name for UI display.
     */
    @JavascriptInterface
    public String engineName() {
        return "Native ARM";
    }

    /**
     * Slice a model file asynchronously.
     *
     * @param inputPath  Absolute path to STL or 3MF file in app-internal storage
     * @param configJson JSON string of OrcaSlicer config key-value pairs
     * @param callbackId Unique ID for correlating progress/result callbacks
     *
     * JS callbacks:
     *   window.onSlicerProgress(callbackId, stage, progress)  — stage updates
     *   window.onSlicerResult(callbackId, gcodePath)          — success
     *   window.onSlicerError(callbackId, message)             — failure
     */
    @JavascriptInterface
    public void sliceAsync(String inputPath, String configJson, String callbackId) {
        Log.i(TAG, "sliceAsync: " + inputPath + " callback=" + callbackId);

        Future<?> future = executor.submit(() -> {
            try {
                // Stage 1: Create slicer instance
                sendProgress(callbackId, "init", 0);
                nativeCreate();

                // Stage 2: Load model
                sendProgress(callbackId, "loading", 10);
                if (inputPath.toLowerCase().endsWith(".3mf")) {
                    nativeLoad3MF(inputPath);
                } else {
                    nativeLoadSTL(inputPath);
                }

                // Stage 3: Apply config
                sendProgress(callbackId, "configuring", 20);
                nativeSetConfig(configJson);

                // Stage 4: Slice
                sendProgress(callbackId, "slicing", 30);
                nativeSlice();

                // Stage 5: Export GCode
                sendProgress(callbackId, "exporting", 90);
                File cacheDir = webView.getContext().getCacheDir();
                String outputPath = new File(cacheDir, "slice_" + callbackId + ".gcode").getAbsolutePath();
                nativeExportGCode(outputPath);

                // Stage 6: Done
                sendProgress(callbackId, "done", 100);
                nativeDestroy();

                activeTasks.remove(callbackId);
                sendResult(callbackId, outputPath);

            } catch (Exception e) {
                Log.e(TAG, "sliceAsync failed: " + e.getMessage(), e);
                try {
                    nativeDestroy();
                } catch (Exception cleanup) {
                    Log.w(TAG, "Cleanup after error failed", cleanup);
                }
                activeTasks.remove(callbackId);
                sendError(callbackId, e.getMessage() != null ? e.getMessage() : "Unknown slicing error");
            }
        });

        activeTasks.put(callbackId, future);
    }

    /**
     * Cancel an in-flight slice operation.
     *
     * @param callbackId The callback ID passed to sliceAsync
     */
    @JavascriptInterface
    public void cancelSlice(String callbackId) {
        Log.i(TAG, "cancelSlice: " + callbackId);
        Future<?> task = activeTasks.remove(callbackId);
        if (task != null) {
            task.cancel(true);
            try {
                nativeDestroy();
            } catch (Exception e) {
                Log.w(TAG, "Cleanup after cancel failed", e);
            }
            sendError(callbackId, "Cancelled");
        }
    }

    /**
     * Write binary data from JS to a temp file for slicing.
     * JS side calls this to transfer model data to the filesystem.
     *
     * @param base64Data Base64-encoded model file content
     * @param fileName   Filename with extension (e.g., "model.stl")
     * @return Absolute path to the written file
     */
    @JavascriptInterface
    public String writeInputFile(String base64Data, String fileName) {
        try {
            byte[] data = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT);
            File cacheDir = webView.getContext().getCacheDir();
            File outFile = new File(cacheDir, fileName);
            java.io.FileOutputStream fos = new java.io.FileOutputStream(outFile);
            fos.write(data);
            fos.close();
            Log.i(TAG, "Wrote input file: " + outFile.getAbsolutePath() + " (" + data.length + " bytes)");
            return outFile.getAbsolutePath();
        } catch (Exception e) {
            Log.e(TAG, "writeInputFile failed: " + e.getMessage(), e);
            return "";
        }
    }

    /**
     * Read a GCode file and return its content as a string.
     * JS side calls this to retrieve slicing results.
     *
     * @param path Absolute path to GCode file
     * @return GCode content string, or empty on error
     */
    @JavascriptInterface
    public String readOutputFile(String path) {
        try {
            return new String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(path)));
        } catch (Exception e) {
            Log.e(TAG, "readOutputFile failed: " + e.getMessage(), e);
            return "";
        }
    }

    // --- Private helpers ---

    private void sendProgress(String callbackId, String stage, int progress) {
        String js = "if(window.onSlicerProgress)window.onSlicerProgress('"
                + escapeJs(callbackId) + "','" + escapeJs(stage) + "'," + progress + ")";
        evalJs(js);
    }

    private void sendResult(String callbackId, String gcodePath) {
        String js = "if(window.onSlicerResult)window.onSlicerResult('"
                + escapeJs(callbackId) + "','" + escapeJs(gcodePath) + "')";
        evalJs(js);
    }

    private void sendError(String callbackId, String message) {
        String js = "if(window.onSlicerError)window.onSlicerError('"
                + escapeJs(callbackId) + "','" + escapeJs(message) + "')";
        evalJs(js);
    }

    private void evalJs(String js) {
        mainHandler.post(() -> {
            try {
                webView.evaluateJavascript(js, null);
            } catch (Exception e) {
                Log.e(TAG, "evaluateJavascript failed: " + e.getMessage());
            }
        });
    }

    private static String escapeJs(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\")
                .replace("'", "\\'")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }
}
