/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    BUCKET: R2Bucket;
    ASSETS: Fetcher;
    SITE_URL: string;
    ENVIRONMENT: 'development' | 'production';
    AUTH_DEV_MODE?: string;
    /** Only enable after manual archive migrations and isolated D1 verification. */
    ARCHIVES_ENABLED?: string;
    /** Separate opt-in after manual 0007 verification; secret is configured outside Git. */
    ARCHIVE_PUBLICATION_ENABLED?: string;
    ARCHIVE_PUBLICATION_SECRET?: string;
    GITHUB_CLIENT_ID?: string;
    GITHUB_CLIENT_SECRET?: string;
    GITHUB_ADMIN_USERNAME?: string;
    RESEND_API_KEY?: string;
    NOTIFY_EMAIL?: string;
    DEV_ADMIN_USERNAME?: string;
  }
}

// 全项目统一引用名下类型，避免各处重复写 Cloudflare.Env
type Env = Cloudflare.Env;

declare namespace App {
  interface Locals {
    /** Set only after administrator session and archive feature checks. */
    privateLibraryAuthorized?: boolean;
    /** Astro Cloudflare 适配器注入的执行上下文（用于 waitUntil 等） */
    cfContext: ExecutionContext;
  }
}
