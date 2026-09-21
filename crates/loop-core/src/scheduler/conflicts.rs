pub fn write_scopes_overlap(left: &[String], right: &[String]) -> bool {
    left.iter().any(|left| {
        right
            .iter()
            .any(|right| normalized_prefix(left, right) || normalized_prefix(right, left))
    })
}

fn normalized_prefix(parent: &str, child: &str) -> bool {
    let parent = parent.trim_end_matches("/**").trim_end_matches('/');
    let child = child.trim_end_matches("/**").trim_end_matches('/');
    parent == child
        || child
            .strip_prefix(parent)
            .is_some_and(|rest| rest.starts_with('/'))
}
