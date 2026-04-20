# Runbook — Sandbox Operations

How the code-submission pipeline is wired, how to build + run it, and
how to diagnose incidents. Full architectural context in
[`docs/architecture/overview.md`](../architecture/overview.md) and
[`docs/architecture/security.md`](../architecture/security.md).

---

## Pipeline at a glance

```
  student
     │ HTTPS
     ▼
  Cloudflare edge
     │
     ▼
  Traefik (443) ─────► api-core (4000)
                           │ HTTP
                           ▼
                     sandbox-orchestrator (5001)
                           │ subprocess: docker run ...
                           ▼
                     lms-runner-<lang> container
                      (ephemeral, --rm, hardened)
```

Everything on the right side of api-core runs on the same VPS today.
The orchestrator's wire protocol is a plain `POST /run` body — when
load demands it (P4+), we'll front it with a BullMQ queue without
changing the request/response shape.

---

## Building runner images

Images live under `infra/sandbox-images/<lang>/`. Each subdir contains:

- `Dockerfile` — minimal Alpine base + compiler/interpreter + non-root
  `runner` user + our `entry.sh`.
- `entry.sh` — reads a `{ source, input }` JSON envelope from stdin,
  compiles + runs inside the container, emits a single-line JSON result
  (`{ verdict, stdout, stderr, runtime_ms, exit_code }`) on stdout.

Build all available images:

```bash
for lang in cpp; do
  docker build -t lms-runner-$lang:latest infra/sandbox-images/$lang
done
```

After an image change, the running orchestrator picks it up automatically
— each `docker run` pulls from the current local image tag.

---

## Running the orchestrator (dev)

```bash
cd apps/sandbox-orchestrator
python3 -m venv .venv                            # first time only
.venv/bin/pip install -r requirements.txt        # first time only
setsid nohup .venv/bin/uvicorn app:app --host 127.0.0.1 --port 5001 \
  > /tmp/lms-logs/sandbox.log 2>&1 < /dev/null &
disown

curl http://127.0.0.1:5001/healthz   # { "status": "ok" }
```

The orchestrator requires:
- Docker daemon reachable (either `/var/run/docker.sock` or `DOCKER_HOST`).
- All runner images pre-built and tagged locally.

No state is persisted — orchestrator is pure compute. Every container
is spawned with `--rm`, so orphans are rare, but a safety janitor is
on the roadmap (P8).

---

## Hardening flags (non-negotiable)

The orchestrator passes these flags to every `docker run` invocation.
They match the policy in `docs/architecture/security.md §Sandbox
isolation`. Any change here requires an ADR + regression test.

```
--rm --network=none --read-only
--tmpfs /tmp:size=10m,mode=1777,exec,nosuid,nodev
--memory=128m --memory-swap=128m --cpus=0.5 --pids-limit=64
--cap-drop=ALL --security-opt=no-new-privileges
--user=10001:10001 --ulimit nofile=64 --ulimit nproc=32
```

**Note on `exec` on the tmpfs mount** — Docker's default tmpfs mount is
`noexec`, which blocks execution of any binary written inside `/tmp`.
Since the runner compiles into `/tmp/main` and then runs it, we must
explicitly opt the tmpfs back into `exec`. This is safe because:
1. `--cap-drop=ALL` + `no-new-privileges` prevent setuid escalation.
2. `--read-only` makes the rest of the filesystem immutable.
3. The tmpfs is destroyed with the container.

---

## Request lifecycle

1. **api-core** receives `POST /api/v1/submissions { exercise_id,
   source_code }`.
2. Creates a `submissions` row with `verdict: 'pending'`.
3. Fetches the exercise + its test_cases from Postgres.
4. `SandboxClient.run({ language, source, test_cases })` → HTTP POST to
   orchestrator.
5. Orchestrator loops test_cases, `docker run`s one runner per case
   (compile-once-per-case for MVP; shared-compile optimisation is a
   P3b task).
6. For each test case the orchestrator returns `{ verdict, actual_output,
   runtime_ms }` and bubbles the worst overall verdict.
7. api-core persists `submission_test_results` rows and updates the
   `submissions` row with the final verdict + total runtime_ms.
