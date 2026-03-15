package dev.brayden.fabric.servercontrolbridge.integration;

import org.slf4j.Logger;

public final class PanelBridgeService {
  private final Logger logger;

  public PanelBridgeService(Logger logger) {
    this.logger = logger;
  }

  public void initialize() {
    logger.info("Panel bridge service scaffold is active; transport hooks are not implemented yet");
  }
}

