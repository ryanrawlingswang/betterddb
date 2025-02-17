import { BetterDDB } from '../betterddb';
import { TransactWriteItem, DeleteItemInput } from '@aws-sdk/client-dynamodb';
import { TransactWriteCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
export class DeleteBuilder<T> {
  private condition?: { expression: string; attributeValues: Record<string, any> };
  private extraTransactItems: TransactWriteItem[] = [];
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
      await this.parent.getClient().send(new TransactWriteCommand({
        TransactItems: allItems
      }));
      // After transaction, retrieve the updated item.
      const result = await this.parent.get(this.key).execute();
      if (result === null) {
        throw new Error('Item not found after transaction delete');
      }
    } else {
    const params: DeleteItemInput = {
      TableName: this.parent.getTableName(),
      Key: this.parent.buildKey(this.key)
    };
    if (this.condition) {
      params.ConditionExpression = this.condition.expression;
        params.ExpressionAttributeValues = this.condition.attributeValues;
      }
      await this.parent.getClient().send(new DeleteCommand(params));
    }
  }

  public transactWrite(ops: TransactWriteItem[] | TransactWriteItem): this {
    if (Array.isArray(ops)) {
      this.extraTransactItems.push(...ops);
    } else {
      this.extraTransactItems.push(ops);
    }
    return this;
  }

  public toTransactDelete(): TransactWriteItem {
    const deleteItem: DeleteItemInput = {
      TableName: this.parent.getTableName(),
      Key: this.parent.buildKey(this.key)
    };
    if (this.condition) {
      deleteItem.ConditionExpression = this.condition.expression;
      deleteItem.ExpressionAttributeValues = this.condition.attributeValues;
    }
    return { Delete: deleteItem };
  }
}
