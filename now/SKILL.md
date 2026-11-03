---
name: now
description: "Print the current date, time and part of day before statements about deadlines, this morning or tonight."
---

Run `bash ~/.claude/skills/now/scripts/now.sh` and use its output.
Install this directory at `~/.claude/skills/now`, or invoke `scripts/now.sh` relative to this skill directory.
The script requires GNU `date`. Set `LOCAL_TZ` to an IANA zone such as `Africa/Lagos`; the default is `UTC`.
It also prints UTC and US Eastern time. Do not infer time of day from message timestamps or file mtimes.
