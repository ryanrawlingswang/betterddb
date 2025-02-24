import { type NativeAttributeValue } from "@aws-sdk/lib-dynamodb";

export type PaginatedResult<T> = {
  items: T[];
  lastKey: Record<string, NativeAttributeValue> | undefined;
};
