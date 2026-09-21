#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Capacity {
    pub max_workers: usize,
    pub max_frontier_workers: usize,
}

impl Capacity {
    pub const fn new(max_workers: usize, max_frontier_workers: usize) -> Self {
        Self {
            max_workers,
            max_frontier_workers,
        }
    }
}
