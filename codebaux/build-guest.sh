#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# build-guest.sh
# Master build runner for the Codebaux v86 guest image.
#
# Chains all 8 build steps with consistent logging, error
# handling, and per-step timing.
#
# Usage:
#   ./build-guest.sh              # Run all steps
#   ./build-guest.sh --from 03    # Resume from step 03
#   ./build-guest.sh --only 04    # Run a single step
#   ./build-guest.sh --dry-run    # Show what would run
#   ./build-guest.sh --deploy-to ../my-app/public/guest
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STEPS_DIR="${SCRIPT_DIR}/scripts"

# Export portable helpers for sub-scripts (macOS vs GNU compatibility)
export CODEBAUX_BUILD=1

# ─── All steps in order ───
STEPS=(
    "01-fetch-v86-deps"
    "02-build-base-image"
    "03-apply-overlay"
    "04-install-helpers"
    "05-configure-init"
    "06-validate-boot"
    "07-integration-tests"
    "08-package"
)

# ─── Parse arguments ───
FROM_STEP=""
ONLY_STEP=""
DRY_RUN=false
DEPLOY_TO=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --from)
            FROM_STEP="$2"
            shift 2
            ;;
        --only)
            ONLY_STEP="$2"
            shift 2
            ;;
        --deploy-to)
            DEPLOY_TO="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [--from NN] [--only NN] [--dry-run]"
            echo ""
            echo "Options:"
            echo "  --from NN    Resume from step NN (e.g., --from 03)"
            echo "  --only NN    Run only step NN (e.g., --only 04)"
            echo "  --deploy-to  Copy artifacts to a target directory after build"
            echo "  --dry-run    Show what would run without executing"
            echo ""
            echo "Steps:"
            for step in "${STEPS[@]}"; do
                echo "  ${step}"
            done
            exit 0
            ;;
        *)
            echo "Unknown argument: $1"
            exit 1
            ;;
    esac
done

# ─── Banner ───
echo "═══════════════════════════════════════════════════════════"
echo "  Codebaux v86 Guest Image Build"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ─── Pre-flight ───
echo "Pre-flight checks:"
for tool in bash; do
    if command -v "${tool}" &>/dev/null; then
        echo "  OK: ${tool}"
    else
        echo "  MISSING: ${tool}"
        exit 1
    fi
done

# Optional tools
for tool in docker node python3 qemu-system-i386 jq; do
    if command -v "${tool}" &>/dev/null; then
        echo "  OK: ${tool} ($(${tool} --version 2>&1 | head -1 | cut -c1-40))"
    else
        echo "  SKIP: ${tool} not found (some steps may be limited)"
    fi
done
echo ""

# ─── Determine which steps to run ───
SKIP=false
if [[ -n "${FROM_STEP}" ]]; then
    SKIP=true
fi

BUILD_START=$(date +%s)
STEP_TIMES=()
FAILED_STEP=""

for step in "${STEPS[@]}"; do
    step_num="${step:0:2}"

    # Handle --from
    if [[ "${SKIP}" == "true" ]]; then
        if [[ "${step_num}" == "${FROM_STEP}" ]]; then
            SKIP=false
        else
            echo "[skip] ${step}"
            continue
        fi
    fi

    # Handle --only
    if [[ -n "${ONLY_STEP}" && "${step_num}" != "${ONLY_STEP}" ]]; then
        continue
    fi

    STEP_SCRIPT="${STEPS_DIR}/${step}.sh"

    if [[ ! -f "${STEP_SCRIPT}" ]]; then
        echo "[ERROR] Script not found: ${STEP_SCRIPT}"
        exit 1
    fi

    if [[ "${DRY_RUN}" == "true" ]]; then
        echo "[dry-run] Would execute: ${STEP_SCRIPT}"
        continue
    fi

    echo "───────────────────────────────────────────────────────"
    echo "[$(date '+%H:%M:%S')] Starting ${step}..."
    echo "───────────────────────────────────────────────────────"

    STEP_START=$(date +%s)

    if bash "${STEP_SCRIPT}"; then
        STEP_ELAPSED=$(( $(date +%s) - STEP_START ))
        STEP_TIMES+=("${step}: ${STEP_ELAPSED}s")
        echo ""
        echo "[$(date '+%H:%M:%S')] ${step} completed in ${STEP_ELAPSED}s"
        echo ""
    else
        STEP_ELAPSED=$(( $(date +%s) - STEP_START ))
        STEP_TIMES+=("${step}: FAILED after ${STEP_ELAPSED}s")
        FAILED_STEP="${step}"
        echo ""
        echo "[$(date '+%H:%M:%S')] ${step} FAILED after ${STEP_ELAPSED}s"
        break
    fi
done

BUILD_ELAPSED=$(( $(date +%s) - BUILD_START ))

# ─── Summary ───
echo ""
echo "═══════════════════════════════════════════════════════════"
if [[ -n "${FAILED_STEP}" ]]; then
    echo "  BUILD FAILED at ${FAILED_STEP}"
else
    echo "  BUILD COMPLETE"
fi
echo "  Total time: ${BUILD_ELAPSED}s"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Step timings:"
for timing in "${STEP_TIMES[@]}"; do
    echo "  ${timing}"
done

if [[ -n "${FAILED_STEP}" ]]; then
    echo ""
    echo "To resume from the failed step:"
    echo "  $0 --from ${FAILED_STEP:0:2}"
    exit 1
fi

echo ""
echo "Output directory: $(cd "${SCRIPT_DIR}" && pwd)/dist/guest/"

if [[ -n "${DEPLOY_TO}" ]]; then
    echo ""
    bash "${STEPS_DIR}/09-deploy.sh" "${DEPLOY_TO}"
else
    echo ""
    echo "To deploy: $0 --deploy-to <target-dir>"
fi
