export const MEMORY_TRANSACTION_STATE = Symbol("ghostwriter.memoryTransactionState");

export type MemoryTransactionParticipant = Readonly<{
  snapshot(): unknown;
  restore(snapshot: unknown): void;
}>;

export type MemoryTransactionalRepository = {
  [MEMORY_TRANSACTION_STATE]?: MemoryTransactionParticipant;
};
