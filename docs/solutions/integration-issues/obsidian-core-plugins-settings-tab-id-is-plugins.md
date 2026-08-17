---
title: "Obsidian's Core plugins settings tab id is plugins, not core-plugins"
date: 2026-08-13
category: integration-issues
module: src/home
problem_type: wrong_api_id
component: settings-modal
symptoms:
  - "openTabById(\"core-plugins\") leaves activeTab empty"
  - "Home CTA looks like it did nothing"
root_cause: the undocumented Settings tab id is the short name plugins; core-plugins is a guess that does not match
resolution_type: live_verified_constant
severity: medium
tags:
  - obsidian-api
  - settings
  - daily-notes
  - onboarding
---

# Obsidian's Core plugins settings tab id is `plugins`

`app.setting.openTabById` takes undocumented ids. Live on 1.13.6 they are:

| Tab | `id` |
|---|---|
| Core plugins | `plugins` |
| Community plugins | `community-plugins` |
| Atoms | `atoms` |

`core-plugins` is not one of them. `openTabById("core-plugins")` returns, `activeTab` stays empty, and the modal does not move.

The constant is `CORE_PLUGINS_SETTINGS_TAB_ID` in `src/home/atomsHomeData.ts`. Do not rename it to the guessed string. Re-list `app.setting.settingTabs` if a future installer changes it.
