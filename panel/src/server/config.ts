export type PanelConfig = {
  containerName: string;
  managementHost: string;
  managementPort: number;
  managementTls: boolean;
  dataRoot: string;
  backupsRoot: string;
  panelDataRoot: string;
  port: number;
};

const parsePort = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }

  return value.toLowerCase() === "true";
};

export const config: PanelConfig = {
  containerName: process.env.MC_CONTAINER_NAME || "forge-minecraft-server",
  managementHost: process.env.MC_MANAGEMENT_HOST || "forge",
  managementPort: parsePort(process.env.MC_MANAGEMENT_PORT, 25585),
  managementTls: parseBoolean(process.env.MC_MANAGEMENT_TLS, false),
  dataRoot: process.env.MC_DATA_ROOT || "/srv/minecraft/data",
  backupsRoot: process.env.MC_BACKUPS_ROOT || "/srv/minecraft/backups",
  panelDataRoot: process.env.PANEL_DATA_ROOT || "/srv/minecraft/panel-data",
  port: parsePort(process.env.PORT, 3000)
};
