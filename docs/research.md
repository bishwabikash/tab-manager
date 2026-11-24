# Tab Manager Pro — Product & Policy Research

**Compiled:** 2026-11-24 · **Subject:** Tab Manager Pro v1.8.0 (MV3) · **Scope:** competitive position, Chrome Web Store policy risk, differentiation

Every figure below is marked **[observed]** (read directly off a primary source on the date given) or **[inference]** (reasoning on top of observed facts). Nothing here is filled in from recall.

---

## 1. Source ledger

| Source | Checked | Page's own "last updated" | Status |
|---|---|---|---|
| [CWS Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies) | 2026-11-24 | 2025-05-22 UTC | Read in full |
| [CWS User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) | 2026-11-24 | 2016-04-23 UTC | Read in full; **stale page date — see §5** |
| [CWS Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use) | 2026-11-24 | — | Served navigation only; substantive text mirrored in Program Policies |
| Competitor CWS listings (5) | 2026-11-24 | per-listing, below | User counts, ratings, dates read from served HTML |
| Chrome "Organizer" / Gemini tab-group reports | 2026-11-24 | — | **Third-party only; no official Google source found** |

**Not obtained:** the Extenshi catalog MCP server could not connect this session (its host is now allowed but MCP servers bind at session start), so no catalog-side competitor data. Competitor figures come from direct Web Store fetches instead.

---

## 2. Competitive landscape [observed 2026-11-24]

| Extension | Users | Rating | Ratings | Listing updated |
|---|---|---|---|---|
| OneTab | 2,000,000 | 3.8 | 14.6K | Oct 11, 2026 |
| Session Buddy | 1,000,000 | 3.3 | 25.1K | Apr 28, 2026 |
| Toby | 300,000 | 3.8 | 3.4K | Nov 23, 2026 |
| Workona Tab Manager | 200,000 | 4.3 | 3.8K | Oct 9, 2026 |
| Tab Manager Plus | 200,000 | 4.5 | 1.1K | Oct 15, 2026 |
| AI Tab Organizer | 20 | 5.0 | — | — |

### The pattern that matters

Install base runs **inversely** to satisfaction at the top of this market. The two largest incumbents hold ~3M users between them at 3.3–3.8 stars, on 39.7K combined ratings. The two best-rated (4.3, 4.5) are an order of magnitude smaller.

**[inference]** That is a satisfaction gap at scale, not proven demand for a replacement — ratings measure the disappointed as much as the delighted, and a 3.3 on 25.1K ratings may reflect a decade of accumulated grievance rather than present quality. It is a wedge worth testing, not a validated opportunity.

### These are not all the same product

**[inference]** The field splits into three jobs, and only one is Tab Manager Pro's:

- **Close-and-restore lists** — OneTab, Session Buddy. You hand over your tabs and get a list back. Highest installs, lowest ratings.
- **Project workspaces** — Toby, Workona. Accounts, boards, teams, sync. Better rated, smaller, and a different commitment from the user.
- **Live tab control** — Tab Manager Plus, Tab Manager Pro. Operate on tabs where they are.

Tab Manager Pro's specific slot — **automatic grouping into Chrome's own native tab groups, with no account** — has no high-install incumbent in this sample. Tab Manager Plus is the nearest neighbour at 200K/4.5 and, per its own README as reported by third parties (**unverified**), does not support Chrome tab groups.

### Chrome itself as the competitor

**[inference, from unverified reports]** Google is testing an "Organizer" side panel and an "Ask Gemini about this group" action in Canary. No official announcement of automatic tab grouping in stable Chrome was found. Native grouping already exists; native *automatic* grouping is the thing that would hurt, and there is no evidence it has shipped. The AI-grouping extension cohort is unproven — the one listing checked has 20 users.

---

## 3. Permission posture [observed]

Every declared permission is used in code. Mapped by grepping all `*.js` for each namespace:

| Permission | APIs actually called | Verdict |
|---|---|---|
| `tabs` | query, get, create, update, remove, group, ungroup + 7 event listeners | Used |
| `tabGroups` | query, update, onCreated, onUpdated | Used |
| `storage` | local, session, onChanged | Used |
| `sessions` | getRecentlyClosed, restore | Used |
| `alarms` | create, get, clear, onAlarm | Used |

