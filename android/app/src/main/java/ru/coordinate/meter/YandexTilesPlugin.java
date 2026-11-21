package ru.coordinate.meter;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

@CapacitorPlugin(name = "YandexTiles")
public class YandexTilesPlugin extends Plugin {
    private static final ExecutorService EXECUTOR = Executors.newFixedThreadPool(4);
    private static final String TILE_ORIGIN = "https://tiles.api-maps.yandex.ru";
    private static final String TILE_PATH = "/v1/tiles/";
    private static final String APP_REFERER = "http://ru.coordinate.meter.ymapapp";
    private static final int MAX_TILE_BYTES = 2 * 1024 * 1024;
    private static final long TILE_INTERVAL_MS = 125L;
    private static long nextTileRequestAtMs = 0L;

    @PluginMethod
    public void getTile(PluginCall call) {
        Integer x = call.getInt("x");
        Integer y = call.getInt("y");
        Integer z = call.getInt("z");
        if (!validTile(x, y, z)) {
            call.reject("Некорректные координаты тайла");
            return;
        }
        EXECUTOR.execute(() -> fetchTile(call, x, y, z));
    }

    private void fetchTile(PluginCall call, int x, int y, int z) {
        HttpURLConnection connection = null;
        try {
            awaitTileSlot();
            URL url = new URL(buildSignedUrl(x, y, z));
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(20000);
            connection.setRequestProperty("Accept", "image/png");
            connection.setRequestProperty("Referer", APP_REFERER);
            connection.setRequestProperty("User-Agent", "CoordinateMeter/1.5.10 (Android route planner)");
            connection.setUseCaches(true);
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) {
                call.reject("Яндекс Tiles API вернул HTTP " + status);
                return;
            }
            String contentType = connection.getContentType();
            if (contentType == null || !contentType.toLowerCase(Locale.ROOT).startsWith("image/")) {
                call.reject("Яндекс Tiles API вернул неожиданный формат");
                return;
            }
            byte[] bytes = readLimited(connection.getInputStream());
            String dataUrl = "data:image/png;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP);
            JSObject result = new JSObject();
            result.put("dataUrl", dataUrl);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Не удалось загрузить тайл Яндекс Карт", error);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static boolean validTile(Integer x, Integer y, Integer z) {
        if (x == null || y == null || z == null || z < 0 || z > 20) return false;
        long upper = (1L << z) - 1L;
        return x >= 0 && y >= 0 && x <= upper && y <= upper;
    }

    private static void awaitTileSlot() throws InterruptedException {
        long delay;
        synchronized (YandexTilesPlugin.class) {
            long now = System.currentTimeMillis();
            long scheduled = Math.max(now, nextTileRequestAtMs);
            nextTileRequestAtMs = scheduled + TILE_INTERVAL_MS;
            delay = scheduled - now;
        }
        if (delay > 0L) Thread.sleep(delay);
    }

    private static byte[] readLimited(InputStream input) throws Exception {
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = stream.read(buffer)) != -1) {
                total += read;
                if (total > MAX_TILE_BYTES) throw new IllegalStateException("Слишком большой ответ тайла");
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }

    private static String buildSignedUrl(int x, int y, int z) throws Exception {
        String path = TILE_PATH + "?x=" + x + "&y=" + y + "&z=" + z
            + "&lang=ru_RU&l=map&projection=web_mercator&maptype=map&apikey="
            + URLEncoder.encode(YandexTilesSecrets.API_KEY, StandardCharsets.UTF_8.name());
        byte[] secret = decodeBase64Url(YandexTilesSecrets.SIGNING_SECRET);
        byte[] temporalSecret = hmac(secret, utcHour().getBytes(StandardCharsets.UTF_8));
        String signature = encodeBase64Url(hmac(temporalSecret, path.getBytes(StandardCharsets.UTF_8)));
        return TILE_ORIGIN + path + "&signature=" + URLEncoder.encode(signature, StandardCharsets.UTF_8.name());
    }

    private static String utcHour() {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH':00:00Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date());
    }

    private static byte[] hmac(byte[] key, byte[] value) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key, "HmacSHA256"));
        return mac.doFinal(value);
    }

    private static byte[] decodeBase64Url(String value) {
        return Base64.decode(value, Base64.URL_SAFE | Base64.NO_WRAP);
    }

    private static String encodeBase64Url(byte[] value) {
        return Base64.encodeToString(value, Base64.URL_SAFE | Base64.NO_WRAP);
    }
}
