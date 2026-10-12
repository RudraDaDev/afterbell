# Afterbell - Full Specification
# School Social Media App
## 1. System Architecture

- Split-plane design: video media fully isolated from the core app server.
- Video uploads route directly from client to Cloudflare R2 object storage. Backend never touches raw video files, only stores the URL reference.
- Zero-egress storage model: repeated views of the same video cost nothing in bandwidth.
- Backend: Node.js service on existing infrastructure. Target footprint: 150 to 300MB RAM, under 5% CPU during normal operation.
- Database: Supabase free tier. Stores profiles, comment trees, security logs, invite tokens, chat history, forum posts, marketplace listings, support tickets. No media.
- Mobile client: NativeScript, cross platform (iOS/Android).
- Web client: custom lightweight JS framework, serves as the primary gateway.
- Distribution: Android via direct APK sideload, shared only with people personally invited and known. iOS via PWA, added to home screen for full screen app like behavior without browser chrome. No app store listings.

## 2. Access Control

- Invite only, currently around 100 people invited. No public registration endpoint.
- Request flow: student submits personal details, admin manually verifies, single use registration token generated tied to that student's identity, token required to complete signup, token burns on use.
- No token reuse or sharing possible once consumed.
- Being invite-only and privately distributed does not change how ad networks, privacy law, or platform policy treat the app. It reduces the odds of external notice, not the underlying obligations.

## 3. Moderation, Text

- Layer 1: in memory keyword filter runs on every post/comment before it's committed to the database. Blocked content is rejected at the API gateway, never stored.
- Layer 2: content that passes the filter goes live immediately.
- Background sweep every 60 seconds: any post live longer than 30 minutes without a moderator "approved" tag is auto hidden from the feed pending review.

## 4. Moderation, Video

- Videos are pending by default on upload. Not visible on the feed until moderator approval.
- Review interface: auto extracted frame grid (several evenly spaced stills across the clip) for fast visual scan. Full playback only used when a frame looks questionable.
- Rejected videos are fingerprinted using perceptual hashing. Reuploads matching a rejected hash are auto flagged without requiring a fresh manual review.
- Audio content is not actively scanned. Relies entirely on the report system.

## 5. Reporting

- Any content type (post, comment, video, DM, forum thread, marketplace listing) can be reported by any user.
- A report immediately hides the content from all other users, before moderator review.
- Moderator reviews after the fact and either restores or permanently removes.

## 6. Moderator Team Structure

- Small trusted group, drawn from across different friend groups and sections rather than a single clique.
- Restriction rule: a moderator cannot act on their own content, or content posted by users flagged as their close friends (maintained as an explicit restriction list per moderator).
- Restricted cases reroute to a different moderator.
- Threshold rule: flagged or borderline content requires approval from two separate moderators before going live.
- Every moderator action (approve, reject, hide, restore) is logged with moderator ID, content ID, action, reason, timestamp.
- Admin reviews the action log periodically, not in real time.
- Compensation: status based (badges, free paid perks), not cash. Keeps moderation incentives separate from the cash economy.
- Mods also help manage support tickets alongside admin.

## 7. Core Features

Main Feed
- Text posts and short form video.
- Client side video compression before upload to keep file sizes and load times low.
- Chronological sort with an engagement boost for approved, in window posts.

Threaded Comments
- Self referencing structure: top level comments attach to the post, replies attach to their parent comment.
- Full comment tree for a post is fetched and grouped by parent server side in a single pass, minimizing repeated database hits.

Direct Messages
- One to one private channels.
- Self messaging blocked. Empty messages blocked.
- Indexed by sender, receiver, and timestamp for fast retrieval at scale.
- Admin visibility restricted to specific reported messages only, never full conversation history, never unreported messages.

Anonymous Confessions
- All identifying user data stripped before the confession is written to storage. No retrievable link back to the author.

Crush Match
- Users privately submit a name to a watch list.
- A match is only revealed if both parties have added each other.
- No one sided visibility. An unreciprocated entry stays fully private.

Forums (Text Only)
- Separate from the main feed, organized by topic/thread rather than chronological posts.
- Realistically driven by a small core of regular posters rather than the full user base, which is normal for forums at any scale.

Minigames
- Best suited to async or small lobby formats (2 to 4 players, turn based, leaderboard driven) rather than anything needing a large live matchmaking queue, since concurrent online users at this scale will typically be small outside peak hours.
- Tournament brackets (for games like BGMI or Free Fire) sized to realistic entrant counts, not the full invited user base.

Marketplace
- Students list items (textbooks, notes, study guides) for sale to each other.
- A flat listing fee is charged to post a listing, since no marketplace service is fully free to run or fully profit neutral for the platform.
- Optional boosted placement at the top of the marketplace tab for an additional fee.
- Realistically low volume at this scale, functions more as a utility feature than a primary revenue source.

