export const SAMPLE_BASE = `{
  "app": "demo-service",
  "version": "1.2.0",
  "replicas": 2,
  "features": {
    "auth": true,
    "cache": false,
    "logging": { "level": "info", "format": "json" }
  },
  "tags": ["web", "api"],
  "database": { "host": "db.internal", "port": 5432, "pool": 10 },
  "deprecated": { "oldApi": true }
}`;

export const SAMPLE_OURS = `{
  "app": "demo-service",
  "version": "1.3.0",
  "replicas": 2,
  "features": {
    "auth": true,
    "cache": true,
    "logging": { "level": "debug", "format": "json" }
  },
  "tags": ["web", "api"],
  "database": { "host": "db.internal", "port": 5432, "pool": 20 },
  "owner": "team-a"
}`;

export const SAMPLE_THEIRS = `{
  "app": "demo-service",
  "version": "1.3.0",
  "replicas": 2,
  "features": {
    "auth": true,
    "cache": false,
    "logging": { "level": "warn", "format": "json" }
  },
  "tags": ["web", "api", "v2"],
  "database": { "host": "db.internal", "port": 5433, "pool": 50 },
  "deprecated": { "oldApi": false },
  "region": "cn-east"
}`;
