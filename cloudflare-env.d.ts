declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    SUPABASE_URL?: string;
    SUPABASE_SECRET_KEY?: string;
    PROJECT_OS_BACKEND?: "d1" | "supabase";
    PROJECT_OS_WORKSPACE_ID?: string;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    PROJECT_OS_AI_DAILY_LIMIT?: string;
    PROJECT_OS_AI_CONTEXT_ENABLED?: string;
    GBRAIN_URL?: string;
    GBRAIN_SOURCE_ID?: string;
    GBRAIN_CLIENT_ID?: string;
    GBRAIN_CLIENT_SECRET?: string;
    PROJECT_OS_BRAIN_ENABLED?: string;
    PROJECT_OS_BRAIN_DAILY_LIMIT?: string;
  }
}
