import { createApp } from "./app";
import { config } from "./config";
import { ensureEventsStarted } from "./events";

const app = createApp();
ensureEventsStarted();

app.listen(config.port, () => {
  console.log(`panel listening on ${config.port}`);
});
