#!/bin/bash

set -euo pipefail

script_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
node "$script_directory/../../../scripts/integration-db.mjs" check

test_arguments=(--quiet)
selected_test_target=false

for argument in "$@"; do
    # Harness arguments after the separator are not Cargo target selectors.
    if [ "$argument" = "--" ]; then
        break
    fi
    case "$argument" in
        --test|--test=*)
            selected_test_target=true
            ;;
    esac
done

if [ "$selected_test_target" = false ]; then
    test_arguments+=(--tests)
fi

export DATABASE_URL=postgresql://admin:admin@localhost:5433/central
exec cargo test "${test_arguments[@]}" "$@"
