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
            value
                .trim()
                .trim_start_matches("./")
                .trim_end_matches('/')
                .to_string()
        })
        .filter(|value| !value.is_empty())
        .collect();
    values.sort();
    values.dedup();
    values
}
