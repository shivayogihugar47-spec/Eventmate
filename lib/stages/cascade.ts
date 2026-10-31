// TODO: Stage – CASCADE
//
// Responsibility: propagate schedule changes when a task is delayed or
// completed late.  Re-compute start_times for all dependent tasks and
// notify affected owners.
//
// Expected exports:
//   - cascadeFromTask(taskId: string, newStartTime: Date): Promise<void>
//       Performs a breadth-first traversal of tasks.depends_on to shift
//       downstream tasks and persist updated start_times.
//   - detectConflicts(eventId: string): Promise<TaskConflict[]>
//       Returns tasks whose recalculated windows overlap with hard constraints
//       (venue close time, curfew, etc.).
