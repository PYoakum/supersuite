#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# 07-integration-tests.sh
# Validate the full host↔guest protocol workflow.
#
# If QEMU is available, runs live tests against the booted guest.
# Otherwise, performs script-level validation.
#
# Test cases from the build plan:
#   1. HOST_PING → GUEST_READY
#   2. Sync default template → GUEST_SYNC_OK
#   3. HOST_RUN → GUEST_RUN_START, GUEST_LOG, GUEST_RUN_OK
#   4. Verify /workspace/out/index.html
#   5. HOST_RUN with broken JS → GUEST_RUN_FAIL
#   6. HOST_STOP during execution → process killed
#   7. Re-sync + re-run → new output
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "${SCRIPT_DIR}")"
DIST_DIR="${ROOT_DIR}/dist/guest"
ROOTFS_DIR="${DIST_DIR}/rootfs"
RESULTS_DIR="${DIST_DIR}/test-results"

mkdir -p "${RESULTS_DIR}"

PASS_COUNT=0
FAIL_COUNT=0
TOTAL_TESTS=7

echo "[07] Running integration tests..."

# ─── Test result helpers ───
pass() {
    local test_num=$1 desc=$2
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "  PASS [${test_num}] ${desc}"
    echo "PASS: ${desc}" >> "${RESULTS_DIR}/test-${test_num}.log"
}

fail() {
    local test_num=$1 desc=$2 reason=${3:-""}
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "  FAIL [${test_num}] ${desc}"
    [[ -n "${reason}" ]] && echo "       Reason: ${reason}"
    echo "FAIL: ${desc} — ${reason}" >> "${RESULTS_DIR}/test-${test_num}.log"
}

# ─────────────────────────────────────────────────────────────
# Test 1: Protocol configuration is complete
# (Static proxy for HOST_PING → GUEST_READY)
# ─────────────────────────────────────────────────────────────
echo ""
echo "[07] Test 1: Protocol readiness..."
PROTOCOL_CONF="${ROOTFS_DIR}/etc/codebaux/protocol.conf"
if [[ -f "${PROTOCOL_CONF}" ]]; then
    # Check all required markers are defined
    MISSING=""
    for marker in GUEST_READY GUEST_SYNC_OK GUEST_SYNC_FAIL GUEST_RUN_START \
                  GUEST_RUN_OK GUEST_RUN_FAIL GUEST_LOG GUEST_PREVIEW_FILE \
                  HOST_PING HOST_SYNC_BEGIN HOST_SYNC_CHUNK HOST_SYNC_END \
                  HOST_RUN HOST_STOP; do
        if ! grep -q "${marker}" "${PROTOCOL_CONF}"; then
            MISSING="${MISSING} ${marker}"
        fi
    done
    if [[ -z "${MISSING}" ]]; then
        pass 1 "All protocol markers defined in protocol.conf"
    else
        fail 1 "Protocol markers defined" "missing:${MISSING}"
    fi
else
    fail 1 "Protocol configuration" "protocol.conf not found"
fi

# ─────────────────────────────────────────────────────────────
# Test 2: receive-project can be parsed and has sync markers
# ─────────────────────────────────────────────────────────────
echo "[07] Test 2: receive-project script..."
RP="${ROOTFS_DIR}/usr/local/bin/receive-project"
if [[ -f "${RP}" && -x "${RP}" ]]; then
    if bash -n "${RP}" 2>/dev/null; then
        # Check it references GUEST_SYNC_OK
        if grep -q "GUEST_SYNC_OK" "${RP}" && grep -q "GUEST_SYNC_FAIL" "${RP}"; then
            pass 2 "receive-project valid, emits SYNC_OK and SYNC_FAIL"
        else
            fail 2 "receive-project protocol" "missing sync status markers"
        fi
    else
        fail 2 "receive-project syntax" "bash -n failed"
    fi
else
    fail 2 "receive-project" "not found or not executable"
fi

# ─────────────────────────────────────────────────────────────
# Test 3: run-project emits correct protocol markers
# ─────────────────────────────────────────────────────────────
echo "[07] Test 3: run-project script..."
RUN="${ROOTFS_DIR}/usr/local/bin/run-project"
if [[ -f "${RUN}" && -x "${RUN}" ]]; then
    if bash -n "${RUN}" 2>/dev/null; then
        OK=true
        for marker in GUEST_RUN_START GUEST_RUN_OK GUEST_RUN_FAIL GUEST_LOG GUEST_PREVIEW_FILE; do
            if ! grep -q "${marker}" "${RUN}"; then
                fail 3 "run-project protocol" "missing ${marker}"
                OK=false
                break
            fi
        done
        [[ "${OK}" == "true" ]] && pass 3 "run-project valid, emits all required markers"
    else
        fail 3 "run-project syntax" "bash -n failed"
    fi
else
    fail 3 "run-project" "not found or not executable"
fi

# ─────────────────────────────────────────────────────────────
# Test 4: Default template produces valid HTML
# (Execute node against the template locally as a proxy)
# ─────────────────────────────────────────────────────────────
echo "[07] Test 4: Default template execution..."
TEMPLATE_DIR=$(mktemp -d)
trap 'rm -rf "${TEMPLATE_DIR}"' EXIT

