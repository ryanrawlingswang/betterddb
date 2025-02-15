import { DynamoDB } from 'aws-sdk';
import { BetterDDB } from '../betterddb';
import { z } from 'zod';

export class CreateBuilder<S extends z.ZodType<any>> {
  private extraTransactItems: DynamoDB.DocumentClient.TransactWriteItemList = [];

  constructor(private parent: BetterDDB<S>, private item: S) {}

  public async execute(): Promise<S> {
    if (this.extraTransactItems.length > 0) {
      // Build our update transaction item.
      const myTransactItem = this.toTransactPut();
      // Combine with extra transaction items.
      const allItems = [...this.extraTransactItems, myTransactItem];
      await this.parent.getClient().transactWrite({
        TransactItems: allItems
      }).promise();
      // After transaction, retrieve the updated item.
      const result = await this.parent.get(this.item).execute();
      if (result === null) {
        throw new Error('Item not found after transaction create');
      }
      return result;
    } else {
    let item = this.item;
    if (this.parent.getAutoTimestamps()) {
      const now = new Date().toISOString();
      item = { ...item, createdAt: now, updatedAt: now } as S;
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
  }

  public transactWrite(ops: DynamoDB.DocumentClient.TransactWriteItemList | DynamoDB.DocumentClient.TransactWriteItem): this {
    if (Array.isArray(ops)) {
      this.extraTransactItems.push(...ops);
    } else {
      this.extraTransactItems.push(ops);
    }
    return this;
  }

  public toTransactPut(): DynamoDB.DocumentClient.TransactWriteItem {
    const putItem: DynamoDB.DocumentClient.Put = {
      TableName: this.parent.getTableName(),
      Item: this.item as DynamoDB.DocumentClient.PutItemInputAttributeMap,
    };
    return { Put: putItem };
  }

  public then<TResult1 = S, TResult2 = never>(
    onfulfilled?: ((value: S) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
  public catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<S | TResult> {
    return this.execute().catch(onrejected);
  }
  public finally(onfinally?: (() => void) | null): Promise<S> {
    return this.execute().finally(onfinally);
  }
}
