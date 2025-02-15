import { DynamoDB } from 'aws-sdk';
import { BetterDDB } from '../betterddb';
import { z } from 'zod';

export class GetBuilder<S extends z.ZodType<any>> {
  private projectionExpression?: string;
  private expressionAttributeNames: Record<string, string> = {};
  private extraTransactItems: DynamoDB.DocumentClient.TransactGetItemList = [];
  constructor(private parent: BetterDDB<S>, private key: Partial<S>) {}

  /**
   * Specify a projection by providing an array of attribute names.
   */
  public withProjection(attributes: (keyof S)[]): this {
    this.projectionExpression = attributes.map(attr => `#${String(attr)}`).join(', ');
    for (const attr of attributes) {
      this.expressionAttributeNames[`#${String(attr)}`] = String(attr);
    }
    return this;
  }

  public async execute(): Promise<S | null> {
    if (this.extraTransactItems.length > 0) {
      // Build our update transaction item.
      const myTransactItem = this.toTransactGet();
      // Combine with extra transaction items.
      const allItems = [...this.extraTransactItems, myTransactItem];
      await this.parent.getClient().transactGet({
        TransactItems: allItems
      }).promise();
      // After transaction, retrieve the updated item.
      const result = await this.parent.get(this.key).execute();
      return result;
    } else {
    const params: DynamoDB.DocumentClient.GetItemInput = {
      TableName: this.parent.getTableName(),
      Key: this.parent.buildKey(this.key)
    };
    if (this.projectionExpression) {
      params.ProjectionExpression = this.projectionExpression;
      params.ExpressionAttributeNames = this.expressionAttributeNames;
    }
    const result = await this.parent.getClient().get(params).promise();
    if (!result.Item) return null;
      return this.parent.getSchema().parse(result.Item);
    }
  }

  public transactGet(ops: DynamoDB.DocumentClient.TransactGetItemList | DynamoDB.DocumentClient.TransactGetItem): this {
    if (Array.isArray(ops)) {
      this.extraTransactItems.push(...ops);
    } else {
      this.extraTransactItems.push(ops);
    }
    return this;
  }

  public toTransactGet(): DynamoDB.DocumentClient.TransactGetItem {
    const getItem: DynamoDB.DocumentClient.Get = {
      TableName: this.parent.getTableName(),
      Key: this.parent.buildKey(this.key)
    };
    if (this.projectionExpression) {
      getItem.ProjectionExpression = this.projectionExpression;
      getItem.ExpressionAttributeNames = this.expressionAttributeNames;
    }
    return { Get: getItem };
  }

  public then<TResult1 = S | null, TResult2 = never>(
    onfulfilled?: ((value: S | null) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
  public catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<S | null | TResult> {
    return this.execute().catch(onrejected);
  }
  public finally(onfinally?: (() => void) | null): Promise<S | null> {
    return this.execute().finally(onfinally);
  }
}