No host permissions. No `<all_urls>`. No `history`. No content scripts. `chrome.windows`, `chrome.commands` and `chrome.action` are used and require no declaration.

This is a genuinely strong position against the policy quoted in §4.2, and against the most commonly reported rejection cause (a permission declared with no matching API call).

---

## 4. Policy findings — verbatim

### 4.1 Single purpose — risk: LOW–MEDIUM

> "An extension must have a single purpose that is narrow and easy to understand. Don't create an extension that requires users to accept bundles of unrelated functionality. If two pieces of functionality are clearly separate, they should be put into two different extensions… Toolbars that provide a broad array of functionality or entry points into services are better delivered as separate extensions."

**[inference]** Tab Manager Pro ships auto-grouping, search, duplicate closing, closed-tab restore, mute, sort, and theming. Each relates to tab management, so the bundle is defensible — but "a broad array of functionality" is a reviewer judgment call, and the restore-closed-tabs feature (`sessions`) is the one furthest from "group my tabs." The listing already frames a single job ("tame tab chaos"), which helps. Keep the single-purpose field tying every feature back to tab management explicitly.

### 4.2 Permissions — risk: LOW

> "Request access to the narrowest permissions necessary to implement your Product's features or services. If more than one permission could be used to implement a feature, you must request those with the least access to data or functionality. Don't attempt to 'future proof' your Product by requesting a permission that might benefit services or features that have not yet been implemented."

Satisfied — see §3.

### 4.3 Privacy policy required even though nothing leaves the device — risk: **HIGH**

This is the most actionable finding. The User Data FAQ addresses local-only handling twice, directly:

> **Q3. Does an extension need to disclose user data handling if the data is only processed or stored locally on a user's device?**
> "Yes. Extensions are required to disclose how they handle user data, even when data is processed or stored locally on a user's device and is not transmitted to external servers or third parties."

> **Q14. My extension or app handles user data, but only stores information locally… Do I still need to post a privacy policy?**
> "Yes. This policy requires all Products that handle user information to post a privacy policy. Users may not easily be able to tell which apps or extensions save information locally or transmit it back to their servers. Your privacy policy, however, may not need to be long or complicated. It just needs to describe how the Product collects, uses, and shares user data."

And from Program Policies:

> "If your Product handles any user data, then you must post an accurate and up to date privacy policy… You must make the policy accessible by providing a link in the designated Chrome Web Store Developer Dashboard field."

**Gap:** there is no privacy policy document anywhere in this repository, and no privacy-policy URL in any file. `welcome.html` has a `.privacy` CSS class and a reassurance block, which is not a privacy policy.

**Important limit:** the Dashboard privacy-policy URL is store-side state, not repo state. I cannot see it from here. If that field is already populated with a live URL, this is closed. **Verify it before the next submission.**

### 4.4 Tab URLs and titles *are* web browsing activity — risk: MEDIUM

The FAQ's own category definition:

> "Collecting web browsing activity and any information about the website content or resources a user requests or interacts with, **including the domains or URLs the browser interacts with**…"

And the restriction:

> "Collection and use of web browsing activity is prohibited, except to the extent required for a user-facing feature described prominently in the Product's Chrome Web Store page and in the Product's user interface."

**[inference]** Tab Manager Pro reads tab titles and URLs — squarely inside that category. It also qualifies for the exception: grouping-by-site and search *are* the user-facing features, and they are described prominently both in the listing and in the popup UI. So the use is permitted. What this obliges is accurate **disclosure**, not a change in behaviour.

### 4.5 Disclosures must match behaviour — risk: MEDIUM (removal, not just rejection)

> "All information provided in the privacy fields of your extension must be up to date and accurate. If the information listed in your privacy fields contradicts the information provided in your privacy policy, or the behavior of your extension, your extensions may be removed from the Store."

Note the consequence is **removal of a published extension**, not merely a rejected submission. The listing's "no browsing data sent anywhere" claim is an asset here only if the privacy fields say the same thing in Google's vocabulary.

### 4.6 Limited Use affirmative statement — needs a judgment call

> "An affirmative statement that your use of the data complies with the Limited Use restrictions must be disclosed on a website belonging to your extension; for example, a link on a homepage to a dedicated page or privacy policy noting: 'The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.'"

