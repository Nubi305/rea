# Round 3: what the capture now takes and records

For the agents who change the comparer, the referee and the playbook after the capture package. It names
each new input member and each new record member of `rea capture-browser-scenario`, says what the comparer
has to read to use them, what the referee's renderer and the playbook's recipes should change, and gives
the measurements. Decisions: `fix-decisions-round3.md`, section "Captures" (C1 to C5).

Worktree `/home/user/rea-wt/capture3`, branch `fx3/capture3`. The fixture application is
`tests/fixtures/captureDefects/server.mjs` ("Fernhollow"). The two scripts that produced every number below
are `scripts/measure-capture-loss.mjs` and `scripts/verify-capture-recipes.mjs`; both take `--rea PATH`, so
they run the build before the change (`/home/user/rea-judge`, 0e089b3) and the new one on the same input.
They are also `npm run verify:browser:bodies` (fails when a capture loses anything) and
`npm run verify:browser:recipes` (fails unless the slower rebuild compares `unchanged` and every wrong
rebuild does not); `package.json` gained those two lines.
The capture guide in the repository is `docs/guides/web/browser-scenario-contract.md`.

## 1. What was wrong, in one table

Chromium 153, measured with raw CDP probes before any code was changed (the probes are in
`/home/user/rea-design/m1/fix3-scratch/capture/probe/`). "Page's record" is `Network.getResponseBody` on
the session Playwright drives, which is what `Response.body()` reads.

| What the page does with a fetch reply                                        | Reply without a cache header                                                         | Reply with `Cache-Control: no-store`                                                                                                                                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| reads it with `text()`, `json()`, `blob()`, `arrayBuffer()`, or it is an XHR | load ends, body in the page's record                                                 | load ends, body in the page's record                                                                                                                                                                         |
| never reads it                                                               | the browser drains it itself **50 ms after it arrives**; only then does the load end | **the load never ends** (not after 1.5 s, not after a forced garbage collection) and the page's record has no body: "No data found"                                                                          |
| reads it through a stream reader (`getReader()`, BYOB, `pipeTo`)             | load ends, body in the page's record                                                 | in **25 to 28 of 40** tries the browser cancels the load at the end of the stream, after the script got every byte: `loadingFailed`, `canceled: true`, `net::ERR_ABORTED`, and the page's record has no body |

Three causes follow, and none of them is in the application or the comparison:

1. REA closed its record right after the last step and read a body only after the browser's "finished"
   event. A click whose reply the page does not read finishes 50 ms later, so it was `response-unfinished`
   unless 50 ms of scenario happened to follow.
2. With `no-store` such a reply never finishes at all, however long REA waits.
3. REA's own `request` step read its reply through a stream reader. On a `no-store` route the browser then
   cancelled REA's own request about half of the time, REA recorded `request-failed` and never asked for
   the body. This is the "no-store loses bodies, more under load" observation, and the 11 of 99 and 21 of
   90 `net::ERR_ABORTED` counts.

Chromium does not buffer a `no-store` reply for the page (the fetch specification lets a browser hold back
a reply it is not caching), which is why only `no-store` shows 2 and 3.

## 2. The mechanism (C1)

The capture asks the browser to keep reply bodies **outside the page**: `Network.configureDurableMessages`
on a second debugging session per page, opened before the first navigation. It then reads each body there
by request id. Measured properties of that copy:

- it has the body whatever the page did with the reply (all six cells of the table above);
- it answers only with a whole body. A reply still arriving, a reply the page aborted half way (with or
  without `Content-Length`), and a reply that never ends are all "No data found". A partial body is never
  recorded as the reply.

A response is tied to its request id by its request line, its status and the browser's timing record of the
response (`sendStart`, `receiveHeadersEnd` and the connection times), which both sessions report with the
same numbers. In a probe with 40 concurrent identical GETs and 40 identical POSTs, 106 of 107 responses
matched one request each; the one without a match was a redirect hop, which has no body. Two responses that
share a key are read by neither: they fall back to the page's record, as does a response without a timing
record. So a body is never attributed to the wrong request.

Also part of C1:

- **The capture settles before it ends.** After the last step it stops admitting requests and waits, up to
  2 seconds or what `capture_timeout_ms` has left, until every request already sent has ended or the
  browser holds its whole reply. A reply answered as an event stream is not waited for. Requests sent
  after the last step are not recorded.
