# Meta capability matrix

This distinguishes implementation from live connection.

- Threads text: upstream official two-step API reused; identity and permalink/owner readback added; fixture-tested. Requires each brand's threads_basic + threads_content_publish grant. Live canary pending.
- Threads analytics: upstream official insights adapter reused; requires threads_manage_insights. Unavailable until verified runtime grant/sync.
- Instagram single image: official media container → status → media_publish → readback implemented; fixture-tested. Requires Professional identity, Page linkage and Page credential under Facebook Login; instagram_basic, instagram_content_publish, pages_read_engagement. JPEG must be publicly fetchable by Meta with rights cleared. Live canary pending.
- Facebook Page text: official Page feed POST + readback implemented; fixture-tested. Requires exact Page token and pages_manage_posts plus identity/read permissions. Live canary pending.
- Instagram/Facebook insights: not wired in this milestone; unavailable, not zero.
- Reels/video/carousel: not implemented; disabled.
- Comments/webhooks: upstream source preserved, but not started by the ASAP post-publishing composition root.

App review metadata and browser logins are not credential capability evidence. Dev-mode owner/tester behavior and public visibility must be tested on each actual route.
