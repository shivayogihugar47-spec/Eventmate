// TODO: Stage – RUN
//
// Responsibility: manage day-of execution; handle status updates, expense
// tracking, and real-time re-scheduling.
//
// Expected exports:
//   - completeTask(taskId: string): Promise<void>
//       Marks a task complete, records actual time, triggers cascade check.
//   - addExpense(eventId: string, vendor: string, amount: number, category: string): Promise<void>
//       Inserts a row into `expenses` and updates budget_items.actual.
//   - getRunSummary(eventId: string): Promise<RunSummary>
//       Returns completed/pending task counts and budget spent vs allocated.