- **A `request` step reads a `no-store` reply whole** (`blob()`), not through a stream reader, so its own
  request is no longer cancelled.
- **An empty request body is recorded as empty.** When the request's own headers declare
  `Content-Length: 0` (a form posted without fields, a `fetch` POST without a body), the request body is
  `captured` with 0 bytes. A request that declares another length, none, or two stays `not_exposed`.
- **A redirect and a 304 are not failed reads.** Their body is `not_exposed` (the browser hands it to no
  reader), or the empty body the browser holds for a 304. It is not a coverage gap. Neither is the absent
  body of a GET, so `completeness` can now be `complete` for a capture that selects request bodies.

What C1 does not reach, each with its measured state (so nobody reads "recorded" as "always"):

- **A file a link saves.** A navigation the browser turns into a download ends as `request-failed`
  (`net::ERR_ABORTED`) for the page. The browser's copy has the file only when all of it had arrived by
  then. The clone-run fixture's 109-byte `topics.csv` is `captured`, with the file's own SHA-256, in
  **79 of 80** captures: 39 of 40 without load of mine (load 8.9 to 10.1) and 40 of 40 under 8 CPU
  burners (load 10.5 to 18.8); the one that missed reads `request-failed`, never a wrong body. The old
  build reads `request-failed` in 3 of 3. A 3 MB file sent in three pieces 250 ms apart is
  `request-failed` in 3 of 3, with or without `Content-Length`, and so is one the server cuts short.
  So this case is not deterministic: a small file is recorded nearly always, a file in between may be
  recorded in one capture and not in the next. My reading of the miss, not established: the page reports
  the failure before the browser has finished keeping the body, and the capture asks the copy once. Asking
  again for a short while after a failed load would be the next thing to try. A link with the `download`
  attribute sends a request the page never sees: no capture records it, before or after.
- **A reply over 8 MiB**, or over the limit when the limit is higher: the browser's copy does not hold it,
  so it is read as before, through the page's record. Tried: 9.5 MB replies, one to a `request` step and
  one the page never reads, are both `body-size-limit` with `observed_bytes: 9500000`.
- **A reply the page abandons half way** (1,000 of 200,000 announced bytes, then `abort()`):
  `request-failed`, `net::ERR_ABORTED`. Its first part is not recorded as the reply.
- **Event streams and replies that never end**: `response-unfinished`, as before.

What it costs: the same 23-step scenario, old and new build in alternation, 6 captures each, twice:
2.9 s against 3.5 s per capture at load 7.5, and 3.4 s against 4.2 s at load 8 to 9. About 0.6 to 0.8 s
more per capture.

## 3. New input members

All optional. A scenario that uses none has the same parsed form and the same `scenario_sha256` as before
(checked: the old and the new build give `6e294592...06ca` for the same file).

