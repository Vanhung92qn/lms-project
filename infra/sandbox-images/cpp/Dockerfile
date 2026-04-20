# lms-runner-cpp — minimal C++ execution image.
#
# Build stage: Alpine + g++ for compilation.
# Runtime stage: same Alpine + runtime libraries + a non-root user + our
# entry script. Size target: < 100 MB.
#
# Hardening applied AT RUN TIME (the orchestrator passes the flags):
#   --network=none --read-only --tmpfs /tmp --memory=128m --cpus=0.5
#   --pids-limit=64 --cap-drop=ALL --security-opt=no-new-privileges
#   --user=10001:10001 --ulimit cpu=2 --timeout 3s wall
# See docs/architecture/security.md §Sandbox isolation.

FROM alpine:3.19

# g++ toolchain + jq for the entry script envelope parsing.
RUN apk add --no-cache g++ musl-dev jq coreutils && \
    addgroup -g 10001 runner && \
    adduser  -D -u 10001 -G runner runner

# The entry script lives in /sandbox and is owned by root (runner can execute
# but not modify). /tmp is a tmpfs at runtime — writable, scratch space.
COPY entry.sh /sandbox/entry.sh
RUN chmod 0555 /sandbox/entry.sh

USER runner:runner
WORKDIR /tmp

ENTRYPOINT ["/sandbox/entry.sh"]
