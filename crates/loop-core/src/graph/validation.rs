use std::collections::{BTreeMap, BTreeSet};

use thiserror::Error;

use crate::task::{Task, TaskId};

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum GraphError {
    #[error("task id is duplicated")]
    DuplicateTask,
    #[error("task {task} depends on missing task {dependency}")]
    MissingDependency { task: TaskId, dependency: TaskId },
    #[error("task dependency cycle contains {task}")]
    Cycle { task: TaskId },
}

pub(super) fn validate(tasks: &BTreeMap<TaskId, Task>) -> Result<(), GraphError> {
    for task in tasks.values() {
        for dependency in &task.dependencies {
            if !tasks.contains_key(dependency) {
                return Err(GraphError::MissingDependency {
                    task: task.id.clone(),
                    dependency: dependency.clone(),
                });
            }
        }
    }
    let mut complete = BTreeSet::new();
    let mut visiting = BTreeSet::new();
    for id in tasks.keys() {
        visit(id, tasks, &mut visiting, &mut complete)?;
    }
    Ok(())
}

fn visit(
    id: &TaskId,
    tasks: &BTreeMap<TaskId, Task>,
    visiting: &mut BTreeSet<TaskId>,
    complete: &mut BTreeSet<TaskId>,
) -> Result<(), GraphError> {
    if complete.contains(id) {
        return Ok(());
    }
    if !visiting.insert(id.clone()) {
        return Err(GraphError::Cycle { task: id.clone() });
    }
    for dependency in &tasks[id].dependencies {
        visit(dependency, tasks, visiting, complete)?;
    }
    visiting.remove(id);
    complete.insert(id.clone());
    Ok(())
}
