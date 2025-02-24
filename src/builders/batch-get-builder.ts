import { type BetterDDB } from "../betterddb";
import { BatchGetCommand } from "@aws-sdk/lib-dynamodb";
import { type BatchGetItemInput } from "@aws-sdk/client-dynamodb";

export class BatchGetBuilder<T> {
  /**
   * @param parent - The BetterDDB instance for the table.
   * @param keys - An array of partial keys for the items you wish to retrieve.
   */
  constructor(
    private parent: BetterDDB<T>,
    private keys: Partial<T>[],
  ) {}

  /**
   * Executes the batch get operation.
   * Returns an array of parsed items of type T.
   */
  public async execute(): Promise<T[]> {
    if (this.keys.length === 0) {
      return [];
    }

    const seen = new Set();
    const deduplicatedKeys = this.keys.filter((key) => {
      const keyString = JSON.stringify(key);
      if (seen.has(keyString)) {
        return false;
      }
      seen.add(keyString);
      return true;
    });
    const tableName = this.parent.getTableName();
    // Build an array of keys using the parent's key builder.
    const keysArray = deduplicatedKeys.map((key) => this.parent.buildKey(key));

    // Construct the BatchGet parameters.
    const params: BatchGetItemInput = {
      RequestItems: {
        [tableName]: {
          Keys: keysArray,
        },
      },
    };

    const result = await this.parent
      .getClient()
      .send(new BatchGetCommand(params));
    const responses = result.Responses ? result.Responses[tableName] : [];
    if (!responses) {
      return [];
    }

    return this.parent.getSchema().array().parse(responses) as T[];
  }
}