**[inference]** The sample wording is scoped to "information received from Google APIs," which Tab Manager Pro does not consume — it reads local browser state via extension APIs. Whether that clause binds here is genuinely ambiguous. Including the sentence costs nothing and removes the question; omitting it is arguable but leaves a reviewer's reading of it unresolved.

### 4.7 Also worth knowing

> "If your product has a blank description field or is missing an icon or screenshots, it will be rejected."

Satisfied — five screenshots and two promo images are in `store-assets/`, and icons at 16/48/128.

---

## 5. What I could not establish

- **Tab Manager Pro's own store standing.** I have no CWS item ID for it, so its user count, rating and review text are unknown. Competitor numbers are meaningless without that baseline — it is the single biggest gap in this brief.
- **Whether the Dashboard privacy-policy URL is set.** Repo-invisible. See §4.3.
- **The User Data FAQ page reports "Last updated 2016-04-23 UTC."** Its content references current policy structure, so the date may be a template artifact rather than the true revision date — but a ten-year-old stamp on a page I am relying on for a HIGH-risk finding is a real caveat. Confirm against the Dashboard's own privacy-practices form at submission time, which is authoritative in a way a docs page is not.
- **Blog claims of 2026 policy changes** (a January 2026 disclosure change, a June 2026 justification requirement) appear in a single third-party source with no corroborating Google announcement. **Not relied upon anywhere above.** If a real deadline exists, it would change §4.3's urgency.
- **Competitor "listing updated" dates** are listing-modification dates, used as a proxy for release freshness. Not the same as a version bump.
- **Tab Manager Plus's tab-group support** is a third-party README claim, unverified.

---

## 6. Recommendation

**Hold the current position; close one compliance gap.**

The local-only, no-account, auto-grouping-into-native-groups slot is defensible and uncontested by any high-install incumbent in this sample. The permission posture is already better than the market's common failure mode. The strategic risk is not competitive — it is a store-side disclosure gap that can get a *published* extension removed (§4.5), which is worse than a rejection.

Ordered by expected value:

1. **Verify or publish a privacy policy and set the Dashboard URL** (§4.3). Highest risk, smallest effort. A few sentences suffice per Google's own wording.
2. **Align the privacy-practices fields with §4.4's vocabulary** — tab URLs/titles handled locally, nothing transmitted. Make the fields and the listing say the same thing.
3. **Get Tab Manager Pro's own listing metrics** and read its negative reviews. The incumbents' 3.3–3.8 ratings suggest where users are let down; your own reviews say whether you are repeating it.
4. **Add a regression test asserting manifest-permission ⇄ code parity.** §3 is true today; a test keeps it true, and it guards the most-reported rejection cause. The repo already has a suitable test suite.
5. **Tighten the single-purpose field** (§4.1) so every shipped feature reads as tab management.

### Explicitly rejected

- **Accounts or cloud sync.** Would move you into Toby/Workona's strength, forfeit the "private by design" claim that currently differentiates you, and pull the full weight of Limited Use, secure-transmission and third-party-transfer policy onto a product that today avoids all of it.
- **AI grouping via a remote model key.** Unproven demand (the one listing checked: 20 users), and it converts a zero-transmission extension into one that ships tab URLs to a third party — reopening §4.4 as a genuine restriction rather than a satisfied exception. Chrome's on-device Gemini Nano would avoid the transmission problem and is the only version of this worth revisiting later.
- **Competing on tab *saving*.** OneTab and Session Buddy own it with 3M users, and their low ratings reflect a job users dislike having done to them, not one done badly.

---

## 7. Acceptance outcomes

Testable, and none require a reviewer's opinion:

1. A privacy policy URL is live, reachable, and entered in the Dashboard field.
2. The policy names what is handled (tab titles, URLs, group state), where it stays (device), and what is shared (nothing).
3. The Dashboard privacy-practices answers contradict neither the policy nor the listing text.
4. No permission in `manifest.json` lacks a corresponding API call — enforced by a test, not by inspection.
5. The single-purpose field maps every shipped feature to tab management.
6. Baseline metrics for Tab Manager Pro's own listing are recorded, so §2 has a reference point.

**Exit condition:** architecture work is not blocked by any unresolved feasibility question here. Items 1–3 are release gates, not design questions. The one material unknown that could change direction is §5's first bullet — the extension's own standing in the market it is being positioned in.
