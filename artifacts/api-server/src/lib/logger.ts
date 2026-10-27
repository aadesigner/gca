import pino from "pino";

const isProduction = process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_ENVIRONMENT);

export const logger = pino({
  // Railway observability bills for log ingest. Production defaults to warn so
  // health checks / crawler chatter / 2xx HTTP are not shipped.
  level: process.env.LOG_LEVEL ?? (isProduction ? "warn" : "info"),
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