Support Tickets
- Users can submit a ticket for issues, questions, or disputes.
- Managed jointly by admin and the moderator team.
- Expected volume is low and manageable by hand at current scale, with spikes around new feature launches or moderation disputes.

## 8. Privacy and Settings

- 100+ individual toggles, opt in by default.
- Categories include: swear word handling (intensity level, plus a choice between full redaction or a softened stand in word that preserves meaning), DM visibility, crush hint eligibility, and other profile, notification, and moderation adjacent settings.
- New accounts are walked through the highest impact settings via an onboarding prompt rather than leaving them buried in a menu.
- Settings changes are self service and reversible at any time by the user.

## 9. Cash Economy

- No payment processor access (cash only, in person collection). Every payment is accompanied by a handwritten signed receipt.
- No entry fee to join or use the app. The app itself stays free so the invite pool has no reason to stay partially uninstalled, and so paid perks retain value by having a full audience to be seen by.
- No recurring subscription tier. Recurring cash collection does not fit a manual, in person collection process at this scale, and a subscription bundle does not currently offer meaningfully different value from one time perk purchases.

Profile Perks
- Custom name badge or emoji tag.
- Premium profile gradient themes and animated borders.
- Verification tick for notable students.

Feed Visibility
- Mega pinned posts: top of feed placement for 24 hours.

Entertainment
- Anonymous confession and crush hints, gated: only sellable if the person being hinted about has personally enabled that setting. No exceptions, regardless of payment.
- Gaming tournament entry fees, pooled and split between winner payout and platform hosting fund.

Marketplace Fees
- Flat listing fee per item posted, plus optional boosted placement fee.

Voluntary Support
- Optional, one time "support the app" contributions framed as helping cover server and maintenance costs, not a fee for access.
- Never gates a core feature. The moment support is required to keep using something, it stops being support and becomes a fee.
- Can carry a small supporter badge as informal recognition, using the same perk mechanic as everything else.

Local Sponsorships (deprioritized)
- Originally planned as paid banner space sold to shops near the school.
- In practice, unproven and difficult to sell without a track record or way for a shop to verify reach, so not currently a reliable revenue source.

## 10. Advertising

- Third party ad networks (such as AdMob) are not currently planned.
- Even with non personalized, child directed tagged ad requests, meaningful obstacles remain: ad network account holders are generally required to be adults, the app's userbase is a known set of minors rather than a general audience, and running an external ad SDK against verified classmates carries real reputational risk if discovered by parents or the school, independent of formal policy compliance.
- The existing perk based cash economy and optional support contributions serve the same funding purpose without that exposure.

## 11. Scaling and Storage Management

- 30 day auto delete on posts and video to stay within Cloudflare R2's free storage tier indefinitely.
- Cash reserves, once beyond personal holding capacity, are transferred to a parent or relative with card or UPI access to cover eventual paid infrastructure costs once free tiers are outgrown.

## 12. Analytics

Theoretical metrics to track
- Daily and weekly active users.
- Retention by day (day 1, day 7, day 30).
- Posts and comments per active user per day.
- Conversion rate on paid perks, percentage of active users purchasing anything.
- Report rate, reports per 100 posts, as a moderation load indicator.
- Session length and opens per day.

Realistic expectations at roughly 100 invited users
- Install and activation: expect roughly 60 to 85 of invited users to actually install and complete signup.
- First week DAU: roughly 40 to 60 percent of activated users, higher early due to novelty and tight friend groups.
- Retention: a hard drop off is typical by day 7 industry wide, confessions and crush match are the strongest built in retention hooks here.
- Paid conversion: roughly 5 to 15 percent of active users ever purchase anything, often a single purchase rather than repeated spending, with spikes tied to specific events or drama rather than steady recurring revenue.
- Peak load concentrated around lunch break and immediately after school, quiet the rest of the day.
- Minigame and tournament concurrency will be small in absolute numbers at this scale, plan formats accordingly.
- Marketplace volume likely low, a handful of listings per month rather than a primary revenue stream.
- Support ticket volume low and manageable by hand, with spikes after new feature launches or disputes.
- The most meaningful signal is not raw DAU percentage, since a tight existing friend group can inflate that on its own, but usage spreading to users outside the founder's own close circle, across forum posts, marketplace listings, and minigame participation.

## 13. Team and Collaboration

- Currently developed solo.
- Recommended build order to avoid stalling: ship the core loop first (feed, DMs, invite gating, basic text moderation), get it live with the initial invited group, then layer in forums, minigames, marketplace, and tournaments based on actual demand rather than building the full spec before anyone has used any of it.
- Open to finding a volunteer designer and illustrator for icons, mascot, banners, and badge art, compensated informally through portfolio credit and in app status (founding team or verified tag) rather than cash, consistent with how the moderator team is compensated.