| Member                    | Where                                                                    | Meaning                                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wait_for_response`       | on `click`, `fill`, `press`, `select_option`, `check`, `uncheck`, `goto` | `{ "method", "path", "status"? }`. The step waits until the reply to the first new matching request has ended, then takes its snapshot. `path` is on the start origin, `{*}` matches one segment, the query is ignored. `status` is a list of statuses that complete the step; omitted means any status; another status fails the step. |
| `start_wait_for_response` | top level, beside `start_url`                                            | The same object. The initial state (`scenario_start`) is recorded after that reply ended, within `command_timeout_ms`.                                                                                                                                                                                                                  |
| `step_timeout_ms`         | top level                                                                | Deadline of every action that sets no `timeout_ms`. A `wait_for_timeout` keeps its duration.                                                                                                                                                                                                                                            |
| `capture_timeout_ms`      | top level                                                                | Deadline of the steps as a whole, counted from the start of the capture; actions, snapshots and the settle window get what is left of it. Browser start and the start navigation keep `command_timeout_ms`, cleanup keeps its 30 s grace.                                                                                               |
| `"title"`                 | a value of `capture.after_each_step` and `capture.at_end`                | Record the document title after the step.                                                                                                                                                                                                                                                                                               |

`save_response` is unchanged (2xx JSON, fails on two matches). A step may carry both.

`wait_for_response` in detail, because recipes depend on it:

- "Ended" is: the page finished loading the reply; or the load failed after the reply arrived; or the
  browser holds the whole reply outside the page (a reply the page never reads). A request that fails
  before any reply fails the step.
- After the reply ended the page gets one turn of its event loop (a zero-delay timer in the page) before
  the snapshot. Code that reacts at once (`const d = await r.json(); render(d)`) has run. Rendering that
  needs a second request or a timer has not: name the later reply, or keep a `wait_for` step.
- The first new matching request decides. On a page that polls the same address, the poll can be it.
- Errors, word for word: `Step <id> waited for a POST /api/x reply with status 422; it answered 500.`,
  `Step <id> waited for a POST /api/x reply, and the page sent no such request before the step ended.`,
  `... the request was sent and not answered before the step ended.`,
  `... it answered 200 and had not ended before the step ended.`,
  `... the request failed before it was answered: net::ERR_...`.
- The wait gives up 100 ms before its step's deadline (half way to a deadline under 200 ms). A step that
  runs out of time while it waits therefore always records the deadline sentence followed by one of the
  three "before the step ended" sentences. Without that headroom the two clocks raced, and a start page
  that had loaded was reported, in one of two captures, as a page that never finished loading.
- `start_wait_for_response` that is not met ends the command before any step: exit 1, code
  `execution_failure`, `message`: `The scenario's start page loaded, and the reply it was to wait for did
  not end as start_wait_for_response says. Step scenario_start waited for a GET /api/notes reply, and the
  page sent no such request before the step ended.` (the same in 3 of 3 captures), with a remedy that names
  the request and `command_timeout_ms`. No Evidence is written, as for any failure before the first step.

Not added, and why: a launch member for the sandbox (`browser.sandbox: false`), which the referee asked
for. The sandbox opt-out is a decision of whoever runs the REA process (`REA_BROWSER_NO_SANDBOX`); as a
scenario member every MCP caller could switch the sandbox off. That is a change of authority and needs the
owner's decision, not a capture detail. The prefix is printed only when `target.browser.no_sandbox` is set,
which is the Linux root or container case where the prefix is valid shell.

## 4. New and changed record members

Everything is in members older readers already accept, except the two marked "new member", which appear
only when a new input asks for them.

| Member                                                                                 | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `steps[].artifacts.title`                                                              | **New member**, present only when the `title` snapshot is selected: `{ "state": "captured", "value": "<document.title>" }` or `{ "state": "missing", "reason" }`. Declared secrets are redacted.                                                                                                                                                                                                                                                                                                                                                         |
| `completeness.missing_sections`                                                        | **New value** `"title"`, only when a selected title could not be read or its step was not executed.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `events.items[]` of kind `network-content`, `phase: "response"`, `body.representation` | `"browser-decoded-response-bytes"` for a body read from the browser's copy (nearly all of them now). `"playwright-response-body-bytes"` remains for the fallback. Both values existed.                                                                                                                                                                                                                                                                                                                                                                   |
| same, `body.state` for status 3xx                                                      | `not_exposed` for a redirect; `captured` with 0 bytes for a 304. Was `unavailable`, reason `body-read-failed`, message "Response body is unavailable for redirect responses".                                                                                                                                                                                                                                                                                                                                                                            |
| same, `phase: "request"`, zero-length body                                             | `captured`, `bytes: 0`, `content: ""`, with the request's media type. Was `not_exposed`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `body.reason` values                                                                   | No new value. `response-unfinished` now means: not whole 2 s after the last step. `request-failed` now means: the load failed **and** the browser holds no whole reply. `body-size-limit` is unchanged, with `observed_bytes`.                                                                                                                                                                                                                                                                                                                           |
| `request-unfinished` event                                                             | Still emitted when the page had not ended a load at the cutoff, also when the reply was recorded whole. Read the body state, not this event, to know whether the reply is there.                                                                                                                                                                                                                                                                                                                                                                         |
| `steps[].status` and `error` for a deadline                                            | `failed`, and `error` starts with one of: `Step <id> ran out of time: its timeout_ms deadline of <n> ms passed before it completed.` / `Step <id> ran out of time: the scenario's step_timeout_ms deadline of <n> ms passed before it completed. Give this step a timeout_ms of its own or raise step_timeout_ms.` / `Step <id> was running when the capture reached its capture_timeout_ms deadline of <n> ms. Raise capture_timeout_ms, or find what this step waits for.` The browser driver's message follows when it says what the step waited for. |
| steps after a capture deadline                                                         | `cancelled`, `error: "not executed: the capture reached its capture_timeout_ms deadline of <n> ms"`; snapshots it left undone are `missing` with that reason; `limitations` gains one line naming the step. The command still exits 0 and writes Evidence.                                                                                                                                                                                                                                                                                               |
| a `goto` the browser refuses                                                           | `failed`, `error: "Step <id> could not navigate. <what happened> The browser reported net::ERR_... <what to change>"`.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `limitations`                                                                          | Reworded lines about how bodies were read and the 2 s settle; one line when the browser kept no copy of bodies (older Chromium without the command).                                                                                                                                                                                                                                                                                                                                                                                                     |
| `parameters`                                                                           | The new input members, when given.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

