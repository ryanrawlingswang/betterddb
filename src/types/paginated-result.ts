export type PaginatedResult<T> = {
  items: T[];
  lastKey: Record<string, any> | undefined;
};
