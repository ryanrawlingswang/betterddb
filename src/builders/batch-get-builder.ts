import { BetterDDB } from '../betterddb';
import { BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { BatchGetItemInput } from '@aws-sdk/client-dynamodb';

export class BatchGetBuilder<T> {
  private projectionExpression?: string;
  private expressionAttributeNames: Record<string, string> = {};

  /**
   * @param parent - The BetterDDB instance for the table.
   * @param keys - An array of partial keys for the items you wish to retrieve.
   */
  constructor(private parent: BetterDDB<T>, private keys: Partial<T>[]) {}

  /**
   * Specify a projection by providing an array of attribute names.
   */
  public withProjection(attributes: (keyof T)[]): this {
    this.projectionExpression = attributes.map(attr => `#${String(attr)}`).join(', ');
    for (const attr of attributes) {
      this.expressionAttributeNames[`#${String(attr)}`] = String(attr);
    }
    return this;
  }

  /**
   * Executes the batch get operation.
   * Returns an array of parsed items of type T.
   */
  public async execute(): Promise<T[]> {
    const tableName = this.parent.getTableName();
    // Build an array of keys using the parent's key builder.
    const keysArray = this.keys.map(key => this.parent.buildKey(key));

    // Construct the BatchGet parameters.
    const params: BatchGetItemInput = {
      RequestItems: {
        [tableName]: {
          Keys: keysArray,
          ...(this.projectionExpression && {
            ProjectionExpression: this.projectionExpression,
            ExpressionAttributeNames: this.expressionAttributeNames,
          }),
        },
      },
    };

    const result = await this.parent.getClient().send(new BatchGetCommand(params));
    const responses = result.Responses ? result.Responses[tableName] : [];
    if (!responses) {
      return [];
    }

    return this.parent.getSchema().array().parse(responses) as T[];
  }

  public then<TResult1 = T[], TResult2 = never>(
    onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  public catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<T[] | TResult> {
    return this.execute().catch(onrejected);
  }

  public finally(onfinally?: (() => void) | null): Promise<T[]> {
    return this.execute().finally(onfinally);
  }
}
