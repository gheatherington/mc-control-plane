package dev.brayden.panelmotdhelper;

import com.google.gson.Gson;
import com.google.gson.JsonSyntaxException;
import com.mojang.logging.LogUtils;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.dedicated.DedicatedServer;
import net.minecraft.server.dedicated.DedicatedServerProperties;
import net.minecraft.server.dedicated.DedicatedServerSettings;
import net.minecraft.server.dedicated.Settings;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;
import org.slf4j.Logger;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Field;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Objects;
import java.util.Properties;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

@Mod(MotdHelperMod.MOD_ID)
public final class MotdHelperMod {
    public static final String MOD_ID = "panelmotdhelper";

    private static final Logger LOGGER = LogUtils.getLogger();
    private static final Gson GSON = new Gson();
    private static final int DEFAULT_PORT = 25586;
    private static final int MAX_BODY_BYTES = 16 * 1024;

    private MotdHttpServer helper;

    public MotdHelperMod() {
        NeoForge.EVENT_BUS.register(this);
    }

    @SubscribeEvent
    public void onServerStarted(ServerStartedEvent event) {
        stopHelper();
        helper = new MotdHttpServer(event.getServer(), resolvePort());
        helper.start();
    }

    @SubscribeEvent
    public void onServerStopping(ServerStoppingEvent event) {
        stopHelper();
    }

    @SubscribeEvent
    public void onServerStopped(ServerStoppedEvent event) {
        stopHelper();
    }

    private void stopHelper() {
        if (helper != null) {
            helper.close();
            helper = null;
        }
    }

    private static int resolvePort() {
        String raw = System.getenv("PANEL_MOTD_HELPER_PORT");

        if (raw == null || raw.isBlank()) {
            return DEFAULT_PORT;
        }

        try {
            int parsed = Integer.parseInt(raw.trim());
            if (parsed > 0 && parsed <= 65535) {
                return parsed;
            }
        } catch (NumberFormatException ignored) {
            LOGGER.warn("Invalid PANEL_MOTD_HELPER_PORT '{}', falling back to {}", raw, DEFAULT_PORT);
        }

        return DEFAULT_PORT;
    }

    private record ApplyRequest(String motd) {
    }

    private record ApplyResponse(boolean applied, String error, String motd) {
    }

    private static final class MotdHttpServer implements AutoCloseable {
        private final HttpServer httpServer;
        private final int port;
        private final MinecraftServer server;

        private MotdHttpServer(MinecraftServer server, int port) {
            this.server = Objects.requireNonNull(server, "server");
            this.port = port;

            try {
                this.httpServer = HttpServer.create(new InetSocketAddress("0.0.0.0", port), 0);
            } catch (IOException exception) {
                throw new IllegalStateException("Failed to bind MOTD helper on port " + port, exception);
            }

            this.httpServer.createContext("/motd", new MotdHandler(this.server));
            this.httpServer.setExecutor(Executors.newSingleThreadExecutor((task) -> {
                Thread thread = new Thread(task, "panel-motd-helper");
                thread.setDaemon(true);
                return thread;
            }));
        }

        private void start() {
            httpServer.start();
            LOGGER.info("Panel MOTD helper listening on {}", port);
        }

        @Override
        public void close() {
            httpServer.stop(0);
            LOGGER.info("Panel MOTD helper stopped");
        }
    }

    private static final class MotdHandler implements HttpHandler {
        private final MinecraftServer server;

        private MotdHandler(MinecraftServer server) {
            this.server = server;
        }

        @Override
        public void handle(HttpExchange exchange) throws IOException {
            try {
                if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                    sendJson(exchange, 405, new ApplyResponse(false, "Use POST /motd", null));
                    return;
                }

                ApplyRequest request = parseRequest(exchange.getRequestBody());
                if (request.motd() == null || request.motd().isBlank()) {
                    sendJson(exchange, 400, new ApplyResponse(false, "A non-empty MOTD string is required", null));
                    return;
                }

                CompletableFuture<ApplyResponse> future = new CompletableFuture<>();

                try {
                    server.executeIfPossible(() -> {
                        try {
                            server.setMotd(request.motd());
                            server.invalidateStatus();
                            persistMotd(server, request.motd());
                            future.complete(new ApplyResponse(true, null, request.motd()));
                        } catch (Throwable exception) {
                            LOGGER.error("Failed to apply live MOTD", exception);
                            future.complete(new ApplyResponse(false, exception.getMessage(), request.motd()));
                        }
                    });
                } catch (RejectedExecutionException exception) {
                    sendJson(exchange, 503, new ApplyResponse(false, "Server is shutting down", request.motd()));
                    return;
                }

                ApplyResponse response = future.get(5, TimeUnit.SECONDS);
                sendJson(exchange, response.applied() ? 200 : 500, response);
            } catch (JsonSyntaxException exception) {
                sendJson(exchange, 400, new ApplyResponse(false, "Request body must be valid JSON", null));
            } catch (TimeoutException exception) {
                sendJson(exchange, 504, new ApplyResponse(false, "Timed out waiting for the server thread", null));
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                sendJson(exchange, 500, new ApplyResponse(false, "Interrupted while applying the MOTD", null));
            } catch (Exception exception) {
                LOGGER.error("Unexpected MOTD helper failure", exception);
                sendJson(exchange, 500, new ApplyResponse(false, exception.getMessage(), null));
            } finally {
                exchange.close();
            }
        }

        private static ApplyRequest parseRequest(InputStream body) throws IOException {
            byte[] bytes = body.readNBytes(MAX_BODY_BYTES + 1);
            if (bytes.length > MAX_BODY_BYTES) {
                throw new IOException("Request body exceeded 16KB");
            }

            return GSON.fromJson(new String(bytes, StandardCharsets.UTF_8), ApplyRequest.class);
        }

        private static void sendJson(HttpExchange exchange, int statusCode, ApplyResponse payload) throws IOException {
            byte[] response = GSON.toJson(payload).getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
            exchange.sendResponseHeaders(statusCode, response.length);

            try (OutputStream stream = exchange.getResponseBody()) {
                stream.write(response);
            }
        }

        private static void persistMotd(MinecraftServer server, String motd) throws ReflectiveOperationException {
            if (!(server instanceof DedicatedServer dedicatedServer)) {
                return;
            }

            Field settingsField = DedicatedServer.class.getDeclaredField("settings");
            settingsField.setAccessible(true);
            DedicatedServerSettings settings = (DedicatedServerSettings) settingsField.get(dedicatedServer);

            Field propertiesField = Settings.class.getDeclaredField("properties");
            propertiesField.setAccessible(true);

            settings.update((current) -> {
                try {
                    Properties nextProperties = new Properties();
                    nextProperties.putAll((Properties) propertiesField.get(current));
                    nextProperties.setProperty("motd", motd);
                    return new DedicatedServerProperties(nextProperties);
                } catch (IllegalAccessException exception) {
                    throw new RuntimeException("Failed to access dedicated server properties", exception);
                }
            });
        }
    }
}
