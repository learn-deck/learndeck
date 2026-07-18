# The PatchQuest path

This directory is the step-by-step course. Follow it with a local coding agent;
do not try to consume it as a long lecture.

Each step contains:

- a focused outcome;
- one small implementation action in your own workspace;
- a diagnostic question before you study the source;
- an exit question after you have evidence;
- a related question to save for a later revisit.

The agent records the selected language, workspace path, question attempts,
feedback, artifacts, commands, and completed steps in
`<workspace>/.patchquest/progress.db`. The database is local to that workspace
so a Go project and a Node project never share progress by accident.

Start at [00 · Start a path](modules/00-start-a-path.md). Do not move ahead
because a page is visible: complete the evidence and exit question for the
current step first.
