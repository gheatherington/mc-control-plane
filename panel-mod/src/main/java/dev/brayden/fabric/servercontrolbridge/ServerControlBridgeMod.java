package dev.brayden.fabric.servercontrolbridge;

import dev.brayden.fabric.servercontrolbridge.integration.PanelBridgeService;
import net.fabricmc.api.ModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class ServerControlBridgeMod implements ModInitializer {
  public static final String MOD_ID = "servercontrolbridge";
  public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

  private final PanelBridgeService panelBridgeService = new PanelBridgeService(LOGGER);

  @Override
  public void onInitialize() {
    LOGGER.info("Initializing server control bridge scaffold");
    panelBridgeService.initialize();
  }
}