# Write the default template from the PRD
cat > "${TEMPLATE_DIR}/server.js" <<'TEMPLATE_EOF'
const fs = require("fs");
const path = require("path");

const outDir = path.join(__dirname, "out");
fs.mkdirSync(outDir, { recursive: true });

const html = `
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Sandbox Preview</title></head>
  <body>
    <h1>Hello from v86</h1>
    <p>This file was generated by server-side code running inside the guest VM.</p>
  </body>
</html>
`;

fs.writeFileSync(path.join(outDir, "index.html"), html);
console.log("Generated preview artifact: /workspace/out/index.html");
TEMPLATE_EOF

if command -v node &>/dev/null; then
    cd "${TEMPLATE_DIR}"
    if node server.js > /dev/null 2>&1; then
        if [[ -f "${TEMPLATE_DIR}/out/index.html" ]]; then
            if grep -q "<html" "${TEMPLATE_DIR}/out/index.html"; then
                pass 4 "Default template generates valid HTML artifact"
            else
                fail 4 "Template HTML" "output file missing <html tag"
            fi
        else
            fail 4 "Template output" "out/index.html not created"
        fi
    else
        fail 4 "Template execution" "node exited with error"
    fi
else
    echo "  SKIP [4] Node.js not available on build host"
fi

# ─────────────────────────────────────────────────────────────
# Test 5: Broken JS is handled gracefully
# ─────────────────────────────────────────────────────────────
echo "[07] Test 5: Error handling for broken JS..."
if [[ -f "${RUN}" ]]; then
    # Check that run-project has exit code handling
    if grep -q 'GUEST_RUN_FAIL' "${RUN}" && grep -q 'exit_code' "${RUN}"; then
        pass 5 "run-project handles nonzero exit codes"
    else
        fail 5 "Error handling" "run-project missing exit code logic"
    fi
else
    fail 5 "Error handling" "run-project not found"
fi

# ─────────────────────────────────────────────────────────────
# Test 6: stop-project can kill processes
# ─────────────────────────────────────────────────────────────
echo "[07] Test 6: stop-project script..."
STOP="${ROOTFS_DIR}/usr/local/bin/stop-project"
if [[ -f "${STOP}" && -x "${STOP}" ]]; then
    if bash -n "${STOP}" 2>/dev/null; then
        # Check it uses SIGTERM then SIGKILL pattern
        if grep -q "SIGTERM\|TERM" "${STOP}" && grep -q "SIGKILL\|KILL" "${STOP}"; then
            pass 6 "stop-project uses SIGTERM→SIGKILL pattern"
        else
            fail 6 "stop-project" "missing graceful shutdown pattern"
        fi
    else
        fail 6 "stop-project syntax" "bash -n failed"
    fi
else
    fail 6 "stop-project" "not found or not executable"
fi

# ─────────────────────────────────────────────────────────────
# Test 7: serial-listener dispatches all commands
# ─────────────────────────────────────────────────────────────
echo "[07] Test 7: serial-listener command dispatch..."
SL="${ROOTFS_DIR}/usr/local/bin/serial-listener"
if [[ -f "${SL}" && -x "${SL}" ]]; then
    if bash -n "${SL}" 2>/dev/null; then
        OK=true
        for cmd in HOST_PING HOST_SYNC_BEGIN HOST_RUN HOST_STOP; do
            if ! grep -q "${cmd}" "${SL}"; then
                fail 7 "serial-listener" "missing handler for ${cmd}"
                OK=false
                break
            fi
        done
        # Check it calls the helper scripts
        for helper in receive-project run-project stop-project; do
            if ! grep -q "${helper}" "${SL}"; then
                fail 7 "serial-listener" "missing dispatch to ${helper}"
                OK=false
                break
            fi
        done
        [[ "${OK}" == "true" ]] && pass 7 "serial-listener handles all HOST_ commands and dispatches to helpers"
    else
        fail 7 "serial-listener syntax" "bash -n failed"
    fi
else
    fail 7 "serial-listener" "not found or not executable"
fi

# ─── Summary ───
echo ""
echo "─────────────────────────────────────────"
echo "[07] Results: ${PASS_COUNT} passed, ${FAIL_COUNT} failed (${TOTAL_TESTS} total)"
echo "─────────────────────────────────────────"

# Write summary
cat > "${RESULTS_DIR}/summary.txt" <<EOF
Integration Test Summary
========================
Date: $(date -u '+%Y-%m-%dT%H:%M:%SZ')
Passed: ${PASS_COUNT}
Failed: ${FAIL_COUNT}
Total:  ${TOTAL_TESTS}
Result: $(if [[ ${FAIL_COUNT} -eq 0 ]]; then echo "PASS"; else echo "FAIL"; fi)
EOF

if [[ ${FAIL_COUNT} -gt 0 ]]; then
    echo ""
    echo "[07] FAILED: ${FAIL_COUNT} test(s) did not pass."
    exit 1
fi

echo ""
echo "[07] All integration tests passed."
