#!/usr/bin/env bash
# Stamps version and appVersion into Chart.yaml before packaging.
# The image repository lives in values.yaml (static). The image tag is derived
# from Chart.appVersion at deploy time via the deployment template
# (`.Values.image.tag | default .Chart.AppVersion`).
# Used by CI (build-publish, release) and available for local testing.
#
# Usage:
#   ./scripts/update-chart-versions.sh <chart-version> <app-version>
#
# Example (local):
#   ./scripts/update-chart-versions.sh 0.1.0 sha-abc1234

set -euo pipefail

CHART_VERSION="${1:?Usage: $0 <chart-version> <app-version>}"
APP_VERSION="${2:?Usage: $0 <chart-version> <app-version>}"

CHART_DIR="$(git rev-parse --show-toplevel)/charts/xero-mcp"

# Portable in-place sed (macOS requires '' after -i, GNU sed does not)
_sed_i() { sed -i.bak "$@" && rm -f "${@: -1}.bak"; }

# Chart.yaml — version and appVersion
_sed_i "s/^version: 0\.0\.0/version: ${CHART_VERSION}/" "$CHART_DIR/Chart.yaml"
_sed_i "s/^appVersion: \"0\.0\.0\"/appVersion: \"${APP_VERSION}\"/" "$CHART_DIR/Chart.yaml"

echo "Chart updated: version=${CHART_VERSION} appVersion=${APP_VERSION}"
