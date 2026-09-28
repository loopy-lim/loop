use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct WorkOwnership {
    pub read_scope: Vec<String>,
    pub write_scope: Vec<String>,
}

impl WorkOwnership {
    pub fn new<R, W, RS, WS>(read_scope: R, write_scope: W) -> Self
    where
        R: IntoIterator<Item = RS>,
        W: IntoIterator<Item = WS>,
        RS: Into<String>,
        WS: Into<String>,
    {
        Self {
            read_scope: normalize_all(read_scope),
            write_scope: normalize_all(write_scope),
        }
    }

    pub fn write_scope_contains(&self, path: &str) -> bool {
        self.write_scope
            .iter()
            .any(|scope| scope_matches_path(scope, path))
    }

    /// These are observations in a shared worktree, never authorship claims.
    pub fn observed_outside_write_scope(&self, paths: &[String]) -> Vec<String> {
        let mut outside: Vec<_> = paths
            .iter()
            .filter(|path| !self.write_scope_contains(path))
            .cloned()
            .collect();
        outside.sort();
        outside.dedup();
        outside
    }
}

fn scope_matches_path(scope: &str, path: &str) -> bool {
    if scope == "." {
        return true;
    }
    if path.starts_with('/') || path.split('/').any(|part| part == "..") {
        return false;
    }
    let pattern = scope.strip_prefix("./").unwrap_or(scope).as_bytes();
    let path = path.as_bytes();
    let mut memo = std::collections::HashMap::new();
    fn matches(
        pattern: &[u8],
        path: &[u8],
        at_pattern: usize,
        at_path: usize,
        memo: &mut std::collections::HashMap<(usize, usize), bool>,
    ) -> bool {
        if let Some(result) = memo.get(&(at_pattern, at_path)) {
            return *result;
        }
        let result = if at_pattern == pattern.len() {
            at_path == path.len()
        } else if pattern[at_pattern] == b'*' && pattern.get(at_pattern + 1) == Some(&b'*') {
            matches(pattern, path, at_pattern + 2, at_path, memo)
                || (at_path < path.len() && matches(pattern, path, at_pattern, at_path + 1, memo))
        } else if pattern[at_pattern] == b'*' {
            matches(pattern, path, at_pattern + 1, at_path, memo)
                || (at_path < path.len()
                    && path[at_path] != b'/'
                    && matches(pattern, path, at_pattern, at_path + 1, memo))
        } else if pattern[at_pattern] == b'?' {
            at_path < path.len()
                && path[at_path] != b'/'
                && matches(pattern, path, at_pattern + 1, at_path + 1, memo)
        } else {
            at_path < path.len()
                && pattern[at_pattern] == path[at_path]
                && matches(pattern, path, at_pattern + 1, at_path + 1, memo)
        };
        memo.insert((at_pattern, at_path), result);
        result
    }
    matches(pattern, path, 0, 0, &mut memo)
}

fn normalize_all<I, S>(values: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let mut values: Vec<_> = values
        .into_iter()
        .map(Into::into)
        .map(|value: String| {
            if [".", "./"].contains(&value.trim()) {
                return ".".to_string();
            }
            value.trim().trim_start_matches("./").to_string()
        })
        .filter(|value| !value.is_empty())
        .collect();
    values.sort();
    values.dedup();
    values
}
