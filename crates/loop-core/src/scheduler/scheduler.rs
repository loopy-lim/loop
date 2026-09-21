use crate::graph::TaskGraph;
use crate::policy::ComputeClass;
use crate::task::{Task, TaskId, TaskState};

use super::{write_scopes_overlap, Capacity};

#[derive(Clone, Copy, Debug)]
pub struct Scheduler {
    capacity: Capacity,
}

impl Scheduler {
    pub const fn new(capacity: Capacity) -> Self {
        Self { capacity }
    }

    pub fn claim_runnable(&self, graph: &TaskGraph, running: &[TaskId]) -> Vec<TaskId> {
        if running.len() >= self.capacity.max_workers {
            return Vec::new();
        }
        let running_tasks: Vec<_> = running.iter().filter_map(|id| graph.task(id)).collect();
        if running_tasks.iter().any(|task| task.kind.is_serial()) {
            return Vec::new();
        }
        let mut claimed: Vec<&Task> = Vec::new();
        let mut frontier = running_tasks
            .iter()
            .filter(|task| task.preferred_compute == ComputeClass::Frontier)
            .count();
        for task in graph.tasks() {
            if claimed.len() + running.len() >= self.capacity.max_workers {
                break;
            }
            if !matches!(task.state, TaskState::Pending | TaskState::Ready)
                || !graph.dependencies_done(task)
            {
                continue;
            }
            if task.kind.is_serial() {
                if running.is_empty() && claimed.is_empty() {
                    claimed.push(task);
                }
                break;
            }
            if task.preferred_compute == ComputeClass::Frontier {
                if frontier >= self.capacity.max_frontier_workers {
                    continue;
                }
                frontier += 1;
            }
            if running_tasks
                .iter()
                .chain(claimed.iter())
                .any(|other| tasks_conflict(task, other))
            {
                continue;
            }
            claimed.push(task);
        }
        claimed.into_iter().map(|task| task.id.clone()).collect()
    }
}

fn tasks_conflict(left: &Task, right: &Task) -> bool {
    if (left.kind.requires_explicit_write_scope() && left.ownership.write_scope.is_empty())
        || (right.kind.requires_explicit_write_scope() && right.ownership.write_scope.is_empty())
    {
        return true;
    }
    write_scopes_overlap(&left.ownership.write_scope, &right.ownership.write_scope)
}
