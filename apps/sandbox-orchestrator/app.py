"""
sandbox-orchestrator — FastAPI service that takes a code submission plus
a list of test cases, spawns a hardened Docker runner per test case, and
returns a per-test verdict plus an overall rollup.

The HTTP boundary is intentionally small (single POST /run endpoint) so
api-core can call it synchronously today and, once we front it with a
BullMQ queue in P4, swap the caller without touching this service.

Hardening flags applied to every runner container match the policy in
docs/architecture/security.md §Sandbox isolation. Any change to the
flag set must be paired with an update to that doc and a regression
test in test_sandbox.py (lands alongside the load-test in P8).
"""

from __future__ import annotations

import json
import logging
import subprocess
import time
import uuid
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("sandbox")

# Every supported language maps to a pre-built Docker image and a file
# extension. Adding a language here + a Dockerfile under
# infra/sandbox-images/<lang>/ is all it takes to onboard a new runtime.
LANGUAGE_IMAGES: dict[str, str] = {
    "cpp": "lms-runner-cpp:latest",
}

# Wall-clock cap applied from the orchestrator side. The runner itself
# enforces a CPU cap via ulimit -t 2; this one catches stuck containers
# that slip through (infinite loop on a low-cpu share).
RUNNER_WALL_TIMEOUT_S = 5

# Cap the stdout length the runner can return to avoid unbounded log
# growth. The runner also truncates on its side (64 KB) — this is defense
# in depth.
MAX_STDOUT_LEN = 65_536


Verdict = Literal["ac", "wa", "tle", "mle", "ce", "re", "ie"]


class TestCaseIn(BaseModel):
    id: str
    input: str = ""
    expected_output: str = ""


class RunRequest(BaseModel):
    language: str = Field(pattern=r"^(cpp|c|js|python)$")
    source: str = Field(min_length=1, max_length=64 * 1024)
    test_cases: list[TestCaseIn] = Field(default_factory=list, max_length=32)


class TestCaseResult(BaseModel):
    test_case_id: str
    passed: bool
    verdict: Verdict
    actual_output: str = ""
    runtime_ms: Optional[int] = None


class RunResponse(BaseModel):
    verdict: Verdict  # overall rollup
    compile_error: Optional[str] = None
    stderr: Optional[str] = None
    runtime_ms: Optional[int] = None
    test_results: list[TestCaseResult] = Field(default_factory=list)


app = FastAPI(title="lms sandbox-orchestrator", version="0.1.0")


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok", "service": "sandbox-orchestrator"}


@app.post("/run", response_model=RunResponse)
def run(req: RunRequest) -> RunResponse:
    image = LANGUAGE_IMAGES.get(req.language)
    if not image:
        raise HTTPException(status_code=400, detail={
            "code": "language_not_supported",
            "message": f"No runner image for language {req.language!r}",
        })

    # No test cases → a single "run as-is, compare to empty expected" execution.
    # Useful for the teacher preview button (no grading, just a smoke run).
    tcs = req.test_cases or [TestCaseIn(id="smoke", input="", expected_output="")]

    results: list[TestCaseResult] = []
    compile_error: Optional[str] = None
    total_runtime_ms = 0
    overall_verdict: Verdict = "ac"

    for tc in tcs:
        try:
            envelope = {"source": req.source, "input": tc.input}
            raw = _run_container(image, envelope)
        except RunnerTimeout:
            log.warning("runner wall-timeout on tc=%s", tc.id)
            results.append(TestCaseResult(test_case_id=tc.id, passed=False, verdict="tle"))
            overall_verdict = _worst(overall_verdict, "tle")
            continue
        except RunnerError as e:
            log.exception("runner error on tc=%s", tc.id)
            results.append(TestCaseResult(
                test_case_id=tc.id, passed=False, verdict="ie", actual_output=str(e)[:500],
            ))
            overall_verdict = _worst(overall_verdict, "ie")
            continue

        # Compile error short-circuits — no point running the remaining TCs.
        if raw.get("verdict") == "ce":
            compile_error = raw.get("stderr", "")[:4_096]
            overall_verdict = "ce"
            results.append(TestCaseResult(
                test_case_id=tc.id, passed=False, verdict="ce",
            ))
            break

        runner_verdict = raw.get("verdict", "ie")
        stdout = (raw.get("stdout") or "")[:MAX_STDOUT_LEN]
        runtime_ms = int(raw.get("runtime_ms") or 0)
        total_runtime_ms += runtime_ms

        if runner_verdict == "tle":
            tc_verdict: Verdict = "tle"
            passed = False
        elif runner_verdict == "mle":
            tc_verdict = "mle"
            passed = False
        elif runner_verdict == "re":
            tc_verdict = "re"
            passed = False
        elif runner_verdict == "ok":
            # Orchestrator grades equality. Strict string compare minus
            # trailing newlines so students aren't punished for a missing \n.
            got = stdout.rstrip("\n")
            want = tc.expected_output.rstrip("\n")
            if got == want:
                tc_verdict = "ac"
                passed = True
            else:
                tc_verdict = "wa"
                passed = False
        else:
            tc_verdict = "ie"
            passed = False

        results.append(TestCaseResult(
            test_case_id=tc.id,
            passed=passed,
            verdict=tc_verdict,
            actual_output=stdout,
            runtime_ms=runtime_ms,
        ))
        overall_verdict = _worst(overall_verdict, tc_verdict)

    return RunResponse(
        verdict=overall_verdict,
        compile_error=compile_error,
        runtime_ms=total_runtime_ms,
        test_results=results,
    )


