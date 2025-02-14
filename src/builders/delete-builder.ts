import { DynamoDB } from 'aws-sdk';
import { BetterDDB } from '../betterddb';

export class DeleteBuilder<T> {
  private condition?: { expression: string; attributeValues: Record<string, any> };

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
