# Plans — the working memory of this project

This folder is how humans and AI agents coordinate across sessions. It answers two questions:
*what are we doing right now* and *what happened before*.

## Layout

```
plans/
  WHERE-I-LEFT-OFF.md        <- always current; read this first
  active/
    YYYY-MM-DD-short-slug/
      plan.md                <- goal, approach, checklist
      record-log.md          <- running log of progress and decisions
  archive/
    YYYY-MM-DD-short-slug/   <- completed plans, moved here verbatim
```

## Lifecycle

1. **Start** — before substantive work, create `active/YYYY-MM-DD-short-slug/` with the two
   files. Keep `plan.md` short: a goal sentence, the approach, and a checklist. If it takes
   more than a few minutes to write, it's too heavy.
2. **Work** — check items off in `plan.md`. Append to `record-log.md` when something
   meaningful happens: a decision made, a dead end hit, a scope change agreed with the user.
3. **Finish** — move the folder to `archive/`, then update `WHERE-I-LEFT-OFF.md` with the
   current state and the natural next step.

## plan.md template

```markdown
# <Title>

**Goal:** one sentence.
**Status:** active | done

## Approach
A few sentences or bullets.

## Checklist
- [ ] step
- [ ] step
```

## record-log.md template

```markdown
# Record log

## YYYY-MM-DD HH:MM
What happened / what was decided and why.
```

## Rules of thumb

- One active plan at a time is the happy path; two is the max before you should finish something.
- Log decisions, not narration. "Chose SQLite over flat files because of search requirements"
  is a log entry; "edited file X" is not.
- `WHERE-I-LEFT-OFF.md` is for the next session's cold start — write it for someone with
  zero context.
