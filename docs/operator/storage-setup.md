# Mozok Storage — Operator Installation Manifest

Storage buckets are created outside migrations because the Lovable platform
manages `storage.buckets` writes through a dedicated tool. `supabase db push`
alone does NOT create these buckets — a clean commercial installation
requires the explicit step below.

## Required buckets

| Bucket id       | Public | Size limit (bytes) | Allowed MIME types                        |
| --------------- | ------ | ------------------ | ----------------------------------------- |
| `course-covers` | false  | 5,242,880 (5 MiB)  | `image/jpeg`, `image/png`, `image/webp`   |
| `course-videos` | false  | 52,428,800 (50 MiB)| `video/mp4`, `video/webm`                 |

Both buckets are PRIVATE. There is no permanent public URL for a cover; UI
code must obtain a short-lived signed URL through the anon or user-scoped
Supabase client. Never call `getPublicUrl` for these buckets and never use a
service-role key from the browser.

## Creation

Create each bucket exactly once using the Supabase Storage API (or the
platform's `storage_create_bucket` tool) with `public=false`. Do NOT rely on
`INSERT INTO storage.buckets` in a migration — writes to that table are
rejected by the platform.

Platform-managed bucket rows may not accept `file_size_limit` or
`allowed_mime_types` from the tool. Upload restrictions are enforced by the
RLS policies described below, which read from `public.media_config`. The
values in `media_config` and the bucket-level configuration (where the
platform supports it) MUST agree — the migration keeps `media_config`
authoritative and every finalization RPC and upload policy compares against
it.

## Policies applied by migrations

Written by the P0C.1 media-foundation migration and its correction:

- `covers_insert_own_editable_course` — INSERT to `authenticated`, restricted
  to the caller-owned editable course; enforces size and MIME against
  `media_config` at upload time.
- `covers_read_owner_or_published` — SELECT to `anon` and `authenticated`;
  visible when the course is published OR the caller is the owning
  instructor. Anonymous callers reach covers only through short-lived
  signed URLs.
- `covers_delete_own_unattached` — DELETE to `authenticated`; blocked while
  the object is attached to any course via `cover_storage_path`.
- `videos_insert_own_editable_course` — INSERT to `authenticated`; same
  ownership + editability check; enforces size and MIME against
  `media_config`.
- `videos_read_entitled` — SELECT to `authenticated` only; the owning
  instructor or an enrolled learner of the published free course whose
  `lessons.video_storage_path` matches the object name.
- `videos_delete_own_unattached` — DELETE to `authenticated`; blocked while
  the object is attached to any lesson via `video_storage_path`.

No credentials, service-role tokens, or private keys are stored in this
document.

## Verification checklist for a fresh install

1. Apply every migration in `supabase/migrations/` in filename order.
2. Create `course-covers` (private) and `course-videos` (private) via the
   Storage API or platform tool.
3. Confirm `SELECT bucket, file_size_limit, allowed_mime_types FROM
   public.media_config;` returns the values in the table above.
4. Confirm the six storage policies above exist on `storage.objects`.
5. Confirm no policy grants `anon` SELECT on `course-videos`.