8. Response is the full graded submission; 45 s upstream timeout.

---

## Diagnostic commands

```bash
# Is orchestrator alive?
curl http://127.0.0.1:5001/healthz

# Ad-hoc grade a snippet (bypass api-core)
curl -s -X POST http://127.0.0.1:5001/run -H 'Content-Type: application/json' -d '{
  "language":"cpp",
  "source":"#include <iostream>\nint main(){std::cout<<42;}",
  "test_cases":[{"id":"t1","input":"","expected_output":"42"}]
}' | jq

# Check recent submissions in the DB
docker exec lms-postgres psql -U lms -d lms -c \
  "SELECT id, user_id, verdict, runtime_ms, created_at FROM submissions ORDER BY created_at DESC LIMIT 10;"

# Orchestrator logs
tail -f /tmp/lms-logs/sandbox.log

# api-core logs (submissions flow)
tail -f /tmp/lms-logs/api.log | grep -i submission

# List running runner containers (should be zero most of the time)
docker ps --filter 'name=lms-run-'

# Purge any orphans older than 60s
docker ps --filter 'name=lms-run-' --format '{{.ID}} {{.RunningFor}}' \
  | awk '$2 ~ /minute/ { print $1 }' | xargs -r docker kill
```

---

## Troubleshooting matrix

| Symptom | Cause | Fix |
|---------|-------|-----|
| `sandbox_timeout` error from api-core | Orchestrator process down or pinned | Restart uvicorn, check logs |
| All verdicts → `ie` | Runner image missing | `docker image ls \| grep lms-runner` |
| Every submission → `ce` on valid code | tmpfs mounted `noexec` | Ensure `exec` in the tmpfs flag |
| Hello-world verdict is `re` with exit 126 "Permission denied" | Same as above (noexec) | — |
| `stdout` is truncated at 64 KB | By design — runner caps output | increase `MAX_STDOUT_LEN` in `app.py` + `head -c` in `entry.sh` |
| Orphaned `lms-run-*` containers | Orchestrator process crashed mid-run | Manual purge (see above); add janitor in P8 |
| `mle` on tight infinite loop | Exit 137 = SIGKILL (OOM or wall timeout) | Expected; refine classification post-MVP |

---

## Adding a new runner language

1. Create `infra/sandbox-images/<lang>/Dockerfile` + `entry.sh`. The
   entry script's output contract (`verdict`, `stdout`, `stderr`,
   `runtime_ms`, `exit_code`) is the same for every language.
2. Add `<lang>` to `LANGUAGE_IMAGES` in
   `apps/sandbox-orchestrator/app.py`.
3. Add the enum value to Prisma's `CodeLanguage` and migrate.
4. `docker build -t lms-runner-<lang>:latest infra/sandbox-images/<lang>/`.
5. Smoke-test with a `curl` against `/run`.
6. Ship an ADR if the language introduces new capabilities (e.g. needs
   `/dev/random`, larger memory cap, etc).

Planned next languages: `node` (P3b), `python` (P3b).

---

## Capacity & limits (MVP targets)

- **Concurrency** — single orchestrator serialising per request. Each
  submission uses ~1 CPU core for ≤ 5 s wall, so 10 concurrent grades ≈
  10 cores peak. We're within 8 vCPU headroom for <50 concurrent
  students.
- **Throughput** — ~6 submissions/s end-to-end (including compile).
  BullMQ queue lands when we exceed this.
- **Timeouts** — 5 s wall per test case (orchestrator), 45 s upstream
  (api-core). A 32-test-case submission therefore tops out at ~2.5
  minutes worst case.
- **Memory per container** — 128 MB hard cap, no swap.

---

## Known limitations (to be addressed later)

- **Compile-once-per-test-case** — wasteful; P3b will compile once and
  `docker exec` per test case in the same container.
- **Output buffering** — orchestrator waits for full output before
  returning; streaming verdicts to the student is a P4 nice-to-have.
- **No result cache** — identical `(user, exercise, source_hash)`
  re-grades from scratch. A content-addressed cache lands post-MVP.
- **Docker socket exposed** to the orchestrator (not containerised
  yet in prod). Tight access control comes with P8 hardening.
