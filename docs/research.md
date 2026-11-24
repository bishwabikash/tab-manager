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
| [Tab Manager Pro's own listing](https://chromewebstore.google.com/detail/tab-manager-pro/ifkbbogcfcijbfakfaklnmgbojmmoboi) | 2026-11-24 | — | Metrics and privacy section read from served HTML |
| [Linked privacy policy (Gist)](https://gist.github.com/bishwabikash/bdf5646d5dbee3f346692d31cb314895) | 2026-11-24 | Policy says 2026-02-08 | Full text read |

**Not obtained:** the Extenshi catalog MCP server could not connect this session (its host is now allowed but MCP servers bind at session start), so no catalog-side competitor data. Competitor figures come from direct Web Store fetches instead.

---

## 2. Baseline first — and it changes the question [observed 2026-11-24]

| | Users | Rating | Ratings | Version |
|---|---|---|---|---|
| **Tab Manager Pro** | **2** | — | **1** | 1.8.0 (52.45 KiB) |

Two users. One rating. Published version matches `manifest.json`, so the release pipeline is working.

**This reframes the brief.** The competitive analysis below was written before I had this number, and it assumed a product contesting share in a market. At two users the binding constraint is not differentiation and not compliance — it is that essentially nobody has installed this. A perfect permission posture and a flawless listing change nothing if the listing is never seen.

Keep the competitive section for positioning — it is still sound about where the uncontested slot is — but read it as *where to aim once there is distribution*, not as the current problem.

---

## 2b. Competitive landscape [observed 2026-11-24]

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

### 4.3 The privacy policy exists — and contradicts the extension — risk: **HIGH**

**Correction to an earlier reading of this repo:** a privacy policy *is* published and the Dashboard field *is* set. It points to a Gist, and the listing's privacy section is filled in ("This developer declares that your data is: Not being sold to third parties…"). Nothing is missing. The problem is that what is published no longer describes what ships.

The requirement, for context — it applies even though this extension transmits nothing:

> **Q14.** "My extension or app handles user data, but only stores information locally… Do I still need to post a privacy policy?"
> "Yes. This policy requires all Products that handle user information to post a privacy policy… Your privacy policy, however, may not need to be long or complicated."

> **Q3.** "Yes. Extensions are required to disclose how they handle user data, even when data is processed or stored locally on a user's device and is not transmitted to external servers or third parties."

The published policy is dated **2026-02-08** and reads, in full relevant part:

> "## Permissions Used
> - **tabs**: Used locally to read tab URLs for domain-based grouping
> - **tabGroups**: Used locally to create and manage tab groups
> - **storage**: Used locally to save your preferences (auto-group setting)"

> "## Contact
> [Your email address]"

Three defects, in order of severity:

**(a) The policy omits two of five declared permissions.** `manifest.json` declares `sessions` and `alarms`; the policy documents neither. `sessions` is the worst possible omission — it is the one that reads recently-closed tabs and windows, the most history-adjacent capability in the extension. Against the removal clause:

> "If the information listed in your privacy fields contradicts the information provided in your privacy policy, or the behavior of your extension, your extensions may be removed from the Store."

An undocumented `sessions` permission is precisely a policy that does not match behaviour.

**(b) `[Your email address]` is an unfilled template placeholder in a live, published policy.** The policy must be "accurate and up to date." A visible placeholder is a defect any reviewer opening the link will see.

**(c) The policy is stale and internally loose.** Dated February 2026, it predates the 1.7.0 address-bar placement feature and the 1.8.0 onboarding work. It also opens with "does NOT collect, store, or transmit any personal data" and then states "All data remains in your browser's local storage" — which is storing data. Google's own FAQ (Q3) treats local storage as data handling requiring disclosure, so the flat denial is the wrong framing even though the underlying privacy behaviour is genuinely good.

**This is a cheap fix with a severe failure mode.** The downside is removal of a published extension, not a rejected submission. Rewriting the policy is perhaps twenty minutes.

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

- **Review text.** With one rating there is no qualitative signal to read. The incumbents' 3.3–3.8 ratings still indicate where users get let down generally, but nothing specific to this extension.
- **Why installs are at two.** Listing age, search ranking, category competition and promotion are all plausible and none is established here. This is the question worth researching next, and it is a different investigation from this one.
- **`gist.githubusercontent.com` is blocked** in this environment, so the policy text was read from the rendered Gist page rather than the raw file. The content is unambiguous, but it is one layer removed from source.
- **The User Data FAQ page reports "Last updated 2016-04-23 UTC."** Its content matches current policy structure, so the date is likely a template artifact — but it is a caveat on a HIGH-risk finding. The Dashboard's own privacy-practices form is authoritative in a way a docs page is not.
- **Blog claims of 2026 policy changes** (a January 2026 disclosure change, a June 2026 justification requirement) appear in a single third-party source with no corroborating Google announcement. **Not relied upon anywhere above.**
- **Competitor "listing updated" dates** are listing-modification dates used as a proxy for release freshness, not version bumps.
- **Tab Manager Plus's tab-group support** is a third-party README claim, unverified.

---

## 6. Recommendation

**Fix the policy contradiction this week. Then treat distribution as the actual project.**

The compliance item is first only because it is a removal risk with a twenty-minute fix, not because it is the important problem. The important problem is two users.

1. **Rewrite the privacy policy** (§4.3). Document all five permissions — `sessions` especially — remove the `[Your email address]` placeholder, re-date it, and drop the "does not store any data" framing in favour of "stores preferences and group state locally; transmits nothing." Keep it short; Google explicitly says it may be.
2. **Re-check the Dashboard privacy-practices answers** against the rewritten policy so §4.5 cannot bite.
3. **Move the policy out of a Gist into the repo** and publish it at a stable URL. A Gist is a single point of failure for a store-listing requirement, and keeping the text in version control means it changes when `manifest.json` changes.
4. **Add a regression test asserting manifest-permission ⇄ code parity, and extend it to the policy document.** §3 is clean today; defect (a) above is exactly what a test would have caught. The repo already has a suitable suite and `cws.test.js` shows the tooling is there.
5. **Then investigate distribution.** Listing discoverability, search terms, category, and what the 200K-user extensions do that a 2-user extension does not. That is a separate research pass and the one most likely to matter.
6. **Tighten the single-purpose field** (§4.1) — cheap, do it while editing the listing.

### Explicitly rejected

- **Accounts or cloud sync.** Would move into Toby/Workona's strength, forfeit the "private by design" position that is currently the clearest differentiator, and pull Limited Use, secure-transmission and third-party-transfer policy onto a product that today avoids all of it.
- **AI grouping via a remote model key.** Unproven demand (the one listing checked: 20 users), and it converts a zero-transmission extension into one shipping tab URLs to a third party — reopening §4.4 as a real restriction rather than a satisfied exception. On-device Gemini Nano avoids the transmission problem and is the only version worth revisiting.
- **Competing on tab *saving*.** OneTab and Session Buddy own it with 3M users, and their low ratings reflect a job users dislike having done to them, not one done badly.
- **Any further competitive repositioning right now.** At two users there is no position to defend. Rejected as premature, not as wrong.

---

## 7. Acceptance outcomes

Testable, and none require a reviewer's opinion:

1. The published privacy policy documents all five declared permissions, `sessions` included.
2. No template placeholder remains in it, and its date is at or after the current release.
3. Its data-handling language says what the extension does — stores locally, transmits nothing — rather than denying storage outright.
4. The policy lives in version control and is served from a stable URL referenced by the Dashboard.
5. A test fails if any `manifest.json` permission lacks either a code reference or a policy entry.
6. The single-purpose field maps every shipped feature to tab management.

**Exit condition:** items 1–4 are release gates and are unblocked — they need writing, not deciding. No architecture question is blocked by this brief. The open question that should drive the next pass is §5's second bullet: why installs are at two.
