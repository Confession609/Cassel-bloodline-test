declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ARCHIVE_ADMIN_PASSWORD?: string;
    ARCHIVE_SESSION_SECRET?: string;
  }
}
