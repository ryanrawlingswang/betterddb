import { DynamoDB } from 'aws-sdk';
import { BetterDDB } from '../betterddb';

export class DeleteBuilder<T> {
  private condition?: { expression: string; attributeValues: Record<string, any> };
  private extraTransactItems: DynamoDB.DocumentClient.TransactWriteItemList = [];
  constructor(private parent: BetterDDB<T>, private key: Partial<T>) {}

  /**
   * Specify a condition expression for the delete operation.
   */
  public withCondition(expression: string, attributeValues: Record<string, any>): this {
    if (this.condition) {
      this.condition.expression += ` AND ${expression}`;
      Object.assign(this.condition.attributeValues, attributeValues);
    } else {
      this.condition = { expression, attributeValues };
    }
    return this;
  }

  public async execute(): Promise<void> {
    if (this.extraTransactItems.length > 0) {
      // Build our update transaction item.
      const myTransactItem = this.toTransactDelete();
      // Combine with extra transaction items.
      const allItems = [...this.extraTransactItems, myTransactItem];
      await this.parent.getClient().transactWrite({
        TransactItems: allItems
      }).promise();
      // After transaction, retrieve the updated item.
      const result = await this.parent.get(this.key).execute();
      if (result === null) {
        throw new Error('Item not found after transaction delete');
      }
    } else {
    const params: DynamoDB.DocumentClient.DeleteItemInput = {
      TableName: this.parent.getTableName(),
      Key: this.parent.buildKey(this.key)
    };
    if (this.condition) {
      params.ConditionExpression = this.condition.expression;
        params.ExpressionAttributeValues = this.condition.attributeValues;
      }
      await this.parent.getClient().delete(params).promise();
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

  public toTransactDelete(): DynamoDB.DocumentClient.TransactWriteItem {
    const deleteItem: DynamoDB.DocumentClient.Delete = {
      TableName: this.parent.getTableName(),
      Key: this.parent.buildKey(this.key)
    };
    if (this.condition) {
      deleteItem.ConditionExpression = this.condition.expression;
      deleteItem.ExpressionAttributeValues = this.condition.attributeValues;
    }
    return { Delete: deleteItem };
  }

  public then<TResult1 = void, TResult2 = never>(
    onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
  public catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<void | TResult> {
    return this.execute().catch(onrejected);
  }
  public finally(onfinally?: (() => void) | null): Promise<void> {
    return this.execute().finally(onfinally);
  }
}
