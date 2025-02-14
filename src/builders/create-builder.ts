import { DynamoDB } from 'aws-sdk';
import { BetterDDB } from '../betterddb';

export class CreateBuilder<T> {
  constructor(private parent: BetterDDB<T>, private item: T) {}

  public async execute(): Promise<T> {
    let item = this.item;
    if (this.parent.getAutoTimestamps()) {
      const now = new Date().toISOString();
      item = { ...item, createdAt: now, updatedAt: now } as T;
    }
    // Validate the item using the schema.
    const validated = this.parent.getSchema().parse(item);
    let finalItem = { ...validated };

    // Compute and merge primary key.
    const computedKeys = this.parent.buildKey(validated);
    finalItem = { ...finalItem, ...computedKeys };

    // Compute and merge index attributes.
    const indexAttributes = this.parent.buildIndexes(validated);
    finalItem = { ...finalItem, ...indexAttributes };

    await this.parent.getClient().put({
      TableName: this.parent.getTableName(),
      Item: finalItem as DynamoDB.DocumentClient.PutItemInputAttributeMap
    }).promise();

    return validated;
  }

  public then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
  public catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<T | TResult> {
    return this.execute().catch(onrejected);
  }
  public finally(onfinally?: (() => void) | null): Promise<T> {
    return this.execute().finally(onfinally);
  }
}
