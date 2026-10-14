# OWL Publish M8 — local media preparation

Date 2026-10-14. Branch feat/owl-publish-m8-media-prep.
Status: OFFLINE media preparation only; no real account OAuth or publish.

Media inspector uses OWL ALLOWED_DIRECTORIES and ffprobe plus SHA256.
YouTube supports the original MOV (video/quicktime) or MP4 (video/mp4); M7 fake API verified both.
Instagram uses a separate MP4 copy. The local converter copies, remuxes, or transcodes to H264 and AAC, checks output with ffprobe and never overwrites the original or existing destination.
It refuses files outside authorized roots, and has no internet or credentials.

Existing real user path and social account display labels are NOT committed in this public source repository. They are only unverified inputs until the owner authorizes the folder and completes official OAuth in Desktop.

Acceptance tests: generated MOV source remains unchanged, MP4 conversion and codec inspection pass, existing output is not overwritten, unauthorized source path rejected. YouTube MOV fake upload private readback and Instagram staging without media_publish also pass.

Release gates:
1. User selects and authorizes only the containing media folder in Desktop Settings > Allowed Folders.
2. Re-read real asset properties; it was only located by Spotlight, not read because Movies is not allowed yet.
3. Connect Google OAuth and verify actual YouTube channel via account selection; display name alone is insufficient.
4. Connect supported Instagram Professional account to approved Meta app, verify actual account ID and permissions.
5. Signed Runtime 1.x installation plus OS-protected tokens; implement streamed real HTTPS and upload reconciliation.
6. Explicit per-action user approval for YouTube PRIVATE upload. Instagram PUBLIC media_publish requires a separate signed confirmation.
No platform uploads or fees occurred.
