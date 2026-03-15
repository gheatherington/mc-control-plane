# Server Control Bridge Mod

This Gradle project is the Fabric mod workspace for the server-control panel integration.

Current scope:

- pins the mod toolchain to Minecraft `1.21.11` and Java `21`;
- provides a dedicated server-side Fabric entrypoint;
- reserves a small package layout for the future panel bridge implementation.

Validation commands:

- `./gradlew tasks`
- `./gradlew build`

The built mod jar will be written to `panel-mod/build/libs/`. When the bridge becomes functional, copy the remapped jar into `/opt/fabric-minecraft-server/data/mods/` and restart the server.

