declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    SUPABASE_URL?: string;
    SUPABASE_PUBLISHABLE_KEY?: string;
    SUPABASE_ANON_KEY?: string;
    SUPABASE_SECRET_KEY?: string;
    PROJECT_OS_APP_URL?: string;
    PROJECT_OS_OWNER_EMAIL?: string;
    PROJECT_OS_OWNER_ID?: string;
    PROJECT_OS_REQUIRE_EXISTING_WORKSPACE?: string;
    PROJECT_OS_REQUIRE_AUXILIARY_IMPORT?: string;
    PROJECT_OS_BACKEND?: "d1" | "supabase";
    PROJECT_OS_WORKSPACE_ID?: string;
    GITHUB_APP_ID?: string;
    GITHUB_APP_SLUG?: string;
    GITHUB_APP_PRIVATE_KEY?: string;
    GITHUB_ALLOWED_ACCOUNTS?: string;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    PROJECT_OS_AI_DAILY_LIMIT?: string;
    PROJECT_OS_AI_CONTEXT_ENABLED?: string;
    PROJECT_OS_NOTEBOOK_VOICE_MONTHLY_USD?: string;
    GBRAIN_URL?: string;
    GBRAIN_SOURCE_ID?: string;
    GBRAIN_CLIENT_ID?: string;
    GBRAIN_CLIENT_SECRET?: string;
    PROJECT_OS_BRAIN_ENABLED?: string;
    PROJECT_OS_BRAIN_DAILY_LIMIT?: string;
  }
}
