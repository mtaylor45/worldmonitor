# Wiki source

These files are the source of truth for the repository's GitHub wiki. They live
here rather than only in the wiki so they are reviewable in pull requests, and
so the wiki can be rebuilt if it is ever lost — a GitHub wiki is a separate git
repository with no history shared with this one.

**Edit here, then publish.** Editing a page in the GitHub web UI puts the wiki
ahead of this directory, which is the state this arrangement exists to avoid.

## Publishing

The wiki must have at least one page created through the web UI before it can be
cloned — GitHub does not create the underlying repository until then.

```bash
git clone https://github.com/mtaylor45/worldmonitor.wiki.git /tmp/wm-wiki
cp docs/wiki/*.md /tmp/wm-wiki/
rm /tmp/wm-wiki/README.md          # this file is not a wiki page
cd /tmp/wm-wiki
git add -A && git commit -m "Sync wiki from docs/wiki" && git push
```

## Pages

| File | Wiki page |
|---|---|
| `Home.md` | Landing page — status, orientation, the shape of the system |
| `Fork-Rules.md` | What you must know before editing anything |
| `Upstream-Merges.md` | The merge routine and what breaks predictably |
| `Testing.md` | The three suites, and two traps that cost real time |
| `Configuration.md` | Every environment variable, in one table |
| `Kiosk-Deployment.md` | The panel, the compositor, and what needs hardware |
| `Wake-Word.md` | "Computer": training it, and tuning against false accepts |
| `Proactive-Alerts.md` | Thresholds, the four guards, and why no model runs there |
| `Troubleshooting.md` | Symptom-first, for real failure modes of this system |
| `_Sidebar.md` | Wiki navigation |
| `_Footer.md` | Wiki footer |

Wiki links are bare page names (`[Wake Word](Wake-Word)`); links into the
repository are absolute URLs, because a wiki page has no relative path to the
code.