An older reader and a new capture, checked with the build at 0e089b3:

- a capture that uses no new input: the old build reads it, `compare-scenario-behavior` old-capture against
  new-capture reads `unchanged`, 4 of 4 steps;
- captures taken with `start_wait_for_response` and `wait_for_response` (they appear in `parameters` only):
  the old build's comparer reads them, and reads the slower rebuild of both recipes `unchanged` (5 of 5 and
  4 of 4 steps);
- a capture taken with `capture_timeout_ms`, `step_timeout_ms` and raised `capture.limits`: the old build's
  comparer reads it;
- a capture that selected `title`: the old build refuses it ("not a complete browser scenario capture").
  The record schema is strict, so this cannot be avoided for a new member; it is why `title` is opt-in.

## 5. Failures of the command itself (C3, C4)

- Start address the browser refuses: exit 1, `message`: `The scenario's start address did not load. The
  browser refuses to connect to port 5060: it is on Chromium's list of ports reserved for other protocols,
  so http://127.0.0.1:5060/static never loads in it. The browser reported net::ERR_UNSAFE_PORT.`,
  `remediation.action`: `Serve the application on another port and capture that address.`,
  `details.diagnostics.browser_error`: `net::ERR_UNSAFE_PORT`. Also worded: connection refused, name not
  resolved, unreachable, no HTTP reply, certificate, redirect loop, aborted, error status without a page;
  any other `net::ERR_` name is passed on with a general remedy. Before: "REA did not classify the failure".
- Start page that never reaches its load event: exit 1, code `provider_timeout`, names `command_timeout_ms`
  with its value and says to start on a page that loads.
- No hang is left: launch and the start navigation have `command_timeout_ms` (20 s default each), the
  steps have `capture_timeout_ms`, body reads 5 s each, cleanup 30 s. With `capture_timeout_ms` set, the
  command needs no outer `timeout`.

## 6. The summary form

`--detail summary` now gives `summary.step_counts` (`total`, `completed`, `failed`, `cancelled`,
`incomplete_capture`) and lists in `summary.steps` only the steps that did not complete or lack a selected
snapshot. A listed step always states `before_url`. Measured on one scenario of 48 `request` steps that all
complete (49 steps with `scenario_start`), same input to both builds:

|                  | bytes  | tokens (`--token-count`) | `steps` list                                                                                             | `completeness`                               |
| ---------------- | ------ | ------------------------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| build at 0e089b3 | 25,285 | 8,231                    | 20,544 bytes, 49 entries                                                                                 | `incomplete`, `missing_sections: ["events"]` |
| this branch      | 6,993  | 1,931                    | 2 bytes, 0 entries; `step_counts: {total 49, completed 49, failed 0, cancelled 0, incomplete_capture 0}` | `complete`, `equality_eligible: true`        |

With one failing wait in such a capture the new summary was 7,935 bytes (2,249 tokens), 802 of them the
list of steps that did not complete; the old build gave 26,229 bytes (8,463 tokens) for it. The old
`incomplete` came from the absent bodies of GET requests, which counted as a gap.

## 7. What the comparer must read

The comparer of the base keeps working: its 2 test files and the clone-run tests pass on this branch
unchanged. **The comparer branch does not: its `scenarioBehaviorComparisonCoverage.test.ts` walks the
capture record's schema to its leaves and fails on a field nobody classified, which `steps[].artifacts.title`
is until item 1 is done.** To use what is new:

1. **Title.** `steps[].artifacts.title` is a new unit of a step: one string per step, present when
   `state` is `captured`, not recorded otherwise (absent member, or `missing`). It belongs in
   `StepObservation` beside `text`, and the closed-world table needs a row for
   `steps[].artifacts.title` and for the `"title"` value of `missing_sections`, or that test fails on
   integration. Renames apply to it like to on-screen text (app-2 shows `Rooms · Brassnook`).
