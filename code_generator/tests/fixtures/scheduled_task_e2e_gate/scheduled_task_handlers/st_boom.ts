// scheduled-task-e2e-gate handler for st_boom: always fails, so a run of it is recorded `failed`.
export async function runBoom(systemActorId: string): Promise<void> {
  void systemActorId;
  throw new Error('st_boom always fails');
}
