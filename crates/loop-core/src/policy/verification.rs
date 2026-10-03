//! Deterministic attribution policy for completion-check source receipts.
//!
//! A receipt's `observed_outside_write_scope` lists repository paths that
//! changed outside the task's declared write scope while the worker ran.
//! Shared-tree observation cannot establish which actor wrote a path, and a
//! task's own declared completion checks legitimately produce tool output
//! (build artifacts, dependency caches, generated files) outside the source
//! scopes the task may edit. This module is the single deterministic policy
//! that separates such generated output from genuine source edits, so
//! criterion verification blocks on edits, not on a check's own side effects.

/// Directory names that build tools, package managers, and test runners write
/// as side effects. Matching is by full path segment, so nested tool output
/// (`packages/ui/node_modules/…`, `crates/foo/target/…`) is covered without
/// exempting sibling source names (`build-config`, `outbox`).
const GENERATED_DIRECTORIES: &[&str] = &[
    // Rust / systems toolchains
    "target",
    "build",
    "out",
    "dist",
    "zig-cache",
    "zig-out",
    ".gradle",
    ".stack-work",
    // Node / TypeScript toolchains
    "node_modules",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".turbo",
    ".parcel-cache",
    // Python toolchains
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".venv",
    // Coverage and generic caches
    "coverage",
    ".cache",
];

/// File names that are tool noise rather than source edits.
const GENERATED_FILES: &[&str] = &[".DS_Store"];

/// File suffixes for incremental-build and bytecode caches.
const GENERATED_SUFFIXES: &[&str] = &[".tsbuildinfo", ".pyc", ".pyo"];

/// Whether `path` is generated tool output that a declared completion check
/// may write outside the task's write scope. Such paths never block criterion
/// verification; every other path observed outside the write scope still does.
///
/// Absolute paths and `..`-escaping paths point outside the audited repository
/// tree, so they are never exempted.
pub fn is_check_side_effect_path(path: &str) -> bool {
    let normalized = path.strip_prefix("./").unwrap_or(path);
    if normalized.starts_with('/') || normalized.split('/').any(|part| part == "..") {
        return false;
    }
    let mut segments = normalized.split('/');
    let file = segments.next_back().unwrap_or("");
    if segments
        .chain(std::iter::once(file))
        .any(|part| GENERATED_DIRECTORIES.contains(&part))
    {
        return true;
    }
    GENERATED_FILES.contains(&file)
        || GENERATED_SUFFIXES
            .iter()
            .any(|suffix| file.ends_with(suffix))
}

#[cfg(test)]
mod attribution_tests {
    use super::is_check_side_effect_path;

    #[test]
    fn build_and_dependency_output_is_exempt() {
        assert!(is_check_side_effect_path("target/debug/libloop_core.rlib"));
        assert!(is_check_side_effect_path("target"));
        assert!(is_check_side_effect_path(
            "crates/foo/target/debug/deps/x.d"
        ));
        assert!(is_check_side_effect_path("node_modules/.bin/vitest"));
        assert!(is_check_side_effect_path(
            "packages/ui/node_modules/vite/dist/index.js"
        ));
        assert!(is_check_side_effect_path(
            "./target/debug/build/app-123/output"
        ));
        assert!(is_check_side_effect_path("tsconfig.tsbuildinfo"));
        assert!(is_check_side_effect_path("src/generated/parser.pyc"));
    }

    #[test]
    fn source_edits_are_never_exempt() {
        assert!(!is_check_side_effect_path("docs/notes.md"));
        assert!(!is_check_side_effect_path("src/impl.rs"));
        assert!(!is_check_side_effect_path("build-config/defaults.rs"));
        assert!(!is_check_side_effect_path("outcome/summary.md"));
        assert!(!is_check_side_effect_path(""));
    }

    #[test]
    fn paths_outside_the_audited_tree_still_block() {
        assert!(!is_check_side_effect_path("/tmp/target/debug/x"));
        assert!(!is_check_side_effect_path("../target/debug/x"));
        assert!(!is_check_side_effect_path("src/../../target/x"));
    }
}