2. **Empty request bodies.** A zero-length form post now arrives through `recordedRequestBody` as
   `{ kind: "text", text: "" }` (it has a media type), and a body-less `fetch` POST as `{ kind: "none" }`.
   Before, the first was `not-recorded`. Both sides run the same browser, so both read the same.
3. **Reasons.** No new reason. `request-failed` and `response-unfinished` are now rare and mean the reply
   really was not whole; the fold over captures for a lost body is still right but should almost never be
   needed. `body-size-limit` on one side only stays the `value` case.
4. **A failed step's `error`** may now start with a deadline sentence. It is text for the reader; compare
   the outcome, as now.
5. **Do not compare** `body.representation`, `request-unfinished` against `request-finished`, or
   `limitations`: all three can differ between two captures of one application.

## 8. What the referee's renderer should change

`renderCloneRunScenario` in `CloneRunWorkspace.ts`:

1. Add `capture_timeout_ms: target.limits.capture_timeout_seconds * 1000` to the rendered document and drop
   `timeout <seconds>` from `cloneRunCaptureCommand`. Consider `step_timeout_ms` (15000 is what the
   examples write on every step) so an author's forgotten `timeout_ms` cannot wait for the whole capture.
2. Add `"title"` to `after_each_step` and `at_end` once the comparer reads it.
3. Pass `start_wait_for_response` through from the scenario file (a new optional member beside
   `start_path`), and let `wait_for_response` on actions through: it is part of the action schema, so a
   scenario file that uses it already validates.
4. All three change the rendered document and so `scenario_sha256`: captures taken before are stale by the
   referee's own rule.
5. A capture that fails before any step (refused start address, start page that never loads) writes no
   Evidence and exits 1 with `message` and `remediation.action`. The worklist item for a capture that keeps
   failing can quote those two members instead of asking for the capture again.
6. The receipt filter `summary.normalized_result.summary.completeness` still exists.
   `summary.normalized_result.summary.step_counts` is the smaller thing to print for "did every step run".
7. **C5, the body limit.** The member is `capture.limits.max_network_body_bytes` (default 65536). Tried on
   the fixture's 73,734-byte reply: with the default it is `body-size-limit` with `observed_bytes: 73734`
   and the capture is `incomplete`; with `262144` it is `captured` in 20 of 20 request steps of one capture
   and the capture is `complete`. `max_network_body_allocation_bytes` (default 1 MiB) did not have to be
   raised for those 1.47 MB of bodies. The limit is part of the rendered document, so of `scenario_sha256`.
8. **`npm run verify:clone-run` fails on this branch at one case, and has to change with it:** "a file
   saved through a download link: its step is unknown and never a match" in
   `scripts/lib/clone-run-e2e-mutant-cases.mjs`. The fixture's `topics.csv` is now recorded, so the step
   matches for the same file (`exit 0, done`) and the case's first assertion (`parity_unknown`) fails; the
   five cases after it are not run. With that one case restated and nothing else changed, all 20 cases
   pass (`verified: true`, 4 min 17 s): the same file reads `done` with `download-link` and
   `download-fetched` unchanged, and the `download-separator` mutant reads `not done`, `parity_changed`,
   one item for both steps (`id,title,slug,pinned...` against `id;title;slug;pinned...`). The restated
   case, runnable as it is, and both logs are in `/home/user/rea-design/m1/fix3-scratch/capture/clone-run/`.
   I did not edit the verifier: it is not a file of the capture package. The reference page's sentence
   that no capture records what a download link saved needs the same change, with the limit from
   section 2 (a file that has not arrived whole when the browser takes the download over is still
   `request-failed`).

## 9. What the playbook's recipes should change

Both click recipes become one step shorter in what can go wrong:

- **A write the page follows with a fetch of the list.** Put `"wait_for_response": { "method": "GET",
  "path": "/api/notes" }` on the click. The POST and the GET are recorded in the click's step and its
  snapshot shows the new list. The `wait_for` step after it can stay as the cited step.
