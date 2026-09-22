pub fn write_scopes_overlap(left: &[String], right: &[String]) -> bool {
    left.iter().any(|left| {
        right
            .iter()
            .any(|right| normalized_prefix(left, right) || normalized_prefix(right, left))
    })
}

fn normalized_prefix(parent: &str, child: &str) -> bool {
    let prefix = |scope: &str| -> String {
        let parts: Vec<_> = scope
            .split('/')
            .take_while(|part| !part.contains(['*', '?', '[', '{']))
            .filter(|part| !part.is_empty() && *part != ".")
            .collect();
        parts.join("/")
    };
    let parent = prefix(parent);
    let child = prefix(child);
    parent.is_empty()
        || child.is_empty()
        || parent == child
        || child
            .strip_prefix(&parent)
            .is_some_and(|rest| rest.starts_with('/'))
}
