declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    SUPABASE_URL?: string;
    SUPABASE_SECRET_KEY?: string;
    PROJECT_OS_BACKEND?: "d1" | "supabase";
    PROJECT_OS_WORKSPACE_ID?: string;
  }
}
