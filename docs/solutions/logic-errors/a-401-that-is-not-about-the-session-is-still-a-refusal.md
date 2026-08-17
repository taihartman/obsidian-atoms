---
module: plus
tags: [issuer-gate, 401, proxy, diagnosability, fail-closed]
problem_type: logic-errors
---

# A 401 that is not about the session is still a refusal

## Problem

`plusClient` already split a 401 three ways: session-shaped (`auth`), gateway/proxy/WAF (`upstream`), and transport (`network`). The issuer gate collapsed the last two into `unreachable` and the offline sentence, because the #508 plan said branching on raw status codes "would read a proxy 401 as a session refusal."

That is right about not calling it a **session** refusal. It does not follow that it is **offline**.

A self-hoster behind a reverse proxy then sees "try again when you're back online" forever. The recovery row never appears, because only a recorded `unverified` refusal writes one.

## Why the two-way map felt correct

Fail-closed was already satisfied: `unreachable` refuses content-bearing egress the same as `refused`. The mapping was written to protect a settings field a hosted user never touched. The missing case is a host that **answered** and said no for a reason that is not the session.

## The rule

Three outcomes, not two:

| What happened | Verdict | Record a refusal? |
|---|---|---|
| Service rejected this session | `refused` / `unverified` | yes |
| Host answered 401/403, not about the session | `refused` / `upstream` | yes |
| 5xx or the request never landed | `unreachable` | no |

The Settings row reads the record. Distinct copy: session-refused names the sign-in; upstream names the address; unreachable names the connection.

## Do not

- Treat `code !== "auth"` as offline.
- Record `unreachable`. A briefly offline user must not be pointed at a field they never touched.
- Call an upstream 401 a dead session. `upstreamRefusedMessage` exists so we do not have to.

Filed as [#536](https://github.com/taihartman/obsidian-atoms/issues/536). Residual of #508 / PR #526.