# ----------------------------------------------------------------------------
# internals
# ----------------------------------------------------------------------------

class RunnerError(RuntimeError):
    pass


class RunnerTimeout(RuntimeError):
    pass


def _run_container(image: str, envelope: dict) -> dict:
    """Spawn the runner image, pipe the JSON envelope to stdin, parse JSON
    output from stdout. Enforces hardening flags per security.md."""
    container_name = f"lms-run-{uuid.uuid4().hex[:10]}"
    cmd = [
        "docker", "run", "--rm", "-i",
        "--name", container_name,
        "--network=none",
        "--read-only",
        "--tmpfs", "/tmp:size=10m,mode=1777,exec,nosuid,nodev",
        "--memory=128m", "--memory-swap=128m",
        "--cpus=0.5",
        "--pids-limit=64",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--user=10001:10001",
        "--ulimit", "nofile=64",
        "--ulimit", "nproc=32",
        image,
    ]

    body = json.dumps(envelope).encode("utf-8")
    start = time.perf_counter()
    try:
        proc = subprocess.run(
            cmd,
            input=body,
            capture_output=True,
            timeout=RUNNER_WALL_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        # The container is still running — kill it explicitly so the host
        # doesn't accrete orphans.
        subprocess.run(["docker", "kill", container_name], capture_output=True, timeout=5)
        raise RunnerTimeout(f"wall timeout after {RUNNER_WALL_TIMEOUT_S}s")
    wall_ms = int((time.perf_counter() - start) * 1000)

    if proc.returncode != 0:
        # Runner's entry script is supposed to always exit 0; non-zero here
        # means docker itself failed (e.g. image missing).
        err = proc.stderr.decode("utf-8", errors="replace")[:500]
        raise RunnerError(f"docker exit {proc.returncode}: {err}")

    try:
        parsed = json.loads(proc.stdout.decode("utf-8", errors="replace"))
    except json.JSONDecodeError as e:
        raise RunnerError(f"bad runner output: {e}") from e

    # Ensure runtime_ms reflects runner's own measurement when available,
    # falling back to wall clock.
    if not parsed.get("runtime_ms"):
        parsed["runtime_ms"] = wall_ms
    return parsed


# Verdict severity ranking. Worse verdicts sit earlier in the list so we can
# bubble up the worst-so-far as the overall result.
_SEVERITY: dict[str, int] = {"ac": 0, "wa": 1, "re": 2, "tle": 3, "mle": 4, "ce": 5, "ie": 6}


def _worst(a: Verdict, b: Verdict) -> Verdict:
    return a if _SEVERITY[a] >= _SEVERITY[b] else b
