use std::collections::BTreeMap;

use crate::task::{Task, TaskId, TaskState};

use super::validation::{validate, GraphError};

#[derive(Clone, Debug)]
pub struct TaskGraph {
    tasks: BTreeMap<TaskId, Task>,
}

impl TaskGraph {
    pub fn new(tasks: impl IntoIterator<Item = Task>) -> Result<Self, GraphError> {
        let mut values = BTreeMap::new();
        for task in tasks {
            if values.insert(task.id.clone(), task).is_some() {
                return Err(GraphError::DuplicateTask);
            }
        }
        validate(&values)?;
        Ok(Self { tasks: values })
    }

    pub fn task(&self, id: &TaskId) -> Option<&Task> {
        self.tasks.get(id)
    }

    pub fn task_mut(&mut self, id: &TaskId) -> Option<&mut Task> {
        self.tasks.get_mut(id)
    }

    pub fn tasks(&self) -> impl Iterator<Item = &Task> {
        self.tasks.values()
    }

    pub fn dependencies_done(&self, task: &Task) -> bool {
        task.dependencies.iter().all(|dependency| {
            self.tasks
                .get(dependency)
                .is_some_and(|value| value.state == TaskState::Done)
        })
    }
}