- **A notice after a refusal.** Put `"wait_for_response": { "method": "POST", "path": "/api/strict-notes" }`
  on the click, with or without `"status": [422]`. Without the list the comparison reads the status (a
  rebuild that refuses with 500 and shows the same notice reads `changed`, `status` on
  `POST /api/strict-notes#1`). With it that rebuild's step fails: `Step save-empty waited for a POST
  /api/strict-notes reply with status 422; it answered 500.` The sentence "a click that waits for its
  reply fails the step when the reply is not 2xx" is true of `save_response` only.
- **A page that loads its data.** `start_wait_for_response`, or `wait_for_response` on the `goto`, naming
  the data request. Without it the initial state of a rebuild that answers 300 ms later shows the page
  before its data, and `scenario_start` reads `changed` (measured below, and in a single trial: the list
  is absent from the snapshot without the wait and present with it, for the start page and for a `goto`).
- Drop the advice that another capture supplies a lost body, and the `no-store` warning.

Lines of `docs/reference/clone-runs.md`, section "Limits of what a capture records", that are no longer
true (I did not edit that file, the comparer and referee packages do):

- "A capture can lose a reply body. Replies sent with `Cache-Control: no-store` were lost in 21 of 90 ...
  Another capture supplies a lost body." Replace with: a reply body is recorded whatever the page does with
  it and whatever its cache headers; it is missing only over the size limit, when the reply had not arrived
  whole 2 seconds after the last step, or when the page abandoned it half way.
- "and so is the body of every redirect": a redirect's body is `not_exposed`, which is not a gap.
- "A request belongs to the step during which it was observed, so a request a reply triggers can land in
  the next step, and an accessibility snapshot can precede the render it caused. A click that waits for its
  reply avoids this.": keep, and name `wait_for_response` as the wait, with any status.
- "A click or press that waits for its reply fails the step when the reply is not 2xx": say `save_response`.
- "Differ only in appearance, headers, the title ...: not stopped": the title can be compared once 7.1 is
  done.
- The three places that say a download is recorded by no capture: "A body recorded by no capture of either
  side is a download or a reply over 64 KiB on both sides", "the content of a file saved through a
  download are not compared", and the row "Serve a download with other content: `parity_unknown` at the
  step that saves it". A file that arrives whole with its headers is recorded now (the fixture's is, in
  every capture taken), and a clone that serves other content reads `parity_changed` at the step that
  saves it. The `request` step the prober adds for a download is still the way to be sure for a larger
  file.

## 10. Measurements

Loss of what the browser was given, over 40 captures of one scenario that meets every defect (23 steps; it
ends right after a click whose reply the page never reads). Load average is the machine's one-minute
average, read before each capture; four other agents were working on the same 4 CPUs throughout, so "at
rest" means "no load of my own".

| What is counted                                            | before, no load of mine                                    | before, 8 CPU burners | after, no load of mine        | after, 8 CPU burners |
| ---------------------------------------------------------- | ---------------------------------------------------------- | --------------------- | ----------------------------- | -------------------- |
| load average while measuring (min / mean / max)            | 3.03 / 6.16 / 7.66                                         | 8.29 / 12.44 / 15.60  | 8.13 / 9.25 / 10.82           | 9.09 / 15.81 / 18.30 |
| seconds per capture (min / mean / max)                     | 2.6 / 3.3 / 4.6                                            | 4.8 / 8.7 / 17.7      | 3.3 / 4.1 / 5.3               | 12.4 / 17.0 / 31.2   |
| reply the page never reads (cacheable), last step          | **40 of 40 lost** (`response-unfinished`)                  | 35 of 40 lost         | 0 of 40                       | 0 of 40              |
| reply the page never reads (`no-store`)                    | **40 of 40 lost** (`response-unfinished`)                  | 40 of 40 lost         | 0 of 40                       | 0 of 40              |
| `no-store` reply to a `request` step                       | **174 of 240 lost** (`request-failed`, `net::ERR_ABORTED`) | 197 of 240 lost       | 0 of 240                      | 0 of 240             |
| `no-store` reply the page reads through a stream reader    | 4 of 40 lost (`request-failed`)                            | 7 of 40 lost          | 0 of 40                       | 0 of 40              |
| reply without a cache header to a `request` step (control) | 0 of 80                                                    | 0 of 80               | 0 of 80                       | 0 of 80              |
| request body of a form post without fields                 | 40 of 40 `not_exposed`                                     | 40 of 40              | 0 of 40 (`captured`, 0 bytes) | 0 of 40              |
| body of a 304 to a conditional request                     | 40 of 40 `body-read-failed`                                | 40 of 40              | 40 of 40 `captured`, 0 bytes  | 40 of 40             |
| body of a 303 to a form post                               | 40 of 40 `body-read-failed`                                | 40 of 40              | 40 of 40 `not_exposed`        | 40 of 40             |

"Before" is the build at 3eb71f14, whose capture code is that of 0e089b3. "After" is the branch's source
as last changed (9de03614; the commits after it, up to df4200d7, change tests, scripts and documents
only; `final-rest.json`, `final-load.json`). The same measurement on the commit that first
held the body change (8cab977d) also lost nothing in any row, at a higher load: 13.60 / 16.80 / 18.83
without load of mine and 19.19 / 23.53 / 29.74 under 8 burners, at 6.1 s and 32.2 s per capture
(`after-rest.json`, `after-load.json`). No capture failed to write Evidence in any of the six runs. The
raw results are in `/home/user/rea-design/m1/fix3-scratch/capture/measure/`. Reproduce with
`node scripts/measure-capture-loss.mjs --captures 40 [--load 8] [--rea PATH]`, or
`npm run verify:browser:bodies`, which fails when anything is lost.

The two click recipes on the fixture application: verdict of `compare-scenario-behavior`, original against
a correct but slower rebuild and against wrong rebuilds.

"Slower" answers every request to its API 300 ms later, reads included. Each wrong rebuild is as slow and
gets one thing wrong. Two runs per row, two captures a side per run, so 4 captures of each rebuild per
row. Load is the one-minute average when the run started.

| Build and recipe                                   | Waits                                                                                | Load       | Slower rebuild                                                                                                                                                                    | Wrong rebuilds                                                                                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0e089b3, list after a write                        | none                                                                                 | 11.5, 13.4 | **changed** 2 of 2: `scenario_start` text; the click's text and its `GET /api/notes`; the list request is recorded in the next step                                               | changed 2 of 2 each                                                                                                                                                                                      |
| 0e089b3, notice after a refusal                    | none                                                                                 | 13.7, 12.3 | **changed** once (the click's text), **unknown** once (the original's own two captures disagree on the click's text)                                                              | changed 2 of 2 each                                                                                                                                                                                      |
| this branch, list after a write                    | none                                                                                 | 9.9, 9.1   | **changed** 2 of 2: `scenario_start` text; the click's step is `unstable`, because the original's own two captures disagree on its text and on the step `GET /api/notes` lands in | changed 2 of 2 each                                                                                                                                                                                      |
| this branch, notice after a refusal                | none                                                                                 | 9.3, 13.4  | **changed** 2 of 2 (the click's text)                                                                                                                                             | changed 2 of 2 each                                                                                                                                                                                      |
| this branch, list after a write                    | `start_wait_for_response` and the click's `wait_for_response`, both `GET /api/notes` | 8.7, 8.5   | **unchanged** 2 of 2                                                                                                                                                              | drops the write: changed 2 of 2 (the click's text, `body/length` and `body/value` of `GET /api/notes#1`, and `see-third` fails). Never shows the list: changed 2 of 2 (`scenario_start` text onwards)    |
| this branch, notice after a refusal                | the click's `wait_for_response`, `POST /api/strict-notes`, any status                | 13.7, 12.8 | **unchanged** 2 of 2                                                                                                                                                              | never shows the notice: changed 2 of 2 (the click's text, `see-title-required` fails). Refuses with 500 and shows the same notice: changed 2 of 2 (`status` of `POST /api/strict-notes#1`, nothing else) |
| this branch, list after a write, 8 CPU burners     | as above                                                                             | 16.5, 19.9 | **unchanged** 2 of 2                                                                                                                                                              | changed 2 of 2 each, same findings                                                                                                                                                                       |
| this branch, notice after a refusal, 8 CPU burners | as above                                                                             | 16.2, 14.4 | **unchanged** 2 of 2                                                                                                                                                              | changed 2 of 2 each, same findings                                                                                                                                                                       |

Where the request the click triggers was recorded, on the slower rebuild, in every one of the 4 captures of
each row: without the wait `POST /api/notes` in the click's step and `GET /api/notes` in the step after it;
with the wait both in the click's step, at rest and under load.

Single trials on the same fixture (new build): a click that waits with `"status": [422]` on the rebuild
that refuses with 500 fails with `Step save-empty waited for a POST /api/strict-notes reply with status
422; it answered 500.`; a `goto` and a start page on the slower rebuild show the list in their own
snapshot only with the wait. Logs and results: `/home/user/rea-design/m1/fix3-scratch/capture/recipes/`.
Reproduce with `node scripts/verify-capture-recipes.mjs --recipe both [--load 8] [--rea PATH]`.
