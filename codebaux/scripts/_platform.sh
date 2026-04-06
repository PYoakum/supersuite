#!/usr/bin/env bash
# Portable wrappers for GNU vs BSD (macOS) tool differences.
# Source this file: . "$(dirname "${BASH_SOURCE[0]}")/_platform.sh"

# file_size <path> — print file size in bytes
file_size() {
    if stat -c %s "$1" 2>/dev/null; then
        return
    fi
    stat -f %z "$1"
}

# dir_size <path> — print directory size in bytes
dir_size() {
    if du -sb "$1" 2>/dev/null | cut -f1; then
        return
    fi
    # macOS: du -sk gives KB
    echo $(( $(du -sk "$1" | cut -f1) * 1024 ))
}

# sha256 <path> — print SHA-256 hash
sha256() {
    if command -v sha256sum &>/dev/null; then
        sha256sum "$1" | cut -d' ' -f1
    else
        shasum -a 256 "$1" | cut -d' ' -f1
    fi
}
