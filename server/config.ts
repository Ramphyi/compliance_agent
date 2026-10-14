import "dotenv/config";
export type Config = {
  production: boolean;
  port: number;
  appUrl: string;
  apiUrl: string;
  demo: boolean;
  memory: boolean;
  databaseUrl?: string;
  externalAi: boolean;
  regulatoryFetch: boolean;
  repositoryFetch?: boolean;
  localDataFile?: string;
};
export function getConfig(): Config {
  const production = process.env.NODE_ENV === "production";
  const config = {
    production,
    port: Number(process.env.PORT || 4000),
    appUrl: process.env.APP_URL || "http://localhost:5173",
    apiUrl: process.env.API_URL || "http://localhost:4000",
    demo: process.env.DEMO_MODE === "true",
    memory: process.env.DB_DRIVER === "memory",
    localDataFile:
      !production &&
      process.env.DEMO_MODE === "true" &&
      process.env.DB_DRIVER === "memory"
        ? process.env.LOCAL_DATA_FILE || ".local/workspace.json"
        : undefined,
    databaseUrl: process.env.DATABASE_URL,
    externalAi: process.env.ALLOW_EXTERNAL_AI === "true",
    regulatoryFetch: process.env.ALLOW_REGULATORY_FETCH === "true",
    repositoryFetch:
      process.env.ALLOW_REPOSITORY_FETCH === "true" ||
      (!production && process.env.ALLOW_REPOSITORY_FETCH !== "false"),
  };
  if (production && (config.demo || config.memory))
    throw new Error("Demo and memory database are forbidden in production");
  if (
    production &&
    (!config.appUrl.startsWith("https://") ||
      !config.apiUrl.startsWith("https://"))
  )
    throw new Error("Production requires HTTPS public URLs");
  if (!config.memory && !config.databaseUrl)
    throw new Error(
      "DATABASE_URL is required. Use npm run dev for the isolated memory demo.",
    );
  return config;
}
